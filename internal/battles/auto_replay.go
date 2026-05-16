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

// schematicEngagement is the second phase: forces meet.
func schematicEngagement(a, bSide Side, unitType string) Phase {
	narration := "Both sides close to engagement range. Lines meet near the center of the field."
	if a.Commander != "" && bSide.Commander != "" {
		narration = fmt.Sprintf("Lines under %s and %s close to engagement range and meet near the center of the field.",
			a.Commander, bSide.Commander)
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
func schematicOutcome(b Battle, a, bSide Side, unitType string) Phase {
	loserStatus := "broken"
	winnerNote := "carries the field"
	if b.Victor == "" {
		return Phase{
			Title:      "Outcome",
			Narration:  "The action concludes; the engagement is recorded as indecisive in the available record.",
			TimeMarker: "End of action",
			DurationMs: 5000,
			Units: []Unit{
				{Label: shortFaction(a), Faction: "a", UnitType: unitType, X: 38, Y: 50, W: 16, H: 22, Strength: 2},
				{Label: shortFaction(bSide), Faction: "b", UnitType: unitType, X: 62, Y: 50, W: 16, H: 22, Strength: 2},
			},
		}
	}
	narration := fmt.Sprintf("%s %s.", b.Victor, winnerNote)
	if a.Casualties != "" || bSide.Casualties != "" {
		var cas []string
		if a.Casualties != "" {
			cas = append(cas, fmt.Sprintf("%s casualties for %s", a.Casualties, shortFaction(a)))
		}
		if bSide.Casualties != "" {
			cas = append(cas, fmt.Sprintf("%s for %s", bSide.Casualties, shortFaction(bSide)))
		}
		if len(cas) > 0 {
			narration += " " + strings.Join(cas, "; ") + "."
		}
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

// buildDeploymentNarration writes the opening narration using whatever side
// metadata is available.
func buildDeploymentNarration(b Battle, a, bSide Side) string {
	parts := []string{}
	left := shortFaction(a)
	right := shortFaction(bSide)
	if a.Strength != "" && bSide.Strength != "" {
		parts = append(parts, fmt.Sprintf("%s (%s) faces %s (%s).", left, a.Strength, right, bSide.Strength))
	} else if a.Strength != "" {
		parts = append(parts, fmt.Sprintf("%s deploys %s opposite %s.", left, a.Strength, right))
	} else if bSide.Strength != "" {
		parts = append(parts, fmt.Sprintf("%s deploys against %s (%s).", left, right, bSide.Strength))
	} else if right != "" {
		parts = append(parts, fmt.Sprintf("%s deploys opposite %s.", left, right))
	} else if left != "" {
		parts = append(parts, fmt.Sprintf("%s takes the field.", left))
	}
	if a.Commander != "" && bSide.Commander != "" {
		parts = append(parts, fmt.Sprintf("Commanded by %s and %s respectively.", a.Commander, bSide.Commander))
	}
	if len(parts) == 0 {
		parts = append(parts, "Both sides take the field.")
	}
	return strings.Join(parts, " ")
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
