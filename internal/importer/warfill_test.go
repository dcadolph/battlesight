package importer

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/dcadolph/battlesight/internal/db"
)

// TestWarFromSources verifies the source order and the values it refuses.
func TestWarFromSources(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		Conflict   string
		Partof     string
	}{{ // Test 0: Wikidata conflict label wins over the infobox.
		Conflict: "Hundred Years' War", Partof: "[[Edwardian War]]", WantResult: "Hundred Years' War",
	}, { // Test 1: Bare Q-id is skipped for the next label.
		Conflict: "Q123|Thirty Years' War", WantResult: "Thirty Years' War",
	}, { // Test 2: Infobox first link, piped and prefixed with "the".
		Partof:     "the [[Western Front (World War I)|Western Front]] of [[World War I]]",
		WantResult: "Western Front (World War I)",
	}, { // Test 3: Infobox text without a link is not a source.
		Partof: "Boko Haram insurgency",
	}, { // Test 4: Leaked infobox parameter is not a source.
		Partof: "| image = Bataille.png",
	}, { // Test 5: List articles are never a war.
		Conflict: "List of battles of the Hundred Years' War", Partof: "[[List of wars]]",
	}, { // Test 6: Underscores in a link become spaces.
		Partof: "[[Kargil_War]]", WantResult: "Kargil War",
	}, { // Test 7: Nothing given.
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, warFromSources(test.Conflict, test.Partof)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// warSeed is one battle row for the war fill and alias tests.
type warSeed struct {
	// ID is the battle slug.
	ID string
	// War is the stored war.
	War string
	// Source is curated or wikidata.
	Source string
	// Verified is 1 for a hand-checked row.
	Verified int
	// Conflict is the stored Wikidata conflict label list.
	Conflict string
	// Partof is the stored infobox partof value.
	Partof string
	// Lat is the latitude, 0 when unset.
	Lat float64
	// Lng is the longitude, 0 when unset.
	Lng float64
}

// openWarDB seeds a temp db with the rows.
func openWarDB(t *testing.T, seeds []warSeed) *sql.DB {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "wars.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	for _, s := range seeds {
		if _, err := conn.ExecContext(context.Background(), `INSERT INTO battles (id, name, year, date, date_start,
			date_end, lat, lng, era, war, battle_type, victor, summary, significance, source, source_id, verified,
			wikipedia_title, wikidata_conflict, infobox_partof)
			VALUES (?, ?, 1900, '1900', '1900-01-01', '1900-12-31', ?, ?, 'industrial', ?, 'land', '', '', '', ?, '',
			?, '', ?, ?)`, s.ID, s.ID, s.Lat, s.Lng, s.War, s.Source, s.Verified, s.Conflict, s.Partof); err != nil {
			t.Fatalf("insert %s: %v", s.ID, err)
		}
	}
	return conn
}

// TestFillAndAliasWars verifies the fill touches only war-less unverified
// wikidata rows and the alias pass moves every row to the canonical name.
func TestFillAndAliasWars(t *testing.T) {
	t.Parallel()
	conn := openWarDB(t, []warSeed{
		{ID: "filled", Source: "wikidata", Conflict: "Israel–Hamas war"},
		{ID: "from-partof", Source: "wikidata", Partof: "the [[Gaza war]]"},
		{ID: "verified", Source: "wikidata", Verified: 1, Conflict: "Gaza war"},
		{ID: "curated", Source: "curated", Partof: "[[Gaza war]]"},
		{ID: "has-war", Source: "wikidata", War: "Russia-Ukraine War", Conflict: "Gaza war"},
		{ID: "no-source", Source: "wikidata"},
		{ID: "out-of-region", Source: "wikidata", Conflict: "Russo-Ukrainian War", Lat: 47, Lng: 6},
	})
	ctx := context.Background()
	filled, err := fillWarFromWikidata(ctx, conn)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(2, filled); diff != "" {
		t.Errorf("filled mismatch (-want +got):\n%s", diff)
	}
	aliases := map[string]string{"Israel–Hamas war": "Gaza war", "Russia-Ukraine War": "Russo-Ukrainian War"}
	moved, err := applyWarAliases(ctx, conn, aliases)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(2, moved); diff != "" {
		t.Errorf("moved mismatch (-want +got):\n%s", diff)
	}
	want := []string{"curated:", "filled:Gaza war", "from-partof:Gaza war", "has-war:Russo-Ukrainian War",
		"no-source:", "out-of-region:", "verified:"}
	got := queryStrings(t, conn, `SELECT id || ':' || war FROM battles ORDER BY id`)
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
	again, err := fillWarFromWikidata(ctx, conn)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(0, again); diff != "" {
		t.Errorf("second fill mismatch (-want +got):\n%s", diff)
	}
}

// TestCanonicaliseWarNamesPrefersKeys verifies a wars.json key wins the
// variant collapse over a spelling more rows carry.
func TestCanonicaliseWarNamesPrefersKeys(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Keys       map[string]bool
		WantResult []string
	}{{ // Test 0: The key wins against three rows.
		Keys:       map[string]bool{"Gaza war": true},
		WantResult: []string{"Gaza war", "Gaza war", "Gaza war", "Gaza war"},
	}, { // Test 1: Without a key the majority wins.
		WantResult: []string{"Gaza War", "Gaza War", "Gaza War", "Gaza War"},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			conn := openWarDB(t, []warSeed{
				{ID: "a", Source: "curated", War: "Gaza war"},
				{ID: "b", Source: "wikidata", War: "Gaza War"},
				{ID: "c", Source: "wikidata", War: "Gaza War"},
				{ID: "d", Source: "wikidata", War: "Gaza War"},
			})
			if _, err := canonicaliseWarNames(context.Background(), conn, test.Keys); err != nil {
				t.Fatal(err)
			}
			got := queryStrings(t, conn, `SELECT war FROM battles ORDER BY id`)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
