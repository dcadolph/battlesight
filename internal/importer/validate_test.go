package importer

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

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

// reportFields lists the id.field of every error and warning in a report.
func reportFields(rep ValidationReport) (errs, warns []string) {
	for _, e := range rep.Errors {
		errs = append(errs, e.ID+"."+e.Field)
	}
	for _, w := range rep.Warnings {
		warns = append(warns, w.ID+"."+w.Field)
	}
	return errs, warns
}

// TestValidateConsistency pins the cross-field checks ported from the retired
// Python audit: year against prose date, victor against sides, and casualties
// against strength.
func TestValidateConsistency(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name      string
		Mutate    func(b *battles.Battle)
		WantError string
		WantWarn  string
	}{{ // Test 0: Year missing from the prose date errors.
		Name: "year date", Mutate: func(b *battles.Battle) { b.Date = "18 June 1816" },
		WantError: "battle-of-test.year,date",
	}, { // Test 1: Victor naming a side by substring passes.
		Name: "victor substring", Mutate: func(b *battles.Battle) { b.Victor = "Side A" },
	}, { // Test 2: Victor sharing a significant word with a side passes.
		Name: "victor word", Mutate: func(b *battles.Battle) {
			b.Sides[0].Name = "Republic of the Philippines (with coalition support)"
			b.Victor = "Republic of the Philippines (and the coalition)"
		},
	}, { // Test 3: Victor sharing only generic words warns.
		Name: "victor generic only", Mutate: func(b *battles.Battle) {
			b.Sides[0].Name, b.Victor = "Sudanese Armed Forces", "Rapid Support Forces"
		}, WantWarn: "battle-of-test.victor",
	}, { // Test 4: A generic outcome passes.
		Name: "victor outcome", Mutate: func(b *battles.Battle) { b.Victor = "Inconclusive" },
	}, { // Test 5: Casualties far above strength warn.
		Name: "casualties over strength", Mutate: func(b *battles.Battle) {
			b.Sides[1].Strength, b.Sides[1].Casualties = "12,000", "25,000 killed"
		}, WantWarn: "battle-of-test.sides[1].casualties",
	}, { // Test 6: A million suffix scales strength.
		Name: "million suffix", Mutate: func(b *battles.Battle) {
			b.Sides[1].Strength, b.Sides[1].Casualties = "1.2 M", "250,000"
		},
	}, { // Test 7: Equipment strength is not compared.
		Name: "ships", Mutate: func(b *battles.Battle) {
			b.Sides[1].Strength, b.Sides[1].Casualties = "30 ships", "4,000 killed"
		},
	}, { // Test 8: A civilian tally after a semicolon is left out.
		Name: "civilian tally", Mutate: func(b *battles.Battle) {
			b.Sides[1].Strength, b.Sides[1].Casualties = "10,000", "8,000 killed; 50,000 civilian dead"
		},
	}, { // Test 9: Small units are not compared.
		Name: "small unit", Mutate: func(b *battles.Battle) {
			b.Sides[1].Strength, b.Sides[1].Casualties = "40", "60"
		},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			b := validBase()
			b.Sides = slices.Clone(b.Sides)
			test.Mutate(&b)
			errs, warns := reportFields(ValidateBattles([]battles.Battle{b}))
			var wantErrs, wantWarns []string
			if test.WantError != "" {
				wantErrs = []string{test.WantError}
			}
			if test.WantWarn != "" {
				wantWarns = []string{test.WantWarn}
			}
			if diff := cmp.Diff(wantErrs, errs, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("errors mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(wantWarns, warns, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("warnings mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestValidateBatch pins the checks that compare battles with each other.
func TestValidateBatch(t *testing.T) {
	t.Parallel()
	b1, b2 := validBase(), validBase()
	b2.ID, b2.Lat = "battle-of-test-two", 51
	b1.WikipediaTitle, b2.WikipediaTitle = "Battle of Test", "Battle of Test"
	b2.War = "The Napoleonic wars"
	errs, warns := reportFields(ValidateBattles([]battles.Battle{b1, b2}))
	if diff := cmp.Diff([]string{"battle-of-test.wikipediaTitle"}, errs); diff != "" {
		t.Errorf("errors mismatch (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff([]string{"battle-of-test.name", ".war"}, warns); diff != "" {
		t.Errorf("warnings mismatch (-want +got):\n%s", diff)
	}
}

// TestValidateReplays pins the structural checks on served replays.
func TestValidateReplays(t *testing.T) {
	t.Parallel()
	phase := func(i int) battles.Phase {
		return battles.Phase{Index: i, Title: "T", Narration: "N",
			Units:     []battles.Unit{{Faction: "a", X: 10, Y: 10}},
			Movements: []battles.Movement{{Faction: "b", FromX: 1, FromY: 1, ToX: 2, ToY: 2}}}
	}
	good := func() battles.Replay {
		return battles.Replay{FactionA: "A", FactionB: "B", Phases: []battles.Phase{phase(0), phase(1), phase(2)}}
	}
	tests := []struct {
		Name       string
		Mutate     func(r *battles.Replay)
		WantFields []string
	}{{ // Test 0: A clean replay passes.
		Name: "clean", Mutate: func(*battles.Replay) {},
	}, { // Test 1: No phases errors.
		Name: "no phases", Mutate: func(r *battles.Replay) { r.Phases = nil }, WantFields: []string{"r.phases"},
	}, { // Test 2: Missing faction label errors.
		Name: "faction label", Mutate: func(r *battles.Replay) { r.FactionB = " " },
		WantFields: []string{"r.factionA,factionB"},
	}, { // Test 3: Missing phase title and narration error.
		Name: "phase text", Mutate: func(r *battles.Replay) { r.Phases[1].Title, r.Phases[1].Narration = "", "" },
		WantFields: []string{"r.phases[1].title", "r.phases[1].narration"},
	}, { // Test 4: Bad faction and out-of-range unit error.
		Name: "unit", Mutate: func(r *battles.Replay) { r.Phases[0].Units = []battles.Unit{{Faction: "d", X: 101}} },
		WantFields: []string{"r.phases[0].units[0].faction", "r.phases[0].units[0]"},
	}, { // Test 5: Out-of-range movement errors.
		Name: "movement", Mutate: func(r *battles.Replay) { r.Phases[2].Movements[0].ToY = -1 },
		WantFields: []string{"r.phases[2].movements[0]"},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			r := good()
			test.Mutate(&r)
			errs, _ := reportFields(ValidateReplays(map[string]battles.Replay{"r": r}))
			if diff := cmp.Diff(test.WantFields, errs, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
