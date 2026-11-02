package importer

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/dcadolph/battlesight/internal/db"
)

// TestNormalizeDateString pins the canonical date display form against
// every messy shape the database currently holds. Order matters:
//
//   - trailing empty parens dropped
//   - US "Month D, YYYY" rewrites to UK "D Month YYYY"
//   - hyphen / em-dash range separator becomes " – " (en-dash + spaces)
//   - slash day range becomes en-dash day range
//   - compound "First battle: …, Second battle: …" keeps the first only
//
// The transform must be idempotent: feeding the canonical form back in
// returns the same string unchanged.
func TestNormalizeDateString(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name string
		In   string
		Want string
	}{
		// Test 0: trailing empty parens get scrubbed.
		{
			Name: "trailing_empty_parens",
			In:   "5 March 1944 – 24 September 1944 ()",
			Want: "5 March 1944 – 24 September 1944",
		},
		// Test 1: US "Month D, YYYY" rewrites to UK form.
		{
			Name: "us_to_uk_single",
			In:   "September 1, 1939",
			Want: "1 September 1939",
		},
		// Test 2: US cross-month range to UK form.
		{
			Name: "us_to_uk_cross_month",
			In:   "July 24 – August 4, 1944",
			Want: "24 July – 4 August 1944",
		},
		// Test 3: US same-month range to UK form.
		{
			Name: "us_to_uk_same_month",
			In:   "September 1 – 3, 1939",
			Want: "1 – 3 September 1939",
		},
		// Test 4: hyphen separator becomes en-dash with spaces.
		{
			Name: "hyphen_to_endash",
			In:   "30 January-1 February 1945",
			Want: "30 January – 1 February 1945",
		},
		// Test 5: slash day range to en-dash day range.
		{
			Name: "slash_to_endash",
			In:   "27/28 September 1941",
			Want: "27 – 28 September 1941",
		},
		// Test 6: compound engagement keeps first segment.
		{
			Name: "compound_engagement",
			In:   "First battle: 13–16 December 1944 , Second battle: 30 January-1 February 1945",
			Want: "13 – 16 December 1944",
		},
		// Test 7: already-canonical form unchanged (idempotency).
		{
			Name: "already_canonical_range",
			In:   "23 August 1942 – 2 February 1943",
			Want: "23 August 1942 – 2 February 1943",
		},
		// Test 8: already-canonical single date unchanged.
		{
			Name: "already_canonical_single",
			In:   "6 June 1944",
			Want: "6 June 1944",
		},
		// Test 9: empty input passes through.
		{
			Name: "empty",
			In:   "",
			Want: "",
		},
		// Test 10: BC year-only kept intact, no fake en-dash inserted.
		{
			Name: "bc_simple",
			In:   "490 BC",
			Want: "490 BC",
		},
		// Test 11: bare ISO date renders as prose.
		{
			Name: "iso_day",
			In:   "2023-10-04",
			Want: "4 October 2023",
		},
		// Test 12: en-dash mangled ISO date renders as prose.
		{
			Name: "iso_day_mangled",
			In:   "2023 – 10 – 04",
			Want: "4 October 2023",
		},
		// Test 13: mangled ISO range across months renders as one prose range.
		{
			Name: "iso_range_mangled",
			In:   "1939 – 09 – 01 to 1939 – 10 – 06",
			Want: "1 September – 6 October 1939",
		},
		// Test 14: prose range with the year written once is left alone.
		{
			Name: "prose_range_unchanged",
			In:   "1 – 6 September 1939",
			Want: "1 – 6 September 1939",
		},
		// Test 15: a year range is not mistaken for an ISO month.
		{
			Name: "year_range_unchanged",
			In:   "1939-1945",
			Want: "1939 – 1945",
		},
		// Test 16: BC range keeps its form.
		{
			Name: "bc_range",
			In:   "264-241 BC",
			Want: "264 – 241 BC",
		},
	}
	for _, test := range tests {
		t.Run(test.Name, func(t *testing.T) {
			t.Parallel()
			got := normalizeDateString(test.In)
			if got != test.Want {
				t.Errorf("\n  in:   %q\n  want: %q\n  got:  %q", test.In, test.Want, got)
			}
		})
	}
}

// TestCanonicalISODate pins ISO rendering, the Wikidata precision guard, and
// the inputs that must not be read as ISO.
func TestCanonicalISODate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantDisplay string
		WantRange   DateRange
		In          string
		Coarse      bool
		WantOK      bool
	}{{ // Test 0: Day-precision ISO date.
		In: "2023-10-04", WantDisplay: "4 October 2023",
		WantRange: DateRange{Start: "2023-10-04", End: "2023-10-04"}, WantOK: true,
	}, { // Test 1: Mangled ISO date under the guard keeps a real day.
		In: "2023 – 10 – 04", Coarse: true, WantDisplay: "4 October 2023",
		WantRange: DateRange{Start: "2023-10-04", End: "2023-10-04"}, WantOK: true,
	}, { // Test 2: 1 January under the guard is a year-precision value.
		In: "0043 – 01 – 01", Coarse: true, WantDisplay: "43",
		WantRange: DateRange{Start: "0043-12-31", End: "0043-12-31"}, WantOK: true,
	}, { // Test 3: First of the month under the guard is a month-precision value.
		In: "2022 – 05 – 01", Coarse: true, WantDisplay: "May 2022",
		WantRange: DateRange{Start: "2022-05-01", End: "2022-05-28"}, WantOK: true,
	}, { // Test 4: Without the guard 1 January is a real day.
		In: "1945-01-01", WantDisplay: "1 January 1945",
		WantRange: DateRange{Start: "1945-01-01", End: "1945-01-01"}, WantOK: true,
	}, { // Test 5: Same-month ISO range.
		In: "2024-04-13 to 2024-04-14", WantDisplay: "13 – 14 April 2024",
		WantRange: DateRange{Start: "2024-04-13", End: "2024-04-14"}, WantOK: true,
	}, { // Test 6: Cross-year ISO range ignores the guard.
		In: "2024 – 10 – 06 to 2025 – 01 – 01", Coarse: true,
		WantDisplay: "6 October 2024 – 1 January 2025",
		WantRange:   DateRange{Start: "2024-10-06", End: "2025-01-01"}, WantOK: true,
	}, { // Test 7: Identical ends collapse to one date.
		In: "1950-06-25 to 1950-06-25", WantDisplay: "25 June 1950",
		WantRange: DateRange{Start: "1950-06-25", End: "1950-06-25"}, WantOK: true,
	}, { // Test 8: Month out of range is not ISO.
		In: "2023-13-01",
	}, { // Test 9: Inverted range is not ISO.
		In: "2024-05-06 to 2024-01-01",
	}, { // Test 10: Year range is not ISO.
		In: "1939 – 1945",
	}, { // Test 11: Prose date is not ISO.
		In: "4 October 2023",
	}, { // Test 12: Year zero is not ISO.
		In: "0000-01-01",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			display, dr, ok := canonicalISODate(test.In, test.Coarse)
			if ok != test.WantOK {
				t.Fatalf("ok = %v, want %v", ok, test.WantOK)
			}
			if diff := cmp.Diff(test.WantDisplay, display); diff != "" {
				t.Errorf("display mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantRange, dr); diff != "" {
				t.Errorf("range mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestCanoniseDateStrings runs the pass on a temp db and pins the rewritten
// date and range per row, including rows that must not change.
func TestCanoniseDateStrings(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	conn, err := db.Open(filepath.Join(t.TempDir(), "dates.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	insert := `INSERT INTO battles (id, name, year, date, date_start, date_end, lat, lng, era, war,
		battle_type, victor, summary, significance, source) VALUES
		('taoussa', 'Attack on Taoussa', 2023, '2023 – 10 – 04', '2023-12-31', '2023-12-31', 0, 0,
			'contemporary', '', 'land', '', '', '', 'wikidata'),
		('roman', 'Roman raid', 43, '0043 – 01 – 01', '0043-12-31', '0043-12-31', 0, 0,
			'ancient', '', 'land', '', '', '', 'wikidata'),
		('month', 'Month battle', 2022, '2022 – 05 – 01', '2022-12-31', '2022-12-31', 0, 0,
			'contemporary', '', 'land', '', '', '', 'wikidata'),
		('poland', 'Invasion of Poland', 1939, '1939 – 09 – 01 to 1939 – 10 – 06', '1939-12-31',
			'1939-12-31', 0, 0, 'ww2', '', 'land', '', '', '', 'curated'),
		('newyear', 'New Year battle', 1945, '1945 – 01 – 01', '1945-12-31', '1945-12-31', 0, 0,
			'ww2', '', 'land', '', '', '', 'curated'),
		('us', 'US form', 1939, 'September 1, 1939', '1939-09-01', '1939-09-01', 0, 0,
			'ww2', '', 'land', '', '', '', 'wikidata'),
		('prose', 'Prose range', 1942, '23 August 1942 – 2 February 1943', '1942-08-23',
			'1943-02-02', 0, 0, 'ww2', '', 'land', '', '', '', 'wikidata'),
		('bc', 'BC battle', -490, '490 BC', '-0490-12-31', '-0490-12-31', 0, 0,
			'ancient', '', 'land', '', '', '', 'wikidata')`
	if _, err := conn.ExecContext(ctx, insert); err != nil {
		t.Fatalf("insert battles: %v", err)
	}
	n, err := canoniseDateStrings(ctx, conn)
	if err != nil {
		t.Fatalf("canonise: %v", err)
	}
	if diff := cmp.Diff(6, n); diff != "" {
		t.Errorf("rewritten count mismatch (-want +got):\n%s", diff)
	}
	again, err := canoniseDateStrings(ctx, conn)
	if err != nil {
		t.Fatalf("canonise second pass: %v", err)
	}
	if diff := cmp.Diff(0, again); diff != "" {
		t.Errorf("second pass not idempotent (-want +got):\n%s", diff)
	}
	rows, err := conn.QueryContext(ctx,
		`SELECT id, date, date_start, date_end FROM battles ORDER BY id`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	got := map[string][3]string{}
	for rows.Next() {
		var id, date, start, end string
		if err := rows.Scan(&id, &date, &start, &end); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got[id] = [3]string{date, start, end}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate: %v", err)
	}
	want := map[string][3]string{
		"taoussa": {"4 October 2023", "2023-10-04", "2023-10-04"},
		"roman":   {"43", "0043-12-31", "0043-12-31"},
		"month":   {"May 2022", "2022-05-01", "2022-05-28"},
		"poland":  {"1 September – 6 October 1939", "1939-09-01", "1939-10-06"},
		"newyear": {"1 January 1945", "1945-01-01", "1945-01-01"},
		"us":      {"1 September 1939", "1939-09-01", "1939-09-01"},
		"prose":   {"23 August 1942 – 2 February 1943", "1942-08-23", "1943-02-02"},
		"bc":      {"490 BC", "-0490-12-31", "-0490-12-31"},
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
}
