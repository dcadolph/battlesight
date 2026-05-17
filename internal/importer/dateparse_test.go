package importer

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// TestParseDateRange covers the date string formats that appear in
// Wikipedia infoboxes and Wikidata exports.
func TestParseDateRange(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name string
		In   string
		Year int
		Want DateRange
	}{
		{Name: "iso single", In: "1939-09-01", Want: DateRange{Start: "1939-09-01", End: "1939-09-01"}},
		{Name: "dmy", In: "14 July 1864", Want: DateRange{Start: "1864-07-14", End: "1864-07-14"}},
		{Name: "mdy with comma", In: "July 14, 1864", Want: DateRange{Start: "1864-07-14", End: "1864-07-14"}},
		{Name: "day range mdy", In: "July 14-15, 1864", Want: DateRange{Start: "1864-07-14", End: "1864-07-15"}},
		{Name: "full range with en-dash", In: "10 July 1940 – 31 October 1940", Want: DateRange{Start: "1940-07-10", End: "1940-10-31"}},
		{Name: "month-year only", In: "September 1939", Want: DateRange{Start: "1939-09-01", End: "1939-09-28"}},
		{Name: "year only", In: "1939", Want: DateRange{Start: "1939-12-31", End: "1939-12-31"}},
		{Name: "bc year", In: "490 BC", Want: DateRange{Start: "-0490-12-31", End: "-0490-12-31"}},
		{Name: "empty falls back", In: "", Year: 1815, Want: DateRange{Start: "1815-12-31", End: "1815-12-31"}},
		{Name: "garbage falls back", In: "{{cite}}", Year: 1066, Want: DateRange{Start: "1066-12-31", End: "1066-12-31"}},
		// Formats actually used in the curated set.
		{Name: "hyphen day range", In: "11-15 December 1862", Want: DateRange{Start: "1862-12-11", End: "1862-12-15"}},
		{Name: "hyphen day range, single digit", In: "1-3 July 1863", Want: DateRange{Start: "1863-07-01", End: "1863-07-03"}},
		{Name: "en-dash day range with comma", In: "December 11–15, 1862", Want: DateRange{Start: "1862-12-11", End: "1862-12-15"}},
		{Name: "cross-month range", In: "30 April - 6 May 1863", Want: DateRange{Start: "1863-04-30", End: "1863-05-06"}},
		{Name: "year-spanning range", In: "21 January - 9 July 1968", Want: DateRange{Start: "1968-01-21", End: "1968-07-09"}},
		{Name: "full mdy range", In: "20 September 1854", Want: DateRange{Start: "1854-09-20", End: "1854-09-20"}},
		{Name: "mdy with no comma", In: "8 January 1815", Want: DateRange{Start: "1815-01-08", End: "1815-01-08"}},
		{Name: "ranged across years", In: "27 November - 13 December 1950", Want: DateRange{Start: "1950-11-27", End: "1950-12-13"}},
		{Name: "long siege", In: "18 May - 4 July 1863", Want: DateRange{Start: "1863-05-18", End: "1863-07-04"}},
		{Name: "early 5th c bc", In: "August 480 BC", Want: DateRange{Start: "-0480-12-31", End: "-0480-12-31"}},
		{Name: "iso date passthrough", In: "1939-09-01", Want: DateRange{Start: "1939-09-01", End: "1939-09-01"}},
		// Wikidata cross-month ranges joined with a comma instead of a dash.
		// Without dedicated handling, the plain DMY pattern picks up the
		// second date and reports the end of the engagement as the start,
		// which makes the war playback show Dunkirk before Battle of France.
		{Name: "comma cross-month range, dunkirk", In: "26 May, 4 June 1940", Want: DateRange{Start: "1940-05-26", End: "1940-06-04"}},
		{Name: "comma cross-month range, battle of france", In: "10 May, 25 June 1940", Want: DateRange{Start: "1940-05-10", End: "1940-06-25"}},
		// Without the word-boundary fix on dayRangeRe2, this matched "14 – 11
		// July 1915" by stealing the trailing "14" out of "1914" and produced
		// date_start=1915-07-14, date_end=1915-07-11 (inverted).
		{Name: "month-year start to dmy end, rufiji delta", In: "October 1914 – 11 July 1915", Want: DateRange{Start: "1914-10-01", End: "1915-07-11"}},
		{Name: "dmy start to month-year end", In: "11 July 1914 – October 1915", Want: DateRange{Start: "1914-07-11", End: "1915-10-28"}},
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			got := ParseDateRange(test.In, test.Year)
			if diff := cmp.Diff(test.Want, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestSlugify confirms battle names are turned into stable URL slugs.
func TestSlugify(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In   string
		Want string
	}{
		{In: "Battle of Marathon", Want: "battle-of-marathon"},
		{In: "Siege of Constantinople (1453)", Want: "siege-of-constantinople-1453"},
		{In: "  Trailing & leading  ", Want: "trailing-leading"},
		{In: "Multi---dash", Want: "multi-dash"},
	}
	for i, test := range tests {
		t.Run(fmt.Sprintf("test %d", i), func(t *testing.T) {
			t.Parallel()
			got := slugify(test.In)
			if diff := cmp.Diff(test.Want, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
