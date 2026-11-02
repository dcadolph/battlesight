package importer

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

	"github.com/dcadolph/battlesight/internal/battles"
)

// TestSnapshotWarKeys verifies both quote styles and escapes are read.
func TestSnapshotWarKeys(t *testing.T) {
	t.Parallel()
	src := "export const TERRITORY = [\n  {\n    war: 'World War II',\n  },\n  {\n" +
		"    war: 'Hundred Years\\' War',\n  },\n  {\n    war: \"Seven Years' War\",\n  },\n];\n" +
		"// war: 'Not a block'\n"
	want := []string{"World War II", "Hundred Years' War", "Seven Years' War"}
	if diff := cmp.Diff(want, SnapshotWarKeys(src)); diff != "" {
		t.Errorf("mismatch (-want +got):\n%s", diff)
	}
}

// TestValidateWars verifies each war key rule.
func TestValidateWars(t *testing.T) {
	t.Parallel()
	wars := map[string]battles.WarNarrative{
		"Russo-Ukrainian War":         {Aliases: []string{"Russia-Ukraine War"}},
		"Russian invasion of Ukraine": {Parent: "Russo-Ukrainian War"},
		"Gaza war":                    {Aliases: []string{"Israel–Hamas war"}},
	}
	tests := []struct {
		Wars       map[string]battles.WarNarrative
		Snapshots  []string
		Curated    []battles.Battle
		WantErrors []string
	}{{ // Test 0: Clean registry with canonical snapshot keys.
		Wars:      wars,
		Snapshots: []string{"Russo-Ukrainian War", "Gaza war"},
		Curated:   []battles.Battle{{ID: "gaza-city", War: "Gaza war"}},
	}, { // Test 6: Snapshot keyed by an alias never paints.
		Wars:       wars,
		Snapshots:  []string{"Russia-Ukraine War"},
		WantErrors: []string{"Russia-Ukraine War.snapshot"},
	}, { // Test 1: Snapshot keyed by an unknown spelling.
		Wars:       wars,
		Snapshots:  []string{"Russia-Ukraine war"},
		WantErrors: []string{"Russia-Ukraine war.snapshot"},
	}, { // Test 2: Two snapshot blocks for one war.
		Wars:       wars,
		Snapshots:  []string{"Gaza war", "Gaza war"},
		WantErrors: []string{"Gaza war.snapshot"},
	}, { // Test 3: Curated battle filed under an alias.
		Wars:       wars,
		Curated:    []battles.Battle{{ID: "khan-younis", War: "Israel–Hamas war"}},
		WantErrors: []string{"khan-younis.war"},
	}, { // Test 7: Curated battle filed under another spelling of a key.
		Wars:       wars,
		Curated:    []battles.Battle{{ID: "rafah", War: "Gaza War"}},
		WantErrors: []string{"rafah.war"},
	}, { // Test 4: Dangling parent.
		Wars:       map[string]battles.WarNarrative{"Child war": {Parent: "Missing war"}},
		WantErrors: []string{"Child war.parent"},
	}, { // Test 5: Alias that is also a key.
		Wars: map[string]battles.WarNarrative{
			"A war": {Aliases: []string{"B war"}},
			"B war": {},
		},
		WantErrors: []string{"aliases"},
	}, { // Test 8: An open war with no sources.
		Wars:       map[string]battles.WarNarrative{"Open war": {StartYear: 2014}},
		WantErrors: []string{"Open war.sources"},
	}, { // Test 9: A war begun in 2025 with a source missing its revision.
		Wars: map[string]battles.WarNarrative{"New war": {StartYear: 2025, EndYear: 2025,
			Sources: []battles.WarSource{{Title: "New war", Fetched: "2026-11-02"}}}},
		WantErrors: []string{"New war.sources"},
	}, { // Test 10: A season in place of a month.
		Wars: map[string]battles.WarNarrative{"Open war": {StartYear: 2014, Outcome: "Ongoing as of late 2025.",
			Sources: []battles.WarSource{{Title: "Open war", Revision: 1, Fetched: "2026-11-02"}}}},
		WantErrors: []string{"Open war.outcome"},
	}, { // Test 11: A cited open war and a closed old war pass.
		Wars: map[string]battles.WarNarrative{
			"Open war": {StartYear: 2014, Outcome: "Ongoing as of November 2026.",
				Sources: []battles.WarSource{{Title: "Open war", Revision: 1, Fetched: "2026-11-02"}}},
			"Old war": {StartYear: 1939, EndYear: 1945, Outcome: "Ended in late 1945."},
		},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			rep := ValidateWars(test.Wars, test.Snapshots, test.Curated)
			var got []string
			for _, e := range rep.Errors {
				if e.ID == "" {
					got = append(got, e.Field)
					continue
				}
				got = append(got, e.ID+"."+e.Field)
			}
			if diff := cmp.Diff(test.WantErrors, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
