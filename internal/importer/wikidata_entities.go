package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	// wikidataAPI is the MediaWiki action API on Wikidata.
	wikidataAPI = "https://www.wikidata.org/w/api.php"
	// wikidataEntityBatch is the wbgetentities id cap for unauthenticated clients.
	wikidataEntityBatch = 50
	// wikidataFactsNamespace caches the date, conflict and class facts per Q-id.
	wikidataFactsNamespace = "wikidata-dates"
	// wikidataLabelsNamespace caches English labels per Q-id.
	wikidataLabelsNamespace = "wikidata-labels"
)

// ErrWikidataBusy reports that Wikidata answered 429 or maxlag twice in a row.
var ErrWikidataBusy = errors.New("wikidata api busy after one retry")

// wikidataTimeRe reads a Wikidata time value such as "+1896-03-01T00:00:00Z".
var wikidataTimeRe = regexp.MustCompile(`^([+-])(\d+)-(\d{2})-(\d{2})T`)

// wikidataFacts holds what Wikidata says about one item, as cached on disk.
type wikidataFacts struct {
	// Missing is true when Wikidata has no such item.
	Missing bool `json:"missing,omitempty"`
	// Date is the P585 point in time, else the P580 start, as a padded ISO date.
	Date string `json:"date,omitempty"`
	// Precision is the Wikidata precision of Date: 9 year, 10 month, 11 day.
	Precision int `json:"precision,omitempty"`
	// End is the P582 end time when Date came from P580, as a padded ISO date.
	End string `json:"end,omitempty"`
	// EndPrecision is the Wikidata precision of End.
	EndPrecision int `json:"endPrecision,omitempty"`
	// Conflicts holds the P607 Q-ids in claim order, preferred rank first.
	Conflicts []string `json:"conflicts,omitempty"`
	// Instances holds the P31 Q-ids in claim order, preferred rank first.
	Instances []string `json:"instances,omitempty"`
}

// WikidataDatesReport summarizes one -wikidata-dates run.
type WikidataDatesReport struct {
	// Pending is the number of rows that had no Wikidata facts at the start.
	Pending int
	// Checked is the number of rows written this run.
	Checked int
	// WithDate is the number of written rows that got a Wikidata date.
	WithDate int
	// Missing is the number of written rows whose Q-id Wikidata does not have.
	Missing int
	// DumpCompared is the number of written rows whose year could be compared with the raw dump.
	DumpCompared int
	// DumpDisagree is the number of compared rows whose live year differs from the dump.
	DumpDisagree int
}

// BackfillWikidataDates fills the wikidata_* columns for every wikidata row that
// has not been checked yet, from wbgetentities in batches of 50 Q-ids. Responses
// are cached per Q-id, so a stopped run resumes where it ended. rawDumpPath is
// the SPARQL dump used only to count how far live Wikidata has moved from it.
func BackfillWikidataDates(ctx context.Context, db *sql.DB, rawDumpPath string) (WikidataDatesReport, error) {
	var rep WikidataDatesReport
	dump, err := loadDumpYears(rawDumpPath)
	if err != nil {
		return rep, err
	}
	rows, err := db.QueryContext(ctx, `SELECT id, source_id FROM battles
		WHERE source = 'wikidata' AND source_id LIKE 'Q%' AND wikidata_checked = '' ORDER BY id`)
	if err != nil {
		return rep, fmt.Errorf("query unchecked rows: %w", err)
	}
	byQID := map[string][]string{}
	var qids []string
	for rows.Next() {
		var id, qid string
		if err := rows.Scan(&id, &qid); err != nil {
			rows.Close()
			return rep, fmt.Errorf("scan unchecked row: %w", err)
		}
		if _, ok := byQID[qid]; !ok {
			qids = append(qids, qid)
		}
		byQID[qid] = append(byQID[qid], id)
		rep.Pending++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return rep, fmt.Errorf("iterate unchecked rows: %w", err)
	}
	log.Printf("wikidata-dates: %d rows, %d Q-ids to check", rep.Pending, len(qids))

	checked := time.Now().UTC().Format("2006-01-02")
	for start := 0; start < len(qids); start += wikidataEntityBatch {
		batch := qids[start:min(start+wikidataEntityBatch, len(qids))]
		facts, err := wikidataFactsFor(ctx, wikidataAPI, batch)
		if err != nil {
			return rep, fmt.Errorf("facts batch at %d: %w", start, err)
		}
		labels, err := wikidataLabelsFor(ctx, wikidataAPI, labelIDs(facts))
		if err != nil {
			return rep, fmt.Errorf("labels batch at %d: %w", start, err)
		}
		if err := writeWikidataFacts(ctx, db, batch, byQID, facts, labels, checked, dump, &rep); err != nil {
			return rep, err
		}
		log.Printf("wikidata-dates: %d/%d Q-ids", min(start+wikidataEntityBatch, len(qids)), len(qids))
	}
	return rep, nil
}

// writeWikidataFacts stores one batch of facts in one transaction and updates rep.
func writeWikidataFacts(ctx context.Context, db *sql.DB, batch []string, byQID map[string][]string,
	facts map[string]wikidataFacts, labels map[string]string, checked string, dump map[string]int,
	rep *WikidataDatesReport) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin facts tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET wikidata_date = ?, wikidata_precision = ?,
		wikidata_end = ?, wikidata_end_precision = ?, wikidata_conflict = ?, wikidata_instance_of = ?,
		wikidata_checked = ? WHERE id = ?`)
	if err != nil {
		return fmt.Errorf("prepare facts update: %w", err)
	}
	defer stmt.Close()
	for _, qid := range batch {
		f := facts[qid]
		conflict := joinLabels(f.Conflicts, labels)
		instance := joinLabels(f.Instances, labels)
		for _, id := range byQID[qid] {
			if _, err := stmt.ExecContext(ctx, f.Date, f.Precision, f.End, f.EndPrecision, conflict, instance,
				checked, id); err != nil {
				return fmt.Errorf("update facts for %s: %w", id, err)
			}
			rep.Checked++
			if f.Missing {
				rep.Missing++
			}
			if f.Date == "" {
				continue
			}
			rep.WithDate++
			dy, ok := dump[qid]
			if !ok || f.Precision < 9 {
				continue
			}
			rep.DumpCompared++
			if ly := parseWikidataYear(f.Date); ly != dy {
				rep.DumpDisagree++
				log.Printf("wikidata-dates: %s %s dump year %d, live year %d", id, qid, dy, ly)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit facts batch: %w", err)
	}
	return nil
}

// loadDumpYears reads the SPARQL dump and returns the year per Q-id. Unknown
// values and a missing file yield no entry.
func loadDumpYears(path string) (map[string]int, error) {
	out := map[string]int{}
	if path == "" {
		return out, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read raw dump: %w", err)
	}
	var dump sparqlResponse[sparqlBinding]
	if err := json.Unmarshal(raw, &dump); err != nil {
		return nil, fmt.Errorf("decode raw dump: %w", err)
	}
	for _, b := range dump.Results.Bindings {
		qid := wikidataID(b.Battle.Value)
		if qid == "" || !wikidataTimeLiteral(b.Date.Value) {
			continue
		}
		if _, seen := out[qid]; !seen {
			out[qid] = sparqlYear(b.Date.Value)
		}
	}
	return out, nil
}

// wikidataTimeLiteral reports whether a SPARQL date value is a literal date
// rather than an unknown-value blank node URI.
func wikidataTimeLiteral(v string) bool {
	return v != "" && !strings.HasPrefix(v, "http")
}

// labelIDs returns the distinct conflict and class Q-ids across facts.
func labelIDs(facts map[string]wikidataFacts) []string {
	seen := map[string]bool{}
	var out []string
	for _, f := range facts {
		for _, id := range append(append([]string{}, f.Conflicts...), f.Instances...) {
			if !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	return out
}

// joinLabels renders Q-ids as a pipe-joined label list, falling back to the
// Q-id for an item with no English label.
func joinLabels(ids []string, labels map[string]string) string {
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		l := labels[id]
		if l == "" {
			l = id
		}
		parts = append(parts, l)
	}
	return strings.Join(parts, "|")
}

// wikidataFactsFor returns the facts for each Q-id, from the cache when present
// and from one wbgetentities call to api for the rest.
func wikidataFactsFor(ctx context.Context, api string, qids []string) (map[string]wikidataFacts, error) {
	out := make(map[string]wikidataFacts, len(qids))
	var fetch []string
	for _, q := range qids {
		if s, ok := wikiCacheGet(wikidataFactsNamespace, q); ok {
			var f wikidataFacts
			if err := json.Unmarshal([]byte(s), &f); err == nil {
				out[q] = f
				continue
			}
		}
		fetch = append(fetch, q)
	}
	if len(fetch) == 0 {
		return out, nil
	}
	ents, err := fetchWikidataEntities(ctx, api, fetch, "claims")
	if err != nil {
		return nil, err
	}
	for _, q := range fetch {
		e, ok := ents[q]
		f := wikidataFacts{Missing: !ok || e.Missing != nil}
		if !f.Missing {
			f = factsFromClaims(e.Claims)
		}
		if b, err := json.Marshal(f); err == nil {
			wikiCacheSet(wikidataFactsNamespace, q, string(b))
		}
		out[q] = f
	}
	return out, nil
}

// wikidataLabelsFor returns the English label for each Q-id, cached per id.
func wikidataLabelsFor(ctx context.Context, api string, qids []string) (map[string]string, error) {
	out := make(map[string]string, len(qids))
	var fetch []string
	for _, q := range qids {
		if s, ok := wikiCacheGet(wikidataLabelsNamespace, q); ok {
			out[q] = s
			continue
		}
		fetch = append(fetch, q)
	}
	for start := 0; start < len(fetch); start += wikidataEntityBatch {
		batch := fetch[start:min(start+wikidataEntityBatch, len(fetch))]
		ents, err := fetchWikidataEntities(ctx, api, batch, "labels")
		if err != nil {
			return nil, err
		}
		for _, q := range batch {
			l := ents[q].Labels["en"].Value
			wikiCacheSet(wikidataLabelsNamespace, q, l)
			out[q] = l
		}
	}
	return out, nil
}

// wikidataEntity is one entity in a wbgetentities response.
type wikidataEntity struct {
	// Missing is present when the id does not exist.
	Missing *string `json:"missing"`
	// Redirects is present when the requested id redirects to another item.
	Redirects *struct {
		// From is the requested id.
		From string `json:"from"`
	} `json:"redirects"`
	// Labels holds the labels by language code.
	Labels map[string]struct {
		// Value is the label text.
		Value string `json:"value"`
	} `json:"labels"`
	// Claims holds the statements by property id.
	Claims map[string][]wikidataClaim `json:"claims"`
}

// wikidataClaim is one statement.
type wikidataClaim struct {
	// Rank is preferred, normal or deprecated.
	Rank string `json:"rank"`
	// Mainsnak is the statement's main value.
	Mainsnak struct {
		// Snaktype is value, somevalue or novalue.
		Snaktype string `json:"snaktype"`
		// Datavalue holds the raw value.
		Datavalue struct {
			// Value is a time object or an entity id object.
			Value json.RawMessage `json:"value"`
		} `json:"datavalue"`
	} `json:"mainsnak"`
}

// wikidataEntitiesResponse is the wbgetentities response body.
type wikidataEntitiesResponse struct {
	// Entities holds the entities keyed by resolved id.
	Entities map[string]wikidataEntity `json:"entities"`
	// Error is set when the API refused the request.
	Error *struct {
		// Code is the API error code, such as maxlag.
		Code string `json:"code"`
		// Info is the human-readable error.
		Info string `json:"info"`
		// ID is the offending id for a no-such-entity error.
		ID string `json:"id"`
	} `json:"error"`
}

// fetchWikidataEntities calls wbgetentities for qids and keys the result by
// requested id, so a redirected item lands under the id that was asked for. The
// API fails a whole call over one deleted id, so that id is dropped and the call
// repeated. A dropped id is absent from the result.
func fetchWikidataEntities(ctx context.Context, api string, qids []string,
	props string) (map[string]wikidataEntity, error) {
	ids := slices.Clone(qids)
	for len(ids) > 0 {
		out, missing, err := fetchWikidataEntitiesOnce(ctx, api, ids, props)
		if err != nil {
			return nil, err
		}
		if missing == "" {
			return out, nil
		}
		i := slices.Index(ids, missing)
		if i < 0 {
			return nil, fmt.Errorf("wbgetentities: no such entity %s outside the request", missing)
		}
		log.Printf("wikidata-dates: %s no longer exists on Wikidata", missing)
		ids = slices.Delete(ids, i, i+1)
	}
	return map[string]wikidataEntity{}, nil
}

// fetchWikidataEntitiesOnce makes one wbgetentities call, retrying once on 429
// or maxlag after the server's Retry-After. A non-empty missing id reports that
// the call failed because that id does not exist.
func fetchWikidataEntitiesOnce(ctx context.Context, api string, qids []string, props string) (map[string]wikidataEntity,
	string, error) {
	resp, wait, err := doWikidataEntities(ctx, api, qids, props)
	if err != nil {
		return nil, "", err
	}
	if wait > 0 {
		log.Printf("wikidata-dates: server busy, retrying once in %s", wait)
		select {
		case <-ctx.Done():
			return nil, "", ctx.Err()
		case <-time.After(wait):
		}
		resp, wait, err = doWikidataEntities(ctx, api, qids, props)
		if err != nil {
			return nil, "", err
		}
		if wait > 0 {
			return nil, "", ErrWikidataBusy
		}
	}
	if resp.Error != nil {
		return nil, resp.Error.ID, nil
	}
	out := make(map[string]wikidataEntity, len(resp.Entities))
	for id, e := range resp.Entities {
		if e.Redirects != nil && e.Redirects.From != "" {
			id = e.Redirects.From
		}
		out[id] = e
	}
	return out, "", nil
}

// doWikidataEntities performs one wbgetentities call. A positive wait reports
// that the server asked for a pause.
func doWikidataEntities(ctx context.Context, api string, qids []string, props string) (*wikidataEntitiesResponse,
	time.Duration, error) {
	params := url.Values{
		"action":    {"wbgetentities"},
		"ids":       {strings.Join(qids, "|")},
		"props":     {props},
		"languages": {"en"},
		"format":    {"json"},
		"maxlag":    {"5"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api+"?"+params.Encode(), nil)
	if err != nil {
		return nil, 0, fmt.Errorf("build wbgetentities request: %w", err)
	}
	req.Header.Set("User-Agent", geocodeUserAgent)
	resp, err := wikiHTTPDo(req)
	if err != nil {
		return nil, 0, fmt.Errorf("wbgetentities request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, retryAfterDelay(resp.Header.Get("Retry-After")), nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("wbgetentities returned %d", resp.StatusCode)
	}
	var out wikidataEntitiesResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, 0, fmt.Errorf("decode wbgetentities: %w", err)
	}
	if out.Error != nil {
		switch {
		case out.Error.Code == "maxlag":
			return nil, retryAfterDelay(resp.Header.Get("Retry-After")), nil
		case out.Error.Code == "no-such-entity" && out.Error.ID != "":
			return &out, 0, nil
		}
		return nil, 0, fmt.Errorf("wbgetentities error: %s: %s", out.Error.Code, out.Error.Info)
	}
	return &out, 0, nil
}

// factsFromClaims extracts the date, conflict and class facts from an item's claims.
func factsFromClaims(claims map[string][]wikidataClaim) wikidataFacts {
	var f wikidataFacts
	if d, p, ok := bestTime(claims["P585"]); ok {
		f.Date, f.Precision = d, p
	} else if d, p, ok := bestTime(claims["P580"]); ok {
		f.Date, f.Precision = d, p
		if e, ep, ok := bestTime(claims["P582"]); ok {
			f.End, f.EndPrecision = e, ep
		}
	}
	f.Conflicts = entityIDs(claims["P607"])
	f.Instances = entityIDs(claims["P31"])
	return f
}

// rankedValues returns the claims that carry a value, preferred rank first and
// deprecated rank dropped, keeping claim order within a rank.
func rankedValues(claims []wikidataClaim) []wikidataClaim {
	var preferred, normal []wikidataClaim
	for _, c := range claims {
		if c.Mainsnak.Snaktype != "value" {
			continue
		}
		switch c.Rank {
		case "preferred":
			preferred = append(preferred, c)
		case "normal":
			normal = append(normal, c)
		}
	}
	return append(preferred, normal...)
}

// bestTime returns the highest-ranked time value of claims as a padded ISO date
// and its precision.
func bestTime(claims []wikidataClaim) (string, int, bool) {
	for _, c := range rankedValues(claims) {
		var v struct {
			Time      string `json:"time"`
			Precision int    `json:"precision"`
		}
		if err := json.Unmarshal(c.Mainsnak.Datavalue.Value, &v); err != nil {
			continue
		}
		if iso, ok := paddedISO(v.Time); ok {
			return iso, v.Precision, true
		}
	}
	return "", 0, false
}

// entityIDs returns the item ids of claims in rank order.
func entityIDs(claims []wikidataClaim) []string {
	var out []string
	for _, c := range rankedValues(claims) {
		var v struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(c.Mainsnak.Datavalue.Value, &v); err == nil && v.ID != "" {
			out = append(out, v.ID)
		}
	}
	return out
}

// paddedISO converts a Wikidata time value to a padded ISO date, writing a zero
// month or day as 01. BC years keep a leading minus.
func paddedISO(t string) (string, bool) {
	m := wikidataTimeRe.FindStringSubmatch(t)
	if m == nil {
		return "", false
	}
	y, err := strconv.Atoi(m[2])
	if err != nil || y == 0 {
		return "", false
	}
	mo, _ := strconv.Atoi(m[3])
	d, _ := strconv.Atoi(m[4])
	mo, d = max(mo, 1), max(d, 1)
	sign := ""
	if m[1] == "-" {
		sign = "-"
	}
	return fmt.Sprintf("%s%04d-%02d-%02d", sign, y, mo, d), true
}

var (
	// redirectRe reads the target of a "#REDIRECT [[Title]]" page.
	redirectRe = regexp.MustCompile(`(?i)^\s*#redirect\s*\[\[([^\]|#]+)`)
	// htmlCommentRe matches an HTML comment in wikitext.
	htmlCommentRe = regexp.MustCompile(`(?s)<!--.*?-->`)
)

// wikitextBatch is the MediaWiki title cap per revisions query.
const wikitextBatch = 50

// BackfillInfoboxDates reads the article infobox date and partof for every
// unverified wikidata row not read yet whose year disagrees with Wikidata or that
// has no Wikidata date, and stores them in infobox_date and infobox_partof. The
// reconcile pass uses them to tell a poisoned year from a year the article and
// Wikidata dispute, and as the source for rows Wikidata gives no date. A row with
// no article, or no infobox, is marked read with empty values. It returns the
// number of rows read.
func BackfillInfoboxDates(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, year, date, date_start, date_end, verified, wikidata_date,
		wikidata_precision, wikipedia_title FROM battles WHERE source = 'wikidata' AND wikidata_checked != ''
		AND infobox_checked = ''`)
	if err != nil {
		return 0, fmt.Errorf("query infobox rows: %w", err)
	}
	byTitle := map[string][]string{}
	var untitled, titles []string
	for rows.Next() {
		var id, date, wdDate, title string
		var year, verified, prec int
		var dr DateRange
		if err := rows.Scan(&id, &year, &date, &dr.Start, &dr.End, &verified, &wdDate, &prec, &title); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan infobox row: %w", err)
		}
		if verified == 1 || wdDate != "" && !yearDisagrees(false, year, date, dr, wdDate, prec) {
			continue
		}
		if title == "" {
			untitled = append(untitled, id)
			continue
		}
		if _, ok := byTitle[title]; !ok {
			titles = append(titles, title)
		}
		byTitle[title] = append(byTitle[title], id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate infobox rows: %w", err)
	}

	dates := make(map[string][2]string, len(titles))
	for start := 0; start < len(titles); start += wikitextBatch {
		batch := titles[start:min(start+wikitextBatch, len(titles))]
		texts, err := wikitextFollowingRedirects(ctx, batch)
		if err != nil {
			return 0, fmt.Errorf("wikitext batch at %d: %w", start, err)
		}
		for _, t := range batch {
			dates[t] = [2]string{infoboxField(texts[t], "date"), infoboxField(texts[t], "partof")}
		}
	}

	checked := time.Now().UTC().Format("2006-01-02")
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin infobox tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET infobox_date = ?, infobox_partof = ?,
		infobox_checked = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare infobox update: %w", err)
	}
	defer stmt.Close()
	n := 0
	write := func(id string, f [2]string) error {
		if _, err := stmt.ExecContext(ctx, f[0], f[1], checked, id); err != nil {
			return fmt.Errorf("update infobox date for %s: %w", id, err)
		}
		n++
		return nil
	}
	for _, id := range untitled {
		if err := write(id, [2]string{}); err != nil {
			return 0, err
		}
	}
	for _, t := range titles {
		for _, id := range byTitle[t] {
			if err := write(id, dates[t]); err != nil {
				return 0, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit infobox dates: %w", err)
	}
	return n, nil
}

// wikitextFollowingRedirects returns the wikitext of each title, keyed by the
// requested title, following one "#REDIRECT" hop. A missing page has no entry.
func wikitextFollowingRedirects(ctx context.Context, titles []string) (map[string]string, error) {
	got, err := fetchWikitext(ctx, underscored(titles))
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(titles))
	hops := map[string]string{}
	for _, t := range titles {
		text := got[t]
		if m := redirectRe.FindStringSubmatch(text); m != nil {
			hops[t] = strings.TrimSpace(m[1])
			continue
		}
		if text != "" {
			out[t] = text
		}
	}
	if len(hops) == 0 {
		return out, nil
	}
	targets := make([]string, 0, len(hops))
	for _, to := range hops {
		targets = append(targets, to)
	}
	got, err = fetchWikitext(ctx, underscored(targets))
	if err != nil {
		return nil, err
	}
	for from, to := range hops {
		if text := got[strings.ReplaceAll(to, "_", " ")]; text != "" {
			out[from] = text
		}
	}
	return out, nil
}

// underscored returns titles with spaces written as underscores, the form the
// wikitext cache is keyed by.
func underscored(titles []string) []string {
	out := make([]string, len(titles))
	for i, t := range titles {
		out[i] = strings.ReplaceAll(t, " ", "_")
	}
	return out
}

// infoboxField returns one raw parameter of the article's conflict infobox with
// references and comments removed, or "" when there is none. Templates stay,
// since {{Start date|1444|11|10}} carries the year as digits.
func infoboxField(wikitext, name string) string {
	box := infoboxRe.FindString(wikitext)
	if box == "" {
		return ""
	}
	for _, m := range fieldRe.FindAllStringSubmatch(box, -1) {
		if !strings.EqualFold(m[1], name) {
			continue
		}
		s := htmlCommentRe.ReplaceAllString(refTag.ReplaceAllString(m[2], ""), "")
		return strings.Join(strings.Fields(s), " ")
	}
	return ""
}
