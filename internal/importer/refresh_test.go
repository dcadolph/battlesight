package importer

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"

	"github.com/dcadolph/battlesight/internal/db"
)

// refreshSeed is one existing row for the refresh test.
type refreshSeed struct {
	// ID is the battle slug.
	ID string
	// Name is the battle name.
	Name string
	// Source is curated or wikidata.
	Source string
	// QID is the Wikidata item.
	QID string
	// Year is the stored year.
	Year int
	// Verified is 1 for a hand-checked row.
	Verified int
	// Title is the stored Wikipedia title.
	Title string
	// Lat is the stored latitude.
	Lat float64
	// WDDate is the stored Wikidata start.
	WDDate string
	// WDPrec is the stored Wikidata start precision.
	WDPrec int
	// Conflict is the stored Wikidata conflict.
	Conflict string
}

// openRefreshDB seeds a temp db with the rows.
func openRefreshDB(t *testing.T, seeds []refreshSeed) *sql.DB {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "refresh.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	for _, s := range seeds {
		if _, err := conn.ExecContext(context.Background(), `INSERT INTO battles (id, name, year, date, date_start,
			date_end, lat, lng, era, war, battle_type, victor, summary, significance, source, source_id, verified,
			wikipedia_title, wikidata_date, wikidata_precision, wikidata_conflict) VALUES (?, ?, ?, 'stored',
			'2000-01-01', '2000-12-31', ?, ?, 'contemporary', 'Kept war', 'land', 'Kept', '', '', ?, ?, ?, ?, ?, ?, ?)`,
			s.ID, s.Name, s.Year, s.Lat, s.Lat, s.Source, s.QID, s.Verified, s.Title, s.WDDate, s.WDPrec,
			s.Conflict); err != nil {
			t.Fatalf("insert %s: %v", s.ID, err)
		}
	}
	return conn
}

// testRefreshSeeds are the existing rows the refresh test starts from.
func testRefreshSeeds() []refreshSeed {
	return []refreshSeed{
		{ID: "curated", Name: "Battle of Curated", Source: "curated", Year: 2024, Title: "Battle of Curated", Lat: 1},
		{ID: "verified", Name: "Verified", Source: "wikidata", QID: "Q2", Year: 2024, Verified: 1, Lat: 1,
			WDDate: "+2024-07-01", WDPrec: 10},
		{ID: "moved", Name: "Moved", Source: "wikidata", QID: "Q3", Year: 2024, Title: "Moved", Lat: 1,
			WDDate: "+2024-07-01", WDPrec: 10},
		{ID: "old", Name: "Old", Source: "wikidata", QID: "Q4", Year: 1990, Lat: 1, WDDate: "+1990-07-01", WDPrec: 10},
		{ID: "same", Name: "Same", Source: "wikidata", QID: "Q5", Year: 2023, Lat: 1, WDDate: "+2023-03-01",
			WDPrec: 10, Conflict: "War A"},
		{ID: "unplaced", Name: "Unplaced", Source: "wikidata", QID: "Q6", Year: 2025, WDDate: "+2025-05-01",
			WDPrec: 10},
		{ID: "p361", Name: "P361", Source: "wikidata", QID: "Q7", Year: 2024, Lat: 1, WDDate: "+2024-01-01",
			WDPrec: 9, Conflict: "Campaign war"},
		{ID: "gone", Name: "Gone", Source: "wikidata", QID: "Q8", Year: 2024, Lat: 1},
		{ID: "battle-of-new-town", Name: "Battle of New Town", Source: "wikidata", QID: "Q9", Year: 1800, Lat: 1},
		{ID: "battle-of-himera", Name: "Battle of Himera", Source: "wikidata", QID: "Q20", Year: -480, Lat: 1},
	}
}

// testRefreshSources is the fake Wikidata for the refresh test.
func testRefreshSources(t *testing.T) (catalogFunc, factsFunc, canonicalTitleFunc) {
	t.Helper()
	b := func(q, label, date, coords, article string) sparqlBinding {
		return sparqlBinding{Battle: sparqlValue{"http://www.wikidata.org/entity/" + q}, Label: sparqlValue{label},
			Date: sparqlValue{date}, Coords: sparqlValue{coords}, Article: sparqlValue{article}}
	}
	catalog := func(context.Context) ([]sparqlBinding, error) {
		return []sparqlBinding{
			b("Q3", "Moved", "", "", ""),
			b("Q6", "Unplaced", "", "Point(37.5 48.2)", "https://en.wikipedia.org/wiki/Battle_of_Unplaced"),
			b("Q10", "Battle of New", "2026-02-01T00:00:00Z", "Point(36 48)", "https://en.wikipedia.org/wiki/Battle_of_New"),
			b("Q10", "Battle of New", "", "", ""),
			b("Q11", "Battle of Curated", "2024-01-01T00:00:00Z", "Point(1 1)", ""),
			b("Q12", "Other name", "2024-01-01T00:00:00Z", "Point(1 1)", "https://en.wikipedia.org/wiki/Battle_of_Curated"),
			b("Q13", "Battle of New Town", "2025-03-01T00:00:00Z", "Point(2 2)", ""),
			b("Q14", "Q14", "2025-03-01T00:00:00Z", "Point(2 2)", ""),
			b("Q15", "Battle of Removed", "2025-04-01T00:00:00Z", "Point(3 3)", ""),
			b("Q21", "Battle of Himera", "-0408-01-01T00:00:00Z", "Point(13.8 38)", ""),
		}, nil
	}
	live := map[string]wikidataFacts{
		"Q2":  {Date: "+2024-07-01", Precision: 10, End: "+2025-12-01", EndPrecision: 11},
		"Q3":  {Date: "+2024-07-01", Precision: 10, End: "+2025-12-01", EndPrecision: 11, Conflicts: []string{"Q100"}},
		"Q4":  {Date: "+1991-07-01", Precision: 10},
		"Q5":  {Date: "+2023-03-01", Precision: 10, Conflicts: []string{"Q101"}},
		"Q6":  {Date: "+2025-05-01", Precision: 10},
		"Q7":  {Date: "+2024-01-01", Precision: 9},
		"Q8":  {Missing: true},
		"Q10": {Date: "+2026-02-01", Precision: 11, Instances: []string{"Q178561"}},
		"Q13": {Date: "+2025-03-01", Precision: 10},
		"Q15": {Date: "+2025-04-01", Precision: 10},
		"Q21": {Date: "-0409-00-00", Precision: 9},
	}
	facts := func(_ context.Context, qids []string) (map[string]wikidataFacts, map[string]string, error) {
		out := map[string]wikidataFacts{}
		for _, q := range qids {
			if f, ok := live[q]; ok {
				out[q] = f
			}
		}
		return out, map[string]string{"Q100": "Russo-Ukrainian War", "Q101": "War A", "Q178561": "battle"}, nil
	}
	canon := func(string) (string, bool) { return "", false }
	return catalog, facts, canon
}

// TestRefreshWikidata verifies the refresh inserts only new Q-ids under a free
// slug, re-reads only unverified wikidata rows in scope, renders dates again
// only where Wikidata moved, keeps a P361 conflict when P607 is empty, and
// never writes curated or verified rows.
func TestRefreshWikidata(t *testing.T) {
	t.Parallel()
	conn := openRefreshDB(t, testRefreshSeeds())
	catalog, facts, canon := testRefreshSources(t)
	ctx := context.Background()
	const removed = `INSERT INTO removed_items (qid, reason) VALUES ('Q15', 'non-battle: film')`
	if _, err := conn.ExecContext(ctx, removed); err != nil {
		t.Fatal(err)
	}
	rep, err := refreshWikidata(ctx, conn, 2022, false, catalog, facts, canon, time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	wantRep := RefreshReport{
		Fetched: 9, New: 7, Inserted: 3, SkippedRemoved: 1, SkippedTitle: 1, SkippedName: 1, SkippedLabel: 1,
		InScope: 5, Missing: 1,
		FactsChanged: 1, DatesRewritten: 1, TitlesSet: 1, CoordsFilled: 1,
	}
	if diff := cmp.Diff(wantRep, rep); diff != "" {
		t.Errorf("report mismatch (-want +got):\n%s", diff)
	}
	got := queryStrings(t, conn, `SELECT id || '|' || year || '|' || date || '|' || date_start || '|' || date_end ||
		'|' || wikipedia_title || '|' || lat || '|' || wikidata_conflict || '|' || wikidata_checked || '|' || war
		FROM battles ORDER BY id`)
	want := []string{
		"battle-of-himera|-480|stored|2000-01-01|2000-12-31||1.0|||Kept war",
		"battle-of-himera-409-bc|-409|409 BC|-0409-12-31|-0409-12-31||38.0||2026-11-02|",
		"battle-of-new|2026|1 February 2026|2026-02-01|2026-02-01|Battle of New|48.0||2026-11-02|",
		"battle-of-new-town|1800|stored|2000-01-01|2000-12-31||1.0|||Kept war",
		"battle-of-new-town-2025|2025|March 2025|2025-03-01|2025-03-31||2.0||2026-11-02|",
		"curated|2024|stored|2000-01-01|2000-12-31|Battle of Curated|1.0|||Kept war",
		"gone|2024|stored|2000-01-01|2000-12-31||1.0|||Kept war",
		"moved|2024|July 2024 – 1 December 2025|2024-07-01|2025-12-01|Moved|1.0|Russo-Ukrainian War|2026-11-02|Kept war",
		"old|1990|stored|2000-01-01|2000-12-31||1.0|||Kept war",
		"p361|2024|stored|2000-01-01|2000-12-31||1.0|Campaign war||Kept war",
		"same|2023|stored|2000-01-01|2000-12-31||1.0|War A||Kept war",
		"unplaced|2025|stored|2000-01-01|2000-12-31|Battle of Unplaced|48.2||2026-11-02|Kept war",
		"verified|2024|stored|2000-01-01|2000-12-31||1.0|||Kept war",
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
}

// TestRefreshWikidataNoNetwork verifies a refresh whose catalog cannot be read
// writes nothing.
func TestRefreshWikidataNoNetwork(t *testing.T) {
	t.Parallel()
	conn := openRefreshDB(t, testRefreshSeeds())
	_, facts, canon := testRefreshSources(t)
	catalog := func(context.Context) ([]sparqlBinding, error) { return nil, ErrNetworkDisabled }
	before := queryStrings(t, conn, `SELECT id || '|' || date || '|' || wikidata_checked FROM battles ORDER BY id`)
	_, err := refreshWikidata(context.Background(), conn, 2022, false, catalog, facts, canon, time.Now())
	if !errors.Is(err, ErrNetworkDisabled) {
		t.Errorf("want network disabled, got %v", err)
	}
	after := queryStrings(t, conn, `SELECT id || '|' || date || '|' || wikidata_checked FROM battles ORDER BY id`)
	if diff := cmp.Diff(before, after); diff != "" {
		t.Errorf("rows changed (-before +after):\n%s", diff)
	}
}
