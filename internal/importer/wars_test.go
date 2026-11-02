package importer

import (
	"fmt"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

// TestWarsFileRoundTrip verifies a read and rewrite of the served wars.json
// keeps every field of every entry.
func TestWarsFileRoundTrip(t *testing.T) {
	t.Parallel()
	in, err := loadWarsFile(filepath.Join("..", "..", "data", "wars.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(in) == 0 {
		t.Fatal("served wars.json read as empty")
	}
	out := filepath.Join(t.TempDir(), "wars.json")
	if err := writeWarsFile(out, in); err != nil {
		t.Fatal(err)
	}
	got, err := loadWarsFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(in, got, cmpopts.EquateEmpty()); diff != "" {
		t.Errorf("round trip mismatch (-want +got):\n%s", diff)
	}
}

// TestMergeWarNarrative verifies the merge fills text fields and keeps every
// other curated field of the existing entry.
func TestMergeWarNarrative(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult warNarrative
		A          warNarrative
		B          warNarrative
	}{{ // Test 0: Curated fields on the existing entry survive a fetched merge.
		A: warNarrative{
			Outcome: "Ceasefire.", StartYear: 2025, EndYear: 2025, Parent: "Iran–Israel conflict",
			Aliases: []string{"Israel–Iran war"}, DeathsLow: 1000, DeathsHigh: 1300, Notable: []string{"Fordow"},
		},
		B: warNarrative{Aftermath: "Talks resumed.", Notable: []string{"Fordow", "Natanz"}},
		WantResult: warNarrative{
			Outcome: "Ceasefire.", Aftermath: "Talks resumed.", StartYear: 2025, EndYear: 2025,
			Parent: "Iran–Israel conflict", Aliases: []string{"Israel–Iran war"}, DeathsLow: 1000,
			DeathsHigh: 1300, Notable: []string{"Fordow", "Natanz"},
		},
	}, { // Test 1: A strongly longer fetched outcome replaces a short one.
		A:          warNarrative{Outcome: "Won."},
		B:          warNarrative{Outcome: "Decisive victory and treaty."},
		WantResult: warNarrative{Outcome: "Decisive victory and treaty."},
	}, { // Test 2: Empty existing entry takes the fetched text.
		B:          warNarrative{KeyTerms: "Armistice."},
		WantResult: warNarrative{KeyTerms: "Armistice."},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := mergeWarNarrative(test.A, test.B)
			if diff := cmp.Diff(test.WantResult, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
