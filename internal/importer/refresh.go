package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

// refreshMaxChanges caps how many existing rows one refresh may change. More
// means the scope rule selected far more than the recent catalog.
const refreshMaxChanges = 2000

// RefreshReport summarizes one -wikidata-refresh run.
type RefreshReport struct {
	// Fetched is the number of distinct Q-ids the catalog queries returned.
	Fetched int
	// New is the number of returned Q-ids no row carries yet.
	New int
	// Inserted is the number of new rows written.
	Inserted int
	// SkippedTitle counts new Q-ids whose article is already some row's stored title.
	SkippedTitle int
	// SkippedName counts new Q-ids named like an existing row of the same year, or a curated row.
	SkippedName int
	// SkippedLabel counts new Q-ids with no English label.
	SkippedLabel int
	// SkippedRemoved counts new Q-ids a cleanse pass removed on purpose, as a non-battle or a merged duplicate.
	SkippedRemoved int
	// InScope is the number of existing rows whose Wikidata facts were read again.
	InScope int
	// Missing counts in-scope rows whose item Wikidata no longer has.
	Missing int
	// FactsChanged counts in-scope rows whose stored Wikidata facts moved.
	FactsChanged int
	// DatesRewritten counts in-scope rows whose date columns were rendered again from a moved Wikidata date.
	DatesRewritten int
	// TitlesSet counts in-scope rows given the item's English article title.
	TitlesSet int
	// CoordsFilled counts in-scope rows at 0,0 given the item's coordinates.
	CoordsFilled int
}

// catalogFunc returns the Wikidata battle catalog as SPARQL rows.
type catalogFunc func(ctx context.Context) ([]sparqlBinding, error)

// factsFunc returns live Wikidata facts per Q-id and the English labels of the
// conflict and class items they name.
type factsFunc func(ctx context.Context, qids []string) (map[string]wikidataFacts, map[string]string, error)

// RefreshWikidata brings the wikidata rows up to date with Wikidata. It inserts
// every battle the catalog queries return that no row carries yet, matched by
// Q-id and never by name and never an item a cleanse pass removed, and reads the live facts of every unverified wikidata
// row dated since the given year or not dated at all. For those rows it stores
// the facts, renders the date columns again when the Wikidata date or end
// moved, takes the item's English article when the row has none or the stored
// title redirects to it, and takes the item's coordinates when the row sits at
// 0,0. It never writes curated or verified rows, a victor, a summary, sides,
// or a war: Cleanse files new and changed rows under their war from the stored
// facts. Every network read happens before the one write transaction, so a
// failed run writes nothing.
// A dry run plans and logs every insert and update and writes nothing.
func RefreshWikidata(ctx context.Context, db *sql.DB, since int, dryRun bool) (RefreshReport, error) {
	return refreshWikidata(ctx, db, since, dryRun, fetchBattleCatalog, liveWikidataFacts, cachedCanonicalTitle,
		time.Now().UTC())
}

// refreshRow is one existing row as the refresh reads it.
type refreshRow struct {
	id, qid, source, title, name string
	year, prec, endPrec          int
	verified                     bool
	lat, lng                     float64
	date, end, conflict          string
}

// catalogItem is one Q-id's merged catalog rows.
type catalogItem struct {
	label, date, coords, article string
}

// refreshWikidata is RefreshWikidata with its sources and clock supplied.
func refreshWikidata(ctx context.Context, db *sql.DB, since int, dryRun bool, catalog catalogFunc, facts factsFunc,
	canon canonicalTitleFunc, now time.Time) (RefreshReport, error) {
	var rep RefreshReport
	bindings, err := catalog(ctx)
	if err != nil {
		return rep, fmt.Errorf("battle catalog: %w", err)
	}
	items, order := mergeCatalog(bindings)
	rep.Fetched = len(order)

	existing, err := loadRefreshRows(ctx, db)
	if err != nil {
		return rep, err
	}
	byQID := map[string][]refreshRow{}
	titles := map[string]bool{}
	ids := map[string]bool{}
	names := map[string][]int{}
	curatedNames := map[string]bool{}
	for _, r := range existing {
		ids[r.id] = true
		if r.title != "" {
			titles[r.title] = true
		}
		lname := strings.ToLower(r.name)
		names[lname] = append(names[lname], r.year)
		if r.source == "curated" {
			curatedNames[lname] = true
		}
		if r.qid != "" {
			byQID[r.qid] = append(byQID[r.qid], r)
		}
	}

	removed, err := removedQIDs(ctx, db)
	if err != nil {
		return rep, err
	}
	var fresh []string
	for _, q := range order {
		if _, ok := byQID[q]; ok {
			continue
		}
		rep.New++
		if removed[q] {
			rep.SkippedRemoved++
			continue
		}
		fresh = append(fresh, q)
	}
	var scope []refreshRow
	scopeQIDs := map[string]bool{}
	for _, r := range existing {
		if r.source == "wikidata" && !r.verified && r.qid != "" && (r.year >= since || r.year == 0) {
			scope = append(scope, r)
			scopeQIDs[r.qid] = true
		}
	}
	rep.InScope = len(scope)
	want := append([]string{}, fresh...)
	for q := range scopeQIDs {
		want = append(want, q)
	}
	log.Printf("wikidata-refresh: %d catalog items, %d new, %d existing rows in scope", rep.Fetched, rep.New,
		rep.InScope)
	got, labels, err := facts(ctx, want)
	if err != nil {
		return rep, fmt.Errorf("live facts: %w", err)
	}

	checked := now.Format("2006-01-02")
	var inserts []refreshInsert
	for _, q := range fresh {
		it := items[q]
		f := got[q]
		ins, skip := planRefreshInsert(q, it, f, labels, titles, ids, names, curatedNames)
		switch skip {
		case "label":
			rep.SkippedLabel++
			continue
		case "title":
			rep.SkippedTitle++
			continue
		case "name":
			rep.SkippedName++
			continue
		}
		ids[ins.id] = true
		if ins.title != "" {
			titles[ins.title] = true
		}
		inserts = append(inserts, ins)
	}

	var updates []refreshUpdate
	for _, r := range scope {
		f, ok := got[r.qid]
		if !ok || f.Missing {
			rep.Missing++
			continue
		}
		u, changed := planRefreshUpdate(r, items[r.qid], f, labels, canon)
		if !changed {
			continue
		}
		updates = append(updates, u)
		if u.factsMoved {
			rep.FactsChanged++
		}
		if u.dateMoved {
			rep.DatesRewritten++
		}
		if u.titleSet {
			rep.TitlesSet++
		}
		if u.coordsSet {
			rep.CoordsFilled++
		}
	}
	if len(updates) > refreshMaxChanges {
		return rep, fmt.Errorf("%w: %d existing rows would change, cap %d", ErrRefreshScope, len(updates),
			refreshMaxChanges)
	}
	if dryRun {
		for _, r := range inserts {
			log.Printf("wikidata-refresh: would insert %s %s %q %d title %q classes %q", r.qid, r.id, r.name,
				r.year, r.title, r.instance)
		}
		for _, u := range updates {
			log.Printf("wikidata-refresh: would update %s date %v %q title %v coords %v conflict %q", u.id,
				u.dateMoved, u.date, u.titleSet, u.coordsSet, u.conflict)
		}
		return rep, nil
	}
	if err := writeRefresh(ctx, db, inserts, updates, checked); err != nil {
		return rep, err
	}
	rep.Inserted = len(inserts)
	return rep, nil
}

// mergeCatalog folds the catalog rows into one item per Q-id, keeping the
// first non-empty value of each field, and returns the Q-ids in first-seen order.
func mergeCatalog(bindings []sparqlBinding) (map[string]catalogItem, []string) {
	items := map[string]catalogItem{}
	var order []string
	for _, b := range bindings {
		q := wikidataID(b.Battle.Value)
		if !strings.HasPrefix(q, "Q") {
			continue
		}
		it, seen := items[q]
		if !seen {
			order = append(order, q)
		}
		if it.label == "" && b.Label.Value != q {
			it.label = b.Label.Value
		}
		if it.date == "" {
			it.date = b.Date.Value
		}
		if it.coords == "" {
			it.coords = b.Coords.Value
		}
		if it.article == "" {
			it.article = b.Article.Value
		}
		items[q] = it
	}
	return items, order
}

// loadRefreshRows reads every battle row the refresh compares against.
func loadRefreshRows(ctx context.Context, db *sql.DB) ([]refreshRow, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, CASE WHEN source_id LIKE 'Q%' THEN source_id ELSE '' END,
		source, wikipedia_title, name, year, verified, lat, lng, wikidata_date, wikidata_precision, wikidata_end,
		wikidata_end_precision, wikidata_conflict FROM battles ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("query refresh rows: %w", err)
	}
	defer rows.Close()
	var out []refreshRow
	for rows.Next() {
		var r refreshRow
		var verified int
		if err := rows.Scan(&r.id, &r.qid, &r.source, &r.title, &r.name, &r.year, &verified, &r.lat, &r.lng,
			&r.date, &r.prec, &r.end, &r.endPrec, &r.conflict); err != nil {
			return nil, fmt.Errorf("scan refresh row: %w", err)
		}
		r.verified = verified == 1
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate refresh rows: %w", err)
	}
	return out, nil
}

// refreshInsert is one new row.
type refreshInsert struct {
	id, name, qid, title, date, era, wdDate, wdEnd, conflict, instance string
	year, prec, endPrec                                                int
	lat, lng                                                           float64
	dr                                                                 DateRange
}

// planRefreshInsert builds the row for a new Q-id, or names why it is skipped:
// "label" for no English label, "title" when its article is some row's stored
// title, "name" when a curated row or a row of the same or a neighboring year
// has its name.
func planRefreshInsert(q string, it catalogItem, f wikidataFacts, labels map[string]string, titles, ids map[string]bool,
	names map[string][]int, curatedNames map[string]bool) (refreshInsert, string) {
	ins := refreshInsert{name: it.label, qid: q, title: wikipediaTitle(it.article), wdDate: f.Date, prec: f.Precision,
		wdEnd: f.End, endPrec: f.EndPrecision, conflict: joinLabels(f.Conflicts, labels),
		instance: joinLabels(f.Instances, labels)}
	if ins.name == "" || slugify(ins.name) == "" {
		return ins, "label"
	}
	if ins.title != "" && titles[ins.title] {
		return ins, "title"
	}
	if display, dr, ok := renderWikidataDate(f.Date, f.Precision, f.End, f.EndPrecision); ok {
		ins.year, ins.date, ins.dr = parseWikidataYear(f.Date), display, dr
	} else {
		ins.year = sparqlYear(it.date)
		ins.date = formatWikidataDate(it.date, ins.year)
		if ins.year == 0 {
			ins.date = ""
		}
		ins.dr = ParseDateRange(ins.date, ins.year)
	}
	lname := strings.ToLower(ins.name)
	if curatedNames[lname] {
		return ins, "name"
	}
	for _, y := range names[lname] {
		if y == 0 || ins.year == 0 || y-ins.year <= 1 && ins.year-y <= 1 {
			return ins, "name"
		}
	}
	ins.era = yearToEra(ins.year)
	ins.lat, ins.lng = parsePoint(it.coords)
	ins.id = slugify(ins.name)
	if ids[ins.id] && ins.year != 0 {
		ins.id = slugify(ins.name) + "-" + yearSlug(ins.year)
	}
	if ids[ins.id] {
		ins.id = slugify(ins.name) + "-" + strings.ToLower(q)
	}
	return ins, ""
}

// refreshUpdate is the new state of one existing row.
type refreshUpdate struct {
	id, wdDate, wdEnd, conflict, instance, title, date, era string
	prec, endPrec, year                                     int
	lat, lng                                                float64
	dr                                                      DateRange
	factsMoved, dateMoved, titleSet, coordsSet              bool
}

// planRefreshUpdate compares an in-scope row with the live facts and its catalog
// item and reports whether anything changes. The date columns are rendered again
// only when the Wikidata date or end moved and Wikidata gives a date. A row's
// conflict is replaced only by a non-empty P607 list, since an empty one may sit
// beside a war-class P361 target that -wikidata-wars stored. The title is taken
// when the row has none or its stored title redirects to the item's article.
func planRefreshUpdate(r refreshRow, it catalogItem, f wikidataFacts, labels map[string]string,
	canon canonicalTitleFunc) (refreshUpdate, bool) {
	u := refreshUpdate{id: r.id, wdDate: f.Date, prec: f.Precision, wdEnd: f.End, endPrec: f.EndPrecision,
		conflict: r.conflict, instance: joinLabels(f.Instances, labels), title: r.title, lat: r.lat, lng: r.lng}
	if c := joinLabels(f.Conflicts, labels); c != "" {
		u.conflict = c
	}
	u.dateMoved = f.Date != "" && (f.Date != r.date || f.Precision != r.prec || f.End != r.end ||
		f.EndPrecision != r.endPrec)
	u.factsMoved = u.dateMoved || f.Date != r.date || u.conflict != r.conflict
	if u.dateMoved {
		display, dr, ok := renderWikidataDate(f.Date, f.Precision, f.End, f.EndPrecision)
		if !ok {
			u.dateMoved = false
		} else {
			u.year, u.date, u.dr, u.era = parseWikidataYear(f.Date), display, dr, yearToEra(parseWikidataYear(f.Date))
		}
	}
	if t := wikipediaTitle(it.article); t != "" && t != r.title {
		if c, ok := canon(r.title); r.title == "" || ok && c == t {
			u.title, u.titleSet = t, true
		}
	}
	if r.lat == 0 && r.lng == 0 {
		if lat, lng := parsePoint(it.coords); lat != 0 || lng != 0 {
			u.lat, u.lng, u.coordsSet = lat, lng, true
		}
	}
	return u, u.factsMoved || u.dateMoved || u.titleSet || u.coordsSet
}

// writeRefresh writes the new rows and the in-scope updates in one transaction.
// Every update also stores the facts it was compared with and the check date.
func writeRefresh(ctx context.Context, db *sql.DB, inserts []refreshInsert, updates []refreshUpdate,
	checked string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin refresh tx: %w", err)
	}
	defer tx.Rollback()
	ins, err := tx.PrepareContext(ctx, `INSERT INTO battles (id, name, year, date, date_start, date_end, lat, lng,
		era, war, battle_type, victor, summary, significance, source, source_id, verified, wikipedia_title,
		wikidata_date, wikidata_precision, wikidata_end, wikidata_end_precision, wikidata_conflict,
		wikidata_instance_of, wikidata_checked)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'land', '', '', '', 'wikidata', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare refresh insert: %w", err)
	}
	defer ins.Close()
	for _, r := range inserts {
		if _, err := ins.ExecContext(ctx, r.id, r.name, r.year, r.date, r.dr.Start, r.dr.End, r.lat, r.lng, r.era,
			r.qid, r.title, r.wdDate, r.prec, r.wdEnd, r.endPrec, r.conflict, r.instance, checked); err != nil {
			return fmt.Errorf("insert %s (%s): %w", r.id, r.qid, err)
		}
		log.Printf("wikidata-refresh: new %s %s %q %d", r.qid, r.id, r.name, r.year)
	}
	facts, err := tx.PrepareContext(ctx, `UPDATE battles SET wikidata_date = ?, wikidata_precision = ?,
		wikidata_end = ?, wikidata_end_precision = ?, wikidata_conflict = ?, wikidata_instance_of = ?,
		wikidata_checked = ?, wikipedia_title = ?, lat = ?, lng = ?
		WHERE id = ? AND source = 'wikidata' AND verified = 0`)
	if err != nil {
		return fmt.Errorf("prepare refresh facts: %w", err)
	}
	defer facts.Close()
	dates, err := tx.PrepareContext(ctx, `UPDATE battles SET year = ?, date = ?, date_start = ?, date_end = ?,
		era = ? WHERE id = ? AND source = 'wikidata' AND verified = 0`)
	if err != nil {
		return fmt.Errorf("prepare refresh dates: %w", err)
	}
	defer dates.Close()
	for _, u := range updates {
		if _, err := facts.ExecContext(ctx, u.wdDate, u.prec, u.wdEnd, u.endPrec, u.conflict, u.instance, checked,
			u.title, u.lat, u.lng, u.id); err != nil {
			return fmt.Errorf("refresh facts for %s: %w", u.id, err)
		}
		if !u.dateMoved {
			continue
		}
		if _, err := dates.ExecContext(ctx, u.year, u.date, u.dr.Start, u.dr.End, u.era, u.id); err != nil {
			return fmt.Errorf("refresh dates for %s: %w", u.id, err)
		}
		log.Printf("wikidata-refresh: %s date -> %q (%s to %s)", u.id, u.date, u.dr.Start, u.dr.End)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit refresh: %w", err)
	}
	return nil
}

// fetchBattleCatalog runs the four catalog queries -wikidata runs. The first
// must answer; a later one that fails is logged and skipped, since a missed
// item is picked up by the next refresh.
func fetchBattleCatalog(ctx context.Context) ([]sparqlBinding, error) {
	queries := []string{wikidataQuery, wikidataQueryStartDate, wikidataQueryNoDate, wikidataQueryNoCoordsWithDate}
	var out []sparqlBinding
	for i, q := range queries {
		rows, err := patientSPARQL[sparqlBinding](ctx, "wikidata-refresh", q)
		if err != nil {
			if i == 0 {
				return nil, fmt.Errorf("catalog query 1: %w", err)
			}
			log.Printf("wikidata-refresh: catalog query %d failed: %v (skipped)", i+1, err)
			continue
		}
		log.Printf("wikidata-refresh: catalog query %d: %d rows", i+1, len(rows))
		out = append(out, rows...)
	}
	return out, nil
}

// refreshBusyTries bounds how many times one facts batch waits out a busy API.
const refreshBusyTries = 10

// patientWikidataEntities reads one batch of claims, waiting a minute and
// trying again while Wikidata reports maxlag or 429, at most refreshBusyTries times.
func patientWikidataEntities(ctx context.Context, qids []string) (map[string]wikidataEntity, error) {
	for try := 1; ; try++ {
		ents, err := fetchWikidataEntities(ctx, wikidataAPI, qids, "claims")
		if !errors.Is(err, ErrWikidataBusy) || try == refreshBusyTries {
			return ents, err
		}
		log.Printf("wikidata-refresh: api busy, waiting %s (try %d of %d)", sparqlBusyPause, try, refreshBusyTries)
		if err := sleepCtx(ctx, sparqlBusyPause); err != nil {
			return nil, err
		}
	}
}

// refreshFreshFor is how old a cached facts entry may be and still count as live,
// so a stopped refresh resumes and a dry run followed by a run reads Wikidata once.
const refreshFreshFor = 12 * time.Hour

// liveWikidataFacts reads each Q-id's facts from wbgetentities unless the cache
// entry was written within refreshFreshFor, and writes what it reads back to the
// cache so -wikidata-dates sees it.
func liveWikidataFacts(ctx context.Context, qids []string) (map[string]wikidataFacts, map[string]string, error) {
	out := make(map[string]wikidataFacts, len(qids))
	var stale []string
	for _, q := range qids {
		if f, ok := recentWikidataFacts(q, time.Now().Add(-refreshFreshFor)); ok {
			out[q] = f
			continue
		}
		stale = append(stale, q)
	}
	log.Printf("wikidata-refresh: %d Q-ids read within %s, %d to fetch", len(out), refreshFreshFor, len(stale))
	qids = stale
	for start := 0; start < len(qids); start += wikidataEntityBatch {
		batch := qids[start:min(start+wikidataEntityBatch, len(qids))]
		ents, err := patientWikidataEntities(ctx, batch)
		if err != nil {
			return nil, nil, fmt.Errorf("facts batch at %d: %w", start, err)
		}
		for _, q := range batch {
			e, ok := ents[q]
			f := wikidataFacts{Missing: !ok || e.Missing != nil}
			if !f.Missing {
				f = factsFromClaims(e.Claims)
			}
			cacheWikidataFacts(q, f)
			out[q] = f
		}
		if start/wikidataEntityBatch%10 == 0 {
			log.Printf("wikidata-refresh: facts %d/%d", min(start+wikidataEntityBatch, len(qids)), len(qids))
		}
	}
	labels, err := wikidataLabelsFor(ctx, wikidataAPI, labelIDs(out))
	if err != nil {
		return nil, nil, fmt.Errorf("labels: %w", err)
	}
	return out, labels, nil
}

// recentWikidataFacts returns the cached facts for q when the entry was written after since.
func recentWikidataFacts(q string, since time.Time) (wikidataFacts, bool) {
	fi, err := os.Stat(wikiCachePath(wikidataFactsNamespace, q))
	if err != nil || fi.ModTime().Before(since) {
		return wikidataFacts{}, false
	}
	s, ok := wikiCacheGet(wikidataFactsNamespace, q)
	if !ok {
		return wikidataFacts{}, false
	}
	var f wikidataFacts
	if err := json.Unmarshal([]byte(s), &f); err != nil {
		return wikidataFacts{}, false
	}
	return f, true
}

// yearSlug renders a year for a slug suffix: 1916 as "1916" and -409 as "409-bc".
func yearSlug(year int) string {
	if year < 0 {
		return fmt.Sprintf("%d-bc", -year)
	}
	return fmt.Sprint(year)
}
