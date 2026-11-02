package importer

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/dcadolph/battlesight/internal/battles"
)

// warSpanTolerance is how many years a battle may sit outside its war's span,
// so a prelude or an aftermath a year off still files under the war.
const warSpanTolerance = 1

// WarSpan is the year range wars.json gives a war. Zero on either side means
// that side is open.
type WarSpan struct {
	// Start is the first year of the war, negative for BC, 0 when unknown.
	Start int
	// End is the last year of the war, 0 when the war is ongoing or unknown.
	End int
}

// Contains reports whether year falls inside the span, within the tolerance.
func (s WarSpan) Contains(year int) bool {
	if s.Start != 0 && year < s.Start-warSpanTolerance {
		return false
	}
	return s.End == 0 || year <= s.End+warSpanTolerance
}

// WarSpans resolves the span of every war key and alias, keyed by canonWarKey.
// A war with no years of its own takes the span of the first entry up its
// parent chain that has one. A war with no year on its whole chain has no span.
func WarSpans(wars map[string]battles.WarNarrative) map[string]WarSpan {
	out := map[string]WarSpan{}
	for name, w := range wars {
		span, ok := resolveSpan(wars, name)
		if !ok {
			continue
		}
		out[canonWarKey(name)] = span
		for _, a := range w.Aliases {
			out[canonWarKey(a)] = span
		}
	}
	return out
}

// resolveSpan walks from name up its parent chain to the first entry with a
// start or end year. A cycle or a parent that is not a key has no span.
func resolveSpan(wars map[string]battles.WarNarrative, name string) (WarSpan, bool) {
	seen := map[string]bool{}
	for {
		w, ok := wars[name]
		if !ok || seen[name] {
			return WarSpan{}, false
		}
		seen[name] = true
		if w.StartYear != 0 || w.EndYear != 0 {
			return WarSpan{Start: w.StartYear, End: w.EndYear}, true
		}
		if w.Parent == "" {
			return WarSpan{}, false
		}
		name = w.Parent
	}
}

// spanOf returns the span of war in any spelling canonWarKey folds together.
func (w WarNames) spanOf(war string) (WarSpan, bool) {
	s, ok := w.Spans[canonWarKey(war)]
	return s, ok
}

// outsideSpan reports whether a dated row's war has a span that excludes the
// row's year. An undated row, or a war with no span, is never outside.
func (w WarNames) outsideSpan(war string, year int) bool {
	if war == "" || year == 0 {
		return false
	}
	s, ok := w.spanOf(war)
	return ok && !s.Contains(year)
}

var (
	// titleYearRes match a year a title states as the event's own: in
	// parentheses, leading, after a trailing comma, or after "in" or a month
	// name at the end. A bare number elsewhere ("Hill 282", "Operation
	// 1027") is a name, not a year.
	titleYearRes = []*regexp.Regexp{
		regexp.MustCompile(`\((\d{3,4})(?:\s*[–-]\s*\d{2,4})?\)`),
		regexp.MustCompile(`^(\d{4})\s`),
		regexp.MustCompile(`,\s*(\d{3,4})$`),
		regexp.MustCompile(`(?i)(?:\bin|january|february|march|april|may|june|july|august|september|october|` +
			`november|december)\s+(\d{3,4})$`),
	}
	// titleYearBCRe matches a BC year in a title, "Battle of Athens 199 BCE".
	titleYearBCRe = regexp.MustCompile(`(?i)\b(\d{1,4})\s*BCE?\b`)
)

// titleYears returns the years a title states as the event's own, BC years
// negative.
func titleYears(title string) []int {
	title = strings.TrimSpace(title)
	var out []int
	for _, re := range titleYearRes {
		for _, m := range re.FindAllStringSubmatch(title, -1) {
			if y, err := strconv.Atoi(m[1]); err == nil {
				out = append(out, y)
			}
		}
	}
	for _, m := range titleYearBCRe.FindAllStringSubmatch(title, -1) {
		if y, err := strconv.Atoi(m[1]); err == nil {
			out = append(out, -y)
		}
	}
	return out
}

// yearSourced reports whether a source states a row's year: a Wikidata date,
// an infobox date naming that year, or the year the name or Wikipedia title
// gives the event. The retired year-enrich pass wrote years no source states.
func yearSourced(year int, wikidataDate, infoboxDate, name, title string) bool {
	if year == 0 {
		return false
	}
	if parseWikidataYear(wikidataDate) != 0 {
		return true
	}
	if display, _, y, ok := infoboxDateProse(infoboxDate); ok &&
		(y == year || slices.Contains(candidateYears(display), year)) {
		return true
	}
	return slices.Contains(titleYears(name), year) || slices.Contains(titleYears(title), year)
}

// spanFix is one row the war-span pass changes.
type spanFix struct {
	// ID is the battle id.
	ID string
	// Year is the new year, unchanged when only the war clears.
	Year int
	// Date is the new display date.
	Date string
	// Range is the new ISO range.
	Range DateRange
	// War is the new war, empty when it clears.
	War string
	// Reason says why, for the log.
	Reason string
}

// spanRow is one row the war-span pass reads.
type spanRow struct {
	// ID is the battle id.
	ID string
	// Year is the stored year.
	Year int
	// Date is the stored display date.
	Date string
	// DateStart is the stored ISO start.
	DateStart string
	// DateEnd is the stored ISO end.
	DateEnd string
	// War is the stored war.
	War string
	// WikidataDate is the Wikidata start as a padded ISO date.
	WikidataDate string
	// Precision is the Wikidata precision of WikidataDate.
	Precision int
	// WikidataEnd is the Wikidata end as a padded ISO date.
	WikidataEnd string
	// EndPrecision is the Wikidata precision of WikidataEnd.
	EndPrecision int
}

// planSpanFix decides what the war-span pass does to a row whose year falls
// outside its war's span. When the Wikidata year sits inside the span, the
// year is the error and takes Wikidata's date. When the Wikidata year is the
// row's year, or Wikidata gives none, nothing ties the row to the war and the
// war clears. A Wikidata year outside the span that differs from the row's
// year is left for a human, since then Wikidata itself is in doubt.
func planSpanFix(r spanRow, wars WarNames) (spanFix, bool) {
	if !wars.outsideSpan(r.War, r.Year) {
		return spanFix{}, false
	}
	span, _ := wars.spanOf(r.War)
	fix := spanFix{ID: r.ID, Year: r.Year, Date: r.Date, War: r.War,
		Range: DateRange{Start: r.DateStart, End: r.DateEnd}}
	wy := parseWikidataYear(r.WikidataDate)
	switch {
	case wy != 0 && wy != r.Year && span.Contains(wy):
		display, dr, ok := renderWikidataDate(r.WikidataDate, r.Precision, r.WikidataEnd, r.EndPrecision)
		if !ok {
			return spanFix{}, false
		}
		fix.Year, fix.Date, fix.Range = wy, display, dr
		fix.Reason = fmt.Sprintf("year %d outside %q, Wikidata %d inside: date %q",
			r.Year, r.War, wy, display)
	case wy == r.Year || wy == 0:
		fix.War = ""
		fix.Reason = fmt.Sprintf("war %q excludes year %d", r.War, r.Year)
	default:
		return spanFix{}, false
	}
	return fix, true
}

// reconcileWarSpans applies planSpanFix to every unverified wikidata row.
// Curated and verified rows are never touched.
func reconcileWarSpans(ctx context.Context, db *sql.DB, wars WarNames) (int, error) {
	if len(wars.Spans) == 0 {
		return 0, nil
	}
	rows, err := db.QueryContext(ctx, `SELECT id, year, date, date_start, date_end, war, wikidata_date,
		wikidata_precision, wikidata_end, wikidata_end_precision FROM battles
		WHERE source = 'wikidata' AND verified = 0 AND war != '' AND year != 0`)
	if err != nil {
		return 0, fmt.Errorf("scan war-span rows: %w", err)
	}
	var fixes []spanFix
	for rows.Next() {
		var r spanRow
		if err := rows.Scan(&r.ID, &r.Year, &r.Date, &r.DateStart, &r.DateEnd, &r.War, &r.WikidataDate,
			&r.Precision, &r.WikidataEnd, &r.EndPrecision); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan war-span row: %w", err)
		}
		if fix, ok := planSpanFix(r, wars); ok {
			fixes = append(fixes, fix)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate war-span rows: %w", err)
	}
	if len(fixes) == 0 {
		return 0, nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin war-span tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET year = ?, era = ?, date = ?, date_start = ?,
		date_end = ?, war = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare war-span update: %w", err)
	}
	defer stmt.Close()
	for _, f := range fixes {
		_, err := stmt.ExecContext(ctx, f.Year, yearToEra(f.Year), f.Date, f.Range.Start, f.Range.End,
			f.War, f.ID)
		if err != nil {
			return 0, fmt.Errorf("war-span fix %s: %w", f.ID, err)
		}
		log.Printf("war-span: %s: %s", f.ID, f.Reason)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit war-span fixes: %w", err)
	}
	return len(fixes), nil
}

// zeroUnsourcedYears sets year 0 on every undated, unverified wikidata row
// whose year no source states (see yearSourced), and clears its date range and
// era. The row leaves the timeline and stays searchable. Curated and verified
// rows are never touched.
func zeroUnsourcedYears(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, year, wikidata_date, infobox_date, name, wikipedia_title
		FROM battles WHERE source = 'wikidata' AND verified = 0 AND year != 0 AND (date = '' OR date = '0')`)
	if err != nil {
		return 0, fmt.Errorf("scan undated rows: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id, wdDate, ibDate, name, title string
		var year int
		if err := rows.Scan(&id, &year, &wdDate, &ibDate, &name, &title); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan undated row: %w", err)
		}
		if !yearSourced(year, wdDate, ibDate, name, title) {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate undated rows: %w", err)
	}
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin unsourced-year tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET year = 0, era = '', date = '', date_start = '',
		date_end = '' WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare unsourced-year update: %w", err)
	}
	defer stmt.Close()
	for _, id := range ids {
		if _, err := stmt.ExecContext(ctx, id); err != nil {
			return 0, fmt.Errorf("zero unsourced year for %s: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit unsourced years: %w", err)
	}
	return len(ids), nil
}
