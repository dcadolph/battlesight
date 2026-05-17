package importer

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/dcadolph/battletrace/internal/battles"
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
	"world-war-2":  {},
	"modern":       {},
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

		// Era must be in the closed set so the timeline bands and themes
		// resolve. A misspelled era silently grays the marker.
		if b.Era == "" {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "era", Message: "required",
			})
		} else if _, ok := validErasSet[b.Era]; !ok {
			rep.Errors = append(rep.Errors, ValidationError{
				ID: b.ID, Field: "era",
				Message: fmt.Sprintf("unknown era %q; valid: ancient medieval early-modern napoleonic industrial world-war-1 world-war-2 modern", b.Era),
			})
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
