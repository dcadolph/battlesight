package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	// coordAgreeKM is how close two coordinates must sit to count as the same place.
	coordAgreeKM = 50
	// coordSourceWikidata names Wikidata P625 as a coordinate's source. Article
	// sources are named by their site id, e.g. enwiki or frwiki.
	coordSourceWikidata = "wikidata"
	// coordWikidataNamespace caches the P625 values and sitelinks per Q-id.
	coordWikidataNamespace = "wikidata-coords"
	// coordGeoDataNamespace prefixes the per-language article coordinate cache.
	coordGeoDataNamespace = "geodata-"
	// coordRequestPause spaces live requests to one every two seconds.
	coordRequestPause = 2 * time.Second
	// coordSPARQLBatch is how many Q-ids one query service request asks about.
	coordSPARQLBatch = 200
	// coordBusyPause is the wait before the one retry of a busy query service.
	coordBusyPause = time.Minute
	// wikidataPreferredRank is the rank IRI of a preferred statement.
	wikidataPreferredRank = "http://wikiba.se/ontology#PreferredRank"
	// wikidataEntityPrefix prefixes every item IRI in a query result.
	wikidataEntityPrefix = "http://www.wikidata.org/entity/"
	// navalBattleClass is the Wikidata P31 label of naval battle (Q1261499).
	navalBattleClass = "naval battle"
	// wikidataEarth is the globe value of a P625 coordinate on Earth.
	wikidataEarth = "http://www.wikidata.org/entity/Q2"
)

// coordLangRe accepts the language part of a Wikipedia site id.
var coordLangRe = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// coordSPARQLQuery asks for the non-deprecated P625 values and the Wikipedia
// sitelinks of the Q-ids filled in for %s.
const coordSPARQLQuery = `SELECT ?item ?lat ?lng ?globe ?rank ?site ?title WHERE {
  VALUES ?item { %s }
  {
    ?item p:P625 ?st .
    ?st wikibase:rank ?rank ; psv:P625 ?v .
    ?v wikibase:geoLatitude ?lat ; wikibase:geoLongitude ?lng .
    OPTIONAL { ?v wikibase:geoGlobe ?globe . }
    FILTER(?rank != wikibase:DeprecatedRank)
  } UNION {
    ?article schema:about ?item ; schema:isPartOf ?site ; schema:name ?title .
    FILTER(STRENDS(STR(?site), ".wikipedia.org/"))
  }
}`

// coordPoint is one coordinate and the source that gives it.
type coordPoint struct {
	// Lat is the latitude in decimal degrees.
	Lat float64
	// Lng is the longitude in decimal degrees.
	Lng float64
	// Source names where the point came from: wikidata or a site id such as enwiki.
	Source string
}

// wikidataCoordFacts is what Wikidata holds about an item's place, as cached on disk.
type wikidataCoordFacts struct {
	// P625 holds the Earth coordinate values as lat, lng pairs, preferred rank first.
	P625 [][2]float64 `json:"p625,omitempty"`
	// Sitelinks maps a Wikipedia language code to the item's article title there.
	Sitelinks map[string]string `json:"sitelinks,omitempty"`
}

// articleCoord is one cached article coordinate. Found is false for an article
// with no usable coordinate.
type articleCoord struct {
	// Found is true when the article carries a usable primary coordinate.
	Found bool `json:"found"`
	// Lat is the latitude in decimal degrees.
	Lat float64 `json:"lat,omitempty"`
	// Lng is the longitude in decimal degrees.
	Lng float64 `json:"lng,omitempty"`
}

// coordLookup fetches the coordinate sources for a set of rows.
type coordLookup interface {
	// wikidataCoords returns the P625 values and sitelinks for each Q-id.
	wikidataCoords(ctx context.Context, qids []string) (map[string]wikidataCoordFacts, error)
	// articleCoords returns the primary article coordinate for each title on
	// the lang Wikipedia. Titles with no usable coordinate are absent.
	articleCoords(ctx context.Context, lang string, titles []string) (map[string]coordPoint, error)
}

// coordRow is one battle row the coordinate stage may move.
type coordRow struct {
	// ID is the battle slug.
	ID string
	// Name is the display name.
	Name string
	// QID is the Wikidata item id.
	QID string
	// Title is the stored English Wikipedia title.
	Title string
	// BattleType is land, naval, siege and so on.
	BattleType string
	// InstanceOf holds the Wikidata P31 labels, pipe-joined.
	InstanceOf string
	// Lat is the stored latitude.
	Lat float64
	// Lng is the stored longitude.
	Lng float64
	// cands collects the source points in order: wikidata, enwiki, then other languages.
	cands []coordPoint
}

// coordAction is what the stage does with one row's stored point.
type coordAction int

const (
	// coordKeep leaves the stored point. It is sourced when the decision names a point.
	coordKeep coordAction = iota
	// coordMove replaces the stored point with the decision's point.
	coordMove
	// coordDisputed leaves the stored point because the sources disagree.
	coordDisputed
)

// coordDecision is the outcome for one row.
type coordDecision struct {
	// Action is keep, move or disputed.
	Action coordAction
	// Point is the agreeing source for keep and the new point for move.
	Point coordPoint
	// Agree counts the sources behind a move, the point's own source included.
	Agree int
	// Reason says why a row is disputed.
	Reason string
}

// CoordMove is one stored point the stage replaced.
type CoordMove struct {
	// ID is the battle slug.
	ID string
	// Name is the display name.
	Name string
	// OldLat is the latitude before the move.
	OldLat float64
	// OldLng is the longitude before the move.
	OldLng float64
	// NewLat is the latitude after the move.
	NewLat float64
	// NewLng is the longitude after the move.
	NewLng float64
	// Source names the source of the new point.
	Source string
	// Agree counts the sources that agree on the new point.
	Agree int
	// KM is the distance moved, 0 for a row that was at 0,0.
	KM float64
}

// CoordReport summarizes one -coords-from-source run.
type CoordReport struct {
	// Rows is the number of unverified wikidata rows checked.
	Rows int
	// Sourced is the number of rows whose stored point agrees with a source.
	Sourced int
	// Moves lists every replaced point, fills of 0,0 rows included.
	Moves []CoordMove
	// Disputed lists rows left alone because their sources disagree, as "id: reason".
	Disputed []string
	// Unsourced is the number of rows with no coordinate in any source.
	Unsourced int
	// ZeroUnsourced is the number of rows left at 0,0 with no coordinate in any source.
	ZeroUnsourced int
	// Naval is the number of land rows retyped naval from Wikidata P31.
	Naval int
}

// CoordsFromSource checks every unverified wikidata row's coordinates against
// Wikidata P625, the English article's coordinate and then the other language
// articles' coordinates. A stored point within coordAgreeKM of a source is kept
// and recorded as sourced. Otherwise the point moves to the source the others
// agree with, or to the only source there is. Rows in coordOverrides are never
// read. land guards the move of a lone source that mirrors the stored point.
func CoordsFromSource(ctx context.Context, db *sql.DB, land *LandMask) (CoordReport, error) {
	return coordsFromSource(ctx, db, liveCoordLookup{}, land)
}

// coordsFromSource runs the stage with the given lookup.
func coordsFromSource(ctx context.Context, db *sql.DB, lookup coordLookup, land *LandMask) (CoordReport, error) {
	var rep CoordReport
	rows, err := loadCoordRows(ctx, db)
	if err != nil {
		return rep, err
	}
	rep.Rows = len(rows)
	log.Printf("coords-from-source: %d rows", len(rows))

	facts, err := lookup.wikidataCoords(ctx, coordQIDs(rows))
	if err != nil {
		return rep, fmt.Errorf("wikidata coordinates: %w", err)
	}
	for i := range rows {
		f := facts[rows[i].QID]
		if len(f.P625) > 0 {
			p := f.P625[0]
			rows[i].cands = append(rows[i].cands, coordPoint{Lat: p[0], Lng: p[1], Source: coordSourceWikidata})
		}
	}

	byLang := map[string][]int{}
	for i := range rows {
		if !coordNeedsMore(&rows[i]) {
			continue
		}
		if t := enTitle(&rows[i], facts[rows[i].QID]); t != "" {
			byLang["en"] = append(byLang["en"], i)
		}
	}
	if err := addArticleCoords(ctx, lookup, rows, byLang, func(r *coordRow, lang string) string {
		return enTitle(r, facts[r.QID])
	}); err != nil {
		return rep, err
	}

	byLang = map[string][]int{}
	for i := range rows {
		if !coordNeedsMore(&rows[i]) {
			continue
		}
		for lang := range facts[rows[i].QID].Sitelinks {
			if lang != "en" {
				byLang[lang] = append(byLang[lang], i)
			}
		}
	}
	if err := addArticleCoords(ctx, lookup, rows, byLang, func(r *coordRow, lang string) string {
		return facts[r.QID].Sitelinks[lang]
	}); err != nil {
		return rep, err
	}

	return rep, applyCoordDecisions(ctx, db, rows, land, &rep)
}

// loadCoordRows reads the unverified wikidata rows that are not hand-placed.
func loadCoordRows(ctx context.Context, db *sql.DB) ([]coordRow, error) {
	res, err := db.QueryContext(ctx, `SELECT id, name, source_id, wikipedia_title, battle_type, wikidata_instance_of,
		lat, lng FROM battles WHERE source = 'wikidata' AND verified = 0 ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("query coordinate rows: %w", err)
	}
	defer res.Close()
	overridden := make(map[string]bool, len(coordOverrides))
	for _, ov := range coordOverrides {
		overridden[ov.ID] = true
	}
	var out []coordRow
	for res.Next() {
		var r coordRow
		if err := res.Scan(&r.ID, &r.Name, &r.QID, &r.Title, &r.BattleType, &r.InstanceOf, &r.Lat,
			&r.Lng); err != nil {
			return nil, fmt.Errorf("scan coordinate row: %w", err)
		}
		if !overridden[r.ID] {
			out = append(out, r)
		}
	}
	if err := res.Err(); err != nil {
		return nil, fmt.Errorf("iterate coordinate rows: %w", err)
	}
	return out, nil
}

// coordQIDs returns the distinct Q-ids of rows in row order.
func coordQIDs(rows []coordRow) []string {
	seen := map[string]bool{}
	var out []string
	for _, r := range rows {
		if strings.HasPrefix(r.QID, "Q") && !seen[r.QID] {
			seen[r.QID] = true
			out = append(out, r.QID)
		}
	}
	return out
}

// enTitle returns the English article title for r: the stored title, else the enwiki sitelink.
func enTitle(r *coordRow, f wikidataCoordFacts) string {
	if t := strings.TrimSpace(r.Title); t != "" {
		return t
	}
	return f.Sitelinks["en"]
}

// coordNeedsMore reports whether another source could change r's decision: its
// stored point agrees with no source yet and no two sources agree with each other.
func coordNeedsMore(r *coordRow) bool {
	if pointAgrees(r.Lat, r.Lng, r.cands) {
		return false
	}
	_, n, _ := coordConsensus(r.cands)
	return n < 2
}

// addArticleCoords looks up the article coordinate for each language's rows and
// appends the hits to the rows' candidates. Languages run in sorted order.
func addArticleCoords(ctx context.Context, lookup coordLookup, rows []coordRow, byLang map[string][]int,
	title func(r *coordRow, lang string) string) error {
	langs := make([]string, 0, len(byLang))
	for lang := range byLang {
		langs = append(langs, lang)
	}
	sort.Strings(langs)
	for _, lang := range langs {
		idx := byLang[lang]
		var titles []string
		for _, i := range idx {
			titles = append(titles, title(&rows[i], lang))
		}
		hits, err := lookup.articleCoords(ctx, lang, titles)
		if err != nil {
			return fmt.Errorf("%swiki coordinates: %w", lang, err)
		}
		for _, i := range idx {
			if p, ok := hits[title(&rows[i], lang)]; ok {
				rows[i].cands = append(rows[i].cands, p)
			}
		}
	}
	return nil
}

// pointAgrees reports whether a non-zero point sits within coordAgreeKM of any candidate.
func pointAgrees(lat, lng float64, cands []coordPoint) bool {
	_, ok := agreeingSource(lat, lng, cands)
	return ok
}

// agreeingSource returns the first candidate within coordAgreeKM of a non-zero point.
func agreeingSource(lat, lng float64, cands []coordPoint) (coordPoint, bool) {
	if lat == 0 && lng == 0 {
		return coordPoint{}, false
	}
	for _, c := range cands {
		if haversineKM(lat, lng, c.Lat, c.Lng) <= coordAgreeKM {
			return c, true
		}
	}
	return coordPoint{}, false
}

// coordConsensus returns the first candidate another candidate agrees with and
// how many candidates agree with it, itself included. A lone candidate is its
// own consensus with a count of 1. ok is false when there is no candidate or
// several that all disagree.
func coordConsensus(cands []coordPoint) (coordPoint, int, bool) {
	if len(cands) == 1 {
		return cands[0], 1, true
	}
	for i, c := range cands {
		n := 1
		for j, d := range cands {
			if i != j && haversineKM(c.Lat, c.Lng, d.Lat, d.Lng) <= coordAgreeKM {
				n++
			}
		}
		if n > 1 {
			return c, n, true
		}
	}
	return coordPoint{}, 0, false
}

// coordMirror reports whether p is the stored point with a lost sign or swapped axes.
func coordMirror(lat, lng float64, p coordPoint) bool {
	for _, m := range [][2]float64{{-lat, lng}, {lat, -lng}, {-lat, -lng}, {lng, lat}} {
		if isValidCoord(m[0], m[1]) && haversineKM(m[0], m[1], p.Lat, p.Lng) <= coordAgreeKM {
			return true
		}
	}
	return false
}

// decideCoord decides what happens to one stored point given its source
// candidates in order. A lone source that mirrors a stored point is only taken
// when the stored point is in the sea and the source on land, since either side
// may carry the lost sign.
func decideCoord(lat, lng float64, cands []coordPoint, land *LandMask) coordDecision {
	if c, ok := agreeingSource(lat, lng, cands); ok {
		return coordDecision{Action: coordKeep, Point: c}
	}
	if len(cands) == 0 {
		return coordDecision{Action: coordKeep}
	}
	s, n, ok := coordConsensus(cands)
	if !ok {
		return coordDecision{Action: coordDisputed, Reason: "sources disagree: " + formatCands(cands)}
	}
	zero := lat == 0 && lng == 0
	if !zero && n == 1 && coordMirror(lat, lng, s) {
		seaToLand := land != nil && !land.OnLand(lat, lng, landTolKM) && land.OnLand(s.Lat, s.Lng, landTolKM)
		if !seaToLand {
			return coordDecision{Action: coordDisputed,
				Reason: "lone source mirrors the stored point: " + formatCands(cands)}
		}
	}
	return coordDecision{Action: coordMove, Point: s, Agree: n}
}

// formatCands renders candidates as "source lat,lng" joined by semicolons.
func formatCands(cands []coordPoint) string {
	parts := make([]string, 0, len(cands))
	for _, c := range cands {
		parts = append(parts, fmt.Sprintf("%s %.4f,%.4f", c.Source, c.Lat, c.Lng))
	}
	return strings.Join(parts, "; ")
}

// isNavalClass reports whether the pipe-joined P31 labels include naval battle.
func isNavalClass(instanceOf string) bool {
	return slices.ContainsFunc(strings.Split(instanceOf, "|"), func(l string) bool {
		return strings.EqualFold(strings.TrimSpace(l), navalBattleClass)
	})
}

// applyCoordDecisions decides every row, logs each move, and writes the result
// in one transaction. Each write is guarded by the point it was decided from.
func applyCoordDecisions(ctx context.Context, db *sql.DB, rows []coordRow, land *LandMask, rep *CoordReport) error {
	checked := time.Now().UTC().Format("2006-01-02")
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin coordinate tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET lat = ?, lng = ?, coord_source = ?, coord_checked = ?
		WHERE id = ? AND lat = ? AND lng = ?`)
	if err != nil {
		return fmt.Errorf("prepare coordinate update: %w", err)
	}
	defer stmt.Close()
	naval, err := tx.PrepareContext(ctx, `UPDATE battles SET battle_type = 'naval' WHERE id = ? AND battle_type = 'land'`)
	if err != nil {
		return fmt.Errorf("prepare naval update: %w", err)
	}
	defer naval.Close()

	for i := range rows {
		r := &rows[i]
		d := decideCoord(r.Lat, r.Lng, r.cands, land)
		lat, lng, source := r.Lat, r.Lng, ""
		switch d.Action {
		case coordKeep:
			source = d.Point.Source
			if source != "" {
				rep.Sourced++
			} else {
				rep.Unsourced++
				if r.Lat == 0 && r.Lng == 0 {
					rep.ZeroUnsourced++
				}
			}
		case coordMove:
			lat, lng, source = d.Point.Lat, d.Point.Lng, d.Point.Source
			m := CoordMove{ID: r.ID, Name: r.Name, OldLat: r.Lat, OldLng: r.Lng, NewLat: lat, NewLng: lng,
				Source: source, Agree: d.Agree}
			if r.Lat != 0 || r.Lng != 0 {
				m.KM = haversineKM(r.Lat, r.Lng, lat, lng)
			}
			rep.Moves = append(rep.Moves, m)
			log.Printf("coords-from-source: move %s (%s) %.4f,%.4f -> %.4f,%.4f from %s, %d agree, %.0f km",
				r.ID, r.Name, r.Lat, r.Lng, lat, lng, source, d.Agree, m.KM)
		case coordDisputed:
			rep.Disputed = append(rep.Disputed, r.ID+": "+d.Reason)
			log.Printf("coords-from-source: disputed %s (%s) at %.4f,%.4f: %s", r.ID, r.Name, r.Lat, r.Lng, d.Reason)
		}
		if _, err := stmt.ExecContext(ctx, lat, lng, source, checked, r.ID, r.Lat, r.Lng); err != nil {
			return fmt.Errorf("update coordinates for %s: %w", r.ID, err)
		}
		if r.BattleType == "land" && isNavalClass(r.InstanceOf) {
			if _, err := naval.ExecContext(ctx, r.ID); err != nil {
				return fmt.Errorf("retype %s naval: %w", r.ID, err)
			}
			rep.Naval++
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit coordinates: %w", err)
	}
	return nil
}

// liveCoordLookup reads coordinate sources from Wikidata and Wikipedia through the disk cache.
type liveCoordLookup struct{}

// wikidataCoords returns the P625 values and sitelinks for each Q-id, from the
// cache when present and from the query service in batches for the rest. The
// query service takes no maxlag, so replication lag on the API does not stall it.
func (liveCoordLookup) wikidataCoords(ctx context.Context, qids []string) (map[string]wikidataCoordFacts, error) {
	out := make(map[string]wikidataCoordFacts, len(qids))
	var fetch []string
	for _, q := range qids {
		if s, ok := wikiCacheGet(coordWikidataNamespace, q); ok {
			var f wikidataCoordFacts
			if err := json.Unmarshal([]byte(s), &f); err == nil {
				out[q] = f
				continue
			}
		}
		fetch = append(fetch, q)
	}
	log.Printf("coords-from-source: %d Q-ids cached, %d to fetch", len(qids)-len(fetch), len(fetch))
	for start := 0; start < len(fetch); start += coordSPARQLBatch {
		if start > 0 {
			if err := sleepCtx(ctx, coordRequestPause); err != nil {
				return nil, err
			}
		}
		batch := fetch[start:min(start+coordSPARQLBatch, len(fetch))]
		rows, err := patientCoordSPARQL(ctx, batch)
		if err != nil {
			return nil, err
		}
		facts := coordFactsFromRows(rows)
		for _, q := range batch {
			f := facts[q]
			if b, err := json.Marshal(f); err == nil {
				wikiCacheSet(coordWikidataNamespace, q, string(b))
			}
			out[q] = f
		}
		log.Printf("coords-from-source: %d/%d Q-ids fetched", min(start+coordSPARQLBatch, len(fetch)), len(fetch))
	}
	return out, nil
}

// coordSPARQLRow is one query service result row for coordSPARQLQuery.
type coordSPARQLRow struct {
	// Item is the item IRI.
	Item sparqlValue `json:"item"`
	// Lat is the latitude of a P625 value.
	Lat sparqlValue `json:"lat"`
	// Lng is the longitude of a P625 value.
	Lng sparqlValue `json:"lng"`
	// Globe is the globe IRI of a P625 value.
	Globe sparqlValue `json:"globe"`
	// Rank is the rank IRI of a P625 statement.
	Rank sparqlValue `json:"rank"`
	// Site is the base URL of the Wikipedia a sitelink points at.
	Site sparqlValue `json:"site"`
	// Title is the sitelink's article title.
	Title sparqlValue `json:"title"`
}

// patientCoordSPARQL runs coordSPARQLQuery for one batch. A busy query service
// gets one retry after coordBusyPause, then the run stops with ErrSPARQLBusy.
func patientCoordSPARQL(ctx context.Context, batch []string) ([]coordSPARQLRow, error) {
	vals := make([]string, len(batch))
	for i, q := range batch {
		vals[i] = "wd:" + q
	}
	query := fmt.Sprintf(coordSPARQLQuery, strings.Join(vals, " "))
	rows, err := fetchSPARQL[coordSPARQLRow](ctx, query)
	if !errors.Is(err, ErrSPARQLBusy) {
		return rows, err
	}
	log.Printf("coords-from-source: query service busy, waiting %s for one retry", coordBusyPause)
	if err := sleepCtx(ctx, coordBusyPause); err != nil {
		return nil, err
	}
	return fetchSPARQL[coordSPARQLRow](ctx, query)
}

// coordFactsFromRows groups query rows by Q-id into the Earth P625 values,
// preferred rank first, and the Wikipedia sitelinks by language.
func coordFactsFromRows(rows []coordSPARQLRow) map[string]wikidataCoordFacts {
	type ranked struct {
		point     [2]float64
		preferred bool
	}
	points := map[string][]ranked{}
	out := map[string]wikidataCoordFacts{}
	for _, r := range rows {
		q, ok := strings.CutPrefix(r.Item.Value, wikidataEntityPrefix)
		if !ok {
			continue
		}
		f := out[q]
		if r.Site.Value != "" {
			if lang, ok := wikipediaLang(r.Site.Value); ok && r.Title.Value != "" {
				if f.Sitelinks == nil {
					f.Sitelinks = map[string]string{}
				}
				f.Sitelinks[lang] = r.Title.Value
			}
			out[q] = f
			continue
		}
		if r.Globe.Value != "" && r.Globe.Value != wikidataEarth {
			continue
		}
		lat, errLat := strconv.ParseFloat(r.Lat.Value, 64)
		lng, errLng := strconv.ParseFloat(r.Lng.Value, 64)
		if errLat != nil || errLng != nil || !isValidCoord(lat, lng) {
			continue
		}
		points[q] = append(points[q], ranked{point: [2]float64{lat, lng}, preferred: r.Rank.Value == wikidataPreferredRank})
		out[q] = f
	}
	for q, ps := range points {
		sort.SliceStable(ps, func(i, j int) bool { return ps[i].preferred && !ps[j].preferred })
		f := out[q]
		for _, p := range ps {
			f.P625 = append(f.P625, p.point)
		}
		out[q] = f
	}
	return out
}

// wikipediaLang returns the language code of a Wikipedia base URL such as
// https://zh-yue.wikipedia.org/, and false for any other site.
func wikipediaLang(site string) (string, bool) {
	host, ok := strings.CutPrefix(site, "https://")
	if !ok {
		return "", false
	}
	lang, ok := strings.CutSuffix(host, ".wikipedia.org/")
	if !ok {
		return "", false
	}
	return lang, coordLangRe.MatchString(lang)
}

// articleCoords returns the primary coordinate of each title's article on the
// lang Wikipedia, from the cache when present and from the coordinates API in
// batches of 50 for the rest. A language whose API cannot be reached is logged
// and skipped, since one lost voter only leaves rows undecided. A busy server
// after one retry stops the run.
func (liveCoordLookup) articleCoords(ctx context.Context, lang string, titles []string) (map[string]coordPoint,
	error) {
	ns := coordGeoDataNamespace + lang
	site := lang + "wiki"
	out := map[string]coordPoint{}
	var fetch []string
	seen := map[string]bool{}
	for _, t := range titles {
		if t == "" || strings.Contains(t, "|") || seen[t] {
			continue
		}
		seen[t] = true
		if s, ok := wikiCacheGet(ns, t); ok {
			var c articleCoord
			if err := json.Unmarshal([]byte(s), &c); err == nil {
				if c.Found {
					out[t] = coordPoint{Lat: c.Lat, Lng: c.Lng, Source: site}
				}
				continue
			}
		}
		fetch = append(fetch, t)
	}
	api := "https://" + lang + ".wikipedia.org/w/api.php"
	for start := 0; start < len(fetch); start += geocodeBatchSize {
		if err := sleepCtx(ctx, coordRequestPause); err != nil {
			return nil, err
		}
		batch := fetch[start:min(start+geocodeBatchSize, len(fetch))]
		resp, err := fetchGeocodeBatch(ctx, api, batch)
		if errors.Is(err, ErrWikipediaBusy) || errors.Is(err, ErrNetworkDisabled) || ctx.Err() != nil {
			return nil, err
		}
		if err != nil {
			log.Printf("coords-from-source: %s skipped: %v", site, err)
			return out, nil
		}
		hits := resolveGeocodeTitles(batch, resp)
		for _, t := range batch {
			h, ok := hits[t]
			c := articleCoord{}
			if ok && geocodeAcceptable(h) {
				c = articleCoord{Found: true, Lat: h.Lat, Lng: h.Lon}
				out[t] = coordPoint{Lat: h.Lat, Lng: h.Lon, Source: site}
			}
			if b, err := json.Marshal(c); err == nil {
				wikiCacheSet(ns, t, string(b))
			}
		}
	}
	if len(fetch) > 0 {
		log.Printf("coords-from-source: %s %d titles fetched, %d with a coordinate", site, len(fetch), len(out))
	}
	return out, nil
}

// sleepCtx waits d or until ctx is done.
func sleepCtx(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}
