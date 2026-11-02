package importer

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strings"
)

// nonBattleFragments are P31 label fragments that mark an item as legend,
// fiction, a religious narrative or a Wikimedia page rather than a military event.
var nonBattleFragments = []string{"myth", "fiction", "legend", "deity", "theomach", "literary", "film",
	"video game", "novel", "folklore", "bible", "counterfactual", "disambiguation", "concept",
	"religious belief"}

// militaryLabel matches the P31 labels of military events. An item whose labels
// all miss it is not a battle.
var militaryLabel = regexp.MustCompile(`battle|siege|skirmish|operation|massacre|engagement|dogfight|` +
	`rebellion|offensive|campaign|raid|conflict|sack|last stand|ambush|invasion|bombardment|landing|` +
	`sinking|warfare|liberation|combat|attack|\bwar\b|piracy|capture|blockade|convoy|capitul|incident|` +
	`airstrike|bombing|strike|fighting|expedition|revolt|occupation|encirclement|counter|conquest|` +
	`charge|coup|shooting|escalade|relief|jihad|annexation|lodgement|front|scuttling|intrusion|` +
	`show of force|resistance|uprising|mutiny|d-day|shipwreck|murder|cleansing|looting|destruction|` +
	`explosion|feud|hostage|kidnap|sedition|jailbreak|missile|staging|insurgen|guerrilla|clash|assault|` +
	`storming|defen[cs]e|retreat|pursuit|surrender|military`)

// IsNonBattle reports whether a pipe-joined Wikidata P31 label list describes
// something other than a military event: any label names legend, fiction, a
// religious narrative or a Wikimedia page, or no label names a military event.
// An empty list is unknown and is never a non-battle.
func IsNonBattle(instanceOf string) bool {
	var labels []string
	for _, l := range strings.Split(strings.ToLower(instanceOf), "|") {
		if l = strings.TrimSpace(l); l != "" {
			labels = append(labels, l)
		}
	}
	if len(labels) == 0 {
		return false
	}
	military := false
	for _, l := range labels {
		for _, f := range nonBattleFragments {
			if strings.Contains(l, f) {
				return true
			}
		}
		if militaryLabel.MatchString(l) {
			military = true
		}
	}
	return !military
}

// dropNonBattles deletes unverified wikidata rows whose Wikidata classes say
// they are not battles, with their sides and references, in one transaction.
// Every deleted row is logged by id and name.
func dropNonBattles(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, name, wikidata_instance_of FROM battles
		WHERE source = 'wikidata' AND verified = 0 AND wikidata_instance_of != ''`)
	if err != nil {
		return 0, fmt.Errorf("scan non-battles: %w", err)
	}
	type hit struct{ id, name, classes string }
	var hits []hit
	for rows.Next() {
		var h hit
		if err := rows.Scan(&h.id, &h.name, &h.classes); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan non-battle row: %w", err)
		}
		if IsNonBattle(h.classes) {
			hits = append(hits, h)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate non-battle rows: %w", err)
	}
	if len(hits) == 0 {
		return 0, nil
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin non-battle tx: %w", err)
	}
	defer tx.Rollback()
	for _, h := range hits {
		for _, q := range []string{`DELETE FROM battle_sides WHERE battle_id = ?`,
			`DELETE FROM battle_references WHERE battle_id = ?`, `DELETE FROM battle_aliases WHERE battle_id = ?`,
			`DELETE FROM battles WHERE id = ?`} {
			if _, err := tx.ExecContext(ctx, q, h.id); err != nil {
				return 0, fmt.Errorf("delete non-battle %s: %w", h.id, err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit non-battles: %w", err)
	}
	for _, h := range hits {
		log.Printf("non-battle: dropped %s (%s): %s", h.id, h.name, h.classes)
	}
	return len(hits), nil
}
