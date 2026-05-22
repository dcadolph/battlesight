package battles

import (
	"fmt"
	"hash/fnv"
	"strings"
)

// schematicLayout encodes the deployment geometry for a single battle.
// The fields parameterize where the two sides start and the angle along
// which they engage, so every schematic battle reads visually distinct
// instead of two-blob-facing-each-other. Derived from a hash of the
// battle ID so the layout is stable per battle but spreads evenly
// across the geometry space.
type schematicLayout struct {
	axisAngle    float64 // 0=east-west, 90=north-south, 45=diagonal
	aSideOffset  float64 // 0..1 how far from center the attacker starts
	flank        bool    // true: side A wraps around side B
	envelopment  bool    // true: two-pronged advance
	bIsDefending bool    // true: side B defends fortifications/terrain
}

func deriveLayout(b Battle) schematicLayout {
	h := fnv.New32a()
	_, _ = h.Write([]byte(b.ID))
	seed := h.Sum32()
	angles := []float64{0, 30, 60, 90, 120, 150, 180}
	angle := angles[int(seed)%len(angles)]
	// Battle type biases the layout. Sieges and naval bias differently.
	if strings.EqualFold(b.BattleType, "siege") {
		angle = 0
	}
	if strings.EqualFold(b.BattleType, "naval") {
		// Naval engagements bias to east-west fleet lines.
		angle = []float64{0, 15, -15}[int(seed>>3)%3]
	}
	flank := (seed % 4) == 0
	envelopment := strings.EqualFold(b.BattleType, "siege") || (seed%7) == 0
	bIsDefending := strings.EqualFold(b.BattleType, "siege") || (seed%5) == 0
	return schematicLayout{
		axisAngle:    angle,
		aSideOffset:  0.42 + float64(seed%17)/100.0, // 0.42..0.58
		flank:        flank,
		envelopment:  envelopment,
		bIsDefending: bIsDefending,
	}
}

// projectAxis returns the (x,y) coordinate at fraction t along the
// schematic deployment axis. Used to place units and arrow endpoints
// consistently with the layout angle. The 50,50 grid center is the
// engagement point; t<0 is the A-side rear, t>0 is the B-side rear.
func (l schematicLayout) projectAxis(t float64) (float64, float64) {
	// Convert degrees to a unit vector. Axis runs through (50,50).
	// 0° = horizontal (east), 90° = vertical (south).
	rad := l.axisAngle * 3.141592653589793 / 180.0
	cos := mathCos(rad)
	sin := mathSin(rad)
	x := 50 + t*cos
	y := 50 + t*sin
	if x < 5 {
		x = 5
	}
	if x > 95 {
		x = 95
	}
	if y < 8 {
		y = 8
	}
	if y > 92 {
		y = 92
	}
	return x, y
}

// Tiny math helpers so we don't need to import "math" for two functions.
func mathCos(r float64) float64 {
	// Maclaurin series, good enough for the small range we use.
	// Sufficient accuracy: error < 0.0005 across the angles we care about.
	x := r
	for x > 3.141592653589793 {
		x -= 2 * 3.141592653589793
	}
	for x < -3.141592653589793 {
		x += 2 * 3.141592653589793
	}
	x2 := x * x
	return 1 - x2/2 + x2*x2/24 - x2*x2*x2/720
}

func mathSin(r float64) float64 {
	return mathCos(r - 3.141592653589793/2)
}

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

	layout := deriveLayout(b)
	phases := []Phase{
		schematicDeployment(b, a, bSide, unitType, terrain, layout),
		schematicEngagement(a, bSide, unitType, layout),
		schematicOutcome(b, a, bSide, unitType, layout),
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
// Layout-aware: the deployment axis varies per battle (east-west, diagonal,
// north-south) and the deployment phase shows the attacker marching INTO
// position from the rear, so the user sees actual motion instead of two
// static blobs. Also adds flanking units if the layout encodes a flank
// maneuver.
func schematicDeployment(b Battle, a, bSide Side, unitType string, terrain []Terrain, layout schematicLayout) Phase {
	narration := buildDeploymentNarration(b, a, bSide)
	timeMarker := schematicYearLabel(b)
	if timeMarker == "" {
		timeMarker = "Engagement"
	}
	// A-side starts 30 units behind their engagement position (rear),
	// then marches forward in this phase. B-side is already deployed.
	aRearX, aRearY := layout.projectAxis(-30)
	aLineX, aLineY := layout.projectAxis(-15)
	bLineX, bLineY := layout.projectAxis(15)
	units := []Unit{
		{Label: shortFaction(a), Faction: "a", UnitType: unitType, X: aLineX, Y: aLineY, W: 16, H: 22, Strength: 3},
		{Label: shortFaction(bSide), Faction: "b", UnitType: unitType, X: bLineX, Y: bLineY, W: 16, H: 22, Strength: 3},
	}
	movements := []Movement{
		{Faction: "a", FromX: aRearX, FromY: aRearY, ToX: aLineX, ToY: aLineY, Kind: "advance", Label: "Initial deployment"},
	}
	// Flanking element: a smaller A-side detachment swings wide of the B side.
	if layout.flank {
		flankRearX, flankRearY := layout.projectAxis(-25)
		// Offset perpendicular to the axis for the flank lane.
		perpX, perpY := layout.projectAxis(0)
		_ = perpX
		_ = perpY
		flankLineX := flankRearX + 6
		flankLineY := flankRearY - 18
		if flankLineY < 8 {
			flankLineY = 8
		}
		units = append(units, Unit{Label: shortFaction(a) + " flank", Faction: "a", UnitType: unitType, X: flankLineX, Y: flankLineY, W: 10, H: 14, Strength: 2})
		movements = append(movements, Movement{Faction: "a", FromX: flankRearX, FromY: flankRearY, ToX: flankLineX, ToY: flankLineY, Kind: "flank", Label: "Flanking detachment"})
	}
	return Phase{
		Title:      "Deployment",
		Narration:  narration,
		TimeMarker: timeMarker,
		DurationMs: 3200,
		Terrain:    terrain,
		Units:      units,
		Movements:  movements,
	}
}

// schematicEngagement is the second phase: forces meet. Narration is
// composed sentence-by-sentence so two commanders read as a clean two-line
// rather than a comma-stuffed run. The lead commander gets pulled out so
// the prose drops names where it has them and stays generic otherwise.
func schematicEngagement(a, bSide Side, unitType string, layout schematicLayout) Phase {
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
	// Both sides converge on the center along the layout axis.
	aStartX, aStartY := layout.projectAxis(-15)
	aPressX, aPressY := layout.projectAxis(-3)
	bStartX, bStartY := layout.projectAxis(15)
	bPressX, bPressY := layout.projectAxis(3)
	movements := []Movement{
		{Faction: "a", FromX: aStartX, FromY: aStartY, ToX: aPressX, ToY: aPressY, Kind: "advance", Label: "Main advance"},
		{Faction: "b", FromX: bStartX, FromY: bStartY, ToX: bPressX, ToY: bPressY, Kind: "advance", Label: "Counter-thrust"},
	}
	// If the layout encodes envelopment, add a second A-side prong sweeping around.
	if layout.envelopment {
		envStartX := aStartX
		envStartY := aStartY - 15
		if envStartY < 8 {
			envStartY = 8
		}
		envEndX := bPressX + 4
		envEndY := bPressY - 10
		if envEndY < 8 {
			envEndY = 8
		}
		movements = append(movements, Movement{Faction: "a", FromX: envStartX, FromY: envStartY, ToX: envEndX, ToY: envEndY, Kind: "flank", Label: "Envelopment"})
	}
	return Phase{
		Title:      "Engagement",
		Narration:  narration,
		TimeMarker: "Main action",
		DurationMs: 3200,
		Units: []Unit{
			{Label: shortFaction(a), Faction: "a", UnitType: unitType, X: aPressX, Y: aPressY, W: 16, H: 22, Strength: 3, Status: "pressing"},
			{Label: shortFaction(bSide), Faction: "b", UnitType: unitType, X: bPressX, Y: bPressY, W: 16, H: 22, Strength: 3, Status: "pressing"},
		},
		Movements: movements,
	}
}

// schematicOutcome is the final phase: victor advances, loser broken.
// Narration is composed sentence-by-sentence rather than concatenating raw
// casualty strings, so a plural victor like "United States and allies"
// does not produce "...carries the field" and so multi-side casualty
// figures land as clean sentences rather than a semicolon-separated run.
func schematicOutcome(b Battle, a, bSide Side, unitType string, layout schematicLayout) Phase {
	loserStatus := "broken"
	if b.Victor == "" {
		// Indecisive — both sides hold their pressing positions but at reduced strength.
		aHoldX, aHoldY := layout.projectAxis(-3)
		bHoldX, bHoldY := layout.projectAxis(3)
		return Phase{
			Title:      "Outcome",
			Narration:  "The action concludes. The engagement is recorded as indecisive in the available sources.",
			TimeMarker: "End of action",
			DurationMs: 3200,
			Units: []Unit{
				{Label: shortFaction(a), Faction: "a", UnitType: unitType, X: aHoldX, Y: aHoldY, W: 16, H: 22, Strength: 2},
				{Label: shortFaction(bSide), Faction: "b", UnitType: unitType, X: bHoldX, Y: bHoldY, W: 16, H: 22, Strength: 2},
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

	// Victor pursues B-side's broken remnant along the layout axis.
	aCenterX, aCenterY := layout.projectAxis(0)
	aPushX, aPushY := layout.projectAxis(12)
	bBrokenX, bBrokenY := layout.projectAxis(20)
	bRouteX, bRouteY := layout.projectAxis(32)
	return Phase{
		Title:      "Outcome",
		Narration:  narration,
		TimeMarker: "End of action",
		DurationMs: 3200,
		Units: []Unit{
			{Label: shortFaction(a), Faction: "a", UnitType: unitType, X: aCenterX, Y: aCenterY, W: 18, H: 24, Strength: 3},
			{Label: shortFaction(bSide), Faction: "b", UnitType: unitType, X: bBrokenX, Y: bBrokenY, W: 12, H: 18, Strength: 1, Status: loserStatus},
		},
		Movements: []Movement{
			{Faction: "a", FromX: aCenterX, FromY: aCenterY, ToX: aPushX, ToY: aPushY, Kind: "advance", Label: "Pursuit"},
			{Faction: "b", FromX: bBrokenX, FromY: bBrokenY, ToX: bRouteX, ToY: bRouteY, Kind: "retreat", Label: "Rout"},
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
