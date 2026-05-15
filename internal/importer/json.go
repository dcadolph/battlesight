package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/dcadolph/battletrace/internal/battles"
)

// ImportJSON reads a curated battles JSON file and inserts records into the database.
// Uses INSERT OR IGNORE to be idempotent on re-runs. Also loads references.json
// from the same directory if it exists.
func ImportJSON(ctx context.Context, db *sql.DB, path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("read json file: %w", err)
	}

	var raw []battles.Battle
	if err := json.Unmarshal(data, &raw); err != nil {
		return 0, fmt.Errorf("parse json: %w", err)
	}

	refsMap := loadRefsFile(filepath.Join(filepath.Dir(path), "references.json"))

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	insertBattle, err := tx.PrepareContext(ctx,
		`INSERT OR IGNORE INTO battles (id, name, year, date, lat, lng, era, war, battle_type, victor, summary, significance, source, verified)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'curated', 1)`)
	if err != nil {
		return 0, fmt.Errorf("prepare battle insert: %w", err)
	}
	defer insertBattle.Close()

	insertSide, err := tx.PrepareContext(ctx,
		`INSERT INTO battle_sides (battle_id, side_index, name, commander, strength, casualties)
		 VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return 0, fmt.Errorf("prepare side insert: %w", err)
	}
	defer insertSide.Close()

	insertRef, err := tx.PrepareContext(ctx,
		`INSERT INTO battle_references (battle_id, ref_type, title, author, year, url, note)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return 0, fmt.Errorf("prepare ref insert: %w", err)
	}
	defer insertRef.Close()

	var count int
	for _, b := range raw {
		result, err := insertBattle.ExecContext(ctx,
			b.ID, b.Name, b.Year, b.Date, b.Lat, b.Lng, b.Era, b.War, b.BattleType, b.Victor, b.Summary, b.Significance)
		if err != nil {
			return count, fmt.Errorf("insert battle %s: %w", b.ID, err)
		}

		affected, _ := result.RowsAffected()
		if affected == 0 {
			continue
		}

		for i, side := range b.Sides {
			if _, err := insertSide.ExecContext(ctx, b.ID, i, side.Name, side.Commander, side.Strength, side.Casualties); err != nil {
				return count, fmt.Errorf("insert side for %s: %w", b.ID, err)
			}
		}

		if refs, ok := refsMap[b.ID]; ok {
			for _, ref := range refs {
				if _, err := insertRef.ExecContext(ctx, b.ID, ref.Type, ref.Title, ref.Author, ref.Year, ref.URL, ref.Note); err != nil {
					return count, fmt.Errorf("insert ref for %s: %w", b.ID, err)
				}
			}
		}

		count++
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit transaction: %w", err)
	}

	return count, nil
}

// loadRefsFile reads references.json into a map keyed by battle ID.
func loadRefsFile(path string) map[string][]battles.Reference {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}

	var refs map[string][]battles.Reference
	if err := json.Unmarshal(data, &refs); err != nil {
		return nil
	}
	return refs
}
