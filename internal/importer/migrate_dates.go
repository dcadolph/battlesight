package importer

import (
	"context"
	"database/sql"
	"fmt"
)

// MigrateDates re-parses the `date` column on every battle and updates the
// `date_start` / `date_end` columns to match. Cheap and idempotent: only
// rows where the recomputed values differ are written, so the second call
// is a no-op. Run on server startup so improvements to ParseDateRange take
// effect against the full corpus, including Wikidata-imported rows that
// `ImportJSON` does not touch.
//
// Returns the count of rows updated.
func MigrateDates(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, year, date, date_start, date_end FROM battles`)
	if err != nil {
		return 0, fmt.Errorf("scan battles for date migration: %w", err)
	}

	type row struct {
		id        string
		year      int
		date      string
		curStart  string
		curEnd    string
	}
	var pending []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.year, &r.date, &r.curStart, &r.curEnd); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan battle row: %w", err)
		}
		pending = append(pending, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate battle rows: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin date migration tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET date_start = ?, date_end = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare date update: %w", err)
	}
	defer stmt.Close()

	var updated int
	for _, r := range pending {
		dr := ParseDateRange(r.date, r.year)
		if dr.Start == r.curStart && dr.End == r.curEnd {
			continue
		}
		if _, err := stmt.ExecContext(ctx, dr.Start, dr.End, r.id); err != nil {
			return updated, fmt.Errorf("update dates for %s: %w", r.id, err)
		}
		updated++
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit date migration: %w", err)
	}
	return updated, nil
}
