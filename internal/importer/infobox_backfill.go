package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// nominatimEndpoint is the public Nominatim search API used for place text.
const nominatimEndpoint = "https://nominatim.openstreetmap.org/search"

// nominatimUserAgent identifies the backfill tool per the Nominatim usage policy.
const nominatimUserAgent = "battlesight-importer/1.0 (personal project; contact via github)"

// nominatimInterval enforces the absolute one-request-per-second budget the
// shared Nominatim service requires of bulk users.
const nominatimInterval = time.Second

// nominatimMinImportance is the score at which a Nominatim hit is trusted outright.
const nominatimMinImportance = 0.3

// nominatimMaxBBoxSpan rejects hits whose bounding box spans more degrees than
// this in either dimension: country-level blobs, not battle sites.
const nominatimMaxBBoxSpan = 5.0

// backfillPlaceCacheNS is the disk cache namespace for Nominatim responses.
const backfillPlaceCacheNS = "nominatim-place"

// backfillWikitextCacheNS is the disk cache namespace for article wikitext,
// shared with the infobox enricher so either caller can serve the other.
const backfillWikitextCacheNS = "wikitext"

// BackfillPipelineSummary tallies one infobox backfill pipeline. The
// CoordTemplate and Geocoded fields stay zero for the date pipeline.
type BackfillPipelineSummary struct {
	// Attempted counts gap battles whose article was requested.
	Attempted int
	// InfoboxFound counts battles whose article carries a military infobox.
	InfoboxFound int
	// Parsed counts battles whose target field yielded usable text.
	Parsed int
	// CoordTemplate counts battles resolved by a direct {{coord}} template hit.
	CoordTemplate int
	// Geocoded counts battles whose place text Nominatim resolved acceptably.
	Geocoded int
	// Written counts rows updated, or would-be updates in dry-run mode.
	Written int
	// Rejected histograms the per-battle skip reasons.
	Rejected map[string]int
}

// InfoboxBackfillSummary aggregates both infobox backfill pipelines.
type InfoboxBackfillSummary struct {
	// Coords summarizes the coordinate pipeline.
	Coords BackfillPipelineSummary
	// Dates summarizes the date pipeline.
	Dates BackfillPipelineSummary
	// NominatimRequests counts live HTTP calls issued to Nominatim.
	NominatimRequests int
}

// backfillBattle is one gap row eligible for infobox backfill.
type backfillBattle struct {
	// ID is the battle primary key.
	ID string
	// Year is the battles.year value used for the date mismatch check.
	Year int
	// War is the battles.war value used for the country-guess geocode query.
	War string
}

// backfillDateUpdate is one pending date write for a battle row.
type backfillDateUpdate struct {
	// ID is the battle primary key.
	ID string
	// Display is the house-style date string for battles.date.
	Display string
	// Start is the ISO date_start value; empty leaves date_start untouched.
	Start string
}

// backfillGapQueryCoords selects the coordinate gap with the war column the
// place-query builder needs.
const backfillGapQueryCoords = `SELECT id, year, war, wikipedia_title FROM battles
	WHERE lat = 0 AND lng = 0`

// backfillGapQueryDates selects the date gap; the war column is not needed so
// an empty literal keeps the scanner shared with the coordinate query.
const backfillGapQueryDates = `SELECT id, year, '', wikipedia_title FROM battles
	WHERE (date = '' OR date = '0') AND wikipedia_title != ''`

// InfoboxBackfill fills coordinate and date gaps from Wikipedia infobox text.
// For every gap battle it fetches the article wikitext in batches of 50
// titles, then resolves coordinates from a {{coord}} template or by geocoding
// the infobox place field via Nominatim, and dates by parsing the infobox
// date field into the house display form. When dryRun is true every step runs
// except the UPDATEs, so the summary shows exactly what a live run would write.
func InfoboxBackfill(ctx context.Context, db *sql.DB, dryRun bool) (InfoboxBackfillSummary, error) {
	sum := InfoboxBackfillSummary{
		Coords: BackfillPipelineSummary{Rejected: map[string]int{}},
		Dates:  BackfillPipelineSummary{Rejected: map[string]int{}},
	}

	coordByTitle, coordTitles, err := loadBackfillGap(ctx, db, backfillGapQueryCoords, &sum.Coords)
	if err != nil {
		return sum, fmt.Errorf("load coordinate gap: %w", err)
	}
	dateByTitle, dateTitles, err := loadBackfillGap(ctx, db, backfillGapQueryDates, &sum.Dates)
	if err != nil {
		return sum, fmt.Errorf("load date gap: %w", err)
	}

	titles := unionTitles(coordTitles, dateTitles)
	mode := "live"
	if dryRun {
		mode = "dry-run"
	}
	if len(titles) == 0 {
		log.Printf("infobox-backfill %s: nothing to do", mode)
		return sum, nil
	}
	log.Printf("infobox-backfill %s: coords gap %d battles (%d titles), "+
		"dates gap %d battles (%d titles), %d unique articles",
		mode, sum.Coords.Attempted, len(coordTitles),
		sum.Dates.Attempted, len(dateTitles), len(titles))

	nom := newNominatimClient()
	defer nom.Close()

	for start := 0; start < len(titles); start += geocodeBatchSize {
		if start > 0 {
			select {
			case <-ctx.Done():
				return sum, ctx.Err()
			case <-time.After(geocodeBatchPause):
			}
		}
		end := min(start+geocodeBatchSize, len(titles))
		batch := titles[start:end]

		pages, err := fetchBackfillWikitext(ctx, batch)
		if err != nil {
			return sum, fmt.Errorf("backfill batch %d-%d: %w", start, end, err)
		}

		var coordUpdates []geocodeUpdate
		var dateUpdates []backfillDateUpdate
		for _, title := range batch {
			content, haveContent := pages[title]
			if haveContent {
				// Comments can hide stale coord templates and infobox drafts;
				// strip them once so both pipelines see live text only.
				content = bfCommentRe.ReplaceAllString(content, "")
			}
			if battles := coordByTitle[title]; len(battles) > 0 {
				ups, err := backfillCoordTitle(ctx, nom, &sum.Coords, content, haveContent, battles)
				if err != nil {
					return sum, fmt.Errorf("backfill batch %d-%d: %w", start, end, err)
				}
				coordUpdates = append(coordUpdates, ups...)
			}
			if battles := dateByTitle[title]; len(battles) > 0 {
				dateUpdates = append(dateUpdates,
					backfillDateTitle(&sum.Dates, content, haveContent, battles)...)
			}
		}

		if !dryRun {
			if len(coordUpdates) > 0 {
				if err := applyGeocodeUpdates(ctx, db, coordUpdates); err != nil {
					return sum, fmt.Errorf("backfill batch %d-%d coords: %w", start, end, err)
				}
			}
			if len(dateUpdates) > 0 {
				if err := applyBackfillDateUpdates(ctx, db, dateUpdates); err != nil {
					return sum, fmt.Errorf("backfill batch %d-%d dates: %w", start, end, err)
				}
			}
		}
		sum.Coords.Written += len(coordUpdates)
		sum.Dates.Written += len(dateUpdates)
		sum.NominatimRequests = nom.requests
		log.Printf("infobox-backfill %s batch %d-%d: coords +%d, dates +%d "+
			"(totals coords=%d dates=%d, nominatim=%d reqs)",
			mode, start, end, len(coordUpdates), len(dateUpdates),
			sum.Coords.Written, sum.Dates.Written, sum.NominatimRequests)
	}

	log.Printf("infobox-backfill %s coords summary: attempted=%d infobox-found=%d "+
		"parsed=%d coord-template=%d geocoded=%d written=%d rejected=[%s]",
		mode, sum.Coords.Attempted, sum.Coords.InfoboxFound, sum.Coords.Parsed,
		sum.Coords.CoordTemplate, sum.Coords.Geocoded, sum.Coords.Written,
		formatRejected(sum.Coords.Rejected))
	log.Printf("infobox-backfill %s dates summary: attempted=%d infobox-found=%d "+
		"parsed=%d written=%d rejected=[%s]",
		mode, sum.Dates.Attempted, sum.Dates.InfoboxFound, sum.Dates.Parsed,
		sum.Dates.Written, formatRejected(sum.Dates.Rejected))
	return sum, nil
}

// loadBackfillGap runs one gap SELECT and groups its rows by wikipedia_title,
// counting usable battles into sum.Attempted and unusable titles into the
// rejected histogram. The returned title slice preserves query order.
func loadBackfillGap(ctx context.Context, db *sql.DB, query string,
	sum *BackfillPipelineSummary) (map[string][]backfillBattle, []string, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, nil, fmt.Errorf("select gap rows: %w", err)
	}
	defer rows.Close()

	byTitle := make(map[string][]backfillBattle)
	var titles []string
	for rows.Next() {
		var b backfillBattle
		var title string
		if err := rows.Scan(&b.ID, &b.Year, &b.War, &title); err != nil {
			return nil, nil, fmt.Errorf("scan gap row: %w", err)
		}
		title = strings.TrimSpace(title)
		if title == "" || strings.Contains(title, "|") {
			sum.Rejected["no-title"]++
			continue
		}
		if _, seen := byTitle[title]; !seen {
			titles = append(titles, title)
		}
		byTitle[title] = append(byTitle[title], b)
		sum.Attempted++
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate gap rows: %w", err)
	}
	return byTitle, titles, nil
}

// unionTitles merges the two pipelines' title lists, keeping first-seen order
// so each shared article is fetched exactly once.
func unionTitles(a, b []string) []string {
	seen := make(map[string]bool, len(a)+len(b))
	out := make([]string, 0, len(a)+len(b))
	for _, t := range append(append([]string{}, a...), b...) {
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

// formatRejected renders a rejected-reason histogram as "reason=n" pairs in
// sorted order, or "none" when the map is empty.
func formatRejected(m map[string]int) string {
	if len(m) == 0 {
		return "none"
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = fmt.Sprintf("%s=%d", k, m[k])
	}
	return strings.Join(parts, " ")
}

// backfillCoordTitle resolves coordinates for every gap battle sharing one
// article. A {{coord}} template anywhere in the article wins outright;
// otherwise the infobox place field is cleaned and geocoded via Nominatim.
// Only context cancellation is returned as an error; per-title failures land
// in the rejected histogram.
func backfillCoordTitle(ctx context.Context, nom *nominatimClient, sum *BackfillPipelineSummary,
	content string, haveContent bool, battles []backfillBattle) ([]geocodeUpdate, error) {
	n := len(battles)
	if !haveContent {
		sum.Rejected["no-article"] += n
		return nil, nil
	}

	if lat, lng := parseCoordTemplate(content); isValidCoord(lat, lng) {
		sum.CoordTemplate += n
		updates := make([]geocodeUpdate, n)
		for i, b := range battles {
			updates[i] = geocodeUpdate{ID: b.ID, Lat: lat, Lng: lng}
		}
		return updates, nil
	}

	box, ok := findMilitaryInfobox(content)
	if !ok {
		sum.Rejected["no-infobox"] += n
		return nil, nil
	}
	sum.InfoboxFound += n
	raw, ok := infoboxParam(box, "place", "location")
	if !ok {
		sum.Rejected["no-place-field"] += n
		return nil, nil
	}
	place := cleanInfoboxText(raw)
	if place == "" {
		sum.Rejected["empty-place"] += n
		return nil, nil
	}
	sum.Parsed += n

	queries := buildPlaceQueries(place, battles[0].War)
	lastReason := "nominatim-miss"
	for _, q := range queries {
		hit, err := nom.search(ctx, q)
		if err != nil {
			return nil, err
		}
		if hit == nil {
			continue
		}
		lat, lng, reason := nominatimAcceptable(*hit, place)
		if reason != "" {
			lastReason = reason
			continue
		}
		sum.Geocoded += n
		updates := make([]geocodeUpdate, n)
		for i, b := range battles {
			updates[i] = geocodeUpdate{ID: b.ID, Lat: lat, Lng: lng}
		}
		return updates, nil
	}
	sum.Rejected[lastReason] += n
	return nil, nil
}

// backfillDateTitle parses the infobox date for every gap battle sharing one
// article and returns the writes that pass the year-consistency check.
func backfillDateTitle(sum *BackfillPipelineSummary, content string, haveContent bool,
	battles []backfillBattle) []backfillDateUpdate {
	n := len(battles)
	if !haveContent {
		sum.Rejected["no-article"] += n
		return nil
	}
	box, ok := findMilitaryInfobox(content)
	if !ok {
		sum.Rejected["no-infobox"] += n
		return nil
	}
	sum.InfoboxFound += n
	raw, ok := infoboxParam(box, "date")
	if !ok {
		sum.Rejected["no-date-field"] += n
		return nil
	}
	text := cleanInfoboxText(raw)
	if text == "" {
		sum.Rejected["empty-date"] += n
		return nil
	}
	parsed, reason := parseInfoboxDate(text)
	if reason != "" {
		sum.Rejected[reason] += n
		return nil
	}
	sum.Parsed += n

	var updates []backfillDateUpdate
	for _, b := range battles {
		if b.Year != parsed.Year && (parsed.EndYear == 0 || b.Year != parsed.EndYear) {
			sum.Rejected["year-mismatch"]++
			continue
		}
		start := parsed.Start
		if parsed.Year != b.Year {
			// Day precision belongs to the range start; when the battle's year
			// only matches the range end, the start date would contradict it.
			start = ""
		}
		updates = append(updates, backfillDateUpdate{ID: b.ID, Display: parsed.Display, Start: start})
	}
	return updates
}

// applyBackfillDateUpdates writes one batch of date fixes in a single short
// transaction so a concurrently running server is never blocked for long. The
// date=”/'0' guard keeps the write from clobbering a row fixed by other
// means between the gap SELECT and this commit.
func applyBackfillDateUpdates(ctx context.Context, db *sql.DB, updates []backfillDateUpdate) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin date transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `UPDATE battles
		SET date = ?, date_start = CASE WHEN ? != '' THEN ? ELSE date_start END
		WHERE id = ? AND (date = '' OR date = '0')`)
	if err != nil {
		return fmt.Errorf("prepare date update: %w", err)
	}
	defer stmt.Close()

	for _, u := range updates {
		if _, err := stmt.ExecContext(ctx, u.Display, u.Start, u.Start, u.ID); err != nil {
			return fmt.Errorf("update battle %s: %w", u.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit date transaction: %w", err)
	}
	return nil
}

// backfillPage is one page's title and content in the revisions response.
type backfillPage struct {
	// Title is the canonical page title after normalization and redirects.
	Title string `json:"title"`
	// Revisions holds the single requested revision with its main slot.
	Revisions []struct {
		// Slots carries revision content keyed by slot name.
		Slots struct {
			// Main is the article's primary content slot.
			Main struct {
				// Content is the raw wikitext.
				Content string `json:"*"`
			} `json:"main"`
		} `json:"slots"`
	} `json:"revisions"`
}

// backfillRevisionsQuery holds the page results plus the title translation
// arrays for the revisions content query.
type backfillRevisionsQuery struct {
	// Normalized maps requested titles to their normalized forms.
	Normalized []geocodeRename `json:"normalized"`
	// Redirects maps redirect sources to their targets.
	Redirects []geocodeRename `json:"redirects"`
	// Pages is keyed by page ID; negative keys mark missing titles.
	Pages map[string]backfillPage `json:"pages"`
}

// backfillRevisionsResponse mirrors the action=query&prop=revisions response.
type backfillRevisionsResponse struct {
	// Error carries the API-level error, e.g. a maxlag rejection.
	Error *geocodeAPIError `json:"error"`
	// Query holds the page results for the requested titles.
	Query backfillRevisionsQuery `json:"query"`
}

// fetchBackfillWikitext returns article wikitext keyed by requested title,
// serving disk-cached articles first and fetching only the misses in one
// batched revisions call with redirect resolution.
func fetchBackfillWikitext(ctx context.Context, titles []string) (map[string]string, error) {
	out := make(map[string]string, len(titles))
	var missing []string
	for _, t := range titles {
		if v, ok := wikiCacheGet(backfillWikitextCacheNS, strings.ReplaceAll(t, " ", "_")); ok {
			out[t] = v
			continue
		}
		missing = append(missing, t)
	}
	if len(missing) == 0 {
		return out, nil
	}

	resp, err := fetchBackfillBatch(ctx, missing)
	if err != nil {
		return nil, err
	}

	rename := make(map[string]string, len(resp.Query.Normalized)+len(resp.Query.Redirects))
	for _, r := range resp.Query.Normalized {
		rename[r.From] = r.To
	}
	for _, r := range resp.Query.Redirects {
		rename[r.From] = r.To
	}
	byTitle := make(map[string]string, len(resp.Query.Pages))
	for _, p := range resp.Query.Pages {
		if len(p.Revisions) == 0 {
			continue
		}
		byTitle[p.Title] = p.Revisions[0].Slots.Main.Content
	}

	for _, req := range missing {
		final := req
		for range geocodeRenameHops {
			next, ok := rename[final]
			if !ok {
				break
			}
			final = next
		}
		content, ok := byTitle[final]
		if !ok || content == "" {
			continue
		}
		out[req] = content
		wikiCacheSet(backfillWikitextCacheNS, strings.ReplaceAll(req, " ", "_"), content)
	}
	return out, nil
}

// fetchBackfillBatch queries the revisions API for one batch of titles,
// retrying once when the server answers 429 or maxlag, mirroring the
// geocode fetcher's etiquette.
func fetchBackfillBatch(ctx context.Context, titles []string) (*backfillRevisionsResponse, error) {
	resp, wait, err := doBackfillRequest(ctx, titles)
	if err != nil || wait <= 0 {
		return resp, err
	}
	log.Printf("infobox-backfill: server busy (429/maxlag), retrying once in %s", wait)
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(wait):
	}
	resp, wait, err = doBackfillRequest(ctx, titles)
	if err != nil {
		return nil, err
	}
	if wait > 0 {
		return nil, fmt.Errorf("revisions api still busy after retry")
	}
	return resp, nil
}

// doBackfillRequest performs one revisions API call. A positive wait reports
// that the server asked for a pause (429 or maxlag) and the caller may retry
// once after waiting that long.
func doBackfillRequest(ctx context.Context, titles []string) (*backfillRevisionsResponse, time.Duration, error) {
	params := url.Values{
		"action":    {"query"},
		"prop":      {"revisions"},
		"rvprop":    {"content"},
		"rvslots":   {"main"},
		"titles":    {strings.Join(titles, "|")},
		"redirects": {"1"},
		"format":    {"json"},
		"maxlag":    {"5"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wikipediaAPI+"?"+params.Encode(), nil)
	if err != nil {
		return nil, 0, fmt.Errorf("build revisions request: %w", err)
	}
	req.Header.Set("User-Agent", geocodeUserAgent)

	resp, err := wikiHTTPDo(req)
	if err != nil {
		return nil, 0, fmt.Errorf("revisions request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, retryAfterDelay(resp.Header.Get("Retry-After")), nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("revisions api returned %d", resp.StatusCode)
	}

	var out backfillRevisionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, 0, fmt.Errorf("decode revisions response: %w", err)
	}
	if out.Error != nil {
		if out.Error.Code == "maxlag" {
			return nil, retryAfterDelay(resp.Header.Get("Retry-After")), nil
		}
		return nil, 0, fmt.Errorf("revisions api error: %s: %s", out.Error.Code, out.Error.Info)
	}
	return &out, 0, nil
}

// militaryInfoboxRe locates the opening of a military conflict infobox.
var militaryInfoboxRe = regexp.MustCompile(
	`(?i)\{\{\s*infobox\s+(?:military conflict|battle\b|military engagement)`)

// bfCommentRe matches HTML comments, which hide editor notes and stale markup.
var bfCommentRe = regexp.MustCompile(`(?s)<!--.*?-->`)

// findMilitaryInfobox returns the full {{...}} span of the first military
// conflict infobox in the article, handling nested templates inside it.
func findMilitaryInfobox(wikitext string) (string, bool) {
	loc := militaryInfoboxRe.FindStringIndex(wikitext)
	if loc == nil {
		return "", false
	}
	return templateSpan(wikitext[loc[0]:])
}

// templateSpan returns the balanced {{...}} template starting at s[0], or
// ok=false when the braces never balance before the string ends.
func templateSpan(s string) (string, bool) {
	depth := 0
	i := 0
	for i < len(s) {
		switch {
		case strings.HasPrefix(s[i:], "{{"):
			depth++
			i += 2
		case strings.HasPrefix(s[i:], "}}"):
			depth--
			i += 2
			if depth == 0 {
				return s[:i], true
			}
		default:
			i++
		}
	}
	return "", false
}

// splitTemplateParams splits a template's inner text on top-level pipes,
// ignoring pipes nested inside {{...}} templates or [[...]] links. The first
// element is the template name; the rest are its parameters.
func splitTemplateParams(inner string) []string {
	var parts []string
	var cur strings.Builder
	tpl, link := 0, 0
	i := 0
	for i < len(inner) {
		switch {
		case strings.HasPrefix(inner[i:], "{{"):
			tpl++
			cur.WriteString("{{")
			i += 2
		case strings.HasPrefix(inner[i:], "}}"):
			tpl--
			cur.WriteString("}}")
			i += 2
		case strings.HasPrefix(inner[i:], "[["):
			link++
			cur.WriteString("[[")
			i += 2
		case strings.HasPrefix(inner[i:], "]]"):
			link--
			cur.WriteString("]]")
			i += 2
		case inner[i] == '|' && tpl == 0 && link == 0:
			parts = append(parts, cur.String())
			cur.Reset()
			i++
		default:
			cur.WriteByte(inner[i])
			i++
		}
	}
	parts = append(parts, cur.String())
	return parts
}

// infoboxParam returns the raw (possibly multiline) value of the first of
// the given parameter names present in the infobox span. Name matching is
// case-insensitive; earlier names win.
func infoboxParam(span string, names ...string) (string, bool) {
	if len(span) < 4 {
		return "", false
	}
	inner := span[2 : len(span)-2]
	values := make(map[string]string)
	for _, part := range splitTemplateParams(inner)[1:] {
		nameVal := strings.SplitN(part, "=", 2)
		if len(nameVal) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(nameVal[0]))
		if _, exists := values[key]; !exists {
			values[key] = strings.TrimSpace(nameVal[1])
		}
	}
	for _, name := range names {
		if v, ok := values[strings.ToLower(name)]; ok && v != "" {
			return v, true
		}
	}
	// No name carried text; still report presence when one exists empty so
	// the caller counts an empty field rather than a missing one.
	for _, name := range names {
		if _, ok := values[strings.ToLower(name)]; ok {
			return "", true
		}
	}
	return "", false
}

// bfUnwrapTemplates lists template names whose last positional parameter is
// kept when the template drops: pure formatting wrappers around real text.
var bfUnwrapTemplates = map[string]bool{
	"nowrap": true, "nobold": true, "small": true, "smaller": true,
	"big": true, "larger": true, "lang": true,
}

// bfBulletRe strips leading list markers from multiline infobox values.
var bfBulletRe = regexp.MustCompile(`(?m)^\s*[*#:;]+\s*`)

// bfWhitespaceRe collapses any whitespace run, including newlines, to one space.
var bfWhitespaceRe = regexp.MustCompile(`\s+`)

// cleanInfoboxText flattens one infobox field value to plain text: comments,
// refs, and templates drop (formatting wrappers keep their text), links keep
// their label, HTML tags vanish, entities decode, and whitespace collapses.
func cleanInfoboxText(s string) string {
	s = bfCommentRe.ReplaceAllString(s, "")
	s = refTag.ReplaceAllString(s, "")
	s = brTag.ReplaceAllString(s, ", ")
	s = bfBulletRe.ReplaceAllString(s, "")
	s = dropTemplates(s)
	s = stripWikitextMarkup(s)
	s = bfWhitespaceRe.ReplaceAllString(s, " ")
	return strings.Trim(s, " ,;:")
}

// dropTemplates removes every {{...}} template from s, handling nesting.
// Formatting wrappers listed in bfUnwrapTemplates are replaced by their last
// positional parameter instead of vanishing.
func dropTemplates(s string) string {
	var b strings.Builder
	i := 0
	for i < len(s) {
		if strings.HasPrefix(s[i:], "{{") {
			span, ok := templateSpan(s[i:])
			if !ok {
				b.WriteString(s[i:])
				break
			}
			b.WriteString(templateReplacement(span))
			i += len(span)
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// bfDateTemplates lists template names that encode a date as positional
// year/month/day numbers; they are rendered back to text so the date parser
// sees them instead of a blank.
var bfDateTemplates = map[string]bool{
	"start date": true, "end date": true,
	"start date and age": true, "end date and age": true,
	"start-date": true, "end-date": true,
}

// templateReplacement returns the text a dropped template leaves behind: a
// rendered date for date templates, the last positional parameter for
// formatting wrappers, nothing for the rest.
func templateReplacement(span string) string {
	if len(span) < 4 {
		return ""
	}
	parts := splitTemplateParams(span[2 : len(span)-2])
	name := strings.ToLower(strings.TrimSpace(parts[0]))
	switch {
	case bfDateTemplates[name]:
		return dateTemplateText(positionalParams(parts[1:]))
	case bfUnwrapTemplates[name]:
		repl := ""
		for _, p := range positionalParams(parts[1:]) {
			if p != "" {
				repl = p
			}
		}
		return dropTemplates(repl)
	}
	return ""
}

// positionalParams returns a template's positional parameter values in order,
// treating numeric keys like 1=x as positional and skipping named parameters
// such as df=y.
func positionalParams(parts []string) []string {
	var pos []string
	for _, p := range parts {
		if eq := strings.Index(p, "="); eq >= 0 {
			key := strings.TrimSpace(p[:eq])
			if _, err := strconv.Atoi(key); err != nil {
				continue
			}
			p = p[eq+1:]
		}
		pos = append(pos, strings.TrimSpace(p))
	}
	return pos
}

// dateTemplateText renders a date template's positional parameters back to
// plain text: numeric year/month/day forms become "29 October 1914", and the
// free-text variant ({{start-date|November 1, 1918}}) passes through.
func dateTemplateText(pos []string) string {
	if len(pos) == 0 {
		return ""
	}
	y := bfAtoi(pos[0])
	if y <= 0 {
		return dropTemplates(pos[0])
	}
	if len(pos) >= 2 {
		if m := bfAtoi(pos[1]); m >= 1 && m <= 12 {
			if len(pos) >= 3 {
				if d := bfAtoi(pos[2]); d >= 1 && d <= 31 {
					return fmt.Sprintf("%d %s %d", d, monthNames[m], y)
				}
			}
			return fmt.Sprintf("%s %d", monthNames[m], y)
		}
	}
	return strconv.Itoa(y)
}

// backfillDate is one parsed infobox date ready for writing.
type backfillDate struct {
	// Display is the house-style string for battles.date.
	Display string
	// Start is the ISO YYYY-MM-DD first day when day precision parsed.
	Start string
	// Year is the year the parsed date starts in.
	Year int
	// EndYear is the end year for ranges spanning years, zero otherwise.
	EndYear int
}

// bfSep matches a date range separator: any dash variant, a slash as in
// "the night of 21/22 April", or the word "to".
const bfSep = `\s*(?:[–—−/-]|\bto\b)\s*`

// bfSepComma additionally accepts a comma, which Wikipedia uses for
// cross-month ranges like "26 May, 4 June 1940".
const bfSepComma = `\s*(?:[–—−/-]|\bto\b|,)\s*`

// bfMon matches a month word with an optional abbreviation dot; validity is
// checked afterwards via backfillMonthNum so stray words fall through.
const bfMon = `([A-Za-z]+)\.?`

var (
	// bfBCRe flags BC/BCE dates, which the backfill skips: the year column
	// already covers them and the DB's BC year encoding is not uniform.
	bfBCRe = regexp.MustCompile(`(?i)\b(?:BC|BCE)\b`)
	// bfOrdinalRe strips ordinal suffixes so "21st April" parses like "21 April".
	bfOrdinalRe = regexp.MustCompile(`\b(\d{1,2})(?:st|nd|rd|th)\b`)
	// bfCircaRe strips leading approximation markers before parsing.
	bfCircaRe = regexp.MustCompile(`(?i)^(?:c\.|ca\.|circa|about|approx\.?|approximately|on|AD)\s+`)
	// bfISORe matches an ISO date already in YYYY-MM-DD form.
	bfISORe = regexp.MustCompile(`\b(\d{4})-(\d{2})-(\d{2})\b`)
	// bfFullDMYRe matches "10 July 1940 – 31 October 1941".
	bfFullDMYRe = regexp.MustCompile(`(?i)\b(\d{1,2})\b\s+` + bfMon + `\s+(\d{3,4})\b` +
		bfSep + `\b(\d{1,2})\b\s+` + bfMon + `\s+(\d{3,4})\b`)
	// bfFullMDYRe matches "July 10, 1940 – October 31, 1941".
	bfFullMDYRe = regexp.MustCompile(`(?i)` + bfMon + `\s+\b(\d{1,2})\b,?\s+(\d{3,4})\b` +
		bfSep + bfMon + `\s+\b(\d{1,2})\b,?\s+(\d{3,4})\b`)
	// bfMonthToFullRe matches "October 1914 – 11 July 1915".
	bfMonthToFullRe = regexp.MustCompile(
		`(?i)` + bfMon + `\s+(\d{3,4})\b` + bfSep + `\b(\d{1,2})\b\s+` + bfMon + `\s+(\d{3,4})\b`)
	// bfFullToMonthRe matches "11 July 1914 – October 1915".
	bfFullToMonthRe = regexp.MustCompile(
		`(?i)\b(\d{1,2})\b\s+` + bfMon + `\s+(\d{3,4})\b` + bfSep + bfMon + `\s+(\d{3,4})\b`)
	// bfCrossDMYRe matches "26 May – 4 June 1940" and "26 May, 4 June 1940".
	bfCrossDMYRe = regexp.MustCompile(
		`(?i)\b(\d{1,2})\b\s+` + bfMon + bfSepComma + `\b(\d{1,2})\b\s+` + bfMon + `\s+(\d{3,4})\b`)
	// bfCrossMDYRe matches "May 26 – June 4, 1940".
	bfCrossMDYRe = regexp.MustCompile(
		`(?i)` + bfMon + `\s+\b(\d{1,2})\b` + bfSepComma + bfMon + `\s+\b(\d{1,2})\b,?\s+(\d{3,4})\b`)
	// bfDayRangeDMYRe matches "20–25 August 1526".
	bfDayRangeDMYRe = regexp.MustCompile(
		`(?i)\b(\d{1,2})\b` + bfSep + `\b(\d{1,2})\b\s+` + bfMon + `\s+(\d{3,4})\b`)
	// bfDayRangeMDYRe matches "August 20–25, 1526".
	bfDayRangeMDYRe = regexp.MustCompile(
		`(?i)` + bfMon + `\s+\b(\d{1,2})\b` + bfSep + `\b(\d{1,2})\b,?\s+(\d{3,4})\b`)
	// bfSingleDMYRe matches "21 April 1526".
	bfSingleDMYRe = regexp.MustCompile(`(?i)\b(\d{1,2})\b\s+` + bfMon + `,?\s+(\d{3,4})\b`)
	// bfSingleMDYRe matches "April 21, 1526".
	bfSingleMDYRe = regexp.MustCompile(`(?i)` + bfMon + `\s+\b(\d{1,2})\b,?\s+(\d{3,4})\b`)
	// bfMonthRangeRe matches "October – December 1526" and "October 1914 – July 1915".
	bfMonthRangeRe = regexp.MustCompile(
		`(?i)` + bfMon + `(?:\s+(\d{3,4})\b)?` + bfSep + bfMon + `\s+(\d{3,4})\b`)
	// bfSeasonRe matches "Spring 1526" and "Winter of 1077".
	bfSeasonRe = regexp.MustCompile(`(?i)\b(spring|summer|autumn|fall|winter)\s+(?:of\s+)?(\d{3,4})\b`)
	// bfMonthYearRe matches "April 1526".
	bfMonthYearRe = regexp.MustCompile(`(?i)` + bfMon + `\s+(\d{3,4})\b`)
	// bfYearOnlyRe matches a bare year, which the backfill skips.
	bfYearOnlyRe = regexp.MustCompile(`^\d{3,4}$`)
)

// backfillMonthNum resolves a month token, accepting the "sept" abbreviation
// the shared months map lacks and trailing abbreviation dots.
func backfillMonthNum(s string) int {
	s = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(s)), ".")
	if s == "sept" {
		return 9
	}
	return months[s]
}

// bfISO assembles one ISO date, returning "" for invalid components.
func bfISO(y, m, d int) string {
	if y <= 0 || m < 1 || m > 12 || d < 1 || d > 31 {
		return ""
	}
	return fmt.Sprintf("%04d-%02d-%02d", y, m, d)
}

// bfAtoi converts a regex-captured digit string, tolerating the empty
// optional captures some range patterns produce.
func bfAtoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// parseInfoboxDate converts cleaned infobox date text into the house display
// form ("April 21, 1526", "August 20–25, 1526", "April 1526", seasons pass
// through). reason is non-empty when the text must be skipped: "bc-date" for
// BC years, "bare-year" when only a year is present, "unparsed" otherwise.
func parseInfoboxDate(s string) (backfillDate, string) {
	s = strings.TrimSpace(s)
	if bfBCRe.MatchString(s) {
		return backfillDate{}, "bc-date"
	}
	s = bfOrdinalRe.ReplaceAllString(s, "$1")
	s = bfCircaRe.ReplaceAllString(s, "")
	if s == "" {
		return backfillDate{}, "unparsed"
	}

	if m := bfISORe.FindStringSubmatch(s); m != nil {
		y, mo, d := bfAtoi(m[1]), bfAtoi(m[2]), bfAtoi(m[3])
		if iso := bfISO(y, mo, d); iso != "" {
			return backfillDate{
				Display: fmt.Sprintf("%s %d, %d", monthNames[mo], d, y),
				Start:   iso, Year: y,
			}, ""
		}
	}
	if d, ok := parseFullRange(s); ok {
		return d, ""
	}
	if d, ok := parseMixedRange(s); ok {
		return d, ""
	}
	if d, ok := parseSameYearRange(s); ok {
		return d, ""
	}
	if d, ok := parseSingleDate(s); ok {
		return d, ""
	}
	if d, ok := parseMonthRange(s); ok {
		return d, ""
	}
	for _, m := range bfSeasonRe.FindAllStringSubmatch(s, -1) {
		y := bfAtoi(m[2])
		if y <= 0 {
			continue
		}
		season := strings.ToUpper(m[1][:1]) + strings.ToLower(m[1][1:])
		return backfillDate{Display: fmt.Sprintf("%s %d", season, y), Year: y}, ""
	}
	for _, m := range bfMonthYearRe.FindAllStringSubmatch(s, -1) {
		mo, y := backfillMonthNum(m[1]), bfAtoi(m[2])
		if mo == 0 || y <= 0 {
			continue
		}
		return backfillDate{Display: fmt.Sprintf("%s %d", monthNames[mo], y), Year: y}, ""
	}
	if bfYearOnlyRe.MatchString(s) {
		return backfillDate{}, "bare-year"
	}
	return backfillDate{}, "unparsed"
}

// parseFullRange handles ranges with explicit years on both sides, in DMY
// ("10 July 1940 – 31 October 1941") and MDY ("July 10, 1940 – ...") order.
func parseFullRange(s string) (backfillDate, bool) {
	for _, m := range bfFullDMYRe.FindAllStringSubmatch(s, -1) {
		if d, ok := buildRange(m[3], m[2], m[1], m[6], m[5], m[4]); ok {
			return d, true
		}
	}
	for _, m := range bfFullMDYRe.FindAllStringSubmatch(s, -1) {
		if d, ok := buildRange(m[3], m[1], m[2], m[6], m[4], m[5]); ok {
			return d, true
		}
	}
	return backfillDate{}, false
}

// parseMixedRange handles ranges where only one side carries a day:
// "October 1914 – 11 July 1915" and "11 July 1914 – October 1915".
func parseMixedRange(s string) (backfillDate, bool) {
	for _, m := range bfMonthToFullRe.FindAllStringSubmatch(s, -1) {
		m1, y1 := backfillMonthNum(m[1]), bfAtoi(m[2])
		d2, m2, y2 := bfAtoi(m[3]), backfillMonthNum(m[4]), bfAtoi(m[5])
		if m1 == 0 || m2 == 0 || y1 <= 0 || bfISO(y2, m2, d2) == "" {
			continue
		}
		bd := backfillDate{
			Display: fmt.Sprintf("%s %d – %s %d, %d", monthNames[m1], y1, monthNames[m2], d2, y2),
			Year:    y1,
		}
		if y2 != y1 {
			bd.EndYear = y2
		}
		return bd, true
	}
	for _, m := range bfFullToMonthRe.FindAllStringSubmatch(s, -1) {
		d1, m1, y1 := bfAtoi(m[1]), backfillMonthNum(m[2]), bfAtoi(m[3])
		m2, y2 := backfillMonthNum(m[4]), bfAtoi(m[5])
		iso := bfISO(y1, m1, d1)
		if m1 == 0 || m2 == 0 || y2 <= 0 || iso == "" {
			continue
		}
		bd := backfillDate{
			Display: fmt.Sprintf("%s %d, %d – %s %d", monthNames[m1], d1, y1, monthNames[m2], y2),
			Start:   iso, Year: y1,
		}
		if y2 != y1 {
			bd.EndYear = y2
		}
		return bd, true
	}
	return backfillDate{}, false
}

// parseSameYearRange handles day ranges sharing one trailing year: cross-month
// "26 May – 4 June 1940" (both orders) and same-month "20–25 August 1526"
// (both orders).
func parseSameYearRange(s string) (backfillDate, bool) {
	for _, m := range bfCrossDMYRe.FindAllStringSubmatch(s, -1) {
		if d, ok := buildRange(m[5], m[2], m[1], m[5], m[4], m[3]); ok {
			return d, true
		}
	}
	for _, m := range bfCrossMDYRe.FindAllStringSubmatch(s, -1) {
		if d, ok := buildRange(m[5], m[1], m[2], m[5], m[3], m[4]); ok {
			return d, true
		}
	}
	for _, m := range bfDayRangeDMYRe.FindAllStringSubmatch(s, -1) {
		if d, ok := buildRange(m[4], m[3], m[1], m[4], m[3], m[2]); ok {
			return d, true
		}
	}
	for _, m := range bfDayRangeMDYRe.FindAllStringSubmatch(s, -1) {
		if d, ok := buildRange(m[4], m[1], m[2], m[4], m[1], m[3]); ok {
			return d, true
		}
	}
	return backfillDate{}, false
}

// parseSingleDate handles one exact day in DMY or MDY order.
func parseSingleDate(s string) (backfillDate, bool) {
	build := func(dayStr, monStr, yearStr string) (backfillDate, bool) {
		d, mo, y := bfAtoi(dayStr), backfillMonthNum(monStr), bfAtoi(yearStr)
		iso := bfISO(y, mo, d)
		if mo == 0 || iso == "" {
			return backfillDate{}, false
		}
		return backfillDate{
			Display: fmt.Sprintf("%s %d, %d", monthNames[mo], d, y),
			Start:   iso, Year: y,
		}, true
	}
	for _, m := range bfSingleDMYRe.FindAllStringSubmatch(s, -1) {
		if d, ok := build(m[1], m[2], m[3]); ok {
			return d, true
		}
	}
	for _, m := range bfSingleMDYRe.FindAllStringSubmatch(s, -1) {
		if d, ok := build(m[2], m[1], m[3]); ok {
			return d, true
		}
	}
	return backfillDate{}, false
}

// parseMonthRange handles month-precision ranges: "October – December 1526"
// within one year and "October 1914 – July 1915" across years.
func parseMonthRange(s string) (backfillDate, bool) {
	for _, m := range bfMonthRangeRe.FindAllStringSubmatch(s, -1) {
		m1, m2 := backfillMonthNum(m[1]), backfillMonthNum(m[3])
		y2 := bfAtoi(m[4])
		if m1 == 0 || m2 == 0 || y2 <= 0 {
			continue
		}
		y1 := y2
		if m[2] != "" {
			y1 = bfAtoi(m[2])
		}
		if y1 == y2 {
			return backfillDate{
				Display: fmt.Sprintf("%s – %s %d", monthNames[m1], monthNames[m2], y2),
				Year:    y1,
			}, true
		}
		return backfillDate{
			Display: fmt.Sprintf("%s %d – %s %d", monthNames[m1], y1, monthNames[m2], y2),
			Year:    y1, EndYear: y2,
		}, true
	}
	return backfillDate{}, false
}

// buildRange assembles a day-precision range in house style from captured
// strings, validating months and days. Same-month ranges require ascending
// days so garbled text like "25–20 August" falls through to other patterns.
func buildRange(y1Str, m1Str, d1Str, y2Str, m2Str, d2Str string) (backfillDate, bool) {
	d1, m1, y1 := bfAtoi(d1Str), backfillMonthNum(m1Str), bfAtoi(y1Str)
	d2, m2, y2 := bfAtoi(d2Str), backfillMonthNum(m2Str), bfAtoi(y2Str)
	start := bfISO(y1, m1, d1)
	if m1 == 0 || m2 == 0 || start == "" || bfISO(y2, m2, d2) == "" {
		return backfillDate{}, false
	}
	bd := backfillDate{Start: start, Year: y1}
	switch {
	case y1 != y2:
		bd.Display = fmt.Sprintf("%s %d, %d – %s %d, %d",
			monthNames[m1], d1, y1, monthNames[m2], d2, y2)
		bd.EndYear = y2
	case m1 != m2:
		bd.Display = fmt.Sprintf("%s %d – %s %d, %d", monthNames[m1], d1, monthNames[m2], d2, y1)
	default:
		if d1 >= d2 {
			return backfillDate{}, false
		}
		bd.Display = fmt.Sprintf("%s %d–%d, %d", monthNames[m1], d1, d2, y1)
	}
	return bd, true
}

// nominatimResult is one hit from the Nominatim search API in jsonv2 format.
type nominatimResult struct {
	// Lat is the latitude in decimal degrees, encoded as a string.
	Lat string `json:"lat"`
	// Lon is the longitude in decimal degrees, encoded as a string.
	Lon string `json:"lon"`
	// Importance is Nominatim's relevance score for the hit.
	Importance float64 `json:"importance"`
	// DisplayName is the full human-readable place hierarchy.
	DisplayName string `json:"display_name"`
	// BoundingBox is [south, north, west, east] in decimal-degree strings.
	BoundingBox []string `json:"boundingbox"`
}

// nominatimClient throttles, caches, and issues Nominatim search calls.
type nominatimClient struct {
	// ticker enforces the absolute one-request-per-second budget.
	ticker *time.Ticker
	// memo caches query outcomes for the run; a nil value marks a known miss.
	memo map[string]*nominatimResult
	// requests counts live HTTP calls issued this run.
	requests int
}

// newNominatimClient returns a client honoring the 1 req/s Nominatim budget.
func newNominatimClient() *nominatimClient {
	return &nominatimClient{
		ticker: time.NewTicker(nominatimInterval),
		memo:   make(map[string]*nominatimResult),
	}
}

// Close releases the rate-limit ticker.
func (n *nominatimClient) Close() {
	n.ticker.Stop()
}

// search resolves one place query, serving the in-run memo and the disk cache
// before the network. Live lookups wait for the rate-limit tick and retry a
// failure once; a query that still fails is recorded as a miss, not an error.
// The returned error is reserved for context cancellation.
func (n *nominatimClient) search(ctx context.Context, query string) (*nominatimResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if hit, ok := n.memo[query]; ok {
		return hit, nil
	}
	if body, ok := wikiCacheGet(backfillPlaceCacheNS, query); ok {
		n.memo[query] = firstNominatimResult([]byte(body))
		return n.memo[query], nil
	}

	for attempt := 0; attempt < 2; attempt++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-n.ticker.C:
		}
		body, err := n.do(ctx, query)
		if err != nil {
			log.Printf("nominatim: query %q attempt %d failed: %v", query, attempt+1, err)
			continue
		}
		wikiCacheSet(backfillPlaceCacheNS, query, string(body))
		n.memo[query] = firstNominatimResult(body)
		return n.memo[query], nil
	}
	n.memo[query] = nil
	return nil, nil
}

// do performs one live Nominatim search request and returns the raw body.
func (n *nominatimClient) do(ctx context.Context, query string) ([]byte, error) {
	params := url.Values{
		"format": {"jsonv2"},
		"limit":  {"1"},
		"q":      {query},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		nominatimEndpoint+"?"+params.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("build nominatim request: %w", err)
	}
	req.Header.Set("User-Agent", nominatimUserAgent)

	n.requests++
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("nominatim request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nominatim returned %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read nominatim response: %w", err)
	}
	return body, nil
}

// firstNominatimResult decodes a search response body and returns its first
// hit, or nil for an empty or malformed result set.
func firstNominatimResult(body []byte) *nominatimResult {
	var results []nominatimResult
	if err := json.Unmarshal(body, &results); err != nil || len(results) == 0 {
		return nil
	}
	return &results[0]
}

// nominatimAcceptable gates one hit against the confidence rules: valid
// coordinates, a bounding box no wider than nominatimMaxBBoxSpan degrees, and
// either an importance of nominatimMinImportance or a place-name token echoed
// in the display name. An empty reason means the hit is accepted.
func nominatimAcceptable(hit nominatimResult, place string) (float64, float64, string) {
	lat, errLat := strconv.ParseFloat(hit.Lat, 64)
	lng, errLng := strconv.ParseFloat(hit.Lon, 64)
	if errLat != nil || errLng != nil || !isValidCoord(lat, lng) {
		return 0, 0, "invalid-coord"
	}
	if len(hit.BoundingBox) == 4 {
		south, err1 := strconv.ParseFloat(hit.BoundingBox[0], 64)
		north, err2 := strconv.ParseFloat(hit.BoundingBox[1], 64)
		west, err3 := strconv.ParseFloat(hit.BoundingBox[2], 64)
		east, err4 := strconv.ParseFloat(hit.BoundingBox[3], 64)
		if err1 == nil && err2 == nil && err3 == nil && err4 == nil {
			if north-south > nominatimMaxBBoxSpan || east-west > nominatimMaxBBoxSpan {
				return 0, 0, "bbox-too-large"
			}
		}
	}
	if hit.Importance >= nominatimMinImportance {
		return lat, lng, ""
	}
	if placeTokenInDisplay(place, hit.DisplayName) {
		return lat, lng, ""
	}
	return 0, 0, "low-confidence"
}

// bfTokenStopwords lists place-string tokens too generic to count as a match
// against a Nominatim display name.
var bfTokenStopwords = map[string]bool{
	"the": true, "and": true, "near": true, "north": true, "south": true,
	"east": true, "west": true, "northern": true, "southern": true,
	"eastern": true, "western": true, "central": true, "upper": true,
	"lower": true, "new": true, "old": true, "modern": true, "present": true,
	"day": true, "region": true, "province": true, "county": true,
	"district": true, "river": true, "lake": true, "sea": true, "gulf": true,
	"bay": true, "island": true, "islands": true, "coast": true, "city": true,
	"town": true, "village": true, "fort": true, "castle": true, "between": true,
	"today": true, "now": true, "formerly": true, "currently": true, "site": true,
}

// placeTokenInDisplay reports whether any distinctive token of the place
// string appears in the display name, case-insensitively.
func placeTokenInDisplay(place, displayName string) bool {
	display := strings.ToLower(displayName)
	tokens := strings.FieldsFunc(place, func(r rune) bool { return !unicode.IsLetter(r) })
	for _, tok := range tokens {
		tok = strings.ToLower(tok)
		if len(tok) < 3 || bfTokenStopwords[tok] {
			continue
		}
		if strings.Contains(display, tok) {
			return true
		}
	}
	return false
}

// bfPlaceNoiseRe strips leading locality prepositions and era qualifiers that
// hurt geocoding, applied repeatedly for stacked forms like "off the coast of".
var bfPlaceNoiseRe = regexp.MustCompile(`(?i)^(?:near|at|in|off|outside|around|about|` +
	`vicinity of|the vicinity of|the coast of|coast of|the outskirts of|outskirts of|` +
	`north of|south of|east of|west of|northeast of|northwest of|southeast of|southwest of|` +
	`present-day|modern-day|modern)\s+`)

// stripPlaceNoise removes leading noise words from a place string until the
// string stabilizes.
func stripPlaceNoise(place string) string {
	place = strings.TrimSpace(place)
	for {
		next := strings.TrimSpace(bfPlaceNoiseRe.ReplaceAllString(place, ""))
		if next == place {
			return place
		}
		place = next
	}
}

// bfPlaceQueryCap bounds the Nominatim candidates per battle so one place
// string can never eat more than a few seconds of the shared 1 req/s budget.
const bfPlaceQueryCap = 5

// bfParenRe captures parenthetical asides in place text.
var bfParenRe = regexp.MustCompile(`\(([^)]*)\)`)

// bfModernParenRe extracts the modern name from "(today Sabha)" style asides.
var bfModernParenRe = regexp.MustCompile(
	`(?i)^(?:today|now|modern|modern-day|present-day|present day|currently|near)\s+(.+)$`)

// bfHistoricalRegions maps historical region and state names, as they appear
// in the last segment of infobox place text, to the modern country used for
// a retry query. Only unambiguous mappings belong here.
var bfHistoricalRegions = map[string]string{
	"mesopotamia":                    "Iraq",
	"persia":                         "Iran",
	"safavid empire":                 "Iran",
	"ottoman empire":                 "Turkey",
	"anatolia":                       "Turkey",
	"italian east africa":            "Ethiopia",
	"abyssinia":                      "Ethiopia",
	"ceylon":                         "Sri Lanka",
	"siam":                           "Thailand",
	"burma":                          "Myanmar",
	"rhodesia":                       "Zimbabwe",
	"southern rhodesia":              "Zimbabwe",
	"bohemia":                        "Czech Republic",
	"czechoslovakia":                 "Czech Republic",
	"prussia":                        "Germany",
	"holy roman empire":              "Germany",
	"gaul":                           "France",
	"new spain":                      "Mexico",
	"new france":                     "Canada",
	"upper canada":                   "Canada",
	"lower canada":                   "Canada",
	"french indochina":               "Vietnam",
	"dutch east indies":              "Indonesia",
	"austria-hungary":                "Austria",
	"russian empire":                 "Russia",
	"soviet union":                   "Russia",
	"ussr":                           "Russia",
	"yugoslavia":                     "Serbia",
	"mandatory palestine":            "Israel",
	"british india":                  "India",
	"mughal empire":                  "India",
	"right-bank ukraine":             "Ukraine",
	"left-bank ukraine":              "Ukraine",
	"kingdom of hungary":             "Hungary",
	"kingdom of france":              "France",
	"kingdom of england":             "England",
	"kingdom of scotland":            "Scotland",
	"kingdom of italy":               "Italy",
	"papal states":                   "Italy",
	"manchuria":                      "China",
	"qing dynasty":                   "China",
	"ming dynasty":                   "China",
	"joseon":                         "South Korea",
	"transylvania":                   "Romania",
	"wallachia":                      "Romania",
	"silesia":                        "Poland",
	"pomerania":                      "Poland",
	"livonia":                        "Latvia",
	"new granada":                    "Colombia",
	"gran colombia":                  "Colombia",
	"al-andalus":                     "Spain",
	"crown of aragon":                "Spain",
	"confederate states of america":  "United States",
	"grand duchy of lithuania":       "Lithuania",
	"polish-lithuanian commonwealth": "Poland",
}

// buildPlaceQueries returns the ordered Nominatim query candidates for one
// place string. Candidates, most precise first: the modern name from a
// "(today X)" aside, the cleaned place with parentheticals dropped, the last
// comma segment plus any country named in the text, the first segment plus
// that country, the first segment plus the modern country a historical last
// segment maps to, and finally the place suffixed with the country guessed
// from the war name.
func buildPlaceQueries(place, war string) []string {
	base := stripPlaceNoise(place)
	if base == "" {
		return nil
	}

	var queries []string
	add := func(q string) {
		q = strings.TrimSpace(strings.Trim(strings.TrimSpace(q), ","))
		if q != "" && len(queries) < bfPlaceQueryCap && !slices.Contains(queries, q) {
			queries = append(queries, q)
		}
	}

	var modern string
	for _, m := range bfParenRe.FindAllStringSubmatch(base, -1) {
		if mm := bfModernParenRe.FindStringSubmatch(strings.TrimSpace(m[1])); mm != nil {
			modern = strings.TrimSpace(mm[1])
			break
		}
	}
	noParens := bfParenRe.ReplaceAllString(base, " ")
	noParens = bfWhitespaceRe.ReplaceAllString(noParens, " ")
	noParens = strings.TrimSpace(strings.ReplaceAll(noParens, " ,", ","))
	if noParens == "" {
		noParens = base
	}

	segs := strings.Split(noParens, ",")
	first := stripPlaceNoise(segs[0])
	last := stripPlaceNoise(segs[len(segs)-1])
	country := countryInText(noParens)

	if modern != "" {
		if country != "" && !strings.Contains(strings.ToLower(modern), strings.ToLower(country)) {
			add(modern + ", " + country)
		} else {
			add(modern)
		}
	}
	add(noParens)

	if country != "" && !strings.Contains(strings.ToLower(last), strings.ToLower(country)) {
		add(last + ", " + country)
	} else if country == "" && !strings.EqualFold(last, noParens) {
		add(last)
	}
	if country != "" && len(segs) > 1 && !strings.EqualFold(first, country) {
		add(first + ", " + country)
	}
	if m, ok := bfHistoricalRegions[strings.ToLower(last)]; ok && !strings.EqualFold(first, last) {
		add(first + ", " + m)
	}
	if wc := countryFromWar(war); wc != "" &&
		!strings.Contains(strings.ToLower(noParens), strings.ToLower(wc)) {
		add(noParens + ", " + wc)
	}
	return queries
}

// bfCountryNames lists the modern country names recognized inside place text
// and war names. Multi-word names come first so they win over any overlap.
var bfCountryNames = []string{
	"United States", "United Kingdom", "South Africa", "South Korea", "North Korea",
	"Saudi Arabia", "New Zealand", "Sri Lanka", "Czech Republic", "Bosnia and Herzegovina",
	"Afghanistan", "Albania", "Algeria", "Angola", "Argentina", "Armenia", "Australia",
	"Austria", "Azerbaijan", "Bangladesh", "Belarus", "Belgium", "Bolivia", "Brazil",
	"Bulgaria", "Cambodia", "Cameroon", "Canada", "Chad", "Chile", "China", "Colombia",
	"Croatia", "Cuba", "Cyprus", "Denmark", "Ecuador", "Egypt", "England", "Eritrea",
	"Estonia", "Ethiopia", "Finland", "France", "Georgia", "Germany", "Ghana", "Greece",
	"Guatemala", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran",
	"Iraq", "Ireland", "Israel", "Italy", "Japan", "Jordan", "Kazakhstan", "Kenya",
	"Kuwait", "Laos", "Latvia", "Lebanon", "Libya", "Lithuania", "Madagascar", "Malaysia",
	"Mali", "Malta", "Mexico", "Mongolia", "Morocco", "Mozambique", "Myanmar", "Nepal",
	"Netherlands", "Nicaragua", "Nigeria", "Niger", "Norway", "Pakistan", "Panama",
	"Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Romania", "Russia",
	"Rwanda", "Scotland", "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia",
	"Somalia", "Spain", "Sudan", "Sweden", "Switzerland", "Syria", "Taiwan", "Thailand",
	"Tunisia", "Turkey", "Uganda", "Ukraine", "Uruguay", "Uzbekistan", "Venezuela",
	"Vietnam", "Wales", "Yemen", "Zambia", "Zimbabwe",
}

// bfCountryRe matches any recognized country name on word boundaries.
var bfCountryRe = buildCountryRe()

// bfCountryCanon maps lowercased country names back to canonical casing.
var bfCountryCanon = buildCountryCanon()

// buildCountryRe compiles the alternation used by countryInText.
func buildCountryRe() *regexp.Regexp {
	quoted := make([]string, len(bfCountryNames))
	for i, name := range bfCountryNames {
		quoted[i] = regexp.QuoteMeta(name)
	}
	return regexp.MustCompile(`(?i)\b(` + strings.Join(quoted, "|") + `)\b`)
}

// buildCountryCanon builds the lowercase-to-canonical country name map.
func buildCountryCanon() map[string]string {
	m := make(map[string]string, len(bfCountryNames))
	for _, name := range bfCountryNames {
		m[strings.ToLower(name)] = name
	}
	return m
}

// countryInText returns the first recognized country named in the text, in
// canonical casing, or "" when none appears.
func countryInText(text string) string {
	match := bfCountryRe.FindString(text)
	if match == "" {
		return ""
	}
	return bfCountryCanon[strings.ToLower(match)]
}

// bfWarCountryHints maps war-name fragments to a modern country for the
// last-chance geocode query. Ordered: the first fragment found wins, so
// specific entries precede the generic adjectives they contain.
var bfWarCountryHints = []struct {
	// Token is the lowercase fragment searched for in the war name.
	Token string
	// Country is the modern country appended to the place query.
	Country string
}{
	{"french and indian", "United States"},
	{"american", "United States"},
	{"ukrain", "Ukraine"},
	{"afghan", "Afghanistan"},
	{"vietnam", "Vietnam"},
	{"korean", "Korea"},
	{"sino", "China"},
	{"chinese", "China"},
	{"japanese", "Japan"},
	{"mexic", "Mexico"},
	{"paraguayan", "Paraguay"},
	{"boer", "South Africa"},
	{"russo-turkish", "Turkey"},
	{"russian", "Russia"},
	{"russo", "Russia"},
	{"franco", "France"},
	{"french", "France"},
	{"spanish", "Spain"},
	{"portuguese", "Portugal"},
	{"italian", "Italy"},
	{"italo", "Italy"},
	{"greco", "Greece"},
	{"greek", "Greece"},
	{"ottoman", "Turkey"},
	{"turkish", "Turkey"},
	{"egyptian", "Egypt"},
	{"indian", "India"},
	{"pakistani", "Pakistan"},
	{"polish", "Poland"},
	{"hungarian", "Hungary"},
	{"austro", "Austria"},
	{"austrian", "Austria"},
	{"swedish", "Sweden"},
	{"danish", "Denmark"},
	{"norwegian", "Norway"},
	{"finnish", "Finland"},
	{"dutch", "Netherlands"},
	{"english", "England"},
	{"scottish", "Scotland"},
	{"irish", "Ireland"},
	{"prussian", "Germany"},
	{"german", "Germany"},
	{"serbian", "Serbia"},
	{"bulgarian", "Bulgaria"},
	{"romanian", "Romania"},
	{"croatian", "Croatia"},
	{"bosnian", "Bosnia and Herzegovina"},
	{"philippine", "Philippines"},
	{"indonesian", "Indonesia"},
	{"malayan", "Malaysia"},
	{"burmese", "Myanmar"},
	{"thai", "Thailand"},
	{"israeli", "Israel"},
	{"syrian", "Syria"},
	{"lebanese", "Lebanon"},
	{"yemeni", "Yemen"},
	{"somali", "Somalia"},
	{"ethiopian", "Ethiopia"},
	{"sudanese", "Sudan"},
	{"libyan", "Libya"},
	{"algerian", "Algeria"},
	{"moroccan", "Morocco"},
	{"nigerian", "Nigeria"},
	{"angolan", "Angola"},
	{"rhodesian", "Zimbabwe"},
	{"peruvian", "Peru"},
	{"chilean", "Chile"},
	{"bolivian", "Bolivia"},
	{"brazilian", "Brazil"},
	{"argentine", "Argentina"},
	{"colombian", "Colombia"},
	{"venezuelan", "Venezuela"},
	{"cuban", "Cuba"},
	{"canadian", "Canada"},
	{"iraqi", "Iraq"},
	{"iranian", "Iran"},
}

// countryFromWar guesses the modern country a war name points at: a country
// named outright wins, then adjectival fragments from bfWarCountryHints.
// Returns "" when the war names no country.
func countryFromWar(war string) string {
	war = strings.TrimSpace(war)
	if war == "" {
		return ""
	}
	if c := countryInText(war); c != "" {
		return c
	}
	lower := strings.ToLower(war)
	for _, hint := range bfWarCountryHints {
		if strings.Contains(lower, hint.Token) {
			return hint.Country
		}
	}
	return ""
}
