package battles

import (
	"context"
	"database/sql"
	"fmt"
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
const battleColumns = "id, name, year, date, lat, lng, era, war, battle_type, victor, summary, significance, COALESCE(verified, 0), COALESCE(source, '')"

// trustedWarSQL produces a SQL fragment that keeps only rows whose war field
// looks usable. Pass the column reference (e.g. "war" or "b.war").
func trustedWarSQL(col string) string {
	return `(` + col + ` = '' OR (` +
		col + ` NOT LIKE '%|%' AND ` + col + ` NOT LIKE '%{%' AND ` + col + ` NOT LIKE '%}%' AND ` +
		col + ` NOT LIKE '%=%' AND ` + col + ` NOT LIKE '%image%' AND ` +
		col + ` NOT LIKE '%<%' AND ` + col + ` NOT LIKE '%>%' AND ` +
		`LENGTH(` + col + `) <= 120))`
}

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

	query := "SELECT " + battleColumns + " FROM battles" +
		where + " ORDER BY date_start ASC, year ASC LIMIT ? OFFSET ?"
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

// Search performs full-text search across battle names, wars, summaries, and significance.
func (s *Store) Search(ctx context.Context, query string, limit, offset int) ([]Battle, int, error) {
	if limit <= 0 {
		limit = 50
	}

	ftsQuery := sanitizeFTS(query)

	countSQL := `SELECT COUNT(*) FROM battles b
		JOIN battles_fts fts ON b.rowid = fts.rowid
		WHERE fts.battles_fts MATCH ?
		  AND (b.lat != 0 OR b.lng != 0)
		  AND ` + trustedSQL
	var total int
	if err := s.db.QueryRowContext(ctx, countSQL, ftsQuery).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count search results: %w", err)
	}

	searchSQL := `SELECT ` + prefixCols("b", battleColumns) + `
		FROM battles b
		JOIN battles_fts fts ON b.rowid = fts.rowid
		WHERE fts.battles_fts MATCH ?
		  AND (b.lat != 0 OR b.lng != 0)
		  AND ` + prefixCols("b", "") + trustedSQL + `
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

// warCounts returns wars with their battle counts, earliest year, and total casualties.
// Only returns wars that pass the trust filter.
func (s *Store) warCounts(ctx context.Context) ([]WarCount, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT war, COUNT(*), MIN(year) FROM battles
		 WHERE war != '' AND `+trustedSQL+` AND LENGTH(war) > 3
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
		 WHERE b.war != '' AND bs.casualties != '' AND `+strings.ReplaceAll(trustedSQL, "war ", "b.war ")+``)
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

	return counts, nil
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
	case "verified":
		conditions = append(conditions, "verified = 1")
	case "all":
		// no quality gate
	default: // "" or "trusted"
		conditions = append(conditions, trustedSQL)
	}

	if len(conditions) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conditions, " AND "), args
}

// sanitizeFTS prepares a user query for FTS5 by quoting each term.
func sanitizeFTS(query string) string {
	terms := strings.Fields(query)
	quoted := make([]string, len(terms))
	for i, t := range terms {
		quoted[i] = `"` + strings.ReplaceAll(t, `"`, `""`) + `"`
	}
	return strings.Join(quoted, " ")
}

// scanBattles reads battle rows into a slice (without sides).
func scanBattles(rows *sql.Rows) ([]Battle, error) {
	var battles []Battle
	for rows.Next() {
		var b Battle
		var verified int
		if err := rows.Scan(&b.ID, &b.Name, &b.Year, &b.Date, &b.Lat, &b.Lng,
			&b.Era, &b.War, &b.BattleType, &b.Victor, &b.Summary, &b.Significance,
			&verified, &b.Source); err != nil {
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
		&verified, &b.Source)
	if err == nil {
		b.Verified = verified == 1
	}
	return err
}

// prefixCols copies a comma-separated column list and prefixes each with
// the given table alias. If cols is empty, returns the empty string.
func prefixCols(prefix, cols string) string {
	if cols == "" {
		return ""
	}
	parts := strings.Split(cols, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, "COALESCE(") {
			// Inject prefix into the inner column reference.
			out = append(out, strings.Replace(p, "COALESCE(", "COALESCE("+prefix+".", 1))
			continue
		}
		out = append(out, prefix+"."+p)
	}
	return strings.Join(out, ", ")
}
