package battles

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

// TestApplyNarrative verifies the curated narrative slot, including the
// death-estimate range and its provenance fields, lands on the summary.
func TestApplyNarrative(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult WarSummary
		In         WarNarrative
		Base       WarSummary
	}{{ // Test 0: Full narrative including range and provenance.
		Base: WarSummary{Name: "World War II", BattleCount: 900, TotalCasualties: 20_000_000},
		In: WarNarrative{
			Outcome:      "Unconditional surrender of Germany and Japan.",
			HumanDeaths:  75_000_000,
			DeathsLow:    70_000_000,
			DeathsHigh:   85_000_000,
			DeathsNote:   "Includes combatant and civilian deaths from all causes.",
			DeathsSource: "Range across major scholarly estimates.",
			StartYear:    1931,
			EndYear:      1945,
		},
		WantResult: WarSummary{
			Name:            "World War II",
			BattleCount:     900,
			TotalCasualties: 20_000_000,
			Outcome:         "Unconditional surrender of Germany and Japan.",
			HumanDeaths:     75_000_000,
			DeathsLow:       70_000_000,
			DeathsHigh:      85_000_000,
			DeathsNote:      "Includes combatant and civilian deaths from all causes.",
			DeathsSource:    "Range across major scholarly estimates.",
			CuratedStartYear: 1931,
			CuratedEndYear:   1945,
		},
	}, { // Test 1: Empty narrative clears nothing numeric it does not carry.
		Base: WarSummary{Name: "Nameless War", TotalCasualties: 5000},
		In:   WarNarrative{},
		WantResult: WarSummary{
			Name:            "Nameless War",
			TotalCasualties: 5000,
		},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := test.Base
			applyNarrative(&got, test.In)
			if diff := cmp.Diff(test.WantResult, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestSummaryDeathsBasis verifies the provenance classification of the
// figure a summary will display.
func TestSummaryDeathsBasis(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		In         WarSummary
	}{{ // Test 0: Curated point estimate present.
		In:         WarSummary{HumanDeaths: 75_000_000, TotalCasualties: 20_000_000},
		WantResult: "curated",
	}, { // Test 1: Range only, no point estimate, still curated.
		In:         WarSummary{DeathsLow: 15_000_000, DeathsHigh: 22_000_000},
		WantResult: "curated",
	}, { // Test 2: Battle roll-up only.
		In:         WarSummary{TotalCasualties: 40_000},
		WantResult: "battle-sum",
	}, { // Test 3: No figure at all.
		In:         WarSummary{},
		WantResult: "",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := summaryDeathsBasis(test.In)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
