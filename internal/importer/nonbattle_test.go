package importer

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/dcadolph/battlesight/internal/db"
)

func TestIsNonBattle(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		WantResult bool
	}{{ // Test 0: Plain battle.
		In: "battle", WantResult: false,
	}, { // Test 1: Legendary battle.
		In: "legendary battle", WantResult: true,
	}, { // Test 2: A myth class beside a battle class still marks a myth.
		In: "myth|battle", WantResult: true,
	}, { // Test 3: Theomachy.
		In: "theomachism", WantResult: true,
	}, { // Test 4: Bible story.
		In: "battle|Bible story", WantResult: true,
	}, { // Test 5: Disambiguation page.
		In: "Wikimedia disambiguation page|war front|battle", WantResult: true,
	}, { // Test 6: Counterfactual event.
		In: "naval battle|counterfactual event", WantResult: true,
	}, { // Test 7: No military class at all.
		In: "picketing", WantResult: true,
	}, { // Test 8: Unknown classes are kept.
		In: "", WantResult: false,
	}, { // Test 9: Pipes with no labels are unknown.
		In: "||", WantResult: false,
	}, { // Test 10: A non-military class beside a military one is kept.
		In: "travel|naval battle", WantResult: false,
	}, { // Test 11: Siege with a ballad is kept.
		In: "battle|ballad|musical work/composition", WantResult: false,
	}, { // Test 12: Deity.
		In: "deity", WantResult: true,
	}, { // Test 13: Military operation.
		In: "military operation", WantResult: false,
	}, { // Test 14: Case does not matter.
		In: "Legendary Battle", WantResult: true,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, IsNonBattle(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestDropNonBattles runs the pass on a temp db. Only the unverified wikidata
// rows with non-battle classes go, with their sides, references and aliases.
func TestDropNonBattles(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	conn, err := db.Open(filepath.Join(t.TempDir(), "nonbattle.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer conn.Close()
	insert := `INSERT INTO battles (id, name, year, date, date_start, date_end, lat, lng, era, war, battle_type,
		victor, summary, significance, source, source_id, verified, wikidata_instance_of)
		VALUES (?, ?, 500, '500', '0500-01-01', '0500-12-31', 1, 1, 'ancient', '', 'land', '', '', '', ?, ?, ?, ?)`
	rows := [][]any{
		{"camlann", "Battle of Camlann", "wikidata", "Q1", 0, "legendary battle"},
		{"deity", "Battle of Gods", "wikidata", "Q2", 0, "deity"},
		{"real", "Battle of Real", "wikidata", "Q3", 0, "battle"},
		{"unknown", "Battle of Unknown", "wikidata", "Q4", 0, ""},
		{"verified", "Battle of Verified", "wikidata", "Q5", 1, "legendary battle"},
		{"curated", "Battle of Curated", "curated", "", 0, "legendary battle"},
	}
	for _, r := range rows {
		if _, err := conn.ExecContext(ctx, insert, r...); err != nil {
			t.Fatalf("insert %v: %v", r[0], err)
		}
	}
	for _, q := range []string{
		`INSERT INTO battle_sides (battle_id, side_index, name, commander, strength, casualties) VALUES ('camlann', 0, 'Britons', '', '', '')`,
		`INSERT INTO battle_references (battle_id, ref_type, title) VALUES ('camlann', 'web', 'Camlann')`,
		`INSERT INTO battle_aliases (battle_id, alias_index, name) VALUES ('camlann', 0, 'Camlan')`,
	} {
		if _, err := conn.ExecContext(ctx, q); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	n, err := dropNonBattles(ctx, conn)
	if err != nil {
		t.Fatalf("drop: %v", err)
	}
	if diff := cmp.Diff(2, n); diff != "" {
		t.Errorf("count mismatch (-want +got):\n%s", diff)
	}
	var ids []string
	res, err := conn.QueryContext(ctx, `SELECT id FROM battles ORDER BY id`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer res.Close()
	for res.Next() {
		var id string
		if err := res.Scan(&id); err != nil {
			t.Fatalf("scan: %v", err)
		}
		ids = append(ids, id)
	}
	if diff := cmp.Diff([]string{"curated", "real", "unknown", "verified"}, ids); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
	for _, table := range []string{"battle_sides", "battle_references", "battle_aliases"} {
		var left int
		if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+table).Scan(&left); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if left != 0 {
			t.Errorf("%s kept %d rows of a dropped battle", table, left)
		}
	}
	removed := queryStrings(t, conn, `SELECT qid || '|' || reason || '|' || kept_id FROM removed_items ORDER BY qid`)
	wantRemoved := []string{"Q1|non-battle: legendary battle|", "Q2|non-battle: deity|"}
	if diff := cmp.Diff(wantRemoved, removed); diff != "" {
		t.Errorf("removed items mismatch (-want +got):\n%s", diff)
	}
	if n, err := dropNonBattles(ctx, conn); err != nil || n != 0 {
		t.Errorf("second pass dropped %d rows, err %v, want 0 and nil", n, err)
	}
}
