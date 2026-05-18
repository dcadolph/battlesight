package battles

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Store provides read access to the battle dataset backed by SQLite.
type Store struct {
	// db is the SQLite database connection.
	db *sql.DB
}

// NewStore creates a store backed by the given database.
func NewStore(db *sql.DB) *Store {
	if db == nil {
		panic("battles.NewStore: db required")
	}
	return &Store{db: db}
}

// battleColumns is the canonical SELECT clause for a battle row.
const battleColumns = "id, name, year, date, lat, lng, era, war, battle_type, victor, summary, significance, COALESCE(verified, 0), COALESCE(source, ''), COALESCE(wikipedia_title, '')"

// trustedWarSQL produces a SQL fragment that keeps only rows whose war field
// looks usable. Pass the column reference (e.g. "war" or "b.war").
func trustedWarSQL(col string) string {
	return `(` + col + ` = '' OR (` +
		col + ` NOT LIKE '%|%' AND ` + col + ` NOT LIKE '%{%' AND ` + col + ` NOT LIKE '%}%' AND ` +
		col + ` NOT LIKE '%=%' AND ` + col + ` NOT LIKE '%image%' AND ` +
		col + ` NOT LIKE '%<%' AND ` + col + ` NOT LIKE '%>%' AND ` +
		`LENGTH(` + col + `) <= 120))`
}

// documentedSQL is the SQL predicate that defines the "documented" tier:
// curated battles plus non-curated battles that have at least one side and a
// clean war attribution. Mirrors classifyTier in handler.go.
const documentedSQL = `(verified = 1 OR (` +
	`(war = '' OR (war NOT LIKE '%|%' AND war NOT LIKE '%{%' AND war NOT LIKE '%}%' AND ` +
	`war NOT LIKE '%=%' AND war NOT LIKE '%image%' AND war NOT LIKE '%<%' AND war NOT LIKE '%>%' AND ` +
	`LENGTH(war) <= 120)) ` +
	`AND EXISTS (SELECT 1 FROM battle_sides s WHERE s.battle_id = battles.id)` +
	`))`

// All returns every battle sorted by year.
func (s *Store) All(ctx context.Context) ([]Battle, int, error) {
	return s.List(ctx, Filter{Limit: 0})
}

// ByID returns a single battle or false if not found.
func (s *Store) ByID(ctx context.Context, id string) (Battle, bool, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+battleColumns+" FROM battles WHERE id = ?", id)

	var b Battle
	if err := scanBattle(row, &b); err != nil {
		if err == sql.ErrNoRows {
			return Battle{}, false, nil
		}
		return Battle{}, false, fmt.Errorf("query battle %s: %w", id, err)
	}

	sides, err := s.sidesForBattle(ctx, b.ID)
	if err != nil {
		return Battle{}, false, err
	}
	b.Sides = sides

	refs, err := s.refsForBattle(ctx, b.ID)
	if err != nil {
		return Battle{}, false, err
	}
	b.References = refs

	aliases, err := s.aliasesForBattle(ctx, b.ID)
	if err != nil {
		return Battle{}, false, err
	}
	b.Aliases = aliases

	return b, true, nil
}

// RandomVerified returns one randomly-chosen hand-curated battle.
func (s *Store) RandomVerified(ctx context.Context) (Battle, bool, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+battleColumns+" FROM battles WHERE verified = 1 ORDER BY RANDOM() LIMIT 1")
	var b Battle
	if err := scanBattle(row, &b); err != nil {
		if err == sql.ErrNoRows {
			return Battle{}, false, nil
		}
		return Battle{}, false, fmt.Errorf("query random verified: %w", err)
	}
	sides, err := s.sidesForBattle(ctx, b.ID)
	if err != nil {
		return Battle{}, false, err
	}
	b.Sides = sides
	refs, err := s.refsForBattle(ctx, b.ID)
	if err != nil {
		return Battle{}, false, err
	}
	b.References = refs
	aliases, err := s.aliasesForBattle(ctx, b.ID)
	if err != nil {
		return Battle{}, false, err
	}
	b.Aliases = aliases
	return b, true, nil
}

// List returns battles matching the filter, sorted by year.
func (s *Store) List(ctx context.Context, f Filter) ([]Battle, int, error) {
	where, args := buildWhere(f)

	countQuery := "SELECT COUNT(*) FROM battles" + where
	var total int
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count battles: %w", err)
	}

	limit := f.Limit
	if limit <= 0 {
		limit = 10000
	}

	// Sort by year first so empty date_start values (year-only records) stay
	// grouped with the rest of their year instead of bubbling to the top of
	// the whole result set. Within a year, the ISO date_start orders day by
	// day so playback reads chronologically.
	query := "SELECT " + battleColumns + " FROM battles" +
		where + " ORDER BY year ASC, date_start ASC LIMIT ? OFFSET ?"
	args = append(args, limit, f.Offset)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list battles: %w", err)
	}
	defer rows.Close()

	battles, err := scanBattles(rows)
	if err != nil {
		return nil, 0, err
	}

	if err := s.loadSides(ctx, battles); err != nil {
		return nil, 0, err
	}

	return battles, total, nil
}

// Search performs full-text search across the entire searchable corpus of
// each battle: name, war, victor, summary, significance, era, battle type,
// date, side names (countries / factions), and commanders. The rich index
// is built by cleanse.rebuildRichSearch; this function only queries it.
//
// Diacritic folding is enabled at the tokenizer level (unicode61
// remove_diacritics=2), so "mohacs" matches "Mohács" and "yi sun sin"
// matches "Yi Sun-sin". sanitizeFTS adds a prefix wildcard to every term
// so partial typing finds the full word.
//
// Coordinate queries: when the input parses as "lat, lng" or "lat lng"
// (with optional space separators), the query routes to searchByCoord
// instead of FTS, returning the geographically nearest battles. Lets a
// user paste a Google Maps coordinate or click a location they remember
// and find the closest engagements without knowing the battle's name.
func (s *Store) Search(ctx context.Context, query string, limit, offset int) ([]Battle, int, error) {
	if limit <= 0 {
		limit = 50
	}

	if lat, lng, ok := parseCoordQuery(query); ok {
		return s.searchByCoord(ctx, lat, lng, limit, offset)
	}

	ftsQuery := sanitizeFTS(query)

	bTrusted := trustedWarSQL("b.war")
	countSQL := `SELECT COUNT(*) FROM battles b
		JOIN battles_rich_fts fts ON fts.battle_id = b.id
		WHERE fts.blob MATCH ?
		  AND (b.lat != 0 OR b.lng != 0)
		  AND ` + bTrusted
	var total int
	if err := s.db.QueryRowContext(ctx, countSQL, ftsQuery).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count search results: %w", err)
	}

	searchSQL := `SELECT ` + prefixCols("b", battleColumns) + `
		FROM battles b
		JOIN battles_rich_fts fts ON fts.battle_id = b.id
		WHERE fts.blob MATCH ?
		  AND (b.lat != 0 OR b.lng != 0)
		  AND ` + bTrusted + `
		ORDER BY b.verified DESC, rank
		LIMIT ? OFFSET ?`

	rows, err := s.db.QueryContext(ctx, searchSQL, ftsQuery, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("search battles: %w", err)
	}
	defer rows.Close()

	battles, err := scanBattles(rows)
	if err != nil {
		return nil, 0, err
	}

	if err := s.loadSides(ctx, battles); err != nil {
		return nil, 0, err
	}

	return battles, total, nil
}

// BattlesByCommander returns battles where the named person appears in any
// side's commander field. Each row carries an inferred role tag: "led"
// means the person is the top-billed commander on at least one side (the
// first comma-separated entry), "participated" means they are listed but
// not first. Used by the people-search panel so users can pull up every
// engagement attributed to a single general or leader.
//
// Matching is case-insensitive substring against commander text. The result
// is intentionally permissive about variants (e.g. "Napoleon" matches both
// "Napoleon I" and "Napoleon Bonaparte"); the caller can refine if needed.
func (s *Store) BattlesByCommander(ctx context.Context, name string, limit, offset int) ([]Battle, []string, int, error) {
	if name == "" {
		return nil, nil, 0, fmt.Errorf("commander name required")
	}
	if limit <= 0 {
		limit = 100
	}
	needle := "%" + strings.ToLower(name) + "%"

	bTrusted := trustedWarSQL("b.war")
	countSQL := `SELECT COUNT(DISTINCT b.id) FROM battles b
		JOIN battle_sides s ON s.battle_id = b.id
		WHERE LOWER(s.commander) LIKE ?
		  AND (b.lat != 0 OR b.lng != 0)
		  AND ` + bTrusted
	var total int
	if err := s.db.QueryRowContext(ctx, countSQL, needle).Scan(&total); err != nil {
		return nil, nil, 0, fmt.Errorf("count commander matches: %w", err)
	}
	if total == 0 {
		return []Battle{}, nil, 0, nil
	}

	listSQL := `SELECT DISTINCT b.id FROM battles b
		JOIN battle_sides s ON s.battle_id = b.id
		WHERE LOWER(s.commander) LIKE ?
		  AND (b.lat != 0 OR b.lng != 0)
		  AND ` + bTrusted + `
		ORDER BY b.year, b.date_start
		LIMIT ? OFFSET ?`
	idRows, err := s.db.QueryContext(ctx, listSQL, needle, limit, offset)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("query commander matches: %w", err)
	}
	defer idRows.Close()
	var ids []string
	for idRows.Next() {
		var id string
		if err := idRows.Scan(&id); err != nil {
			return nil, nil, 0, fmt.Errorf("scan commander id: %w", err)
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return []Battle{}, nil, 0, nil
	}

	placeholders := strings.Repeat("?,", len(ids))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT `+prefixCols("b", battleColumns)+` FROM battles b WHERE b.id IN (`+placeholders+`)`,
		args...)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("load commander battles: %w", err)
	}
	defer rows.Close()
	battles, err := scanBattles(rows)
	if err != nil {
		return nil, nil, 0, err
	}
	if err := s.loadSides(ctx, battles); err != nil {
		return nil, nil, 0, err
	}

	// Re-order to match the chronological order from listSQL.
	byID := make(map[string]Battle, len(battles))
	for _, b := range battles {
		byID[b.ID] = b
	}
	ordered := make([]Battle, 0, len(ids))
	roles := make([]string, 0, len(ids))
	needleLower := strings.ToLower(name)
	for _, id := range ids {
		b, ok := byID[id]
		if !ok {
			continue
		}
		ordered = append(ordered, b)
		role := "participated"
		for _, side := range b.Sides {
			cmd := strings.ToLower(side.Commander)
			if !strings.Contains(cmd, needleLower) {
				continue
			}
			// Top-billed means the name appears within the first comma-
			// separated commander entry (which by curator convention is
			// the senior commander on that side).
			first := cmd
			if i := strings.Index(cmd, ","); i >= 0 {
				first = cmd[:i]
			}
			if strings.Contains(first, needleLower) {
				role = "led"
				break
			}
		}
		roles = append(roles, role)
	}

	return ordered, roles, total, nil
}

// coordQueryRe matches a "lat, lng" or "lat lng" search query. Accepts
// optional minus signs, integer or decimal forms, a comma or whitespace
// separator, and surrounding whitespace. The latitude range [-90, 90]
// and longitude range [-180, 180] are validated after the regex matches,
// so a string like "12345, 678" parses cleanly but is rejected as
// out-of-range by parseCoordQuery.
var coordQueryRe = regexp.MustCompile(`^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$`)

// parseCoordQuery returns (lat, lng, ok) if `q` looks like a coordinate
// pair within the valid geographic ranges. Used by Search to branch into
// a nearest-neighbor query when the user pastes a Google Maps URL coord
// or types a latitude/longitude pair.
func parseCoordQuery(q string) (float64, float64, bool) {
	m := coordQueryRe.FindStringSubmatch(q)
	if len(m) != 3 {
		return 0, 0, false
	}
	lat, err1 := strconv.ParseFloat(m[1], 64)
	lng, err2 := strconv.ParseFloat(m[2], 64)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return 0, 0, false
	}
	return lat, lng, true
}

// searchByCoord returns the battles geographically nearest to (lat, lng),
// ordered by ascending squared distance on the lat/lng plane. The squared
// approximation is fine for sorting; battles spanning two hemispheres
// rarely tie with battles on the same continent, and Haversine would only
// matter at antimeridian or pole crossings which our coverage avoids. The
// trust gate and zero-coord gate from the FTS path are applied so the UI
// behaves the same shape: same fields, same tier guarantees.
func (s *Store) searchByCoord(ctx context.Context, lat, lng float64, limit, offset int) ([]Battle, int, error) {
	bTrusted := trustedWarSQL("b.war")
	// Total is the count of trusted, coord-bearing battles. Distance
	// search has no meaningful "match" predicate so the count is the
	// candidate pool size; the user gets the top `limit` rows of that
	// pool ordered by proximity.
	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM battles b WHERE (b.lat != 0 OR b.lng != 0) AND `+bTrusted).
		Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count coord candidates: %w", err)
	}

	// Squared planar distance is used in the ORDER BY only. Adequate for
	// ranking at the latitudes our catalog covers; an antimeridian crosser
	// or polar approach would need Haversine, but our coverage avoids
	// those edges. Not selected as a column so scanBattles still matches
	// the canonical battleColumns shape.
	searchSQL := `SELECT ` + prefixCols("b", battleColumns) + `
		FROM battles b
		WHERE (b.lat != 0 OR b.lng != 0)
		  AND ` + bTrusted + `
		ORDER BY ((b.lat - ?) * (b.lat - ?) + (b.lng - ?) * (b.lng - ?)) ASC
		LIMIT ? OFFSET ?`

	rows, err := s.db.QueryContext(ctx, searchSQL, lat, lat, lng, lng, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("coord search: %w", err)
	}
	defer rows.Close()

	battles, err := scanBattles(rows)
	if err != nil {
		return nil, 0, err
	}
	if err := s.loadSides(ctx, battles); err != nil {
		return nil, 0, err
	}
	return battles, total, nil
}

// Stats returns aggregate counts for filter UI population.
func (s *Store) Stats(ctx context.Context) (StatsResponse, error) {
	var stats StatsResponse

	err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*), COALESCE(MIN(year), 0), COALESCE(MAX(year), 0) FROM battles").
		Scan(&stats.TotalBattles, &stats.YearRange[0], &stats.YearRange[1])
	if err != nil {
		return stats, fmt.Errorf("query stats totals: %w", err)
	}

	if err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM battles WHERE verified = 1").
		Scan(&stats.VerifiedBattles); err != nil {
		return stats, fmt.Errorf("query verified count: %w", err)
	}

	var queryErr error
	stats.Eras, queryErr = s.nameCounts(ctx, "era")
	if queryErr != nil {
		return stats, queryErr
	}
	stats.Wars, queryErr = s.warCounts(ctx)
	if queryErr != nil {
		return stats, queryErr
	}
	stats.BattleTypes, queryErr = s.nameCounts(ctx, "battle_type")
	if queryErr != nil {
		return stats, queryErr
	}

	return stats, nil
}

// nameCounts returns distinct values and their counts for a column.
func (s *Store) nameCounts(ctx context.Context, column string) ([]NameCount, error) {
	query := fmt.Sprintf(
		"SELECT %s, COUNT(*) FROM battles WHERE %s != '' GROUP BY %s ORDER BY COUNT(*) DESC",
		column, column, column)
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query %s counts: %w", column, err)
	}
	defer rows.Close()

	var counts []NameCount
	for rows.Next() {
		var nc NameCount
		if err := rows.Scan(&nc.Name, &nc.Count); err != nil {
			return nil, fmt.Errorf("scan %s count: %w", column, err)
		}
		counts = append(counts, nc)
	}
	return counts, rows.Err()
}

// sidesForBattle returns the sides for a single battle.
func (s *Store) sidesForBattle(ctx context.Context, battleID string) ([]Side, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT name, commander, strength, casualties FROM battle_sides WHERE battle_id = ? ORDER BY side_index", battleID)
	if err != nil {
		return nil, fmt.Errorf("query sides for %s: %w", battleID, err)
	}
	defer rows.Close()

	var sides []Side
	for rows.Next() {
		var side Side
		if err := rows.Scan(&side.Name, &side.Commander, &side.Strength, &side.Casualties); err != nil {
			return nil, fmt.Errorf("scan side: %w", err)
		}
		sides = append(sides, side)
	}
	return sides, rows.Err()
}

// loadSides batch-loads sides for a slice of battles.
func (s *Store) loadSides(ctx context.Context, battles []Battle) error {
	if len(battles) == 0 {
		return nil
	}

	ids := make([]any, len(battles))
	placeholders := make([]string, len(battles))
	idxMap := make(map[string]int, len(battles))
	for i, b := range battles {
		ids[i] = b.ID
		placeholders[i] = "?"
		idxMap[b.ID] = i
	}

	query := fmt.Sprintf(
		"SELECT battle_id, name, commander, strength, casualties FROM battle_sides WHERE battle_id IN (%s) ORDER BY battle_id, side_index",
		strings.Join(placeholders, ","))

	rows, err := s.db.QueryContext(ctx, query, ids...)
	if err != nil {
		return fmt.Errorf("load sides batch: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var battleID string
		var side Side
		if err := rows.Scan(&battleID, &side.Name, &side.Commander, &side.Strength, &side.Casualties); err != nil {
			return fmt.Errorf("scan side: %w", err)
		}
		if idx, ok := idxMap[battleID]; ok {
			battles[idx].Sides = append(battles[idx].Sides, side)
		}
	}
	return rows.Err()
}

// warParent returns the canonical parent-war name for a sub-war label, or
// empty when the war stands alone. The classification is deliberately
// conservative: only catches the noisy WWI/WWII/Civil War fragmentation
// from Wikidata where the same conflict appears under dozens of theater
// and campaign aliases.
func warParent(name string) string {
	if name == "" {
		return ""
	}
	n := strings.ToLower(name)
	// Order matters: WWII patterns are checked first because their substrings
	// would otherwise be caught by the WWI rule ("world war i" ⊂ "world war ii").
	switch {
	case strings.Contains(n, "world war ii"),
		strings.Contains(n, "world war 2"),
		strings.Contains(n, "second world war"),
		n == "pacific war",
		n == "invasion of poland":
		if name == "World War II" {
			return ""
		}
		return "World War II"
	case strings.Contains(n, "world war i"),
		strings.Contains(n, "world war 1"),
		strings.Contains(n, "first world war"):
		if name == "World War I" {
			return ""
		}
		return "World War I"
	case strings.Contains(n, "american civil war"):
		if name == "American Civil War" {
			return ""
		}
		return "American Civil War"
	case strings.Contains(n, "napoleonic war"),
		strings.Contains(n, "war of the first coalition"),
		strings.Contains(n, "war of the second coalition"),
		strings.Contains(n, "war of the third coalition"),
		strings.Contains(n, "war of the fourth coalition"),
		strings.Contains(n, "war of the fifth coalition"),
		strings.Contains(n, "war of the sixth coalition"),
		strings.Contains(n, "war of the seventh coalition"),
		strings.Contains(n, "peninsular war"):
		if name == "Napoleonic Wars" {
			return ""
		}
		return "Napoleonic Wars"
	case strings.Contains(n, "syrian civil war"):
		if name == "Syrian Civil War" {
			return ""
		}
		return "Syrian Civil War"
	case strings.Contains(n, "russo-ukrainian"),
		strings.Contains(n, "russian invasion of ukraine"):
		if name == "Russo-Ukrainian War" {
			return ""
		}
		return "Russo-Ukrainian War"
	}
	return ""
}

// rollupWarHierarchy injects synthetic parent rows and populates the rolled
// totals so the bloodiest-wars sort surfaces canonical conflicts above their
// theaters even when the parent has few or no direct battles of its own.
func rollupWarHierarchy(counts []WarCount) []WarCount {
	byName := make(map[string]*WarCount, len(counts))
	for i := range counts {
		counts[i].Parent = warParent(counts[i].Name)
		counts[i].RolledCount = counts[i].Count
		counts[i].RolledCasualties = counts[i].Casualties
		byName[counts[i].Name] = &counts[i]
	}

	// Ensure every parent referenced from a child exists as its own row.
	for _, c := range counts {
		if c.Parent == "" {
			continue
		}
		if _, ok := byName[c.Parent]; !ok {
			synth := WarCount{Name: c.Parent, MinYear: c.MinYear}
			counts = append(counts, synth)
			byName[c.Parent] = &counts[len(counts)-1]
		}
	}

	// Roll up children into parents. One level of nesting is sufficient for
	// the patterns warParent classifies today; if hierarchy ever goes deeper
	// this loop would need transitive closure.
	parentCountryTally := map[string]map[string]int{}
	for i := range counts {
		c := &counts[i]
		if c.Parent == "" {
			continue
		}
		p := byName[c.Parent]
		if p == nil {
			continue
		}
		p.RolledCount += c.Count
		p.RolledCasualties += c.Casualties
		if c.MinYear != 0 && (p.MinYear == 0 || c.MinYear < p.MinYear) {
			p.MinYear = c.MinYear
		}
		tally := parentCountryTally[p.Name]
		if tally == nil {
			tally = map[string]int{}
			parentCountryTally[p.Name] = tally
		}
		for _, country := range p.Countries {
			tally[country]++
		}
		for _, country := range c.Countries {
			tally[country]++
		}
	}
	for parentName, tally := range parentCountryTally {
		p := byName[parentName]
		if p == nil {
			continue
		}
		type entry struct {
			Name  string
			Count int
		}
		ordered := make([]entry, 0, len(tally))
		for name, count := range tally {
			ordered = append(ordered, entry{name, count})
		}
		sort.Slice(ordered, func(i, j int) bool {
			if ordered[i].Count != ordered[j].Count {
				return ordered[i].Count > ordered[j].Count
			}
			return ordered[i].Name < ordered[j].Name
		})
		if len(ordered) > 6 {
			ordered = ordered[:6]
		}
		p.Countries = p.Countries[:0]
		for _, e := range ordered {
			p.Countries = append(p.Countries, e.Name)
		}
	}

	return counts
}

// warCounts returns wars with their battle counts, earliest year, and total casualties.
// Only returns wars that pass the trust filter.
func (s *Store) warCounts(ctx context.Context) ([]WarCount, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT war, COUNT(*), MIN(year) FROM battles
		 WHERE war != '' AND `+trustedWarSQL("war")+` AND LENGTH(war) > 3
		 GROUP BY war ORDER BY COUNT(*) DESC LIMIT 500`)
	if err != nil {
		return nil, fmt.Errorf("query war counts: %w", err)
	}
	defer rows.Close()

	var counts []WarCount
	for rows.Next() {
		var wc WarCount
		if err := rows.Scan(&wc.Name, &wc.Count, &wc.MinYear); err != nil {
			return nil, fmt.Errorf("scan war count: %w", err)
		}
		counts = append(counts, wc)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	warIdx := make(map[string]int, len(counts))
	for i, wc := range counts {
		warIdx[wc.Name] = i
	}

	casRows, err := s.db.QueryContext(ctx,
		`SELECT b.war, bs.casualties FROM battle_sides bs
		 JOIN battles b ON b.id = bs.battle_id
		 WHERE b.war != '' AND bs.casualties != '' AND `+trustedWarSQL("b.war"))
	if err != nil {
		return counts, nil
	}
	defer casRows.Close()

	for casRows.Next() {
		var war, cas string
		casRows.Scan(&war, &cas)
		if idx, ok := warIdx[war]; ok {
			counts[idx].Casualties += ParseCasualtyNumber(cas)
		}
	}

	// Populate the country list for each war from the sides table. Group sides
	// per (war, battle) so each battle contributes its own set of countries
	// without one prolific battle skewing the ranking.
	sideRows, err := s.db.QueryContext(ctx,
		`SELECT b.war, bs.battle_id, bs.name FROM battle_sides bs
		 JOIN battles b ON b.id = bs.battle_id
		 WHERE b.war != '' AND `+trustedWarSQL("b.war"))
	if err == nil {
		defer sideRows.Close()
		type key struct {
			war      string
			battleID string
		}
		groups := map[string][]string{}
		seenKey := map[key]map[string]bool{}
		for sideRows.Next() {
			var war, battleID, name string
			if err := sideRows.Scan(&war, &battleID, &name); err != nil {
				continue
			}
			k := key{war, battleID}
			if seenKey[k] == nil {
				seenKey[k] = map[string]bool{}
			}
			if seenKey[k][name] {
				continue
			}
			seenKey[k][name] = true
			gk := war + "\x00" + battleID
			groups[gk] = append(groups[gk], name)
		}
		byWar := map[string][][]string{}
		for gk, sides := range groups {
			parts := strings.SplitN(gk, "\x00", 2)
			war := parts[0]
			byWar[war] = append(byWar[war], sides)
		}
		for i := range counts {
			if sides, ok := byWar[counts[i].Name]; ok {
				counts[i].Countries = rankCountriesForWar(sides, 6)
			}
		}
	}

	return rollupWarHierarchy(counts), nil
}

// ParseCasualtyNumber extracts a representative casualty number from a freeform
// string like "50,000 killed/wounded", "15,000–20,000", or "69 dead and 533 wounded".
//
// Rules of thumb:
//   - When two numbers are separated by an en/em dash or "to", the result is
//     their midpoint (treated as a range).
//   - Otherwise the largest plausible number (sum of explicit components is
//     too aggressive; max is closer to typical Wikipedia infobox phrasing).
//   - Commas are stripped so "50,000" becomes 50000.
//   - Values above 10 million are discarded as parsing artifacts.
func ParseCasualtyNumber(s string) int {
	nums := extractNumbers(s)
	if len(nums) == 0 {
		return 0
	}

	if pair, ok := findRange(s, nums); ok {
		return (pair[0] + pair[1]) / 2
	}

	best := 0
	for _, n := range nums {
		if n > best && n <= 10_000_000 {
			best = n
		}
	}
	return best
}

// extractNumbers pulls every comma-separated integer out of a string.
func extractNumbers(s string) []int {
	var out []int
	num := 0
	inNumber := false
	for _, ch := range s {
		switch {
		case ch >= '0' && ch <= '9':
			num = num*10 + int(ch-'0')
			inNumber = true
		case ch == ',' && inNumber:
			// commas inside numbers are thousands separators; skip
		default:
			if inNumber {
				out = append(out, num)
			}
			num = 0
			inNumber = false
		}
	}
	if inNumber {
		out = append(out, num)
	}
	return out
}

// findRange returns the first two numbers of a range expression like
// "15,000–20,000" or "15000 to 20000". Returns false if no range is detected.
func findRange(s string, nums []int) ([2]int, bool) {
	if len(nums) < 2 {
		return [2]int{}, false
	}
	low := strings.ToLower(s)
	for _, sep := range []string{"–", "—", " to ", "-"} {
		idx := strings.Index(low, sep)
		if idx < 0 {
			continue
		}
		left := nums[0]
		right := nums[1]
		if right > left && right <= 10_000_000 && left <= 10_000_000 {
			return [2]int{left, right}, true
		}
	}
	return [2]int{}, false
}

// aliasesForBattle returns the alternative names for a single battle in
// curator-defined order. Empty slice when the battle has no aliases; never
// returns nil error and nil slice together.
func (s *Store) aliasesForBattle(ctx context.Context, battleID string) ([]Alias, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT name, by_text FROM battle_aliases WHERE battle_id = ? ORDER BY alias_index", battleID)
	if err != nil {
		return nil, fmt.Errorf("query aliases for %s: %w", battleID, err)
	}
	defer rows.Close()
	var aliases []Alias
	for rows.Next() {
		var a Alias
		if err := rows.Scan(&a.Name, &a.By); err != nil {
			return nil, fmt.Errorf("scan alias: %w", err)
		}
		aliases = append(aliases, a)
	}
	return aliases, rows.Err()
}

// refsForBattle returns the references for a single battle.
func (s *Store) refsForBattle(ctx context.Context, battleID string) ([]Reference, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT ref_type, title, author, year, url, note FROM battle_references WHERE battle_id = ?", battleID)
	if err != nil {
		return nil, fmt.Errorf("query refs for %s: %w", battleID, err)
	}
	defer rows.Close()

	var refs []Reference
	for rows.Next() {
		var r Reference
		if err := rows.Scan(&r.Type, &r.Title, &r.Author, &r.Year, &r.URL, &r.Note); err != nil {
			return nil, fmt.Errorf("scan ref: %w", err)
		}
		refs = append(refs, r)
	}
	return refs, rows.Err()
}

// buildWhere constructs a WHERE clause from a Filter.
func buildWhere(f Filter) (string, []any) {
	var conditions []string
	var args []any

	if f.Era != "" {
		conditions = append(conditions, "era = ?")
		args = append(args, f.Era)
	}
	if f.War != "" {
		conditions = append(conditions, "war = ?")
		args = append(args, f.War)
	}
	if f.BattleType != "" {
		conditions = append(conditions, "battle_type = ?")
		args = append(args, f.BattleType)
	}
	if f.YearMin != 0 {
		conditions = append(conditions, "year >= ?")
		args = append(args, f.YearMin)
	}
	if f.YearMax != 0 {
		conditions = append(conditions, "year <= ?")
		args = append(args, f.YearMax)
	}

	if !f.IncludeNoCoord {
		conditions = append(conditions, "(lat != 0 OR lng != 0)")
	}

	switch f.Quality {
	case "reconstructed":
		// Reconstructed-only is applied by the handler via the IDs filter
		// (the replays registry is not visible to the store). Nothing to add
		// here; the handler short-circuits and never sets Quality=reconstructed
		// without also supplying IDs.
	case "indexed":
		// Sparse Wikidata-harvested entries: not curated, and missing either
		// a clean war attribution or any sides data.
		conditions = append(conditions, "verified = 0 AND NOT ("+documentedSQL+")")
	case "all":
		// no quality gate
	default: // "" or "documented"
		conditions = append(conditions, documentedSQL)
	}

	if len(f.IDs) > 0 {
		placeholders := make([]string, len(f.IDs))
		for i, id := range f.IDs {
			placeholders[i] = "?"
			args = append(args, id)
		}
		conditions = append(conditions, "id IN ("+strings.Join(placeholders, ",")+")")
	}

	if len(conditions) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conditions, " AND "), args
}

// sanitizeFTS prepares a user query for FTS5. Each term is stripped of
// characters that would corrupt the query grammar, then suffixed with a
// prefix wildcard so "falluja" matches "Fallujah" and "stalingr" matches
// "Stalingrad". Quoting (the previous behavior) forced exact phrase
// matching, which silently broke partial-word searches that any modern
// search box is expected to handle.
func sanitizeFTS(query string) string {
	// Hyphens, slashes, and underscores inside a typed query should split
	// terms rather than corrupt them. Replace with spaces before tokenizing.
	pre := strings.NewReplacer("-", " ", "/", " ", "_", " ").Replace(query)
	terms := strings.Fields(pre)
	out := make([]string, 0, len(terms))
	for _, t := range terms {
		var b strings.Builder
		for _, r := range t {
			// Keep letters, digits, apostrophes, and the Latin-1 / Latin
			// Extended range so accented names like Mohács survive the pass.
			// Drop everything else so FTS5 operators like ( ) " * ^ cannot
			// escape from the user-controlled string.
			if (r >= 'a' && r <= 'z') ||
				(r >= 'A' && r <= 'Z') ||
				(r >= '0' && r <= '9') ||
				r == '\'' ||
				(r >= 0x00C0 && r <= 0x024F) {
				b.WriteRune(r)
			}
		}
		clean := b.String()
		if clean == "" {
			continue
		}
		// Trailing wildcard for prefix match. FTS5 treats this as a real
		// prefix search on the tokenized form.
		out = append(out, clean+"*")
	}
	return strings.Join(out, " ")
}

// scanBattles reads battle rows into a slice (without sides).
func scanBattles(rows *sql.Rows) ([]Battle, error) {
	var battles []Battle
	for rows.Next() {
		var b Battle
		var verified int
		if err := rows.Scan(&b.ID, &b.Name, &b.Year, &b.Date, &b.Lat, &b.Lng,
			&b.Era, &b.War, &b.BattleType, &b.Victor, &b.Summary, &b.Significance,
			&verified, &b.Source, &b.WikipediaTitle); err != nil {
			return nil, fmt.Errorf("scan battle: %w", err)
		}
		b.Verified = verified == 1
		battles = append(battles, b)
	}
	return battles, rows.Err()
}

// scanBattle reads one battle from a single row.
func scanBattle(row *sql.Row, b *Battle) error {
	var verified int
	err := row.Scan(&b.ID, &b.Name, &b.Year, &b.Date, &b.Lat, &b.Lng,
		&b.Era, &b.War, &b.BattleType, &b.Victor, &b.Summary, &b.Significance,
		&verified, &b.Source, &b.WikipediaTitle)
	if err == nil {
		b.Verified = verified == 1
	}
	return err
}

// prefixCols copies a comma-separated column list and prefixes each column
// with the given table alias. Splits on top-level commas only — commas
// inside function arguments (e.g. COALESCE(x, '')) are preserved.
func prefixCols(prefix, cols string) string {
	if cols == "" {
		return ""
	}
	var parts []string
	depth := 0
	start := 0
	for i, ch := range cols {
		switch ch {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				parts = append(parts, cols[start:i])
				start = i + 1
			}
		}
	}
	parts = append(parts, cols[start:])

	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, "COALESCE(") {
			out = append(out, strings.Replace(p, "COALESCE(", "COALESCE("+prefix+".", 1))
			continue
		}
		out = append(out, prefix+"."+p)
	}
	return strings.Join(out, ", ")
}
