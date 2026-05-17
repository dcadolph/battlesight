package battles

import (
	"fmt"
	"strings"
)

// GenerateReplay synthesizes a schematic phase replay from a battle's known
// metadata. Returns (Replay, true) when there is enough data to build a
// useful sequence, or (Replay{}, false) otherwise.
//
// The output is intentionally generic: a deployment phase, an engagement
// phase, and an outcome phase, with unit types and a single terrain hint
// chosen from the battle type. Sides are colored by victor when known.
func GenerateReplay(b Battle) (Replay, bool) {
	if len(b.Sides) == 0 {
		return Replay{}, false
	}

	a, bSide := orderSides(b)
	unitType := unitTypeForBattle(b)
	terrain := schematicTerrain(b)

	intro := buildSchematicIntro(b, a, bSide)
	yearLabel := schematicYearLabel(b)
	titleSuffix := ""
	if yearLabel != "" {
		titleSuffix = " · " + yearLabel
	}

	phases := []Phase{
		schematicDeployment(b, a, bSide, unitType, terrain),
		schematicEngagement(a, bSide, unitType),
		schematicOutcome(b, a, bSide, unitType),
	}

	aName := factionDisplay(a)
	bName := factionDisplay(bSide)
	if aName == "" {
		aName = "Side A"
	}
	if bName == "" {
		bName = "Side B"
	}

	return Replay{
		BattleID:        b.ID,
		Title:           b.Name + titleSuffix,
		Intro:           intro,
		BattlefieldDesc: schematicBattlefieldDesc(b),
		AspectRatio:     1.6,
		FactionA:        aName,
		FactionB:        bName,
		Schematic:       true,
		Phases:          phases,
	}, true
}

// orderSides chooses which side is faction A versus B for the schematic.
// The victor (when known) is assigned to faction A so the narrative reads
// from the perspective of who won. Falls back to natural order.
func orderSides(b Battle) (Side, Side) {
	a := b.Sides[0]
	var bSide Side
	if len(b.Sides) > 1 {
		bSide = b.Sides[1]
	}
	if b.Victor != "" && len(b.Sides) >= 2 {
		victorLower := strings.ToLower(strings.TrimSpace(b.Victor))
		if strings.Contains(strings.ToLower(b.Sides[1].Name), victorLower) ||
			strings.Contains(victorLower, strings.ToLower(b.Sides[1].Name)) {
			a = b.Sides[1]
			bSide = b.Sides[0]
		}
	}
	return a, bSide
}

// unitTypeForBattle picks a visual unit kind from the battle's type field.
func unitTypeForBattle(b Battle) string {
	switch strings.ToLower(b.BattleType) {
	case "naval":
		return "ships"
	case "aerial":
		return "aircraft"
	case "siege":
		return "infantry"
	default:
		return "infantry"
	}
}

// schematicTerrain returns a single terrain feature appropriate to the
// battle type, or nil if none fits.
func schematicTerrain(b Battle) []Terrain {
	switch strings.ToLower(b.BattleType) {
	case "naval":
		return []Terrain{{Kind: "coast", Label: "Coastline", Points: []float64{0, 88, 35, 92, 70, 90, 100, 94}}}
	case "siege":
		return []Terrain{{Kind: "fort", Label: "Fortified position", Points: []float64{38, 38, 62, 62}}}
	case "aerial":
		return nil
	default:
		return nil
	}
}

// schematicBattlefieldDesc returns a short context line for the replay header.
func schematicBattlefieldDesc(b Battle) string {
	parts := []string{}
	switch strings.ToLower(b.BattleType) {
	case "naval":
		parts = append(parts, "Naval engagement")
	case "siege":
		parts = append(parts, "Siege")
	case "aerial":
		parts = append(parts, "Air engagement")
	case "land":
		parts = append(parts, "Land engagement")
	default:
		parts = append(parts, "Engagement")
	}
	if b.War != "" {
		parts = append(parts, b.War)
	}
	return strings.Join(parts, " · ")
}

// schematicYearLabel returns a year tag (e.g. "490 BC" or "1815") or "" if
// the year is unknown.
func schematicYearLabel(b Battle) string {
	if b.Year == 0 {
		return ""
	}
	if b.Year < 0 {
		return fmt.Sprintf("%d BC", -b.Year)
	}
	return fmt.Sprintf("%d", b.Year)
}

// buildSchematicIntro composes a one-sentence overview suitable for the
// replay's intro card.
func buildSchematicIntro(b Battle, a, bSide Side) string {
	parts := []string{}
	if b.War != "" {
		parts = append(parts, fmt.Sprintf("Part of %s.", b.War))
	}
	matchups := factionDisplay(a)
	if factionDisplay(bSide) != "" {
		if matchups != "" {
			matchups += " against " + factionDisplay(bSide)
		} else {
			matchups = factionDisplay(bSide)
		}
	}
	if matchups != "" {
		if a.Commander != "" || bSide.Commander != "" {
			commanders := strings.TrimSpace(a.Commander)
			if bSide.Commander != "" {
				if commanders != "" {
					commanders += " vs " + bSide.Commander
				} else {
					commanders = bSide.Commander
				}
			}
			parts = append(parts, fmt.Sprintf("%s. Commanders: %s.", matchups, commanders))
		} else {
			parts = append(parts, matchups+".")
		}
	}
	if b.Victor != "" {
		parts = append(parts, fmt.Sprintf("Outcome: %s prevails.", b.Victor))
	}
	if len(parts) == 0 {
		return "Schematic reconstruction from available metadata."
	}
	parts = append(parts, "Schematic reconstruction — positions and movements are illustrative, not surveyed.")
	return strings.Join(parts, " ")
}

// schematicDeployment is the first phase: both sides arrayed for battle.
func schematicDeployment(b Battle, a, bSide Side, unitType string, terrain []Terrain) Phase {
	narration := buildDeploymentNarration(b, a, bSide)
	timeMarker := schematicYearLabel(b)
	if timeMarker == "" {
		timeMarker = "Engagement"
	}
	return Phase{
		Title:      "Deployment",
		Narration:  narration,
		TimeMarker: timeMarker,
		DurationMs: 5500,
		Terrain:    terrain,
		Units: []Unit{
			{Label: shortFaction(a), Faction: "a", UnitType: unitType, X: 24, Y: 50, W: 16, H: 22, Strength: 3},
			{Label: shortFaction(bSide), Faction: "b", UnitType: unitType, X: 76, Y: 50, W: 16, H: 22, Strength: 3},
		},
	}
}

// schematicEngagement is the second phase: forces meet. Narration is
// composed sentence-by-sentence so two commanders read as a clean two-line
// rather than a comma-stuffed run. The lead commander gets pulled out so
// the prose drops names where it has them and stays generic otherwise.
func schematicEngagement(a, bSide Side, unitType string) Phase {
	narration := "Both sides close to engagement range. Lines meet near the center of the field."
	switch {
	case a.Commander != "" && bSide.Commander != "":
		narration = fmt.Sprintf(
			"%s closes on %s. Lines meet near the center of the field.",
			a.Commander, bSide.Commander,
		)
	case a.Commander != "":
		narration = fmt.Sprintf(
			"%s presses forward. Lines meet near the center of the field.",
			a.Commander,
		)
	case bSide.Commander != "":
		narration = fmt.Sprintf(
			"%s holds the line. The opposing force closes to engagement range.",
			bSide.Commander,
		)
	}
	return Phase{
		Title:      "Engagement",
		Narration:  narration,
		TimeMarker: "Main action",
		DurationMs: 5500,
		Units: []Unit{
			{Label: shortFaction(a), Faction: "a", UnitType: unitType, X: 38, Y: 50, W: 16, H: 22, Strength: 3, Status: "pressing"},
			{Label: shortFaction(bSide), Faction: "b", UnitType: unitType, X: 62, Y: 50, W: 16, H: 22, Strength: 3, Status: "pressing"},
		},
		Movements: []Movement{
			{Faction: "a", FromX: 30, FromY: 50, ToX: 48, ToY: 50, Kind: "advance"},
			{Faction: "b", FromX: 70, FromY: 50, ToX: 52, ToY: 50, Kind: "advance"},
		},
	}
}

// schematicOutcome is the final phase: victor advances, loser broken.
// Narration is composed sentence-by-sentence rather than concatenating raw
// casualty strings, so a plural victor like "United States and allies"
// does not produce "...carries the field" and so multi-side casualty
// figures land as clean sentences rather than a semicolon-separated run.
func schematicOutcome(b Battle, a, bSide Side, unitType string) Phase {
	loserStatus := "broken"
	if b.Victor == "" {
		return Phase{
			Title:      "Outcome",
			Narration:  "The action concludes. The engagement is recorded as indecisive in the available sources.",
			TimeMarker: "End of action",
			DurationMs: 5000,
			Units: []Unit{
				{Label: shortFaction(a), Faction: "a", UnitType: unitType, X: 38, Y: 50, W: 16, H: 22, Strength: 2},
				{Label: shortFaction(bSide), Faction: "b", UnitType: unitType, X: 62, Y: 50, W: 16, H: 22, Strength: 2},
			},
		}
	}

	// Verb that works whether the subject is singular ("Hannibal") or plural
	// ("United States and allies"). "holds the field" reads as both.
	narration := fmt.Sprintf("%s holds the field.", strings.TrimSpace(b.Victor))

	// Casualty roll, one sentence per side. Pull a parsed number when we
	// can so the prose reads "About 95,000 men lost." rather than dumping
	// the freeform casualty string into the line.
	if line := casualtySentence(a); line != "" {
		narration += " " + line
	}
	if line := casualtySentence(bSide); line != "" {
		narration += " " + line
	}

	return Phase{
		Title:      "Outcome",
		Narration:  narration,
		TimeMarker: "End of action",
		DurationMs: 5500,
		Units: []Unit{
			{Label: shortFaction(a), Faction: "a", UnitType: unitType, X: 50, Y: 50, W: 18, H: 24, Strength: 3},
			{Label: shortFaction(bSide), Faction: "b", UnitType: unitType, X: 78, Y: 50, W: 12, H: 18, Strength: 1, Status: loserStatus},
		},
		Movements: []Movement{
			{Faction: "a", FromX: 50, FromY: 50, ToX: 70, ToY: 50, Kind: "advance"},
			{Faction: "b", FromX: 78, FromY: 50, ToX: 92, ToY: 50, Kind: "retreat"},
		},
	}
}

// casualtySentence renders one side's casualty figure as a single clean
// sentence for the outcome narration. Returns "" when the side has no
// parseable casualty data so the caller can skip cleanly.
//
// Number extraction reads the largest plausible integer out of the raw
// freeform casualty string (capped at 10M to skip page numbers and noise).
// The prose form swallows "1,200-2,000 killed, ~1,500 captured" into
// "About 2,000 men lost" rather than reprinting all of it.
func casualtySentence(s Side) string {
	name := shortFaction(s)
	if name == "" {
		return ""
	}
	count := parseLargestCasualtyNumber(s.Casualties)
	if count > 0 {
		return fmt.Sprintf("%s lost about %s.", name, humanizeCount(count))
	}
	return ""
}

// parseLargestCasualtyNumber pulls the biggest comma-separated integer in
// the freeform casualty string. Caps at 10M to skip page numbers and stray
// reference markers; returns 0 if nothing parses.
func parseLargestCasualtyNumber(s string) int {
	if s == "" {
		return 0
	}
	cleaned := strings.ReplaceAll(s, ",", "")
	var best int
	var run strings.Builder
	flush := func() {
		if run.Len() == 0 {
			return
		}
		var n int
		fmt.Sscanf(run.String(), "%d", &n)
		if n > best && n <= 10_000_000 {
			best = n
		}
		run.Reset()
	}
	for _, r := range cleaned {
		if r >= '0' && r <= '9' {
			run.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	return best
}

// humanizeCount renders a count for narration prose. 117871 becomes
// "117,000 men", 95 stays "95 men". The "men" suffix is generic across
// eras; "soldiers" would feel wrong for Marathon and "troops" wrong for
// Cannae.
func humanizeCount(n int) string {
	if n >= 1_000_000 {
		return fmt.Sprintf("%.1f million men", float64(n)/1_000_000)
	}
	if n >= 10_000 {
		// Round to nearest thousand for readability.
		rounded := (n / 1000) * 1000
		return fmt.Sprintf("%s men", commaInt(rounded))
	}
	if n >= 1000 {
		return fmt.Sprintf("%s men", commaInt(n))
	}
	return fmt.Sprintf("%d men", n)
}

// commaInt formats an integer with thousands separators. Avoids pulling in
// golang.org/x/text/message for one call site.
func commaInt(n int) string {
	in := fmt.Sprintf("%d", n)
	if len(in) <= 3 {
		return in
	}
	var out strings.Builder
	rem := len(in) % 3
	if rem > 0 {
		out.WriteString(in[:rem])
		if len(in) > rem {
			out.WriteString(",")
		}
	}
	for i := rem; i < len(in); i += 3 {
		out.WriteString(in[i : i+3])
		if i+3 < len(in) {
			out.WriteString(",")
		}
	}
	return out.String()
}

// buildDeploymentNarration writes the opening narration using whatever side
// metadata is available. Composed as discrete sentences (no semicolons, no
// parenthetical-soup) so a side with both strength and commander reads as
// "Athens fields 10,000 men. Miltiades commands." rather than as a
// run-on. Parses strength to a number when possible so the prose reads
// "about 10,000 men" not "10,000 (Miltiades)".
func buildDeploymentNarration(b Battle, a, bSide Side) string {
	left := shortFaction(a)
	right := shortFaction(bSide)
	var parts []string

	// Opening: who faces whom. Drops cleanly when names are missing.
	switch {
	case left != "" && right != "":
		parts = append(parts, fmt.Sprintf("%s faces %s.", left, right))
	case left != "":
		parts = append(parts, fmt.Sprintf("%s takes the field.", left))
	case right != "":
		parts = append(parts, fmt.Sprintf("%s holds the field against an approaching enemy.", right))
	default:
		parts = append(parts, "Both sides take the field.")
	}

	// Strength sentences. One per side when known. parseLargestCasualtyNumber
	// also reads strength strings since both are freeform integers with
	// commas and surrounding prose; the function name speaks of casualties
	// but the parser is generic.
	if line := strengthSentence(left, a.Strength); line != "" {
		parts = append(parts, line)
	}
	if line := strengthSentence(right, bSide.Strength); line != "" {
		parts = append(parts, line)
	}

	// Commander sentence. Single line in both directions so we are not
	// rendering "Commanded by X and Y respectively." which always reads
	// awkward when one commander is unknown.
	switch {
	case a.Commander != "" && bSide.Commander != "":
		parts = append(parts, fmt.Sprintf("%s commands against %s.", a.Commander, bSide.Commander))
	case a.Commander != "":
		parts = append(parts, fmt.Sprintf("%s commands.", a.Commander))
	case bSide.Commander != "":
		parts = append(parts, fmt.Sprintf("%s commands the defence.", bSide.Commander))
	}

	// b is unused beyond the side data above; reference it so the linter
	// stays quiet without changing the function signature.
	_ = b

	return strings.Join(parts, " ")
}

// strengthSentence renders one side's troop strength as a single clean
// sentence. Returns "" when there is no parseable number so the caller can
// drop the line entirely rather than emit "Athens deploys ." with a blank.
func strengthSentence(name, strength string) string {
	if name == "" || strength == "" {
		return ""
	}
	count := parseLargestCasualtyNumber(strength)
	if count > 0 {
		return fmt.Sprintf("%s fields about %s.", name, humanizeCount(count))
	}
	return ""
}

// factionDisplay returns the cleaned faction name, falling back to "" if
// nothing useful is available.
func factionDisplay(s Side) string {
	return strings.TrimSpace(s.Name)
}

// shortFaction trims a long name down so it fits inside a unit label.
func shortFaction(s Side) string {
	n := strings.TrimSpace(s.Name)
	if len(n) > 28 {
		return n[:27] + "…"
	}
	if n == "" {
		return "Unknown"
	}
	return n
}
