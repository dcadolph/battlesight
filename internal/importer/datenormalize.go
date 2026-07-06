package importer

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"
)

// monthNames is the canonical full month list used when rebuilding date
// strings. Indexed 1-12 with a blank zero slot so monthNames[m] is a
// natural lookup. Always full names, never abbreviations, because the
// display surface in the app has the room and prefers "September" over
// "Sep" for the editorial feel.
var monthNames = []string{
	"",
	"January", "February", "March", "April",
	"May", "June", "July", "August",
	"September", "October", "November", "December",
}

var (
	// trailingParensRe scrubs the empty " ()" that the Wikipedia infobox
	// extractor leaves behind when a footnote was the only content of the
	// parenthetical. Caught in actual rows like "30 September – 18 October
	// 1944, ()".
	trailingParensRe = regexp.MustCompile(`[,]?\s*\(\s*\)\s*$`)

	// compoundEngagementRe splits compound dates like "First battle: ...,
	// Second battle: ..." and keeps the first segment.
	compoundEngagementRe = regexp.MustCompile(`(?i)^\s*(?:first|main)\s+(?:battle|engagement|phase)[:,]\s*`)

	// slashDayRangeRe rewrites "27/28 September 1941" into a normal day
	// range form. The "/" is occasionally used for "the night of 27 to 28".
	slashDayRangeRe = regexp.MustCompile(`\b(\d{1,2})\s*/\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{3,4})`)

	// dateSeparator catches "-", "—", or "–" used as a range separator and
	// replaces with the canonical en-dash with surrounding spaces. Only
	// rewrites when the surrounding tokens are date-like (digit or letter)
	// to avoid eating hyphens inside proper names. The en-dash is included
	// so "13–16 December" (already an en-dash but no spaces) gets the
	// surrounding spaces inserted.
	dateSeparator = regexp.MustCompile(`(\d|[A-Za-z])\s*[-—–]\s*(\d|[A-Za-z])`)
)

// normalizeDateString rewrites a free-form date field into the canonical
// form the rest of the app prefers. The transform is conservative; it
// preserves the structure of the original string but normalises punctuation,
// month order, and the surrounding whitespace. Unparseable inputs pass
// through unchanged so a strange one-off does not become a regression.
//
// Rules:
//
//   - Trailing empty parentheses "(...)" are stripped.
//   - Compound "First battle: ..., Second battle: ..." keeps the first
//     segment only.
//   - US "Month D, YYYY" rewrites to UK "D Month YYYY".
//   - US "Month D – Month D, YYYY" rewrites to UK form.
//   - Slash day ranges "27/28 September 1941" rewrite to en-dash form.
//   - "-" or "—" between date tokens becomes " – " (en-dash with spaces).
//   - Internal whitespace collapses.
func normalizeDateString(s string) string {
	if s == "" {
		return ""
	}
	out := s

	// 1. Strip trailing empty parens.
	out = trailingParensRe.ReplaceAllString(out, "")

	// 2. Compound-engagement guard: keep first segment only.
	if compoundEngagementRe.MatchString(out) {
		out = compoundEngagementRe.ReplaceAllString(out, "")
		if i := strings.Index(strings.ToLower(out), ", second"); i > 0 {
			out = strings.TrimSpace(out[:i])
		}
	}

	// 3. US "Month D – Month D, YYYY" cross-month range to UK form.
	// Done BEFORE the mdyRe single-date rewrite because the range form
	// contains Month-Day pairs that would otherwise be picked off
	// piecewise and leave the range half-rewritten.
	out = usFullRangeRe.ReplaceAllStringFunc(out, func(match string) string {
		m := usFullRangeRe.FindStringSubmatch(match)
		if len(m) != 6 {
			return match
		}
		m1, d1, m2, d2, y := m[1], m[2], m[3], m[4], m[5]
		if monthNum(m1) == 0 || monthNum(m2) == 0 {
			return match
		}
		return fmt.Sprintf("%s %s – %s %s %s", d1, m1, d2, m2, y)
	})

	// 4. US "Month D – D, YYYY" becomes "D – D Month YYYY". Same-month
	// range carrying a single month token. Runs after usFullRangeRe so a
	// cross-month range isn't mis-matched as a same-month one.
	out = usDayRangeRe.ReplaceAllStringFunc(out, func(match string) string {
		m := usDayRangeRe.FindStringSubmatch(match)
		if len(m) != 5 {
			return match
		}
		mn, d1, d2, y := m[1], m[2], m[3], m[4]
		if monthNum(mn) == 0 {
			return match
		}
		return fmt.Sprintf("%s – %s %s %s", d1, d2, mn, y)
	})

	// 5. US "Month D, YYYY" single date to UK form. Runs AFTER range
	// rewrites so a Month-Day pair inside a range isn't picked off as a
	// standalone date and left mis-formatted within the range.
	out = mdyRe.ReplaceAllStringFunc(out, func(match string) string {
		m := mdyRe.FindStringSubmatch(match)
		if len(m) != 4 {
			return match
		}
		monthName, day, year := m[1], m[2], m[3]
		if monthNum(monthName) == 0 {
			return match
		}
		return fmt.Sprintf("%s %s %s", day, monthName, year)
	})

	// 6. Slash day ranges → en-dash day ranges.
	out = slashDayRangeRe.ReplaceAllString(out, "$1 – $2 $3 $4")

	// 7. Hyphen / em-dash / no-space en-dash separator → en-dash with
	// surrounding spaces.
	// Loop because adjacent replacements can leave a fresh dash that the
	// regex only catches on a second pass.
	for {
		next := dateSeparator.ReplaceAllString(out, "$1 – $2")
		if next == out {
			break
		}
		out = next
	}

	// 8. Collapse double whitespace and trim.
	for strings.Contains(out, "  ") {
		out = strings.ReplaceAll(out, "  ", " ")
	}
	out = strings.TrimSpace(out)
	out = strings.TrimRight(out, ",")
	return strings.TrimSpace(out)
}

var (
	// usFullRangeRe matches "Month D – Month D, YYYY" (US style cross-month
	// range with optional comma before the year).
	usFullRangeRe = regexp.MustCompile(`(?i)([A-Za-z]+)\s+(\d{1,2})\s*[–\-]\s*([A-Za-z]+)\s+(\d{1,2})\s*,?\s+(\d{3,4})`)
	// usDayRangeRe matches "Month D – D, YYYY" (US style same-month range
	// with optional comma).
	usDayRangeRe = regexp.MustCompile(`(?i)([A-Za-z]+)\s+(\d{1,2})\s*[–\-]\s*(\d{1,2})\s*,?\s+(\d{3,4})`)
)

// canoniseDateStrings rewrites the display `date` column for every battle
// using normalizeDateString. Idempotent because a normalised value passes
// through the rewrite unchanged. Skips rows whose normalised form is
// identical to the stored value so the write transaction stays small.
func canoniseDateStrings(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, date FROM battles WHERE date != ''`)
	if err != nil {
		return 0, fmt.Errorf("query dates: %w", err)
	}
	type pair struct {
		id, date string
	}
	var pending []pair
	for rows.Next() {
		var p pair
		if err := rows.Scan(&p.id, &p.date); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan date row: %w", err)
		}
		pending = append(pending, p)
	}
	rows.Close()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin date tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET date = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare date update: %w", err)
	}
	defer stmt.Close()

	rewritten := 0
	for _, p := range pending {
		normalised := normalizeDateString(p.date)
		if normalised == p.date {
			continue
		}
		if _, err := stmt.ExecContext(ctx, normalised, p.id); err != nil {
			return rewritten, fmt.Errorf("update date for %s: %w", p.id, err)
		}
		rewritten++
	}
	if err := tx.Commit(); err != nil {
		return rewritten, fmt.Errorf("commit date rewrites: %w", err)
	}
	return rewritten, nil
}
