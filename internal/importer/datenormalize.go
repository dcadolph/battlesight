package importer

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
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

	// isoDayRe matches a bare ISO date, or the spaced en-dash form the
	// separator rewrite used to make of one ("2023 – 10 – 04").
	isoDayRe = regexp.MustCompile(`^` + isoDayPattern + `$`)

	// isoRangeRe matches two such dates joined by "to" or a dash.
	isoRangeRe = regexp.MustCompile(`^` + isoDayPattern + `\s+(?:to|-|–)\s+` + isoDayPattern + `$`)
)

// isoDayPattern is one ISO calendar date with hyphen or spaced en-dash
// separators, capturing year, month and day.
const isoDayPattern = `(\d{4})(?:-| – )(\d{2})(?:-| – )(\d{2})`

// isoDate is a calendar date read from an ISO string.
type isoDate struct {
	// Year is the year, always positive.
	Year int
	// Month is the month, 1 to 12.
	Month int
	// Day is the day of the month, 1 to 31.
	Day int
}

// iso renders the date as a zero-padded ISO string.
func (d isoDate) iso() string {
	return fmt.Sprintf("%04d-%02d-%02d", d.Year, d.Month, d.Day)
}

// prose renders the date as "4 October 2023".
func (d isoDate) prose() string {
	return fmt.Sprintf("%d %s %d", d.Day, monthNames[d.Month], d.Year)
}

// parseISOParts builds an isoDate from captured year, month and day digits
// and reports false when any part is out of range.
func parseISOParts(y, m, d string) (isoDate, bool) {
	year, errY := strconv.Atoi(y)
	month, errM := strconv.Atoi(m)
	day, errD := strconv.Atoi(d)
	if errY != nil || errM != nil || errD != nil {
		return isoDate{}, false
	}
	if year < 1 || month < 1 || month > 12 || day < 1 || day > 31 {
		return isoDate{}, false
	}
	return isoDate{Year: year, Month: month, Day: day}, true
}

// canonicalISODate renders a bare ISO date or ISO range, or the en-dash
// mangling of either, as display prose together with its ISO date range. It
// reports false when s is not one of those forms.
//
// When coarse is true a single date on 1 January renders as its year alone and
// a single date on the first of any other month renders as month and year.
// Wikidata returns year-precision and month-precision values padded to those
// days, so for its rows the padded day is not a real day. Ranges keep their
// days, since only curated rows carry ISO ranges.
func canonicalISODate(s string, coarse bool) (string, DateRange, bool) {
	if m := isoDayRe.FindStringSubmatch(s); m != nil {
		d, ok := parseISOParts(m[1], m[2], m[3])
		if !ok {
			return "", DateRange{}, false
		}
		switch {
		case coarse && d.Month == 1 && d.Day == 1:
			return formatYearLabel(d.Year), yearFallback(d.Year), true
		case coarse && d.Day == 1:
			return fmt.Sprintf("%s %d", monthNames[d.Month], d.Year), DateRange{
				Start: fmt.Sprintf("%04d-%02d-01", d.Year, d.Month),
				End:   fmt.Sprintf("%04d-%02d-28", d.Year, d.Month),
			}, true
		}
		return d.prose(), DateRange{Start: d.iso(), End: d.iso()}, true
	}
	m := isoRangeRe.FindStringSubmatch(s)
	if m == nil {
		return "", DateRange{}, false
	}
	start, okS := parseISOParts(m[1], m[2], m[3])
	end, okE := parseISOParts(m[4], m[5], m[6])
	if !okS || !okE || end.iso() < start.iso() {
		return "", DateRange{}, false
	}
	dr := DateRange{Start: start.iso(), End: end.iso()}
	switch {
	case start == end:
		return start.prose(), dr, true
	case start.Year == end.Year && start.Month == end.Month:
		return fmt.Sprintf("%d – %s", start.Day, end.prose()), dr, true
	case start.Year == end.Year:
		return fmt.Sprintf("%d %s – %s", start.Day, monthNames[start.Month], end.prose()), dr, true
	}
	return start.prose() + " – " + end.prose(), dr, true
}

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
//   - A bare ISO date or ISO range, or its spaced en-dash mangling, renders
//     as prose ("4 October 2023") before any separator rewrite can touch it.
//   - "-" or "—" between date tokens becomes " – " (en-dash with spaces).
//   - Internal whitespace collapses.
func normalizeDateString(s string) string {
	if s == "" {
		return ""
	}
	if display, _, ok := canonicalISODate(strings.TrimSpace(s), false); ok {
		return display
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
// using normalizeDateString and, whenever it rewrites a date, recomputes
// date_start and date_end from the new string so the two never disagree. ISO
// forms take their range straight from the ISO digits, with the Wikidata
// precision guard of canonicalISODate for wikidata rows. Other rewrites
// reparse the prose and keep the stored range when the prose does not parse.
// Idempotent because a normalized value passes through the rewrite unchanged.
func canoniseDateStrings(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, date, date_start, date_end, year, source FROM battles WHERE date != ''`)
	if err != nil {
		return 0, fmt.Errorf("query dates: %w", err)
	}
	type row struct {
		id, date, start, end, source string
		year                         int
	}
	var pending []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.date, &r.start, &r.end, &r.year, &r.source); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan date row: %w", err)
		}
		pending = append(pending, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate date rows: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin date tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx,
		`UPDATE battles SET date = ?, date_start = ?, date_end = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare date update: %w", err)
	}
	defer stmt.Close()

	rewritten := 0
	for _, r := range pending {
		display, dr, ok := canonicalISODate(strings.TrimSpace(r.date), r.source == "wikidata")
		if !ok {
			display = normalizeDateString(r.date)
			dr = ParseDateRange(display, r.year)
		}
		if display == r.date {
			continue
		}
		if dr.Start == "" || dr.End == "" {
			dr = DateRange{Start: r.start, End: r.end}
		}
		if _, err := stmt.ExecContext(ctx, display, dr.Start, dr.End, r.id); err != nil {
			return rewritten, fmt.Errorf("update date for %s: %w", r.id, err)
		}
		rewritten++
	}
	if err := tx.Commit(); err != nil {
		return rewritten, fmt.Errorf("commit date rewrites: %w", err)
	}
	return rewritten, nil
}
