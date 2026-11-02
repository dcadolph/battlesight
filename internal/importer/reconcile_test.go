package importer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

	"github.com/dcadolph/battlesight/internal/db"
)

func TestRenderWikidataDate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantDisplay string
		WantRange   DateRange
		Want        bool
		Start       string
		End         string
		StartPrec   int
		EndPrec     int
	}{{ // Test 0: Day precision on the first of a month keeps the day.
		Start: "1896-03-01", StartPrec: 11,
		WantDisplay: "1 March 1896", WantRange: DateRange{Start: "1896-03-01", End: "1896-03-01"}, Want: true,
	}, { // Test 1: Month precision.
		Start: "1896-03-01", StartPrec: 10,
		WantDisplay: "March 1896", WantRange: DateRange{Start: "1896-03-01", End: "1896-03-31"}, Want: true,
	}, { // Test 2: Year precision.
		Start: "1937-01-01", StartPrec: 9,
		WantDisplay: "1937", WantRange: DateRange{Start: "1937-12-31", End: "1937-12-31"}, Want: true,
	}, { // Test 3: BC renders as the year.
		Start: "-0044-03-15", StartPrec: 11,
		WantDisplay: "44 BC", WantRange: DateRange{Start: "-0044-12-31", End: "-0044-12-31"}, Want: true,
	}, { // Test 4: Decade precision cannot name a year.
		Start: "1890-01-01", StartPrec: 8, Want: false,
	}, { // Test 5: Garbage start.
		Start: "soon", StartPrec: 11, Want: false,
	}, { // Test 6: Day range in one month.
		Start: "1916-07-01", StartPrec: 11, End: "1916-07-03", EndPrec: 11,
		WantDisplay: "1 – 3 July 1916", WantRange: DateRange{Start: "1916-07-01", End: "1916-07-03"}, Want: true,
	}, { // Test 7: Day range across months.
		Start: "1916-07-01", StartPrec: 11, End: "1916-11-18", EndPrec: 11,
		WantDisplay: "1 July – 18 November 1916", WantRange: DateRange{Start: "1916-07-01", End: "1916-11-18"}, Want: true,
	}, { // Test 8: Month range across years ends on the real last day.
		Start: "2024-08-01", StartPrec: 10, End: "2025-02-01", EndPrec: 10,
		WantDisplay: "August 2024 – February 2025",
		WantRange:   DateRange{Start: "2024-08-01", End: "2025-02-28"}, Want: true,
	}, { // Test 9: Year range.
		Start: "1618-01-01", StartPrec: 9, End: "1648-01-01", EndPrec: 9,
		WantDisplay: "1618 – 1648", WantRange: DateRange{Start: "1618-01-01", End: "1648-12-31"}, Want: true,
	}, { // Test 10: Same month at month precision collapses to one month.
		Start: "1940-05-01", StartPrec: 10, End: "1940-05-01", EndPrec: 10,
		WantDisplay: "May 1940", WantRange: DateRange{Start: "1940-05-01", End: "1940-05-31"}, Want: true,
	}, { // Test 11: An end before the start is ignored.
		Start: "1940-05-10", StartPrec: 11, End: "1940-05-01", EndPrec: 11,
		WantDisplay: "10 May 1940", WantRange: DateRange{Start: "1940-05-10", End: "1940-05-10"}, Want: true,
	}, { // Test 12: Month to day range in one year.
		Start: "1944-06-01", StartPrec: 10, End: "1944-08-30", EndPrec: 11,
		WantDisplay: "June – 30 August 1944", WantRange: DateRange{Start: "1944-06-01", End: "1944-08-30"}, Want: true,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			display, dr, ok := renderWikidataDate(test.Start, test.StartPrec, test.End, test.EndPrec)
			if diff := cmp.Diff(test.Want, ok); diff != "" {
				t.Fatalf("ok mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantDisplay, display); diff != "" {
				t.Errorf("display mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantRange, dr, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("range mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestRenderWikidataDateParsesBack confirms every range renderWikidataDate
// stores is the range ParseDateRange reads back from its display string.
// MigrateDates reparses every date at startup, so any disagreement flips the
// row on one start and reconcile flips it back on the next.
func TestRenderWikidataDateParsesBack(t *testing.T) {
	t.Parallel()
	type point struct {
		ISO  string
		Prec int
	}
	starts := []point{{"1889-01-05", 9}, {"1889-01-05", 10}, {"1889-01-05", 11}}
	ends := []point{
		{"", 0},
		{"1889-01-20", 11}, {"1889-02-17", 9}, {"1889-02-17", 10}, {"1889-02-17", 11},
		{"1891-03-17", 9}, {"1891-03-17", 10}, {"1891-03-17", 11},
	}
	for _, s := range starts {
		for _, e := range ends {
			name := fmt.Sprintf("%s@%d to %s@%d", s.ISO, s.Prec, e.ISO, e.Prec)
			t.Run(name, func(t *testing.T) {
				t.Parallel()
				display, dr, ok := renderWikidataDate(s.ISO, s.Prec, e.ISO, e.Prec)
				if !ok {
					t.Fatalf("render failed")
				}
				if diff := cmp.Diff(dr, ParseDateRange(display, 1889)); diff != "" {
					t.Errorf("%q parses back differently (-stored +parsed):\n%s", display, diff)
				}
			})
		}
	}
}

// testReconcileRow returns an unverified wikidata row that agrees with its
// Wikidata facts, so planReconcile leaves it alone.
func testReconcileRow() reconcileRow {
	return reconcileRow{
		ID: "x", Year: 1937, Date: "4 June 1937", DateStart: "1937-06-04", DateEnd: "1937-06-04",
		Lat: 41, Lng: 128, WikidataDate: "1937-06-04", Precision: 11, InfoboxChecked: true,
	}
}

func TestPlanReconcile(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Mutate  func(r *reconcileRow)
		WantFix reconcileFix
		Want    bool
	}{{ // Test 0: A row that agrees with Wikidata does not change.
		Mutate: func(r *reconcileRow) {}, Want: false,
	}, { // Test 1: Template-poisoned year and date reset from Wikidata.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 2026, "March 2026", "2026-03-01", "2026-03-31"
		},
		WantFix: reconcileFix{Year: 1937, Date: "4 June 1937", Range: DateRange{Start: "1937-06-04", End: "1937-06-04"}},
		Want:    true,
	}, { // Test 2: A verified row keeps its year.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.Verified = 2026, "March 2026", true
		},
		Want: false,
	}, { // Test 3: A date string naming the Wikidata year is a range and passes.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.WikidataDate, r.Precision = 1863, "31 December 1862 – 2 January 1863", "1862-12-31", 11
		},
		Want: false,
	}, { // Test 4: A true first-of-month day lost to the padded-day guard comes back.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 1896, "March 1896", "1896-03-01", "1896-03-31"
			r.WikidataDate, r.Verified = "1896-03-01", true
		},
		WantFix: reconcileFix{Year: 1896, Date: "1 March 1896", Range: DateRange{Start: "1896-03-01", End: "1896-03-01"}},
		Want:    true,
	}, { // Test 5: A true 1 January day lost to the guard comes back.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 1900, "1900", "1900-12-31", "1900-12-31"
			r.WikidataDate = "1900-01-01"
		},
		WantFix: reconcileFix{Year: 1900, Date: "1 January 1900", Range: DateRange{Start: "1900-01-01", End: "1900-01-01"}},
		Want:    true,
	}, { // Test 6: A month-precision 1 January comes back as the month.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 1900, "1900", "1900-12-31", "1900-12-31"
			r.WikidataDate, r.Precision = "1900-01-01", 10
		},
		WantFix: reconcileFix{Year: 1900, Date: "January 1900", Range: DateRange{Start: "1900-01-01", End: "1900-01-31"}},
		Want:    true,
	}, { // Test 7: Month precision on the first already rendered as the month does not change.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 1896, "March 1896", "1896-03-01", "1896-03-31"
			r.WikidataDate, r.Precision = "1896-03-01", 10
		},
		Want: false,
	}, { // Test 8: A hand-edited date with the coarse text but another range is left alone.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 1896, "March 1896", "1896-03-02", "1896-03-30"
			r.WikidataDate = "1896-03-01"
		},
		Want: false,
	}, { // Test 9: A stray Ukraine war outside its region takes the Wikidata conflict.
		Mutate: func(r *reconcileRow) {
			r.War, r.Conflict = "Russo-Ukrainian War", "Second Sino-Japanese War|World War II"
		},
		WantFix: reconcileFix{Year: 1937, Date: "4 June 1937", Range: DateRange{Start: "1937-06-04", End: "1937-06-04"},
			War: "Second Sino-Japanese War"},
		Want: true,
	}, { // Test 10: No Wikidata conflict clears the stray war.
		Mutate:  func(r *reconcileRow) { r.War = "Russo-Ukrainian War" },
		WantFix: reconcileFix{Year: 1937, Date: "4 June 1937", Range: DateRange{Start: "1937-06-04", End: "1937-06-04"}},
		Want:    true,
	}, { // Test 11: Wikidata agreeing with the war keeps it, since the coordinates are the suspect.
		Mutate: func(r *reconcileRow) { r.War, r.Conflict = "Russo-Ukrainian War", "Russo-Ukrainian war" },
		Want:   false,
	}, { // Test 12: A war inside its region is kept.
		Mutate: func(r *reconcileRow) {
			r.War, r.Lat, r.Lng, r.Conflict = "Russo-Ukrainian War", 48.3, 37.2, "World War II"
		},
		Want: false,
	}, { // Test 13: Decade precision never resets the year.
		Mutate: func(r *reconcileRow) { r.WikidataDate, r.Precision = "1890-01-01", 8 },
		Want:   false,
	}, { // Test 14: A Wikidata range renders as a range.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date = 2025, "April 2025"
			r.WikidataDate, r.Precision, r.WikidataEnd, r.EndPrecision = "1916-07-01", 11, "1916-11-18", 11
		},
		WantFix: reconcileFix{Year: 1916, Date: "1 July – 18 November 1916",
			Range: DateRange{Start: "1916-07-01", End: "1916-11-18"}},
		Want: true,
	}, { // Test 15: A verified row keeps a stray war.
		Mutate: func(r *reconcileRow) { r.War, r.Verified = "Russo-Ukrainian War", true },
		Want:   false,
	}, { // Test 16: Same day and month in another year is a typo and keeps the row's date.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 1811, "17 January 1811", "1811-01-17", "1811-01-17"
			r.WikidataDate = "2000-01-17"
		},
		Want: false,
	}, { // Test 17: The infobox names the row's year, so the article disputes Wikidata and wins.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.InfoboxDate = 316, "AD 316", "8 October 316"
			r.WikidataDate = "0314-10-08"
		},
		Want: false,
	}, { // Test 18: The infobox names the Wikidata year, so the template year resets.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 2026, "March 2026", "2026-03-01", "2026-03-31"
			r.InfoboxDate = "{{Start date|1937|6|4|df=y}}"
		},
		WantFix: reconcileFix{Year: 1937, Date: "4 June 1937", Range: DateRange{Start: "1937-06-04", End: "1937-06-04"}},
		Want:    true,
	}, { // Test 19: Before the infobox is read the year is not reset.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 2026, "March 2026", "2026-03-01", "2026-03-31"
			r.InfoboxChecked = false
		},
		Want: false,
	}, { // Test 20: An infobox naming a third year is a dispute and the row stays.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 1731, "1731", "1731-12-31", "1731-12-31"
			r.WikidataDate, r.Precision, r.InfoboxDate = "1142-01-01", 9, "{{circa}} 1732"
		},
		Want: false,
	}, { // Test 21: An infobox naming no year backs Wikidata.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 2026, "March 2026", "2026-03-01", "2026-03-31"
			r.InfoboxDate = "Spring"
		},
		WantFix: reconcileFix{Year: 1937, Date: "4 June 1937", Range: DateRange{Start: "1937-06-04", End: "1937-06-04"}},
		Want:    true,
	}, { // Test 22: A start lost to the padded-day guard comes back with its Wikidata end.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 1916, "June 1916", "1916-06-01", "1916-06-30"
			r.WikidataDate, r.WikidataEnd, r.EndPrecision = "1916-06-01", "1916-06-07", 11
		},
		WantFix: reconcileFix{Year: 1916, Date: "1 – 7 June 1916", Range: DateRange{Start: "1916-06-01", End: "1916-06-07"}},
		Want:    true,
	}, { // Test 23: An infobox naming both years is ambiguous and the row stays.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = -165, "165 BC", "-0165-12-31", "-0165-12-31"
			r.WikidataDate, r.Precision, r.InfoboxDate = "-0166-01-01", 9, "166 BC or 165 BC"
		},
		Want: false,
	}, { // Test 24: No Wikidata date, the infobox year replaces a template year.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 2026, "0", "2026-12-31", "2026-12-31"
			r.WikidataDate, r.Precision, r.InfoboxDate = "", 0, "{{Start date|1941|10|20|df=y}}"
		},
		WantFix: reconcileFix{Year: 1941, Date: "20 October 1941", Range: DateRange{Start: "1941-10-20", End: "1941-10-20"}},
		Want:    true,
	}, { // Test 25: No Wikidata date, the infobox fills a missing date for the same year.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd = 1943, "0", "1943-12-31", "1943-12-31"
			r.WikidataDate, r.Precision, r.InfoboxDate = "", 0, "{{start and end dates|1943|5|15|1943|5|19|df=y}}"
		},
		WantFix: reconcileFix{Year: 1943, Date: "15 – 19 May 1943",
			Range: DateRange{Start: "1943-05-15", End: "1943-05-19"}},
		Want: true,
	}, { // Test 26: No Wikidata date and no infobox year leaves the row.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.WikidataDate, r.Precision, r.InfoboxDate = 2026, "0", "", 0, "unknown"
		},
		Want: false,
	}, { // Test 27: No Wikidata date and an infobox naming the row's year keeps it.
		Mutate: func(r *reconcileRow) {
			r.Year, r.Date, r.WikidataDate, r.Precision, r.InfoboxDate = 1732, "c. 1732", "", 0, "c. 1731 or 1732"
		},
		Want: false,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			r := testReconcileRow()
			test.Mutate(&r)
			fix, ok := planReconcile(r)
			if diff := cmp.Diff(test.Want, ok); diff != "" {
				t.Fatalf("changed mismatch (-want +got):\n%s", diff)
			}
			if !ok {
				return
			}
			fix.Reasons = nil
			if diff := cmp.Diff(test.WantFix, fix); diff != "" {
				t.Errorf("fix mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestPaddedISO(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantISO string
		Want    bool
		In      string
	}{
		{In: "+1896-03-01T00:00:00Z", WantISO: "1896-03-01", Want: true},  // Test 0: Day.
		{In: "+1937-00-00T00:00:00Z", WantISO: "1937-01-01", Want: true},  // Test 1: Year with zero month and day.
		{In: "-0044-03-15T00:00:00Z", WantISO: "-0044-03-15", Want: true}, // Test 2: BC.
		{In: "+0939-08-00T00:00:00Z", WantISO: "0939-08-01", Want: true},  // Test 3: Month with zero day.
		{In: "1896-03-01T00:00:00Z", Want: false},                         // Test 4: No sign.
		{In: "+0000-00-00T00:00:00Z", Want: false},                        // Test 5: Year zero.
		{In: "", Want: false}, // Test 6: Empty.
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got, ok := paddedISO(test.In)
			if diff := cmp.Diff(test.Want, ok); diff != "" {
				t.Fatalf("ok mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantISO, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestSPARQLISODate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantISO string
		In      string
	}{
		{In: "1896-03-01T00:00:00Z", WantISO: "1896-03-01"},                 // Test 0: Plain literal.
		{In: "-0043-03-15T00:00:00Z", WantISO: "-0044-03-15"},               // Test 1: Astronomical -43 is 44 BC.
		{In: "http://www.wikidata.org/.well-known/genid/9794", WantISO: ""}, // Test 2: Unknown value.
		{In: "", WantISO: ""},                                // Test 3: Empty.
		{In: "0000-06-01T00:00:00Z", WantISO: "-0001-06-01"}, // Test 4: Astronomical year zero is 1 BC.
		{In: "garbage", WantISO: ""},                         // Test 5: Not a date.
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantISO, sparqlISODate(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// testClaims decodes a claims map written as JSON.
func testClaims(t *testing.T, raw string) map[string][]wikidataClaim {
	t.Helper()
	var c map[string][]wikidataClaim
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		t.Fatalf("decode claims: %v", err)
	}
	return c
}

func TestFactsFromClaims(t *testing.T) {
	t.Parallel()
	timeClaim := func(rank, tm string, prec int) string {
		return fmt.Sprintf(`{"rank":%q,"mainsnak":{"snaktype":"value","datavalue":{"value":{"time":%q,"precision":%d}}}}`,
			rank, tm, prec)
	}
	itemClaim := func(rank, id string) string {
		return fmt.Sprintf(`{"rank":%q,"mainsnak":{"snaktype":"value","datavalue":{"value":{"id":%q}}}}`, rank, id)
	}
	tests := []struct {
		WantFacts wikidataFacts
		Claims    string
	}{{ // Test 0: Point in time wins over start time and ignores the end.
		Claims: `{"P585":[` + timeClaim("normal", "+1896-03-01T00:00:00Z", 11) + `],` +
			`"P580":[` + timeClaim("normal", "+1895-01-01T00:00:00Z", 9) + `],` +
			`"P582":[` + timeClaim("normal", "+1897-01-01T00:00:00Z", 9) + `]}`,
		WantFacts: wikidataFacts{Date: "1896-03-01", Precision: 11},
	}, { // Test 1: Start and end when there is no point in time.
		Claims: `{"P580":[` + timeClaim("normal", "+1916-07-01T00:00:00Z", 11) + `],` +
			`"P582":[` + timeClaim("normal", "+1916-11-18T00:00:00Z", 11) + `]}`,
		WantFacts: wikidataFacts{Date: "1916-07-01", Precision: 11, End: "1916-11-18", EndPrecision: 11},
	}, { // Test 2: Preferred rank wins and deprecated is dropped.
		Claims: `{"P585":[` + timeClaim("deprecated", "+2026-03-01T00:00:00Z", 10) + `,` +
			timeClaim("normal", "+1936-01-01T00:00:00Z", 9) + `,` +
			timeClaim("preferred", "+1937-06-04T00:00:00Z", 11) + `],` +
			`"P607":[` + itemClaim("normal", "Q1") + `,` + itemClaim("preferred", "Q2") + `],` +
			`"P31":[` + itemClaim("normal", "Q178561") + `]}`,
		WantFacts: wikidataFacts{Date: "1937-06-04", Precision: 11, Conflicts: []string{"Q2", "Q1"},
			Instances: []string{"Q178561"}},
	}, { // Test 3: Unknown value snaks carry no date.
		Claims:    `{"P585":[{"rank":"normal","mainsnak":{"snaktype":"somevalue"}}]}`,
		WantFacts: wikidataFacts{},
	}, { // Test 4: A decade point in time yields to a dated start and end.
		Claims: `{"P585":[` + timeClaim("normal", "+2020-00-00T00:00:00Z", 8) + `],` +
			`"P580":[` + timeClaim("normal", "+2022-00-00T00:00:00Z", 9) + `],` +
			`"P582":[` + timeClaim("normal", "+2023-12-00T00:00:00Z", 10) + `]}`,
		WantFacts: wikidataFacts{Date: "2022-01-01", Precision: 9, End: "2023-12-01", EndPrecision: 10},
	}, { // Test 5: A decade point in time stays when the start is no finer.
		Claims: `{"P585":[` + timeClaim("normal", "+1950-00-00T00:00:00Z", 8) + `],` +
			`"P580":[` + timeClaim("normal", "+1940-00-00T00:00:00Z", 8) + `]}`,
		WantFacts: wikidataFacts{Date: "1950-01-01", Precision: 8},
	}, { // Test 6: A decade point in time with no start stays.
		Claims:    `{"P585":[` + timeClaim("normal", "+1820-00-00T00:00:00Z", 8) + `]}`,
		WantFacts: wikidataFacts{Date: "1820-01-01", Precision: 8},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := factsFromClaims(testClaims(t, test.Claims))
			if diff := cmp.Diff(test.WantFacts, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestSPARQLYear(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantYear int
		In       string
	}{
		{In: "1757-06-23T00:00:00Z", WantYear: 1757},  // Test 0: AD.
		{In: "-0404-01-01T00:00:00Z", WantYear: -405}, // Test 1: Aegospotami, 405 BC.
		{In: "0000-01-01T00:00:00Z", WantYear: -1},    // Test 2: Year zero.
		{In: "", WantYear: 0},                         // Test 3: Empty.
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantYear, sparqlYear(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestInfoboxField(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantDate string
		In       string
	}{{ // Test 0: Date with a reference and a comment.
		In: "{{Infobox military conflict\n| conflict = X\n| date = 4 June 1937<ref>Smith</ref> <!-- check -->\n" +
			"| place = Pochonbo\n}}",
		WantDate: "4 June 1937",
	}, { // Test 1: A start date template keeps its digits.
		In:       "{{Infobox military conflict\n| date = {{Start date|1444|11|10|df=y}}\n}}",
		WantDate: "{{Start date|1444|11|10|df=y}}",
	}, { // Test 2: No infobox.
		In: "Battle text {{One source|date=October 2025}}", WantDate: "",
	}, { // Test 3: Infobox without a date.
		In: "{{Infobox military conflict\n| place = X\n}}", WantDate: "",
	}, { // Test 4: An empty date never reads the next parameter as its value.
		In: "{{Infobox military conflict\n| date =\n| place = Kidodi\n}}", WantDate: "",
	}, { // Test 5: A one-line infobox.
		In: "{{Infobox military conflict | conflict = Battle of X | date = 3 May 1802 | place = Y }}", WantDate: "3 May 1802",
	}, { // Test 6: A nested template closing on its own line before the date, Battle of Katasin.
		In: "{{Infobox military conflict\n| conflict = Battle of Katasin\n| image = {{Location map|India West Bengal\n" +
			"|width = 280\n|label = \n}}\n| date = 1243 AD\n| place = [[Contai]]\n}}",
		WantDate: "1243 AD",
	}, { // Test 7: The bare Battle template, Battle of Livny.
		In:       "{{Battle\n| conflict = Battle of Livny\n| place = [[Livny]]\n| date = [[7 July]] [[1618]]\n}}",
		WantDate: "[[7 July]] [[1618]]",
	}, { // Test 8: A cite template's own date never stands in for the field, Battle of Korea Strait.
		In: "{{Infobox military conflict\n| conflict = Battle of Korea Strait\n| strength1 = 1 steamer<ref name=\"a\">" +
			"{{cite web \n|date = 7 September 2019\n|publisher= X}}</ref>\n| date = 25–26 June 1950\n}}",
		WantDate: "25–26 June 1950",
	}, { // Test 9: A cite template's date with no infobox date stays empty.
		In: "{{Infobox military conflict\n| strength1 = 1 steamer<ref>{{cite web\n" +
			"|date = 7 September 2019}}</ref>\n}}",
		WantDate: "",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantDate, infoboxField(test.In, "date")); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestInfoboxDateProse(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantDisplay string
		WantStart   string
		WantYear    int
		Want        bool
		In          string
	}{{ // Test 0: Open template cut off.
		In: "9–12 December 1945{{cite web", WantDisplay: "9 – 12 December 1945", WantYear: 1945, Want: true,
	}, { // Test 1: Stray closers.
		In:          "8 September 1681 – 3 March 1707 )}}",
		WantDisplay: "8 September 1681 – 3 March 1707", WantYear: 1681, Want: true,
	}, { // Test 2: Dash template.
		In:          "16 October 1934{{snd}}19 October 1935",
		WantDisplay: "16 October 1934 – 19 October 1935", WantYear: 1934, Want: true,
	}, { // Test 3: Start date.
		In: "{{Start date|1444|11|10|df=y}}", WantDisplay: "10 November 1444", WantYear: 1444, Want: true,
	}, { // Test 4: Month only.
		In: "{{start date|1916|10}}", WantDisplay: "October 1916", WantYear: 1916, Want: true,
	}, { // Test 5: BC.
		In: "c. 1100 BC", WantDisplay: "c. 1100 BC", WantYear: -1100, Want: true,
	}, { // Test 6: No year.
		In: "Unknown", Want: false,
	}, { // Test 7: Empty.
		In: "", Want: false,
	}, { // Test 8: Year to day range starts in the first year.
		In: "1591 – 3 January 1594", WantDisplay: "1591 – 3 January 1594", WantStart: "1591-01-01", WantYear: 1591,
		Want: true,
	}, { // Test 9: ISO date template, Dongshan.
		In: "{{date|1965-8-6}}", WantDisplay: "6 August 1965", WantStart: "1965-08-06", WantYear: 1965, Want: true,
	}, { // Test 10: Date range with named parameters, Insein.
		In: "{{Date range and age in years, months, weeks and days|month1=1|day1=30|year1=1949|" +
			"month2=5|day2=21|year2=1949|df=yes}}",
		WantDisplay: "30 January 1949 – 21 May 1949", WantStart: "1949-01-30", WantYear: 1949, Want: true,
	}, { // Test 11: Date range with positional parameters.
		In:          "{{Date range and age in years, months, weeks and days|df=y|1941|5|7|1941|5|27}}",
		WantDisplay: "7 – 27 May 1941", WantStart: "1941-05-07", WantYear: 1941, Want: true,
	}, { // Test 12: An age template after the prose is not repeated.
		In: "24 December 1941 – 15 January 1942 <br> ({{Age in years, months, weeks and days|month1=12|day1=24|" +
			"year1=1941|month2=01|day2=15|year2=1942}})",
		WantDisplay: "24 December 1941 – 15 January 1942", WantStart: "1941-12-24", WantYear: 1941, Want: true,
	}, { // Test 13: Old style date keeps the new style day and the year, Battle of the Zolota Lypa.
		In:          "{{OldStyleDate|26–28 August|1914|13–15 August}}",
		WantDisplay: "26 – 28 August 1914", WantStart: "1914-08-26", WantYear: 1914, Want: true,
	}, { // Test 14: A list of dates with labels, Battles of Tilton.
		In:          "{{ublist|\n{{Start date|1864|5|13}} (first)|{{End date|1864|10|13}} (second)}}",
		WantDisplay: "13 May 1864 – 13 October 1864", WantStart: "1864-05-13", WantYear: 1864, Want: true,
	}, { // Test 15: A bulleted plain list.
		In:          "{{plainlist|\n* 4 June 1937\n* 5 June 1937}}",
		WantDisplay: "4 June 1937 – 5 June 1937", WantStart: "1937-06-04", WantYear: 1937, Want: true,
	}, { // Test 16: A formatting wrapper keeps its text.
		In: "{{nowrap|4 June 1937}}", WantDisplay: "4 June 1937", WantStart: "1937-06-04", WantYear: 1937, Want: true,
	}, { // Test 17: A citation template still drops.
		In: "1 May 1802{{sfn|Smith|2001|p=4}}", WantDisplay: "1 May 1802", WantStart: "1802-05-01", WantYear: 1802, Want: true,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			display, dr, year, ok := infoboxDateProse(test.In)
			if ok && test.WantStart != "" {
				if diff := cmp.Diff(test.WantStart, dr.Start); diff != "" {
					t.Errorf("start mismatch (-want +got):\n%s", diff)
				}
			}
			if diff := cmp.Diff(test.Want, ok); diff != "" {
				t.Fatalf("ok mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantDisplay, display); diff != "" {
				t.Errorf("display mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantYear, year); diff != "" {
				t.Errorf("year mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestJoinLabels(t *testing.T) {
	t.Parallel()
	got := joinLabels([]string{"Q1", "Q2"}, map[string]string{"Q1": "World War II"})
	if diff := cmp.Diff("World War II|Q2", got); diff != "" {
		t.Errorf("mismatch (-want +got):\n%s", diff)
	}
}

// TestReconcileSourceDates runs the pass on a temp db. A poisoned row comes back
// to Wikidata, a row with no Wikidata check and a curated row stay as they are.
func TestReconcileSourceDates(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	conn, err := db.Open(filepath.Join(t.TempDir(), "reconcile.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer conn.Close()
	insert := `INSERT INTO battles (id, name, year, date, date_start, date_end, lat, lng, era, war, battle_type,
		victor, summary, significance, source, source_id, verified, wikidata_date, wikidata_precision,
		wikidata_conflict, wikidata_checked, infobox_checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'land', '', '',
		'', ?, ?, 0, ?, ?, ?, ?, ?)`
	rows := [][]any{
		{"pochonbo", "Battle of Pochonbo", 2026, "March 2026", "2026-03-01", "2026-03-31", 41.1, 128.2,
			"contemporary", "Russo-Ukrainian War", "wikidata", "Q1", "1937-06-04", 11, "Second Sino-Japanese War",
			"2026-11-01", "2026-11-01"},
		{"unchecked", "Battle of Unchecked", 1999, "1999", "1999-12-31", "1999-12-31", 41.1, 128.2,
			"contemporary", "", "wikidata", "Q2", "1937-06-04", 0, "", "", ""},
		{"curated", "Battle of Curated", 1999, "1999", "1999-12-31", "1999-12-31", 41.1, 128.2,
			"contemporary", "", "curated", "", "1937-06-04", 11, "", "2026-11-01", "2026-11-01"},
	}
	for _, r := range rows {
		if _, err := conn.ExecContext(ctx, insert, r...); err != nil {
			t.Fatalf("insert %v: %v", r[0], err)
		}
	}
	n, err := reconcileSourceDates(ctx, conn)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if diff := cmp.Diff(1, n); diff != "" {
		t.Errorf("count mismatch (-want +got):\n%s", diff)
	}
	type got struct {
		ID, Date, Start, End, Era, War string
		Year                           int
	}
	want := []got{
		{ID: "curated", Year: 1999, Date: "1999", Start: "1999-12-31", End: "1999-12-31", Era: "contemporary"},
		{ID: "pochonbo", Year: 1937, Date: "4 June 1937", Start: "1937-06-04", End: "1937-06-04", Era: "interwar",
			War: "Second Sino-Japanese War"},
		{ID: "unchecked", Year: 1999, Date: "1999", Start: "1999-12-31", End: "1999-12-31", Era: "contemporary"},
	}
	res, err := conn.QueryContext(ctx, `SELECT id, year, date, date_start, date_end, era, war FROM battles ORDER BY id`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer res.Close()
	var have []got
	for res.Next() {
		var g got
		if err := res.Scan(&g.ID, &g.Year, &g.Date, &g.Start, &g.End, &g.Era, &g.War); err != nil {
			t.Fatalf("scan: %v", err)
		}
		have = append(have, g)
	}
	if diff := cmp.Diff(want, have); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
	if n, err := reconcileSourceDates(ctx, conn); err != nil || n != 0 {
		t.Errorf("second pass changed %d rows, err %v, want 0 and nil", n, err)
	}
}

// testWikidataServer serves wbgetentities from handle and counts calls.
func testWikidataServer(t *testing.T, handle func(w http.ResponseWriter, ids []string)) (string, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		handle(w, strings.Split(r.URL.Query().Get("ids"), "|"))
	}))
	t.Cleanup(srv.Close)
	return srv.URL, &calls
}

func TestFetchWikidataEntities(t *testing.T) {
	t.Parallel()
	entity := func(id string) string { return fmt.Sprintf(`%q:{"id":%q,"labels":{"en":{"value":"L%s"}}}`, id, id, id) }
	tests := []struct {
		Handle    func(w http.ResponseWriter, ids []string)
		WantIDs   []string
		WantCalls int32
		Want      error
		WantErr   bool
	}{{ // Test 0: Plain batch.
		Handle: func(w http.ResponseWriter, ids []string) {
			parts := make([]string, 0, len(ids))
			for _, id := range ids {
				parts = append(parts, entity(id))
			}
			fmt.Fprintf(w, `{"entities":{%s}}`, strings.Join(parts, ","))
		},
		WantIDs: []string{"Q1", "Q2", "Q3"}, WantCalls: 1,
	}, { // Test 1: A deleted id fails the call, is dropped, and the rest come back.
		Handle: func(w http.ResponseWriter, ids []string) {
			if slices.Contains(ids, "Q2") {
				fmt.Fprint(w, `{"error":{"code":"no-such-entity","info":"gone","id":"Q2"}}`)
				return
			}
			fmt.Fprintf(w, `{"entities":{%s,%s}}`, entity("Q1"), entity("Q3"))
		},
		WantIDs: []string{"Q1", "Q3"}, WantCalls: 2,
	}, { // Test 2: A redirected id lands under the id that was asked for.
		Handle: func(w http.ResponseWriter, ids []string) {
			fmt.Fprintf(w, `{"entities":{%s,%s,"Q9":{"id":"Q9","redirects":{"from":"Q2","to":"Q9"}}}}`,
				entity("Q1"), entity("Q3"))
		},
		WantIDs: []string{"Q1", "Q2", "Q3"}, WantCalls: 1,
	}, { // Test 3: Busy twice is ErrWikidataBusy.
		Handle: func(w http.ResponseWriter, ids []string) {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
		},
		Want: ErrWikidataBusy, WantErr: true, WantCalls: 2,
	}, { // Test 4: Any other API error fails.
		Handle: func(w http.ResponseWriter, ids []string) {
			fmt.Fprint(w, `{"error":{"code":"param-invalid","info":"bad"}}`)
		},
		WantErr: true, WantCalls: 1,
	}, { // Test 5: A server error fails.
		Handle:  func(w http.ResponseWriter, ids []string) { w.WriteHeader(http.StatusBadGateway) },
		WantErr: true, WantCalls: 1,
	}, { // Test 6: Every id deleted yields an empty result.
		Handle: func(w http.ResponseWriter, ids []string) {
			fmt.Fprintf(w, `{"error":{"code":"no-such-entity","info":"gone","id":%q}}`, ids[0])
		},
		WantIDs: nil, WantCalls: 3,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			api, calls := testWikidataServer(t, test.Handle)
			got, err := fetchWikidataEntities(context.Background(), api, []string{"Q1", "Q2", "Q3"}, "labels")
			if (err != nil) != test.WantErr {
				t.Fatalf("err %v, want error %v", err, test.WantErr)
			}
			if test.Want != nil && !errors.Is(err, test.Want) {
				t.Errorf("err %v, want %v", err, test.Want)
			}
			if diff := cmp.Diff(test.WantCalls, calls.Load()); diff != "" {
				t.Errorf("calls mismatch (-want +got):\n%s", diff)
			}
			ids := slices.Sorted(maps.Keys(got))
			if diff := cmp.Diff(test.WantIDs, ids, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("ids mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
