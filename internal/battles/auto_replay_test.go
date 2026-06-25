package battles

import (
	"fmt"
	"strings"
	"testing"
)

// TestGenerateReplay confirms the schematic generator only fires when there
// is at least one side, and that it threads through key metadata.
func TestGenerateReplay(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name      string
		In        Battle
		WantOK    bool
		WantTitle string
		Want3     bool // expect three phases when ok
	}{
		{
			Name:   "no sides means no replay",
			In:     Battle{ID: "x", Name: "Battle of X"},
			WantOK: false,
		},
		{
			Name: "two sides with a victor",
			In: Battle{
				ID:         "x",
				Name:       "Battle of X",
				Year:       1066,
				BattleType: "land",
				Victor:     "Normandy",
				Sides: []Side{
					{Name: "Normandy", Commander: "William"},
					{Name: "England", Commander: "Harold"},
				},
			},
			WantOK:    true,
			WantTitle: "Battle of X · 1066",
			Want3:     true,
		},
		{
			Name: "single side produces no replay",
			In: Battle{
				ID:   "x",
				Name: "Skirmish",
				Year: 1900,
				Sides: []Side{
					{Name: "Force A"},
				},
			},
			WantOK: false,
		},
		{
			Name: "naval battle gets ship unit type and coast terrain",
			In: Battle{
				ID:         "x",
				Name:       "Sea fight",
				Year:       1805,
				BattleType: "naval",
				Sides:      []Side{{Name: "A"}, {Name: "B"}},
			},
			WantOK: true,
			Want3:  true,
		},
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			got, ok := GenerateReplay(test.In)
			if ok != test.WantOK {
				t.Fatalf("ok = %v, want %v", ok, test.WantOK)
			}
			if !ok {
				return
			}
			if !got.Schematic {
				t.Errorf("expected Schematic = true")
			}
			if test.WantTitle != "" && got.Title != test.WantTitle {
				t.Errorf("title = %q, want %q", got.Title, test.WantTitle)
			}
			if test.Want3 && len(got.Phases) != 3 {
				t.Errorf("phase count = %d, want 3", len(got.Phases))
			}
			// Naval-specific assertions.
			if test.In.BattleType == "naval" {
				if len(got.Phases[0].Terrain) == 0 || got.Phases[0].Terrain[0].Kind != "coast" {
					t.Errorf("expected coast terrain in naval deployment, got %+v", got.Phases[0].Terrain)
				}
				if got.Phases[0].Units[0].UnitType != "ships" {
					t.Errorf("naval units should be ships, got %q", got.Phases[0].Units[0].UnitType)
				}
			}
			// Outcome narration should name the victor when one is set.
			if test.In.Victor != "" {
				last := got.Phases[len(got.Phases)-1]
				if !strings.Contains(last.Narration, test.In.Victor) {
					t.Errorf("outcome narration missing victor %q: %s", test.In.Victor, last.Narration)
				}
			}
		})
	}
}
