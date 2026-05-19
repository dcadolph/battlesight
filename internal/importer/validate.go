package importer

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/dcadolph/battlesight/internal/battles"
)

// ValidationError is one problem found in a single curated battle. Field
// names match the JSON keys to keep the operator's mental model aligned
// with what they typed.
type ValidationError struct {
	// ID is the battle's curated slug. Empty when the record has no ID.
	ID string
	// Field is the JSON key the error applies to.
	Field string
	// Message is a one-line operator-facing description.
	Message string
}

// Error implements the error interface so a single ValidationError can be
// returned from helpers that fail on a single record.
func (v ValidationError) Error() string {
	if v.ID == "" {
		return fmt.Sprintf("%s: %s", v.Field, v.Message)
	}
	return fmt.Sprintf("%s.%s: %s", v.ID, v.Field, v.Message)
}

// ValidationReport accumulates every problem found in a batch of curated
// battles. Errors are hard problems that must block an import; Warnings
// are soft signals (missing significance prose, weak commander data) that
// a curator should fix but do not block the pipeline.
type ValidationReport struct {
	// Errors is the list of blocking problems.
	Errors []ValidationError
	// Warnings is the list of non-blocking problems.
	Warnings []ValidationError
}

// HasErrors reports whether the report contains any blocking issues.
func (r ValidationReport) HasErrors() bool {
	return len(r.Errors) > 0
}

// FormatReport renders the report as human-readable text, one issue per
// line, errors first then warnings. Returns "" if the report is clean.
func (r ValidationReport) FormatReport() string {
	if len(r.Errors) == 0 && len(r.Warnings) == 0 {
		return ""
	}
	var b strings.Builder
	if len(r.Errors) > 0 {
		fmt.Fprintf(&b, "%d error(s):\n", len(r.Errors))
		for _, e := range r.Errors {
			fmt.Fprintf(&b, "  ✗ %s\n", e.Error())
		}
	}
	if len(r.Warnings) > 0 {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "%d warning(s):\n", len(r.Warnings))
		for _, w := range r.Warnings {
			fmt.Fprintf(&b, "  ! %s\n", w.Error())
		}
	}
	return b.String()
}

// validErasSet is the closed set of era keys the rest of the app expects.
// Curators must pick from this list; new eras require an app-wide rollout
// (era theme colors, timeline bands, etc.).
var validErasSet = map[string]struct{}{
	"ancient":      {},
	"medieval":     {},
	"early-modern": {},
	"napoleonic":   {},
	"industrial":   {},
	"world-war-1":  {},
	"interwar":     {},
	"world-war-2":  {},
	// "modern" used to cover 1946 → today. Split at 1991 (USSR collapse)
	// so the cold-war proxies and the post-Soviet contemporary wars sit in
	// their own buckets. Front-end ERA_RANGES and theme map mirror this.
	"cold-war":     {},
	"contemporary": {},
}

// validBattleTypesSet is the closed set of battle types. Used both for
// rendering decisions in the UI (icon, default unit type for the schematic
// replay) and for filtering in the command bar.
var validBattleTypesSet = map[string]struct{}{
	"land":       {},
	"naval":      {},
	"siege":      {},
	"air":        {},
	"amphibious": {},
}

// idPattern matches the slug format every curated ID must take: lowercase
// letters, digits, and hyphens. No spaces, no underscores, no uppercase.
var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$`)

// eraYearRange bounds the calendar years that legitimately belong inside an
// era. The validator uses this to flag mismatches between b.Year and b.Era
// (a battle dated 1500 tagged as "ancient" is a curation typo). Bounds are
// half-open on the upper end so the cliff edges match the front-end era
// pickers in web/src/theme/era.ts.
var eraYearRange = map[string][2]int{
	"ancient":      {-3000, 500},
	"medieval":     {500, 1500},
	"early-modern": {1500, 1700},
	"napoleonic":   {1700, 1820},
	"industrial":   {1820, 1914},
	"world-war-1":  {1914, 1919},
	"interwar":     {1919, 1939},
	"world-war-2":  {1939, 1946},
	"cold-war":     {1946, 1991},
	"contemporary": {1991, 2100},
}

// eraCasualtyCap bounds the largest plausible single-battle total casualty
// figure for each era. These are deliberately generous: the goal is to
// catch order-of-magnitude data-entry errors (a 19th-century skirmish with
// "5,000,000 casualties" almost always means 5,000) without flagging the
// extreme but real cases like Stalingrad or the Somme.
var eraCasualtyCap = map[string]int{
	"ancient":      250_000,
	"medieval":     500_000,
	"early-modern": 500_000,
	"napoleonic":   1_000_000,
	"industrial":   1_500_000,
	"world-war-1":  5_000_000,
	"interwar":     2_000_000,
	"world-war-2":  10_000_000,
	"cold-war":     3_000_000,
	"contemporary": 2_000_000,
}

// landBattleTypes are the battle types that should sit on dry land. Naval
// and amphibious battles legitimately have water-side coordinates and are
// not subject to the open-ocean gate. Air engagements (dogfights, bombing
// runs) can happen over water too, so we exempt them.
var landBattleTypes = map[string]struct{}{
	"land":  {},
	"siege": {},
}

// deepOceanBoxes is a small list of lat/lng rectangles that are reliably
// open ocean — far enough from coast that any land-typed battle landing
// inside is almost certainly a bad import. Deliberately conservative: the
// boxes carve out only the deepest sections so coastal naval bases like
// Pearl Harbor stay safe. Used by the open-ocean gate for non-naval and
// non-air battle types.
var deepOceanBoxes = []struct {
	LatLo, LatHi, LngLo, LngHi float64
	Name                       string
}{
	{LatLo: 15, LatHi: 55, LngLo: -55, LngHi: -25, Name: "deep North Atlantic"},
	{LatLo: -45, LatHi: -10, LngLo: -30, LngHi: 5, Name: "deep South Atlantic"},
	{LatLo: -40, LatHi: 50, LngLo: -150, LngHi: -125, Name: "deep East Pacific"},
	{LatLo: -45, LatHi: 40, LngLo: 165, LngHi: 180, Name: "deep West Pacific"},
	{LatLo: -45, LatHi: 40, LngLo: -180, LngHi: -160, Name: "central Pacific"},
	{LatLo: -45, LatHi: -10, LngLo: 65, LngHi: 100, Name: "deep Indian Ocean"},
	{LatLo: -85, LatHi: -65, LngLo: -180, LngHi: 180, Name: "Southern Ocean"},
	{LatLo: 84, LatHi: 90, LngLo: -180, LngHi: 180, Name: "deep Arctic Ocean"},
}

// inDeepOcean returns the name of the deep-ocean box containing (lat, lng),
// or "" when the point is not inside any of the gated rectangles.
func inDeepOcean(lat, lng float64) string {
	for _, b := range deepOceanBoxes {
		if lat >= b.LatLo && lat <= b.LatHi && lng >= b.LngLo && lng <= b.LngHi {
			return b.Name
		}
	}
	return ""
}

// largestCasualtyNumber extracts the largest integer from a free-form
// casualty string ("15,000 killed; 8,000 wounded" → 15000). Used by the
// validator to apply era-aware casualty caps as a warning. Commas are
// stripped so thousand-separated values parse correctly. Returns 0 when
// the string contains no plausible number.
func largestCasualtyNumber(s string) int {
	if s == "" {
		return 0
	}
	best := 0
	cur := 0
	inNumber := false
	flush := func() {
		if inNumber && cur > best {
			best = cur
		}
		cur = 0
		inNumber = false
	}
	for _, ch := range s {
		switch {
		case ch >= '0' && ch <= '9':
			cur = cur*10 + int(ch-'0')
			inNumber = true
		case ch == ',':
			// Thousands separator inside a number; only swallow when we're
			// already in a number. A leading comma resets.
			if !inNumber {
				flush()
			}
		default:
			flush()
		}
	}
	flush()
	return best
}

// ValidateBattles walks a batch of curated battles and returns every issue
// found. The function does not stop at the first problem so a curator
// editing a file with multiple mistakes sees all of them at once.
func ValidateBattles(bs []battles.Battle) ValidationReport {
	var rep ValidationReport
	seen := make(map[string]struct{})

	for _, b := range bs {
		// ID checks. A bad ID is the most disorienting failure mode because
		// downstream code keys everything off it, so we are strict here.
		if b.ID == "" {
			rep.Errors = append(rep.Errors, ValidationError{
				Field: "id", Message: "required, cannot be empty",
			})
		} else {
			if !idPattern.MatchString(b.ID) {
				rep.Errors = append(rep.Errors, ValidationError{
					ID: b.ID, Field: "id",
					Message: "must be lowercase letters, digits, and hyphens only (no spaces, no underscores)",
				})
			}
			if _, dup := seen[b.ID]; dup {
				rep.Errors = append(rep.Errors, ValidationError{
					ID: b.ID, Field: "id", Message: "duplicate ID in this batch",
				})
			} else {
				seen[b.ID] = struct{}{}
			}
		}

		// Name is the user-visible headline; everything else can be sparse
		// but this one must be present.
		if strings.TrimSpace(b.Name) == "" {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "name", Message: "required, cannot be empty or whitespace",
			})
		}

		// Year is the timeline anchor. Year 0 is reserved as "unknown" and
		// is not a valid curated value (there is no calendar year 0).
		if b.Year == 0 {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "year", Message: "required, must be a non-zero calendar year (BC is negative)",
			})
		}
		if b.Year < -3000 || b.Year > 2100 {
			rep.Warnings = append(rep.Warnings, ValidationError{
				ID: b.ID, Field: "year", Message: fmt.Sprintf("unusual value %d, double-check", b.Year),
			})
		}

		// Coordinate checks. Exact zero on either axis is the import
		// sentinel for "unknown" and is forbidden in curated entries — if
		// the curator does not know the coords, they should not be adding
		// the battle yet.
		if b.Lat == 0 && b.Lng == 0 {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "lat,lng",
				Message: "both coordinates are zero, which is the unknown-coord sentinel and not a real location",
			})
		} else {
			if b.Lat == 0 {
				rep.Errors = append(rep.Errors, ValidationError{
					ID: b.ID, Field: "lat",
					Message: "exact zero is reserved as a sentinel; if the battle is on the equator, use 0.0001",
				})
			}
			if b.Lng == 0 {
				rep.Errors = append(rep.Errors, ValidationError{
					ID: b.ID, Field: "lng",
					Message: "exact zero is reserved as a sentinel; if the battle is on the Prime Meridian, use 0.0001",
				})
			}
		}
		if b.Lat < -90 || b.Lat > 90 {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "lat", Message: "must be in range [-90, 90]",
			})
		}
		if b.Lng < -180 || b.Lng > 180 {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "lng", Message: "must be in range [-180, 180]",
			})
		}

		// Open-ocean gate. Land and siege battles cannot sit in the middle
		// of an ocean: that almost always means the coords were pulled
		// from the wrong Wikidata location field, or a name collision
		// (e.g. "Battle of Hastings" matched a ship named Hastings).
		// Naval, air, and amphibious types legitimately operate over
		// water and are exempt.
		if _, isLand := landBattleTypes[b.BattleType]; isLand && (b.Lat != 0 || b.Lng != 0) {
			if box := inDeepOcean(b.Lat, b.Lng); box != "" {
				rep.Errors = append(rep.Errors, ValidationError{
					ID: b.ID, Field: "lat,lng",
					Message: fmt.Sprintf("land/siege battle plotted inside %s at (%.3f, %.3f); coordinates look wrong", box, b.Lat, b.Lng),
				})
			}
		}

		// Era must be in the closed set so the timeline bands and themes
		// resolve. A misspelled era silently grays the marker.
		if b.Era == "" {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "era", Message: "required",
			})
		} else if _, ok := validErasSet[b.Era]; !ok {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "era",
				Message: fmt.Sprintf("unknown era %q; valid: ancient medieval early-modern napoleonic industrial world-war-1 interwar world-war-2 cold-war contemporary", b.Era),
			})
		} else if b.Year != 0 {
			// Year/era alignment: a battle dated 1500 tagged as "ancient"
			// is almost certainly a typo. The 1919-1938 interwar gap is
			// not in the eraYearRange map so years inside it match no
			// era and silently pass; that is intentional because no
			// front-end era currently covers interwar engagements.
			if r, ok := eraYearRange[b.Era]; ok {
				if b.Year < r[0] || b.Year >= r[1] {
					rep.Errors = append(rep.Errors, ValidationError{
						ID: b.ID, Field: "era,year",
						Message: fmt.Sprintf("era %q expects years in [%d, %d) but battle year is %d", b.Era, r[0], r[1], b.Year),
					})
				}
			}
		}

		// Battle type is required because the UI uses it for filtering and
		// the auto-replay picks unit icons from it.
		if b.BattleType == "" {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "battleType", Message: "required",
			})
		} else if _, ok := validBattleTypesSet[b.BattleType]; !ok {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "battleType",
				Message: fmt.Sprintf("unknown battle type %q; valid: land naval siege air amphibious", b.BattleType),
			})
		}

		// War is required for curated battles so they roll up into the
		// war-playback browser.
		if strings.TrimSpace(b.War) == "" {
			rep.Warnings = append(rep.Warnings, ValidationError{
				ID: b.ID, Field: "war",
				Message: "empty; battle will not appear in any war's playback",
			})
		}

		// Sides. A real battle has at least two; everything else is a
		// curation error.
		if len(b.Sides) < 2 {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "sides",
				Message: fmt.Sprintf("need at least 2 sides, got %d", len(b.Sides)),
			})
		}
		if len(b.Sides) > 4 {
			rep.Warnings = append(rep.Warnings, ValidationError{
				ID: b.ID, Field: "sides",
				Message: fmt.Sprintf("%d sides, only the first 4 will render in the outro", len(b.Sides)),
			})
		}
		// Casualty sanity bounds: read the largest integer from each
		// side's casualty string and compare against an era-aware cap. A
		// warning rather than error because legitimately extreme cases
		// (Stalingrad, Cannae, Verdun) exist and the cap is generous.
		cap, hasCap := eraCasualtyCap[b.Era]
		for i, s := range b.Sides {
			if strings.TrimSpace(s.Name) == "" {
				rep.Errors = append(rep.Errors, ValidationError{
					ID:      b.ID,
					Field:   fmt.Sprintf("sides[%d].name", i),
					Message: "required",
				})
			}
			if s.Commander == "" {
				rep.Warnings = append(rep.Warnings, ValidationError{
					ID:      b.ID,
					Field:   fmt.Sprintf("sides[%d].commander", i),
					Message: "empty; consider adding for richer dossier",
				})
			}
			if hasCap {
				if n := largestCasualtyNumber(s.Casualties); n > cap {
					rep.Warnings = append(rep.Warnings, ValidationError{
						ID:      b.ID,
						Field:   fmt.Sprintf("sides[%d].casualties", i),
						Message: fmt.Sprintf("largest figure %d exceeds %s era cap of %d; double-check the order of magnitude", n, b.Era, cap),
					})
				}
			}
		}

		// Summary is the dossier's "stake line" source. Significance is the
		// outro narration. At least one should be present so the dossier
		// has something to say beyond the metadata strip.
		if strings.TrimSpace(b.Summary) == "" && strings.TrimSpace(b.Significance) == "" {
			rep.Warnings = append(rep.Warnings, ValidationError{
				ID: b.ID, Field: "summary,significance",
				Message: "both empty; dossier will render only the side cards",
			})
		}
	}

	return rep
}
