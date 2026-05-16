package battles

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// TestParseCasualtyNumber covers the cases that matter for war/battle stats:
// single numbers, comma-grouped numbers, multi-component phrases ("X killed,
// Y wounded"), explicit ranges, garbage strings, and overflow values.
func TestParseCasualtyNumber(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name string
		In   string
		Want int
	}{
		{Name: "single comma-grouped", In: "50,000 killed", Want: 50000},
		{Name: "compound phrase", In: "69 dead and 533 wounded", Want: 533},
		{Name: "en-dash range", In: "15,000–20,000", Want: 17500},
		{Name: "em-dash range", In: "100,000—150,000", Want: 125000},
		{Name: "word range", In: "15000 to 25000 men", Want: 20000},
		{Name: "hyphen range", In: "192-200 killed", Want: 196},
		{Name: "killed wounded captured", In: "10,000 killed, 5,000 wounded, 2,000 captured", Want: 10000},
		{Name: "empty", In: "", Want: 0},
		{Name: "no numbers", In: "unknown", Want: 0},
		{Name: "overflow filtered", In: "999,999,999 killed", Want: 0},
		{Name: "tiny number", In: "1 killed", Want: 1},
		{Name: "ship count", In: "60 ships lost", Want: 60},
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			got := ParseCasualtyNumber(test.In)
			if diff := cmp.Diff(test.Want, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestBuildWhere verifies the WHERE clause builder respects each filter
// option and the trust gate behavior.
func TestBuildWhere(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name         string
		In           Filter
		WantNoArgs   bool
		WantArgCount int
		WantContains string
	}{
		{Name: "empty filter gates documented+coords", In: Filter{}, WantNoArgs: true, WantContains: "lat != 0"},
		{Name: "era filter", In: Filter{Era: "ancient"}, WantArgCount: 1, WantContains: "era = ?"},
		{Name: "documented quality is default", In: Filter{Quality: "documented"}, WantNoArgs: true, WantContains: "EXISTS"},
		{Name: "indexed quality negates documented", In: Filter{Quality: "indexed"}, WantNoArgs: true, WantContains: "verified = 0 AND NOT"},
		{Name: "all quality skips trust", In: Filter{Quality: "all"}, WantNoArgs: true},
		{Name: "year range", In: Filter{YearMin: 1800, YearMax: 1900}, WantArgCount: 2, WantContains: "year >="},
		{Name: "include no-coord", In: Filter{IncludeNoCoord: true, Quality: "all"}, WantNoArgs: true},
		{Name: "ids filter binds and clauses", In: Filter{IDs: []string{"a", "b"}, Quality: "all"}, WantArgCount: 2, WantContains: "id IN (?,?)"},
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			where, args := buildWhere(test.In)
			if test.WantNoArgs && len(args) != 0 {
				t.Errorf("expected no args, got %v", args)
			}
			if !test.WantNoArgs && len(args) != test.WantArgCount {
				t.Errorf("expected %d args, got %d (%v)", test.WantArgCount, len(args), args)
			}
			if test.WantContains != "" && !containsSubstr(where, test.WantContains) {
				t.Errorf("WHERE did not contain %q: %s", test.WantContains, where)
			}
			// Include-no-coord must not add the lat/lng gate.
			if test.In.IncludeNoCoord && containsSubstr(where, "lat != 0") {
				t.Errorf("WHERE should not gate coords when IncludeNoCoord: %s", where)
			}
		})
	}
}

// containsSubstr is a tiny test helper for substring assertions.
func containsSubstr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// TestPrefixCols verifies the column-list rewriter splits only on top-level
// commas. Commas inside function calls (e.g. COALESCE(x, 0)) must be
// preserved so the resulting SQL is valid.
func TestPrefixCols(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name   string
		Prefix string
		In     string
		Want   string
	}{
		{Name: "simple plain columns", Prefix: "b", In: "id, name", Want: "b.id, b.name"},
		{Name: "coalesce default literal", Prefix: "b", In: "id, COALESCE(verified, 0)", Want: "b.id, COALESCE(b.verified, 0)"},
		{Name: "multiple coalesces", Prefix: "x", In: "id, COALESCE(a, 0), COALESCE(b, '')", Want: "x.id, COALESCE(x.a, 0), COALESCE(x.b, '')"},
		{Name: "empty input", Prefix: "b", In: "", Want: ""},
		{Name: "trailing whitespace", Prefix: "b", In: "id ,  name", Want: "b.id, b.name"},
	}
	for i, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", i, test.Name), func(t *testing.T) {
			t.Parallel()
			got := prefixCols(test.Prefix, test.In)
			if got != test.Want {
				t.Errorf("got %q, want %q", got, test.Want)
			}
		})
	}
}

// TestSanitizeFTS confirms FTS5 query terms are quoted to prevent operator
// injection from user input.
func TestSanitizeFTS(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In   string
		Want string
	}{
		{In: "marathon", Want: `"marathon"`},
		{In: "Battle of Cannae", Want: `"Battle" "of" "Cannae"`},
		{In: ``, Want: ``},
		{In: `quote " inside`, Want: `"quote" """" "inside"`},
	}
	for i, test := range tests {
		t.Run(fmt.Sprintf("test %d", i), func(t *testing.T) {
			t.Parallel()
			got := sanitizeFTS(test.In)
			if diff := cmp.Diff(test.Want, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
