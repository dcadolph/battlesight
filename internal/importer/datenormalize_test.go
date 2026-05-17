package importer

import "testing"

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
