package importer

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

// TestChooseWar verifies P607 wins and P361 targets pass only with a war class.
func TestChooseWar(t *testing.T) {
	t.Parallel()
	meta := map[string]wikidataWarTarget{
		"Q1": {Label: "Hundred Years' War", Classes: []string{"war"}},
		"Q2": {Label: "Edwardian phase", Classes: []string{"military campaign"}},
		"Q3": {Label: "Late Middle Ages", Classes: []string{"historical period"}},
		"Q4": {Label: "Siege of Orléans", Classes: []string{"siege"}},
		"Q5": {Label: "List of battles", Classes: []string{"Wikimedia list article"}},
		"Q6": {Label: "Battle of Verdun", Classes: []string{"battle", "military operation"}},
		"Q7": {Label: "Kabardian Uprising", Classes: []string{"rebellion"}},
		"Q8": {Classes: []string{"war"}},
	}
	tests := []struct {
		WantResult   []string
		In           wikidataWarLinks
		WantConflict bool
	}{{ // Test 0: P607 wins over P361.
		In:         wikidataWarLinks{Conflicts: []string{"Q1"}, PartOf: []string{"Q7"}},
		WantResult: []string{"Hundred Years' War"}, WantConflict: true,
	}, { // Test 1: P361 keeps war classes in order, drops a period.
		In:         wikidataWarLinks{PartOf: []string{"Q3", "Q2", "Q7"}},
		WantResult: []string{"Edwardian phase", "Kabardian Uprising"},
	}, { // Test 2: A siege, a list and a battle are never a war.
		In: wikidataWarLinks{PartOf: []string{"Q4", "Q5", "Q6"}},
	}, { // Test 3: Unlabeled P607 falls through to P361.
		In:         wikidataWarLinks{Conflicts: []string{"Q8"}, PartOf: []string{"Q1"}},
		WantResult: []string{"Hundred Years' War"},
	}, { // Test 4: Nothing.
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got, conflict := chooseWar(test.In, meta)
			if diff := cmp.Diff(test.WantResult, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
			if conflict != test.WantConflict {
				t.Errorf("conflict mismatch: want %v, got %v", test.WantConflict, conflict)
			}
		})
	}
}

// TestEntityID verifies only item URIs yield a Q-id.
func TestEntityID(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		In         string
	}{{ // Test 0: Item URI.
		In: "http://www.wikidata.org/entity/Q42", WantResult: "Q42",
	}, { // Test 1: Property URI.
		In: "http://www.wikidata.org/entity/P31",
	}, { // Test 2: Empty.
	}, { // Test 3: Other host.
		In: "https://example.org/entity/Q42",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, entityID(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
