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

// All returns every battle sorted by year.
func (s *Store) All(ctx context.Context) ([]Battle, int, error) {
	return s.List(ctx, Filter{Limit: 0})
}

// ByID returns a single battle or false if not found.
func (s *Store) ByID(ctx context.Context, id string) (Battle, bool, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT id, name, year, date, lat, lng, era, war, battle_type, victor, summary, significance FROM battles WHERE id = ?", id)

	var b Battle
	err := row.Scan(&b.ID, &b.Name, &b.Year, &b.Date, &b.Lat, &b.Lng, &b.Era, &b.War, &b.BattleType, &b.Victor, &b.Summary, &b.Significance)
	if err == sql.ErrNoRows {
		return Battle{}, false, nil
	}
	if err != nil {
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

	query := "SELECT id, name, year, date, lat, lng, era, war, battle_type, victor, summary, significance FROM battles" +
		where + " ORDER BY year ASC LIMIT ? OFFSET ?"
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

	countSQL := `SELECT COUNT(*) FROM battles_fts WHERE battles_fts MATCH ?`
	var total int
	if err := s.db.QueryRowContext(ctx, countSQL, ftsQuery).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count search results: %w", err)
	}

	searchSQL := `SELECT b.id, b.name, b.year, b.date, b.lat, b.lng, b.era, b.war, b.battle_type, b.victor, b.summary, b.significance
		FROM battles b
		JOIN battles_fts fts ON b.rowid = fts.rowid
		WHERE fts.battles_fts MATCH ?
		ORDER BY rank
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
	query := fmt.Sprintf("SELECT %s, COUNT(*) FROM battles GROUP BY %s ORDER BY COUNT(*) DESC", column, column)
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
func (s *Store) warCounts(ctx context.Context) ([]WarCount, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT war, COUNT(*), MIN(year) FROM battles WHERE war != '' GROUP BY war ORDER BY COUNT(*) DESC")
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

	// Build index after slice is fully populated so pointers are stable.
	warIdx := make(map[string]int, len(counts))
	for i, wc := range counts {
		warIdx[wc.Name] = i
	}

	casRows, err := s.db.QueryContext(ctx,
		`SELECT b.war, bs.casualties FROM battle_sides bs
		 JOIN battles b ON b.id = bs.battle_id
		 WHERE b.war != '' AND bs.casualties != ''`)
	if err != nil {
		return counts, nil
	}
	defer casRows.Close()

	for casRows.Next() {
		var war, cas string
		casRows.Scan(&war, &cas)
		if idx, ok := warIdx[war]; ok {
			counts[idx].Casualties += parseCasualtyNumber(cas)
		}
	}

	return counts, nil
}

// parseCasualtyNumber extracts the largest plausible number from a casualty
// string like "50,000 killed/wounded" or "69 dead and 533 wounded".
// Ignores numbers over 10 million (likely parsing artifacts).
func parseCasualtyNumber(s string) int {
	best := 0
	num := 0
	inNumber := false

	for _, ch := range s {
		if ch >= '0' && ch <= '9' {
			num = num*10 + int(ch-'0')
			inNumber = true
		} else if ch == ',' && inNumber {
			continue
		} else {
			if inNumber && num > best && num <= 10_000_000 {
				best = num
			}
			num = 0
			inNumber = false
		}
	}
	if inNumber && num > best && num <= 10_000_000 {
		best = num
	}
	return best
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

// loadRefs batch-loads references for a slice of battles.
func (s *Store) loadRefs(ctx context.Context, battles []Battle) error {
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
		"SELECT battle_id, ref_type, title, author, year, url, note FROM battle_references WHERE battle_id IN (%s)",
		strings.Join(placeholders, ","))

	rows, err := s.db.QueryContext(ctx, query, ids...)
	if err != nil {
		return fmt.Errorf("load refs batch: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var battleID string
		var r Reference
		if err := rows.Scan(&battleID, &r.Type, &r.Title, &r.Author, &r.Year, &r.URL, &r.Note); err != nil {
			return fmt.Errorf("scan ref: %w", err)
		}
		if idx, ok := idxMap[battleID]; ok {
			battles[idx].References = append(battles[idx].References, r)
		}
	}
	return rows.Err()
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
		if err := rows.Scan(&b.ID, &b.Name, &b.Year, &b.Date, &b.Lat, &b.Lng, &b.Era, &b.War, &b.BattleType, &b.Victor, &b.Summary, &b.Significance); err != nil {
			return nil, fmt.Errorf("scan battle: %w", err)
		}
		battles = append(battles, b)
	}
	return battles, rows.Err()
}
