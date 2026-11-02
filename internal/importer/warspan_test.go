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

// TestWarSpans verifies spans resolve through aliases and the parent chain.
func TestWarSpans(t *testing.T) {
	t.Parallel()
	wars := map[string]battles.WarNarrative{
		"Korean War":              {StartYear: 1950, EndYear: 1953, Aliases: []string{"6.25 War"}},
		"Pusan Perimeter":         {Parent: "Korean War"},
		"Russo-Ukrainian War":     {StartYear: 2014},
		"Second Nagorno-Karabakh": {},
		"Loop A":                  {Parent: "Loop B"},
		"Loop B":                  {Parent: "Loop A"},
		"Orphan":                  {Parent: "Missing parent"},
		"Gallic Wars":             {StartYear: -58, EndYear: -50},
	}
	want := map[string]WarSpan{
		"korean war":          {Start: 1950, End: 1953},
		"6.25 war":            {Start: 1950, End: 1953},
		"pusan perimeter":     {Start: 1950, End: 1953},
		"russo-ukrainian war": {Start: 2014},
		"gallic wars":         {Start: -58, End: -50},
	}
	if diff := cmp.Diff(want, WarSpans(wars)); diff != "" {
		t.Errorf("mismatch (-want +got):\n%s", diff)
	}
}

// TestWarSpanContains verifies the one-year tolerance and open ends.
func TestWarSpanContains(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Span       WarSpan
		Year       int
		WantResult bool
	}{{ // Test 0: Inside.
		Span: WarSpan{Start: 1950, End: 1953}, Year: 1951, WantResult: true,
	}, { // Test 1: One year before the start is a prelude.
		Span: WarSpan{Start: 1950, End: 1953}, Year: 1949, WantResult: true,
	}, { // Test 2: Two years after the end is outside.
		Span: WarSpan{Start: 1950, End: 1953}, Year: 1955,
	}, { // Test 3: Open end.
		Span: WarSpan{Start: 2014}, Year: 2026, WantResult: true,
	}, { // Test 4: Open end, far before the start.
		Span: WarSpan{Start: 2014}, Year: 1476,
	}, { // Test 5: BC span.
		Span: WarSpan{Start: -58, End: -50}, Year: -52, WantResult: true,
	}, { // Test 6: AD year against a BC span.
		Span: WarSpan{Start: -58, End: -50}, Year: 1422,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, test.Span.Contains(test.Year)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestTitleYears verifies only a year the title states as the event's own counts.
func TestTitleYears(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Title      string
		WantResult []int
	}{{ // Test 0: Parenthesized disambiguation year.
		Title: "Battle of Tagab (2012)", WantResult: []int{2012},
	}, { // Test 1: Parenthesized range takes its start.
		Title: "Defense of Jasna Góra (1770-1772)", WantResult: []int{1770},
	}, { // Test 2: Leading year.
		Title: "2019 Bagram Airfield attack", WantResult: []int{2019},
	}, { // Test 3: Year after a trailing comma.
		Title: "Kleisoura Battle, 1903", WantResult: []int{1903},
	}, { // Test 4: Year after a month name at the end.
		Title: "Actions of 7–8 May 1945", WantResult: []int{1945},
	}, { // Test 5: Year after "in" at the end.
		Title: "Occupation of Stryj by the Ukrainians in 1939", WantResult: []int{1939},
	}, { // Test 6: BC year.
		Title: "Battle of Athens 199 BCE", WantResult: []int{-199},
	}, { // Test 7: A hill number is a name.
		Title: "Battle of Hill 282",
	}, { // Test 8: An operation number is a name.
		Title: "Operation 1027",
	}, { // Test 9: No year at all.
		Title: "Battle of Jam",
	}, { // Test 10: Three-digit parenthesized year.
		Title: "Battle of Soissons (978)", WantResult: []int{978},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, titleYears(test.Title), cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestYearSourced verifies which sources make a year stand.
func TestYearSourced(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WikidataDate string
		InfoboxDate  string
		Name         string
		Title        string
		Year         int
		WantResult   bool
	}{{ // Test 0: Wikidata date.
		Year: 1709, WikidataDate: "1709-06-27", WantResult: true,
	}, { // Test 1: Infobox date names the year.
		Year: 1528, InfoboxDate: "September 24, 1528", WantResult: true,
	}, { // Test 2: Infobox date names another year.
		Year: 2026, InfoboxDate: "September 24, 1528",
	}, { // Test 3: Title year.
		Year: 2012, Name: "Battle of Tagab (2012)", WantResult: true,
	}, { // Test 4: Wikipedia title year when the name has none.
		Year: 1221, Name: "Battle of Halych", Title: "Battle of Halych (1221)", WantResult: true,
	}, { // Test 5: Title year differs from the stored year.
		Year: 2023, Name: "Battle of Tepic (1859)",
	}, { // Test 6: Nothing states the year.
		Year: 2026, Name: "Battle of Coilsfield",
	}, { // Test 7: Year 0 is never sourced.
		Year: 0, Name: "Battle of Tagab (2012)",
	}, { // Test 8: Infobox range end names the year.
		Year: 1900, InfoboxDate: "4–6 May 1900", WantResult: true,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := yearSourced(test.Year, test.WikidataDate, test.InfoboxDate, test.Name, test.Title)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// testSpanWars is the span table the war-span tests file rows by.
func testSpanWars() WarNames {
	return WarNames{Spans: map[string]WarSpan{
		"korean war":          {Start: 1950, End: 1953},
		"russo-ukrainian war": {Start: 2014},
		"iran-iraq war":       {Start: 1980, End: 1988},
		"gallic wars":         {Start: -58, End: -50},
	}}
}

// TestPlanSpanFix verifies the war-span decision for each case.
func TestPlanSpanFix(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Row        spanRow
		WantResult spanFix
		WantOK     bool
	}{{ // Test 0: Wikidata year inside the span fixes the year.
		Row: spanRow{ID: "korea-strait", Year: 2019, Date: "7 September 2019", War: "Korean War",
			WikidataDate: "1950-06-26", Precision: 11},
		WantResult: spanFix{ID: "korea-strait", Year: 1950, Date: "26 June 1950",
			Range: DateRange{Start: "1950-06-26", End: "1950-06-26"}, War: "Korean War"},
		WantOK: true,
	}, { // Test 1: Wikidata year equals the row year, so the war clears.
		Row: spanRow{ID: "valea-alba", Year: 1476, Date: "26 July 1476", DateStart: "1476-07-26",
			DateEnd: "1476-07-26", War: "Russo-Ukrainian War", WikidataDate: "1476-07-26", Precision: 11},
		WantResult: spanFix{ID: "valea-alba", Year: 1476, Date: "26 July 1476",
			Range: DateRange{Start: "1476-07-26", End: "1476-07-26"}},
		WantOK: true,
	}, { // Test 2: No Wikidata date, so nothing ties the row to the war.
		Row:        spanRow{ID: "sawran", Year: 1470, War: "Russo-Ukrainian War"},
		WantResult: spanFix{ID: "sawran", Year: 1470},
		WantOK:     true,
	}, { // Test 3: Wikidata year outside the span and not the row's year is left for a human.
		Row: spanRow{ID: "kuwait", Year: 1990, War: "Iran–Iraq War", WikidataDate: "2009-08-02", Precision: 11},
	}, { // Test 4: Inside the span.
		Row: spanRow{ID: "pusan", Year: 1950, War: "Korean War"},
	}, { // Test 5: War with no span.
		Row: spanRow{ID: "other", Year: 1200, War: "Unknown war"},
	}, { // Test 6: Undated row.
		Row: spanRow{ID: "undated", War: "Korean War"},
	}, { // Test 7: Spelling variant resolves to the span.
		Row:        spanRow{ID: "arbedo", Year: 1422, War: "the Gallic Wars", WikidataDate: "1422-06-30", Precision: 11},
		WantResult: spanFix{ID: "arbedo", Year: 1422},
		WantOK:     true,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got, ok := planSpanFix(test.Row, testSpanWars())
			if diff := cmp.Diff(test.WantOK, ok); diff != "" {
				t.Errorf("ok mismatch (-want +got):\n%s", diff)
			}
			got.Reason = ""
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// spanSeed is one battle row for the war-span and unsourced-year passes.
type spanSeed struct {
	// ID is the battle slug.
	ID string
	// Name is the display name, the ID when empty.
	Name string
	// Date is the display date.
	Date string
	// War is the stored war.
	War string
	// Source is curated or wikidata.
	Source string
	// WikidataDate is the Wikidata start.
	WikidataDate string
	// InfoboxDate is the infobox date parameter.
	InfoboxDate string
	// Year is the stored year.
	Year int
	// Verified is 1 for a hand-checked row.
	Verified int
}

// openSpanDB seeds a temp db with the rows.
func openSpanDB(t *testing.T, seeds []spanSeed) *sql.DB {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "spans.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	for _, s := range seeds {
		if s.Name == "" {
			s.Name = s.ID
		}
		prec := 0
		if s.WikidataDate != "" {
			prec = 11
		}
		if _, err := conn.ExecContext(context.Background(), `INSERT INTO battles (id, name, year, date, date_start,
			date_end, lat, lng, era, war, battle_type, victor, summary, significance, source, source_id, verified,
			wikipedia_title, wikidata_date, wikidata_precision, infobox_date)
			VALUES (?, ?, ?, ?, '', '', 0, 0, ?, ?, 'land', '', '', '', ?, '', ?, '', ?, ?, ?)`,
			s.ID, s.Name, s.Year, s.Date, yearToEra(s.Year), s.War, s.Source, s.Verified, s.WikidataDate, prec,
			s.InfoboxDate); err != nil {
			t.Fatalf("insert %s: %v", s.ID, err)
		}
	}
	return conn
}

// TestReconcileWarSpansAndUnsourcedYears runs both passes on a temp db and
// checks protected rows never change and a second run does nothing.
func TestReconcileWarSpansAndUnsourcedYears(t *testing.T) {
	t.Parallel()
	conn := openSpanDB(t, []spanSeed{
		{ID: "korea-strait", Year: 2019, Date: "7 September 2019", War: "Korean War", Source: "wikidata",
			WikidataDate: "1950-06-26"},
		{ID: "valea-alba", Year: 1476, Date: "26 July 1476", War: "Russo-Ukrainian War", Source: "wikidata",
			WikidataDate: "1476-07-26"},
		{ID: "kuwait", Year: 1990, Date: "2 August 1990", War: "Iran–Iraq War", Source: "wikidata",
			WikidataDate: "2009-08-02"},
		{ID: "verified-poltava", Year: 2009, Date: "9 March 2009", War: "Korean War", Source: "wikidata",
			Verified: 1, WikidataDate: "1709-06-27"},
		{ID: "curated-out", Year: 1476, Date: "1476", War: "Russo-Ukrainian War", Source: "curated"},
		{ID: "jam", Name: "Battle of Jam", Year: 2026, Date: "0", Source: "wikidata"},
		{ID: "tagab", Name: "Battle of Tagab (2012)", Year: 2012, Date: "", Source: "wikidata"},
		{ID: "konzoula", Year: 1839, Date: "0", Source: "wikidata", InfoboxDate: "4 October 1839"},
		{ID: "dated-unsourced", Year: 1850, Date: "1850", Source: "wikidata"},
		{ID: "verified-undated", Year: 2023, Date: "", Source: "wikidata", Verified: 1},
	})
	ctx := context.Background()
	wars := testSpanWars()
	spans, err := reconcileWarSpans(ctx, conn, wars)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(2, spans); diff != "" {
		t.Errorf("span fixes mismatch (-want +got):\n%s", diff)
	}
	zeroed, err := zeroUnsourcedYears(ctx, conn)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(1, zeroed); diff != "" {
		t.Errorf("zeroed mismatch (-want +got):\n%s", diff)
	}
	want := []string{
		"curated-out|1476|1476|Russo-Ukrainian War|medieval",
		"dated-unsourced|1850|1850||industrial",
		"jam|0|||",
		"konzoula|1839|0||industrial",
		"korea-strait|1950|26 June 1950|Korean War|cold-war",
		"kuwait|1990|2 August 1990|Iran–Iraq War|cold-war",
		"tagab|2012|||contemporary",
		"valea-alba|1476|26 July 1476||medieval",
		"verified-poltava|2009|9 March 2009|Korean War|contemporary",
		"verified-undated|2023|||contemporary",
	}
	got := queryStrings(t, conn, `SELECT id || '|' || year || '|' || date || '|' || war || '|' || era
		FROM battles ORDER BY id`)
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
	again, err := reconcileWarSpans(ctx, conn, wars)
	if err != nil {
		t.Fatal(err)
	}
	againZero, err := zeroUnsourcedYears(ctx, conn)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([2]int{0, 0}, [2]int{again, againZero}); diff != "" {
		t.Errorf("second run mismatch (-want +got):\n%s", diff)
	}
}

// TestAlignYearToDateSkipsProtected verifies poisoned prose on a verified row
// never moves its year, while the same prose on an unverified row does.
func TestAlignYearToDateSkipsProtected(t *testing.T) {
	t.Parallel()
	conn := openSpanDB(t, []spanSeed{
		{ID: "verified", Year: 1709, Date: "9 March 2009", Source: "wikidata", Verified: 1},
		{ID: "curated", Year: 1709, Date: "9 March 2009", Source: "curated"},
		{ID: "unverified", Year: 1709, Date: "9 March 2009", Source: "wikidata"},
	})
	if _, err := alignYearToDate(context.Background(), conn); err != nil {
		t.Fatal(err)
	}
	want := []string{"curated|1709", "unverified|2009", "verified|1709"}
	got := queryStrings(t, conn, `SELECT id || '|' || year FROM battles ORDER BY id`)
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
}
