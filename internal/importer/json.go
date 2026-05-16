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

// ImportJSON reads a curated battles JSON file and upserts records into the
// database. The JSON is treated as the source of truth for curated entries:
// changes to era, victor, dates, summary, sides, references etc. all
// propagate on the next import run. Wikidata-imported (verified=0) battles
// are not touched. Loads references.json from the same directory if present.
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

	// Curated entries are authoritative: an UPSERT keeps the DB in sync with
	// the JSON file on every startup. Fixes to era, victor, dates, summary, etc.
	// in the JSON propagate without manual migrations.
	insertBattle, err := tx.PrepareContext(ctx,
		`INSERT INTO battles (id, name, year, date, date_start, date_end, lat, lng, era, war, battle_type, victor, summary, significance, wikipedia_title, source, verified)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'curated', 1)
		 ON CONFLICT(id) DO UPDATE SET
		    name = excluded.name,
		    year = excluded.year,
		    date = excluded.date,
		    date_start = excluded.date_start,
		    date_end = excluded.date_end,
		    lat = excluded.lat,
		    lng = excluded.lng,
		    era = excluded.era,
		    war = excluded.war,
		    battle_type = excluded.battle_type,
		    victor = excluded.victor,
		    summary = excluded.summary,
		    significance = excluded.significance,
		    wikipedia_title = excluded.wikipedia_title,
		    source = 'curated',
		    verified = 1`)
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
		dr := ParseDateRange(b.Date, b.Year)
		if _, err := insertBattle.ExecContext(ctx,
			b.ID, b.Name, b.Year, b.Date, dr.Start, dr.End, b.Lat, b.Lng, b.Era, b.War, b.BattleType, b.Victor, b.Summary, b.Significance, b.WikipediaTitle); err != nil {
			return count, fmt.Errorf("upsert battle %s: %w", b.ID, err)
		}

		// Replace sides for this battle. Curated JSON owns the side list; if
		// it changes between runs the DB must reflect that.
		if _, err := tx.ExecContext(ctx, `DELETE FROM battle_sides WHERE battle_id = ?`, b.ID); err != nil {
			return count, fmt.Errorf("clear sides for %s: %w", b.ID, err)
		}
		for i, side := range b.Sides {
			if _, err := insertSide.ExecContext(ctx, b.ID, i, side.Name, side.Commander, side.Strength, side.Casualties); err != nil {
				return count, fmt.Errorf("insert side for %s: %w", b.ID, err)
			}
		}

		// Replace references for this battle from references.json.
		if _, err := tx.ExecContext(ctx, `DELETE FROM battle_references WHERE battle_id = ?`, b.ID); err != nil {
			return count, fmt.Errorf("clear refs for %s: %w", b.ID, err)
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
