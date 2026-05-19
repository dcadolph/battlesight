package importer

import (
	"strings"
	"testing"

	"github.com/dcadolph/battlesight/internal/battles"
)

// validBase returns a fully-populated curated battle that passes every
// validator gate. Tests mutate fields off this base to isolate one gate
// at a time, so a failure points at the field under test rather than at
// a parallel curation gap.
func validBase() battles.Battle {
	return battles.Battle{
		ID:           "battle-of-test",
		Name:         "Battle of Test",
		Year:         1815,
		Date:         "18 June 1815",
		Lat:          50.68,
		Lng:          4.41,
		Era:          "napoleonic",
		BattleType:   "land",
		War:          "Napoleonic Wars",
		Summary:      "A test battle that exists only to seed the validator suite.",
		Significance: "Establishes that the validator accepts a fully-formed record.",
		Sides: []battles.Side{
			{Name: "Side A", Commander: "Commander A", Casualties: "10,000"},
			{Name: "Side B", Commander: "Commander B", Casualties: "12,000"},
		},
	}
}

// TestValidateBaseIsClean is the canary: if validBase() ever fails the
// gates, every other test in this file becomes unreadable. Pin it.
func TestValidateBaseIsClean(t *testing.T) {
	t.Parallel()
	rep := ValidateBattles([]battles.Battle{validBase()})
	if rep.HasErrors() {
		t.Errorf("validBase() unexpectedly errored: %s", rep.FormatReport())
	}
}

// TestEraYearAlignment pins that a battle's calendar year must fall
// inside the era's bracket. Several era/year mismatches must error; the
// matching cases must not.
func TestEraYearAlignment(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name      string
		Era       string
		Year      int
		WantError bool
	}{
		// Test 0: A medieval era with a medieval year passes.
		{Name: "medieval_in_range", Era: "medieval", Year: 1066, WantError: false},
		// Test 1: Medieval label on a renaissance-era year errors.
		{Name: "medieval_too_late", Era: "medieval", Year: 1600, WantError: true},
		// Test 2: Ancient label on a medieval year errors.
		{Name: "ancient_too_late", Era: "ancient", Year: 1500, WantError: true},
		// Test 3: WW2 era with a WW1 year errors.
		{Name: "ww2_in_ww1", Era: "world-war-2", Year: 1916, WantError: true},
		// Test 4: Cold War era (1946-1991) with a 1944 year sits in WW2,
		// so the year-era alignment check should fire.
		{Name: "cold_war_too_early", Era: "cold-war", Year: 1944, WantError: true},
		// Test 4b: Contemporary era (1991+) with a 1989 year sits in the
		// cold-war bracket, so the alignment check should fire.
		{Name: "contemporary_too_early", Era: "contemporary", Year: 1989, WantError: true},
		// Test 5: Ancient era with -500 (the lower era boundary) passes.
		{Name: "ancient_low_boundary", Era: "ancient", Year: -500, WantError: false},
	}
	for _, test := range tests {
		t.Run(test.Name, func(t *testing.T) {
			t.Parallel()
			b := validBase()
			b.Era = test.Era
			b.Year = test.Year
			rep := ValidateBattles([]battles.Battle{b})
			gotEraYearErr := false
			for _, e := range rep.Errors {
				if e.Field == "era,year" {
					gotEraYearErr = true
				}
			}
			if gotEraYearErr != test.WantError {
				t.Errorf("era=%q year=%d: want era/year error=%v, got=%v\nreport: %s",
					test.Era, test.Year, test.WantError, gotEraYearErr, rep.FormatReport())
			}
		})
	}
}

// TestOpenOceanGate pins that land/siege battles plotted in deep open
// ocean get rejected, and naval/air battles at the same coordinates do
// not. The coordinates picked sit well inside the deep-ocean boxes.
func TestOpenOceanGate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name       string
		BattleType string
		Lat, Lng   float64
		WantError  bool
	}{
		// Test 0: Land battle in the middle of the Atlantic errors.
		{Name: "land_in_atlantic", BattleType: "land", Lat: 30, Lng: -40, WantError: true},
		// Test 1: Naval battle at the same point is fine.
		{Name: "naval_in_atlantic", BattleType: "naval", Lat: 30, Lng: -40, WantError: false},
		// Test 2: Land battle on actual land (Waterloo) passes.
		{Name: "land_on_land", BattleType: "land", Lat: 50.68, Lng: 4.41, WantError: false},
		// Test 3: Siege in the Pacific errors.
		{Name: "siege_in_pacific", BattleType: "siege", Lat: 0, Lng: -140, WantError: true},
		// Test 4: Air engagement over the Pacific passes (dogfights and
		// bombing runs legitimately happen over water).
		{Name: "air_over_pacific", BattleType: "air", Lat: 0, Lng: -140, WantError: false},
	}
	for _, test := range tests {
		t.Run(test.Name, func(t *testing.T) {
			t.Parallel()
			b := validBase()
			b.BattleType = test.BattleType
			b.Lat = test.Lat
			b.Lng = test.Lng
			rep := ValidateBattles([]battles.Battle{b})
			gotOceanErr := false
			for _, e := range rep.Errors {
				if e.Field == "lat,lng" && strings.Contains(e.Message, "plotted inside") {
					gotOceanErr = true
				}
			}
			if gotOceanErr != test.WantError {
				t.Errorf("type=%q lat=%g lng=%g: want ocean error=%v got=%v\nreport: %s",
					test.BattleType, test.Lat, test.Lng, test.WantError, gotOceanErr, rep.FormatReport())
			}
		})
	}
}

// TestCasualtyEraCap pins that the largest casualty figure on any side is
// compared against the era's plausibility cap and produces a warning when
// exceeded.
func TestCasualtyEraCap(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name       string
		Era        string
		Year       int
		Casualties string
		WantWarn   bool
	}{
		// Test 0: 500 ancient casualties is normal.
		{Name: "ancient_small", Era: "ancient", Year: -480, Casualties: "500 killed", WantWarn: false},
		// Test 1: 5 million ancient casualties triggers the warning (the
		// largest plausible ancient battle was nowhere near this).
		{Name: "ancient_implausible", Era: "ancient", Year: -480, Casualties: "5,000,000 killed", WantWarn: true},
		// Test 2: 2 million WW2 casualties is within the era cap.
		{Name: "ww2_extreme_within_cap", Era: "world-war-2", Year: 1943, Casualties: "2,000,000 killed", WantWarn: false},
		// Test 3: 50 million WW2 casualties is the kind of data-entry
		// error the gate exists to catch.
		{Name: "ww2_typo", Era: "world-war-2", Year: 1943, Casualties: "50,000,000 casualties", WantWarn: true},
		// Test 4: No casualty figure produces no warning.
		{Name: "no_figure", Era: "napoleonic", Year: 1815, Casualties: "Heavy losses on both sides", WantWarn: false},
	}
	for _, test := range tests {
		t.Run(test.Name, func(t *testing.T) {
			t.Parallel()
			b := validBase()
			b.Era = test.Era
			b.Year = test.Year
			b.Sides[0].Casualties = test.Casualties
			rep := ValidateBattles([]battles.Battle{b})
			gotCapWarn := false
			for _, w := range rep.Warnings {
				if strings.Contains(w.Message, "era cap") {
					gotCapWarn = true
				}
			}
			if gotCapWarn != test.WantWarn {
				t.Errorf("era=%q cas=%q: want cap warning=%v got=%v\nreport: %s",
					test.Era, test.Casualties, test.WantWarn, gotCapWarn, rep.FormatReport())
			}
		})
	}
}

// TestLargestCasualtyNumber pins the helper that the era-cap gate calls
// to extract the worst-case integer from a free-form casualty string.
func TestLargestCasualtyNumber(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In   string
		Want int
	}{
		// Test 0: simple integer with a thousands separator.
		{In: "15,000 killed", Want: 15000},
		// Test 1: two figures; the larger wins.
		{In: "5,000 killed; 12,000 wounded", Want: 12000},
		// Test 2: no number, returns zero.
		{In: "heavy casualties", Want: 0},
		// Test 3: million-scale figure parses cleanly.
		{In: "approximately 1,200,000 dead", Want: 1200000},
		// Test 4: empty string.
		{In: "", Want: 0},
	}
	for _, test := range tests {
		got := largestCasualtyNumber(test.In)
		if got != test.Want {
			t.Errorf("largestCasualtyNumber(%q): want %d got %d", test.In, test.Want, got)
		}
	}
}
