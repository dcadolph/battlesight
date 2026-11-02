package importer

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

	"github.com/dcadolph/battlesight/internal/battles"
	"github.com/dcadolph/battlesight/internal/db"
)

func TestTwinSimilarity(t *testing.T) {
	t.Parallel()
	tests := []struct {
		A, B       string
		WantResult string
	}{{ // Test 0: One letter apart.
		A: "Battle of Bembezi", B: "Battle of Bembesi", WantResult: "0.92",
	}, { // Test 1: A space is not a difference.
		A: "Battle of Wad Kaltabu", B: "Battle of Wadkaltabu", WantResult: "1.00",
	}, { // Test 2: Connectors drop, so at and of meet.
		A: "Battle at Machhiwara", B: "Battle of Machhiwara", WantResult: "1.00",
	}, { // Test 3: Diacritics and parentheticals drop.
		A: "Battle of Bembézi (1893)", B: "Battle of Bembezi", WantResult: "1.00",
	}, { // Test 4: Type words stay, so a siege and a battle of one place differ.
		A: "Siege of Suffolk", B: "Battle of Suffolk", WantResult: "0.62",
	}, { // Test 5: Two spellings a transliteration apart fall under the bar.
		A: "Battle of Klushino", B: "Battle of Kruszyn", WantResult: "0.71",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := fmt.Sprintf("%.2f", twinSimilarity(test.A, test.B))
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("similarity mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// testTwin builds a wikidata twin row.
func testTwin(id, name, title string, year int) twinRow {
	return twinRow{ID: id, Name: name, Year: year, Title: title, Source: "wikidata"}
}

func TestTwinCandidates(t *testing.T) { //nolint:funlen // Test function.
	t.Parallel()
	tests := []struct {
		Name        string
		Rows        []twinRow
		Canon       map[string]string
		WantPairs   []string
		WantCurated []string
	}{{ // Test 0: A spelling twin redirects to the anchor's article.
		Name: "bembezi",
		Rows: []twinRow{
			testTwin("battle-of-bembezi", "Battle of Bembezi", "Battle of Bembezi", 1893),
			testTwin("battle-of-bembesi", "Battle of Bembesi", "Battle of Bembesi", 1893),
		},
		Canon:     map[string]string{"Battle of Bembezi": "Battle of Bembezi", "Battle of Bembesi": "Battle of Bembezi"},
		WantPairs: []string{"battle-of-bembesi>battle-of-bembezi"},
	}, { // Test 1: A siege and a battle of one place stay apart.
		Name: "suffolk",
		Rows: []twinRow{
			testTwin("siege-of-suffolk", "Siege of Suffolk", "Siege of Suffolk", 1863),
			testTwin("battle-of-suffolk", "Battle of Suffolk", "Battle of Suffolk", 1863),
		},
		Canon: map[string]string{"Siege of Suffolk": "Siege of Suffolk", "Battle of Suffolk": "Siege of Suffolk"},
	}, { // Test 2: Two rows redirecting to a third article have no anchor.
		Name: "kakor",
		Rows: []twinRow{
			testTwin("battle-of-kakor", "Battle of Kakor", "Battle of Kakor", 1759),
			testTwin("battle-of-kakkor", "Battle of Kakkor", "Battle of Kakkor", 1759),
		},
		Canon: map[string]string{"Battle of Kakor": "Malhar Rao Holkar", "Battle of Kakkor": "Malhar Rao Holkar"},
	}, { // Test 3: An ordinal on one side only marks a second engagement.
		Name: "ras lanuf",
		Rows: []twinRow{
			testTwin("battle-of-ras-lanuf", "Battle of Ras Lanuf", "Battle of Ras Lanuf", 2011),
			testTwin("second-battle-of-ras-lanuf", "Second Battle of Ras Lanuf", "Second Battle of Ras Lanuf", 2011),
		},
		Canon: map[string]string{"Battle of Ras Lanuf": "Battle of Ras Lanuf",
			"Second Battle of Ras Lanuf": "Battle of Ras Lanuf"},
	}, { // Test 4: Different years are different battles.
		Name: "kawanakajima",
		Rows: []twinRow{
			testTwin("battles-of-kawanakajima", "Battles of Kawanakajima", "Battles of Kawanakajima", 1553),
			testTwin("battle-of-kawanakajima", "Battle of Kawanakajima", "Battle of Kawanakajima", 1561),
		},
		Canon: map[string]string{"Battles of Kawanakajima": "Battles of Kawanakajima",
			"Battle of Kawanakajima": "Battles of Kawanakajima"},
	}, { // Test 5: A curated row is a curated twin, never a merge.
		Name: "geneina",
		Rows: []twinRow{
			testTwin("battle-of-geneina", "Battle of Geneina", "Battle of Geneina", 2023),
			{ID: "el-geneina-2023", Name: "Battle of El Geneina", Year: 2023, Title: "Battle of El Geneina",
				Source: "curated"},
		},
		Canon: map[string]string{"Battle of Geneina": "Battle of Geneina",
			"Battle of El Geneina": "Battle of Geneina"},
		WantCurated: []string{"el-geneina-2023>battle-of-geneina"},
	}, { // Test 6: Two sub-battles redirecting to a parent article never pair.
		Name: "donbas",
		Rows: []twinRow{
			testTwin("battle-of-siversk", "Battle of Siversk", "Battle of Siversk", 2022),
			testTwin("battle-of-sviatohirsk", "Battle of Sviatohirsk", "Battle of Sviatohirsk", 2022),
			testTwin("battle-of-donbas", "Battle of Donbas", "Battle of Donbas (2022)", 2022),
		},
		Canon: map[string]string{"Battle of Siversk": "Battle of Donbas (2022)",
			"Battle of Sviatohirsk": "Battle of Donbas (2022)", "Battle of Donbas (2022)": "Battle of Donbas (2022)"},
	}, { // Test 7: A verified anchor protects the pair.
		Name: "verified",
		Rows: []twinRow{
			{ID: "battle-of-bembezi", Name: "Battle of Bembezi", Year: 1893, Title: "Battle of Bembezi",
				Source: "wikidata", Verified: true},
			testTwin("battle-of-bembesi", "Battle of Bembesi", "Battle of Bembesi", 1893),
		},
		Canon:       map[string]string{"Battle of Bembezi": "Battle of Bembezi", "Battle of Bembesi": "Battle of Bembezi"},
		WantCurated: []string{"battle-of-bembesi>battle-of-bembezi"},
	}, { // Test 8: A title the cache never resolved is left alone.
		Name: "uncached",
		Rows: []twinRow{
			testTwin("battle-of-bembezi", "Battle of Bembezi", "Battle of Bembezi", 1893),
			testTwin("battle-of-bembesi", "Battle of Bembesi", "Battle of Bembesi", 1893),
		},
		Canon: map[string]string{"Battle of Bembezi": "Battle of Bembezi"},
	}}
	label := func(ps []twinPair) []string {
		var out []string
		for _, p := range ps {
			out = append(out, p.Twin.ID+">"+p.Anchor.ID)
		}
		return out
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantPairs, label(redirectTwins(test.Rows, test.Canon)),
				cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("twins mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantCurated, label(curatedTwins(test.Rows, test.Canon)),
				cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("curated twins mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestTwinCandidatesStable pins that one fixture yields one pair order.
func TestTwinCandidatesStable(t *testing.T) {
	t.Parallel()
	rows := []twinRow{
		testTwin("battle-of-messkirch", "Battle of Messkirch", "Battle of Messkirch", 1800),
		testTwin("battle-of-merskirch", "Battle of Merskirch", "Battle of Merskirch", 1800),
		testTwin("battle-of-bembezi", "Battle of Bembezi", "Battle of Bembezi", 1893),
		testTwin("battle-of-bembesi", "Battle of Bembesi", "Battle of Bembesi", 1893),
		testTwin("battle-at-machhiwara", "Battle at Machhiwara", "Battle at Machhiwara", 1555),
		testTwin("battle-of-machhiwara", "Battle of Machhiwara", "Battle of Machhiwara", 1555),
	}
	canon := map[string]string{
		"Battle of Messkirch": "Battle of Messkirch", "Battle of Merskirch": "Battle of Messkirch",
		"Battle of Bembezi": "Battle of Bembezi", "Battle of Bembesi": "Battle of Bembezi",
		"Battle at Machhiwara": "Battle of Machhiwara", "Battle of Machhiwara": "Battle of Machhiwara",
	}
	first := redirectTwins(rows, canon)
	for range 20 {
		if diff := cmp.Diff(first, redirectTwins(rows, canon)); diff != "" {
			t.Fatalf("pair order changed between runs (-first +again):\n%s", diff)
		}
	}
	if len(first) != 3 || first[0].Canonical != "Battle of Bembezi" || first[2].Canonical != "Battle of Messkirch" {
		t.Errorf("want 3 pairs sorted by canonical title, got %+v", first)
	}
}

// twinSeed is one battle row with its sides and aliases for a merge test.
type twinSeed struct {
	// ID is the battle slug.
	ID string
	// Name is the display name.
	Name string
	// Title is the stored Wikipedia title.
	Title string
	// Source is curated or wikidata.
	Source string
	// Verified marks a hand-checked row.
	Verified int
	// Sides lists side names.
	Sides []string
	// Aliases lists alias names, each attributed to "Smith".
	Aliases []string
	// Lat is the latitude.
	Lat float64
}

// openTwinDB seeds a temp db with the rows, one reference each.
func openTwinDB(t *testing.T, seeds []twinSeed) *sql.DB {
	t.Helper()
	ctx := context.Background()
	conn, err := db.Open(filepath.Join(t.TempDir(), "twins.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	for _, s := range seeds {
		if _, err := conn.ExecContext(ctx, `INSERT INTO battles (id, name, year, date, date_start, date_end, lat, lng,
			era, war, battle_type, victor, summary, significance, source, source_id, verified, wikipedia_title)
			VALUES (?, ?, 1893, '1893', '1893-01-01', '1893-12-31', ?, 28, 'modern', '', 'land', '', '', '', ?,
			CASE ? WHEN 'wikidata' THEN 'Q' || ? ELSE '' END, ?, ?)`,
			s.ID, s.Name, s.Lat, s.Source, s.Source, s.ID, s.Verified, s.Title); err != nil {
			t.Fatalf("insert %s: %v", s.ID, err)
		}
		for i, n := range s.Sides {
			if _, err := conn.ExecContext(ctx, `INSERT INTO battle_sides (battle_id, side_index, name, commander, strength,
				casualties) VALUES (?, ?, ?, '', '', '')`, s.ID, i, n); err != nil {
				t.Fatalf("insert side: %v", err)
			}
		}
		for i, n := range s.Aliases {
			if _, err := conn.ExecContext(ctx, `INSERT INTO battle_aliases (battle_id, alias_index, name, by_text)
				VALUES (?, ?, ?, 'Smith')`, s.ID, i, n); err != nil {
				t.Fatalf("insert alias: %v", err)
			}
		}
		if _, err := conn.ExecContext(ctx, `INSERT INTO battle_references (battle_id, ref_type, title)
			VALUES (?, 'web', 'ref')`, s.ID); err != nil {
			t.Fatalf("insert reference: %v", err)
		}
	}
	return conn
}

// queryStrings runs a one-column query and returns its values in order.
func queryStrings(t *testing.T, conn *sql.DB, q string, args ...any) []string {
	t.Helper()
	rows, err := conn.QueryContext(context.Background(), q, args...)
	if err != nil {
		t.Fatalf("query %q: %v", q, err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, s)
	}
	return out
}

// staticCanon returns a canonOf that answers from m.
func staticCanon(m map[string]string) func([]twinRow) map[string]string {
	return func([]twinRow) map[string]string { return m }
}

func TestMergeTwins(t *testing.T) { //nolint:funlen // Test function.
	t.Parallel()
	canon := map[string]string{
		"Battle of Bembezi": "Battle of Bembezi", "Battle of Bembesi": "Battle of Bembezi",
		"Battle of Wad Kaltabu": "Battle of Wad Kaltabu", "Battle of Wadkaltabu": "Battle of Wad Kaltabu",
		"Battle of Maqongqo": "Battle of Maqongqo", "Battle of Magango": "Battle of Maqongqo",
	}
	tests := []struct {
		Name        string
		Seeds       []twinSeed
		Pairs       []DuplicatePair
		WantCount   int
		WantIDs     []string
		WantAliases []string
		WantSides   []string
		WantRemoved []string
	}{{ // Test 0: A spelling twin merges, carrying its name and aliases with attribution.
		Name: "bembezi",
		Seeds: []twinSeed{
			{ID: "battle-of-bembezi", Name: "Battle of Bembezi", Title: "Battle of Bembezi", Source: "wikidata",
				Sides: []string{"Ndebele", "British"}},
			{ID: "battle-of-bembesi", Name: "Battle of Bembesi", Title: "Battle of Bembesi", Source: "wikidata",
				Sides: []string{"Matabele"}, Aliases: []string{"Bembesi River"}},
		},
		WantCount: 1, WantIDs: []string{"battle-of-bembezi"},
		WantAliases: []string{"Battle of Bembesi|", "Bembesi River|Smith"},
		WantSides:   []string{"British", "Ndebele"},
		WantRemoved: []string{"Qbattle-of-bembesi|redirect twin|battle-of-bembezi"},
	}, { // Test 1: Twins merge however far apart their stored points sit.
		Name: "wad kaltabu",
		Seeds: []twinSeed{
			{ID: "battle-of-wad-kaltabu", Name: "Battle of Wad Kaltabu", Title: "Battle of Wad Kaltabu",
				Source: "wikidata", Lat: 14},
			{ID: "battle-of-wadkaltabu", Name: "Battle of Wadkaltabu", Title: "Battle of Wadkaltabu",
				Source: "wikidata", Lat: -21},
		},
		WantCount: 1, WantIDs: []string{"battle-of-wad-kaltabu"}, WantAliases: []string{"Battle of Wadkaltabu|"},
		WantRemoved: []string{"Qbattle-of-wadkaltabu|redirect twin|battle-of-wad-kaltabu"},
	}, { // Test 2: An anchor with no sides receives the twin's sides.
		Name: "sides move",
		Seeds: []twinSeed{
			{ID: "battle-of-maqongqo", Name: "Battle of Maqongqo", Title: "Battle of Maqongqo", Source: "wikidata"},
			{ID: "battle-of-magango", Name: "Battle of Magango", Title: "Battle of Magango", Source: "wikidata",
				Sides: []string{"Zulu", "Boers"}},
		},
		WantCount: 1, WantIDs: []string{"battle-of-maqongqo"}, WantAliases: []string{"Battle of Magango|"},
		WantSides:   []string{"Boers", "Zulu"},
		WantRemoved: []string{"Qbattle-of-magango|redirect twin|battle-of-maqongqo"},
	}, { // Test 3: An allowlist pair merges two alternate names the rule refuses.
		Name: "allowlist",
		Seeds: []twinSeed{
			{ID: "battle-of-klushino", Name: "Battle of Klushino", Title: "Battle of Klushino", Source: "wikidata"},
			{ID: "battle-of-kruszyn", Name: "Battle of Kruszyn", Title: "Battle of Kruszyn", Source: "wikidata"},
		},
		Pairs:     []DuplicatePair{{Keep: "battle-of-klushino", Merge: "battle-of-kruszyn"}},
		WantCount: 1, WantIDs: []string{"battle-of-klushino"}, WantAliases: []string{"Battle of Kruszyn|"},
		WantRemoved: []string{"Qbattle-of-kruszyn|allowlist twin|battle-of-klushino"},
	}, { // Test 4: A verified row in an allowlist pair is never merged.
		Name: "allowlist verified",
		Seeds: []twinSeed{
			{ID: "battle-of-klushino", Name: "Battle of Klushino", Title: "Battle of Klushino", Source: "wikidata"},
			{ID: "battle-of-kruszyn", Name: "Battle of Kruszyn", Title: "Battle of Kruszyn", Source: "wikidata",
				Verified: 1},
		},
		Pairs:     []DuplicatePair{{Keep: "battle-of-klushino", Merge: "battle-of-kruszyn"}},
		WantCount: 0, WantIDs: []string{"battle-of-klushino", "battle-of-kruszyn"},
	}, { // Test 5: A curated twin is never merged by the rule.
		Name: "curated",
		Seeds: []twinSeed{
			{ID: "battle-of-bembezi", Name: "Battle of Bembezi", Title: "Battle of Bembezi", Source: "wikidata"},
			{ID: "bembesi-1893", Name: "Battle of Bembesi", Title: "Battle of Bembesi", Source: "curated"},
		},
		WantCount: 0, WantIDs: []string{"battle-of-bembezi", "bembesi-1893"},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			ctx := context.Background()
			conn := openTwinDB(t, test.Seeds)
			n, err := mergeTwins(ctx, conn, test.Pairs, staticCanon(canon))
			if err != nil {
				t.Fatalf("merge: %v", err)
			}
			if diff := cmp.Diff(test.WantCount, n); diff != "" {
				t.Errorf("count mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantIDs, queryStrings(t, conn, `SELECT id FROM battles ORDER BY id`)); diff != "" {
				t.Errorf("rows mismatch (-want +got):\n%s", diff)
			}
			keep := test.WantIDs[0]
			aliases := queryStrings(t, conn, `SELECT name || '|' || by_text FROM battle_aliases WHERE battle_id = ?
				ORDER BY name`, keep)
			if diff := cmp.Diff(test.WantAliases, aliases, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("aliases mismatch (-want +got):\n%s", diff)
			}
			sides := queryStrings(t, conn, `SELECT name FROM battle_sides WHERE battle_id = ? ORDER BY name`, keep)
			if diff := cmp.Diff(test.WantSides, sides, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("sides mismatch (-want +got):\n%s", diff)
			}
			orphans := queryStrings(t, conn, `SELECT battle_id FROM battle_sides WHERE battle_id NOT IN (SELECT id FROM battles)
				UNION ALL SELECT battle_id FROM battle_references WHERE battle_id NOT IN (SELECT id FROM battles)
				UNION ALL SELECT battle_id FROM battle_aliases WHERE battle_id NOT IN (SELECT id FROM battles)`)
			if len(orphans) != 0 {
				t.Errorf("merged rows left children behind: %v", orphans)
			}
			removed := queryStrings(t, conn, `SELECT qid || '|' || reason || '|' || kept_id FROM removed_items
				ORDER BY qid`)
			if diff := cmp.Diff(test.WantRemoved, removed, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("removed items mismatch (-want +got):\n%s", diff)
			}
			if again, err := mergeTwins(ctx, conn, test.Pairs, staticCanon(canon)); err != nil || again != 0 {
				t.Errorf("second pass merged %d, err %v, want 0 and nil", again, err)
			}
		})
	}
}

// TestDeduplicateWikipediaKeepsCurated pins that a curated row survives a shared
// title even when the wikidata row has more sides, and takes its name as an alias.
func TestDeduplicateWikipediaKeepsCurated(t *testing.T) {
	t.Parallel()
	conn := openTwinDB(t, []twinSeed{
		{ID: "gaza-city-2023-2024", Name: "Battle of Gaza City", Title: "Siege of Gaza City", Source: "curated"},
		{ID: "siege-of-gaza-city", Name: "Siege of Gaza City", Title: "Siege of Gaza City", Source: "wikidata",
			Sides: []string{"Israel", "Hamas"}, Aliases: []string{"Gaza City offensive"}},
	})
	n, err := deduplicateWikipedia(context.Background(), conn)
	if err != nil {
		t.Fatalf("dedupe: %v", err)
	}
	if n != 1 {
		t.Errorf("removed %d rows, want 1", n)
	}
	if diff := cmp.Diff([]string{"gaza-city-2023-2024"}, queryStrings(t, conn, `SELECT id FROM battles`)); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
	want := []string{"Gaza City offensive", "Siege of Gaza City"}
	got := queryStrings(t, conn, `SELECT name FROM battle_aliases WHERE battle_id = 'gaza-city-2023-2024' ORDER BY name`)
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("aliases mismatch (-want +got):\n%s", diff)
	}
	removed := queryStrings(t, conn, `SELECT qid || '|' || reason || '|' || kept_id FROM removed_items`)
	wantRemoved := []string{"Qsiege-of-gaza-city|same Wikipedia title|gaza-city-2023-2024"}
	if diff := cmp.Diff(wantRemoved, removed); diff != "" {
		t.Errorf("removed items mismatch (-want +got):\n%s", diff)
	}
}

func TestValidateDuplicates(t *testing.T) {
	t.Parallel()
	curated := []battles.Battle{{ID: "gettysburg-1863"}}
	tests := []struct {
		Pairs     []DuplicatePair
		WantCount int
	}{{ // Test 0: A clean pair passes.
		Pairs: []DuplicatePair{{Keep: "a", Merge: "b"}}, WantCount: 0,
	}, { // Test 1: A curated id fails.
		Pairs: []DuplicatePair{{Keep: "gettysburg-1863", Merge: "b"}}, WantCount: 1,
	}, { // Test 2: A self pair fails.
		Pairs: []DuplicatePair{{Keep: "a", Merge: "a"}}, WantCount: 1,
	}, { // Test 3: A missing side fails.
		Pairs: []DuplicatePair{{Keep: "a"}}, WantCount: 1,
	}, { // Test 4: An id in two pairs fails.
		Pairs: []DuplicatePair{{Keep: "a", Merge: "b"}, {Keep: "a", Merge: "c"}}, WantCount: 1,
	}, { // Test 5: An empty list passes.
		Pairs: nil, WantCount: 0,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			rep := ValidateDuplicates(test.Pairs, curated)
			if diff := cmp.Diff(test.WantCount, len(rep.Errors)); diff != "" {
				t.Errorf("error count mismatch (-want +got):\n%s\n%v", diff, rep.Errors)
			}
		})
	}
}

func TestLoadDuplicates(t *testing.T) {
	t.Parallel()
	got, err := LoadDuplicates(filepath.Join(t.TempDir(), "absent.json"))
	if err != nil || got != nil {
		t.Errorf("missing file: got %v, %v, want nil, nil", got, err)
	}
	got, err = LoadDuplicates(filepath.Join("..", "..", "data", "duplicates.json"))
	if err != nil {
		t.Fatalf("repo allowlist: %v", err)
	}
	if rep := ValidateDuplicates(got, nil); rep.HasErrors() {
		t.Errorf("repo allowlist invalid: %v", rep.Errors)
	}
}
