package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"

	"github.com/dcadolph/battlesight/internal/battles"
)

// MergeReplays validates the replay drafts in draftPath (a JSON object
// keyed by battle id) against the battles table, then inserts or
// replaces them in phasesPath. Existing entries that are not being
// replaced are preserved byte for byte. Returns the ids merged.
func MergeReplays(ctx context.Context, db *sql.DB, draftPath, phasesPath string) ([]string, error) {
	draftBytes, err := os.ReadFile(draftPath)
	if err != nil {
		return nil, fmt.Errorf("read drafts: %w", err)
	}
	var drafts map[string]battles.Replay
	if err := json.Unmarshal(draftBytes, &drafts); err != nil {
		return nil, fmt.Errorf("parse drafts: %w", err)
	}
	if len(drafts) == 0 {
		return nil, fmt.Errorf("no replays in %s", draftPath)
	}

	existingBytes, err := os.ReadFile(phasesPath)
	if err != nil {
		return nil, fmt.Errorf("read phases: %w", err)
	}
	var existing map[string]json.RawMessage
	if err := json.Unmarshal(existingBytes, &existing); err != nil {
		return nil, fmt.Errorf("parse phases: %w", err)
	}

	merged := make([]string, 0, len(drafts))
	for id, r := range drafts {
		var lat, lng float64
		row := db.QueryRowContext(ctx, "SELECT lat, lng FROM battles WHERE id = ?", id)
		if err := row.Scan(&lat, &lng); err != nil {
			if err == sql.ErrNoRows {
				return nil, fmt.Errorf("draft %s: no such battle", id)
			}
			return nil, fmt.Errorf("draft %s: lookup battle: %w", id, err)
		}
		if err := battles.ValidateReplay(id, r, lat, lng); err != nil {
			return nil, fmt.Errorf("draft rejected: %w", err)
		}
		// The map key carries the battle id in phases.json; the field
		// stays empty inside the entry to match the file convention.
		r.BattleID = ""
		if r.Origin == "" {
			r.Origin = "drafted"
		}
		raw, err := json.MarshalIndent(r, "  ", "  ")
		if err != nil {
			return nil, fmt.Errorf("draft %s: marshal: %w", id, err)
		}
		existing[id] = raw
		merged = append(merged, id)
	}

	out, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal phases: %w", err)
	}
	out = append(out, '\n')
	if err := os.WriteFile(phasesPath, out, 0o644); err != nil {
		return nil, fmt.Errorf("write phases: %w", err)
	}
	return merged, nil
}
