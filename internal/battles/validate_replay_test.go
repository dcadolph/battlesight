package battles

import (
	"fmt"
	"strings"
	"testing"
)

// validDraft returns a minimal replay that passes every check, anchored
// at 41.44, 12.62 (Anzio).
func validDraft() Replay {
	phase := func(i int) Phase {
		return Phase{
			Index:      i,
			Title:      fmt.Sprintf("Phase %d", i),
			Narration:  "Something happens.",
			DurationMs: 7000,
			Units: []Unit{
				{ID: "u1", Label: "1st Division", Faction: "a", Lat: 41.45, Lng: 12.63},
				{ID: "u2", Label: "Garrison", Faction: "b", Lat: 41.40, Lng: 12.60},
			},
			Movements: []Movement{
				{Faction: "a", Kind: "advance", FromLat: 41.45, FromLng: 12.63, ToLat: 41.42, ToLng: 12.61},
			},
			CameraLat: 41.44, CameraLng: 12.62, CameraAltitude: 0.12, CameraTweenMs: 1800,
		}
	}
	return Replay{
		Title:    "Anzio: The Beachhead",
		Intro:    "January 1944. The Allies land behind the Gustav Line.",
		FactionA: "Allies",
		FactionB: "Germany",
		Phases:   []Phase{phase(0), phase(1), phase(2)},
	}
}

func TestValidateReplay(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name    string
		Mutate  func(*Replay)
		WantSub string
	}{{ // Test 0: Clean draft passes.
		Name:   "valid draft",
		Mutate: func(r *Replay) {},
	}, { // Test 1: Too few phases.
		Name:    "two phases",
		Mutate:  func(r *Replay) { r.Phases = r.Phases[:2] },
		WantSub: "phase count",
	}, { // Test 2: Duration outside the cinematic window.
		Name:    "short duration",
		Mutate:  func(r *Replay) { r.Phases[1].DurationMs = 900 },
		WantSub: "durationMs",
	}, { // Test 3: Unit too far from the battle anchor.
		Name: "unit far away",
		Mutate: func(r *Replay) {
			r.Phases[0].Units[0].Lat = 52.5
			r.Phases[0].Units[0].Lng = 13.4
		},
		WantSub: "degrees from battle",
	}, { // Test 4: Placeholder sentinel rejected.
		Name: "sentinel unit",
		Mutate: func(r *Replay) {
			r.Phases[0].Units[0].Lat = 0
			r.Phases[0].Units[0].Lng = 0
			r.Phases[0].Units[0].X = 50
			r.Phases[0].Units[0].Y = 50
		},
		WantSub: "placeholder sentinel",
	}, { // Test 5: Bad faction slot.
		Name:    "bad faction",
		Mutate:  func(r *Replay) { r.Phases[2].Units[0].Faction = "axis" },
		WantSub: "not a, b, or c",
	}, { // Test 6: Duplicate unit ids in one phase.
		Name:    "duplicate ids",
		Mutate:  func(r *Replay) { r.Phases[0].Units[1].ID = "u1" },
		WantSub: "duplicate id",
	}, { // Test 7: Index mismatch.
		Name:    "index mismatch",
		Mutate:  func(r *Replay) { r.Phases[2].Index = 7 },
		WantSub: "does not match position",
	}, { // Test 8: Camera far from battle.
		Name: "camera far away",
		Mutate: func(r *Replay) {
			r.Phases[1].CameraLat = 30
			r.Phases[1].CameraLng = 30
		},
		WantSub: "too far from battle",
	}, { // Test 9: Missing factions.
		Name:    "missing faction labels",
		Mutate:  func(r *Replay) { r.FactionB = "" },
		WantSub: "factionA and factionB",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			draft := validDraft()
			test.Mutate(&draft)
			err := ValidateReplay("battle-of-anzio", draft, 41.443, 12.625)
			if test.WantSub == "" {
				if err != nil {
					t.Fatalf("want nil error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("want error containing %q, got nil", test.WantSub)
			}
			if !strings.Contains(err.Error(), test.WantSub) {
				t.Errorf("error %q does not contain %q", err.Error(), test.WantSub)
			}
		})
	}
}
