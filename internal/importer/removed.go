package importer

import (
	"context"
	"database/sql"
	"fmt"
)

// recordRemoved notes the Wikidata item of the row id as removed on purpose,
// with the reason and the row it folded into, so no import or refresh adds it
// back. It must run before the row is deleted. A row with no Q-id records nothing.
func recordRemoved(ctx context.Context, tx *sql.Tx, id, reason, keptID string) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO removed_items (qid, reason, kept_id)
		SELECT source_id, ?, ? FROM battles WHERE id = ? AND source_id LIKE 'Q%'
		ON CONFLICT(qid) DO UPDATE SET reason = excluded.reason, kept_id = excluded.kept_id`,
		reason, keptID, id); err != nil {
		return fmt.Errorf("record removed %s: %w", id, err)
	}
	return nil
}

// removedQIDs returns every Wikidata item removed on purpose.
func removedQIDs(ctx context.Context, q interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}) (map[string]bool, error) {
	rows, err := q.QueryContext(ctx, `SELECT qid FROM removed_items`)
	if err != nil {
		return nil, fmt.Errorf("query removed items: %w", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var qid string
		if err := rows.Scan(&qid); err != nil {
			return nil, fmt.Errorf("scan removed item: %w", err)
		}
		out[qid] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate removed items: %w", err)
	}
	return out, nil
}
