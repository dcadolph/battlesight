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
)

// Wikidata time precisions used by the reconcile pass.
const (
	precisionYear  = 9
	precisionMonth = 10
	precisionDay   = 11
)

// wikidataTime is a padded ISO date paired with its Wikidata precision.
type wikidataTime struct {
	// Year is the year, negative for BC.
	Year int
	// Month is the month, 1 to 12.
	Month int
	// Day is the day of the month.
	Day int
	// Precision is the Wikidata precision.
	Precision int
}

// parseWikidataTime reads a padded ISO date written by paddedISO.
func parseWikidataTime(iso string, precision int) (wikidataTime, bool) {
	s, sign := iso, 1
	if strings.HasPrefix(s, "-") {
		s, sign = s[1:], -1
	}
	parts := strings.Split(s, "-")
	if len(parts) != 3 {
		return wikidataTime{}, false
	}
	y, errY := strconv.Atoi(parts[0])
	m, errM := strconv.Atoi(parts[1])
	d, errD := strconv.Atoi(parts[2])
	if errY != nil || errM != nil || errD != nil || y == 0 || m < 1 || m > 12 || d < 1 || d > 31 {
		return wikidataTime{}, false
	}
	return wikidataTime{Year: sign * y, Month: m, Day: d, Precision: precision}, true
}

// label renders t at its precision: "1 March 1896", "March 1896" or "1896".
// BC dates and precisions coarser than a year render as the year.
func (t wikidataTime) label(withYear bool) string {
	if t.Year < 0 || t.Precision < precisionMonth {
		return formatYearLabel(t.Year)
	}
	s := monthNames[t.Month]
	if t.Precision >= precisionDay {
		s = strconv.Itoa(t.Day) + " " + s
	}
	if withYear {
		s += " " + strconv.Itoa(t.Year)
	}
	return s
}

// renderWikidataDate renders a Wikidata start and optional end as display prose
// at their precisions. A single date takes its ISO range from ParseDateRange so
// it agrees with every other row, and a range spans the start's period to the
// end's period. It reports false when start does not parse or
// is coarser than a year.
func renderWikidataDate(start string, startPrec int, end string, endPrec int) (string, DateRange, bool) {
	s, ok := parseWikidataTime(start, startPrec)
	if !ok || startPrec < precisionYear {
		return "", DateRange{}, false
	}
	if e, ok := parseWikidataTime(end, endPrec); ok && endPrec >= precisionYear && s.Year > 0 && end > start {
		if display := joinWikidataRange(s, e); display != s.label(true) {
			return display, DateRange{Start: s.periodStart(), End: e.periodEnd()}, true
		}
	}
	display := s.label(true)
	dr := ParseDateRange(display, s.Year)
	if dr.Start == "" {
		dr = yearFallback(s.Year)
	}
	return display, dr, true
}

// periodStart returns the first day of the period t names at its precision.
func (t wikidataTime) periodStart() string {
	switch {
	case t.Precision >= precisionDay:
		return fmt.Sprintf("%04d-%02d-%02d", t.Year, t.Month, t.Day)
	case t.Precision == precisionMonth:
		return fmt.Sprintf("%04d-%02d-01", t.Year, t.Month)
	}
	return fmt.Sprintf("%04d-01-01", t.Year)
}

// periodEnd returns the last day of the period t names at its precision.
func (t wikidataTime) periodEnd() string {
	switch {
	case t.Precision >= precisionDay:
		return fmt.Sprintf("%04d-%02d-%02d", t.Year, t.Month, t.Day)
	case t.Precision == precisionMonth:
		return fmt.Sprintf("%04d-%02d-%02d", t.Year, t.Month, monthEnd(t.Year, t.Month))
	}
	return fmt.Sprintf("%04d-12-31", t.Year)
}

// joinWikidataRange renders a start and end as one range, dropping the start's
// year when both fall in the same year and both name a month.
func joinWikidataRange(s, e wikidataTime) string {
	switch {
	case e.Precision < precisionMonth && s.Precision < precisionMonth:
		if s.Year == e.Year {
			return s.label(true)
		}
		return fmt.Sprintf("%d – %d", s.Year, e.Year)
	case s.Year == e.Year && s.Precision >= precisionMonth && e.Precision >= precisionMonth:
		if s.Month == e.Month && s.Precision == precisionDay && e.Precision == precisionDay {
			if s.Day == e.Day {
				return s.label(true)
			}
			return fmt.Sprintf("%d – %s", s.Day, e.label(true))
		}
		if s.Month == e.Month && s.Precision == e.Precision {
			return s.label(true)
		}
		return s.label(false) + " – " + e.label(true)
	}
	return s.label(true) + " – " + e.label(true)
}

// reconcileRow is one wikidata row as the reconcile pass reads it.
type reconcileRow struct {
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
	// Lat is the stored latitude.
	Lat float64
	// Lng is the stored longitude.
	Lng float64
	// Verified is true for hand-verified rows.
	Verified bool
	// WikidataDate is the Wikidata start as a padded ISO date.
	WikidataDate string
	// Precision is the Wikidata precision of WikidataDate.
	Precision int
	// WikidataEnd is the Wikidata end as a padded ISO date.
	WikidataEnd string
	// EndPrecision is the Wikidata precision of WikidataEnd.
	EndPrecision int
	// Conflict is the pipe-joined P607 label list.
	Conflict string
	// InfoboxDate is the article infobox's date parameter, empty when there is none.
	InfoboxDate string
	// InfoboxChecked is true once the article's infobox date has been read.
	InfoboxChecked bool
}

// reconcileFix is the set of columns the reconcile pass rewrites for one row.
type reconcileFix struct {
	// Year is the new year.
	Year int
	// Date is the new display date.
	Date string
	// Range is the new ISO range.
	Range DateRange
	// War is the new war.
	War string
	// Reasons lists why the row changed, for the log.
	Reasons []string
}

// planReconcile decides what, if anything, the reconcile pass changes on r.
//
// Three rules, each against Wikidata as the source of truth:
//
// Precision restore: a Wikidata start that the padded-day guard of
// canonicalISODate rendered coarser than Wikidata's own precision (a true 1
// March read as "March 1896") is rendered again at the real precision, with the
// Wikidata end when there is one. This applies to verified rows too, because it
// only undoes that guard.
//
// Year reset: an unverified row whose year disagrees with Wikidata (see
// yearDisagrees) takes year, date and range from Wikidata once the article's
// infobox date has been read and backs Wikidata (see infoboxBacksWikidata).
// Otherwise the article and Wikidata dispute the year and the row is left for a
// human. The retired year-enrich pass took its years from maintenance templates
// outside the infobox, so the infobox names the true year for those rows.
//
// Infobox date: an unverified row Wikidata gives no date takes year, date and
// range from the article's infobox date when that names years and not the row's
// own year, and takes date and range alone when the row has no date string.
//
// War reset: an unverified row whose modern war's region excludes its
// coordinates takes the first Wikidata P607 label, or no war. A row whose
// Wikidata conflict is that same war keeps it, since the coordinates are then
// the suspect.
func planReconcile(r reconcileRow) (reconcileFix, bool) {
	fix := reconcileFix{Year: r.Year, Date: r.Date, Range: DateRange{Start: r.DateStart, End: r.DateEnd}, War: r.War}
	changed := false
	coarse, coarseRange, okC := canonicalISODate(r.WikidataDate, true)
	fine, fineRange, okF := renderWikidataDate(r.WikidataDate, r.Precision, r.WikidataEnd, r.EndPrecision)
	if okC && okF && coarse != fine && r.Date == coarse && fix.Range == coarseRange &&
		r.Precision > coarsePrecision(r.WikidataDate) {
		fix.Date, fix.Range = fine, fineRange
		fix.Reasons = append(fix.Reasons, "precision "+coarse+" -> "+fine)
		changed = true
	}
	if yearDisagrees(r.Verified, fix.Year, fix.Date, fix.Range, r.WikidataDate, r.Precision) &&
		r.InfoboxChecked && infoboxBacksWikidata(r.InfoboxDate, parseWikidataYear(r.WikidataDate), fix.Year) {
		wy := parseWikidataYear(r.WikidataDate)
		if display, dr, ok := renderWikidataDate(r.WikidataDate, r.Precision, r.WikidataEnd, r.EndPrecision); ok {
			fix.Reasons = append(fix.Reasons, fmt.Sprintf("year %d %q -> %d %q", fix.Year, fix.Date, wy, display))
			fix.Year, fix.Date, fix.Range = wy, display, dr
			changed = true
		}
	}
	if !r.Verified && r.WikidataDate == "" && r.InfoboxChecked {
		if display, dr, y, ok := infoboxDateProse(r.InfoboxDate); ok {
			switch {
			case y != fix.Year && !slices.Contains(candidateYears(display), fix.Year):
				fix.Reasons = append(fix.Reasons, fmt.Sprintf("infobox year %d %q -> %d %q", fix.Year, fix.Date, y,
					display))
				fix.Year, fix.Date, fix.Range = y, display, dr
				changed = true
			case fix.Date == "0" || fix.Date == "":
				fix.Reasons = append(fix.Reasons, fmt.Sprintf("infobox date %q -> %q", fix.Date, display))
				fix.Date, fix.Range = display, dr
				changed = true
			}
		}
	}
	if !r.Verified {
		probe := AuditRow{War: r.War, Lat: r.Lat, Lng: r.Lng}
		if warOutsideRegion(&probe) {
			conflict, _, _ := strings.Cut(r.Conflict, "|")
			if canonWarKey(conflict) != canonWarKey(r.War) {
				fix.Reasons = append(fix.Reasons, fmt.Sprintf("war %q -> %q", r.War, conflict))
				fix.War = conflict
				changed = true
			}
		}
	}
	return fix, changed
}

// yearDisagrees reports whether an unverified row's year contradicts a Wikidata
// date of year precision or finer. A date string naming the Wikidata year is a
// range that starts there and passes, and so does a single day matching
// Wikidata's month and day in another year (see sameDayOtherYear).
func yearDisagrees(verified bool, year int, date string, dr DateRange, wikidataDate string, precision int) bool {
	if verified || precision < precisionYear {
		return false
	}
	wy := parseWikidataYear(wikidataDate)
	return wy != 0 && wy != year && !slices.Contains(candidateYears(date), wy) &&
		!sameDayOtherYear(dr, wikidataDate, precision)
}

var (
	// startDateTplRe matches {{Start date|Y|M|D}}, {{End date|...}} and their
	// "and age" forms.
	startDateTplRe = regexp.MustCompile(`(?i)\{\{\s*(?:start|end)[ _]date(?:[ _]and[ _]age)?\s*\|([^{}]*)\}\}`)
	// dashTplRe matches the dash templates infobox dates use between two dates.
	dashTplRe = regexp.MustCompile(`(?i)\{\{\s*(?:snd|spnd|ndash|mdash|spaced[ _]ndash|spaced[ _]en[ _]dash|` +
		`en[ _]dash)\s*\}\}`)
	// openTemplateRe matches a template left open by a field cut at its line end.
	openTemplateRe = regexp.MustCompile(`\{\{.*$`)
	// startEndDatesTplRe matches {{Start and end dates|Y|M|D|Y|M|D}}.
	startEndDatesTplRe = regexp.MustCompile(`(?i)\{\{\s*start[ _]and[ _]end[ _]dates\s*\|([^{}]*)\}\}`)
)

// infoboxDateProse renders a raw infobox date parameter as display prose and
// returns it with its ISO range and the first year it names. It reports false
// when the parameter names no year.
func infoboxDateProse(raw string) (string, DateRange, int, bool) {
	s := dashTplRe.ReplaceAllString(raw, " – ")
	s = startEndDatesTplRe.ReplaceAllStringFunc(s, func(m string) string {
		nums := templateNumbers(startEndDatesTplRe.FindStringSubmatch(m)[1])
		if len(nums) < 6 {
			return dateFromParts(nums)
		}
		iso := fmt.Sprintf("%04d-%02d-%02d to %04d-%02d-%02d", nums[0], nums[1], nums[2], nums[3], nums[4], nums[5])
		if display, _, ok := canonicalISODate(iso, false); ok {
			return display
		}
		return dateFromParts(nums[:3]) + " – " + dateFromParts(nums[3:6])
	})
	s = startDateTplRe.ReplaceAllStringFunc(s, func(m string) string {
		return dateFromParts(templateNumbers(startDateTplRe.FindStringSubmatch(m)[1]))
	})
	s = cleanWikitext(s)
	s = strings.TrimRight(strings.ReplaceAll(openTemplateRe.ReplaceAllString(s, ""), "}}", ""), " ,;)(")
	if strings.Count(s, "(") < strings.Count(s, ")") {
		s = strings.TrimSpace(strings.ReplaceAll(s, ")", ""))
	}
	s = normalizeDateString(s)
	years := candidateYears(s)
	if s == "" || len(years) == 0 {
		return "", DateRange{}, 0, false
	}
	dr := ParseDateRange(s, years[0])
	switch {
	case dr.Start == "":
		dr = yearFallback(years[0])
	case years[0] > 0 && !strings.HasPrefix(dr.Start, fmt.Sprintf("%04d-", years[0])):
		dr.Start = fmt.Sprintf("%04d-01-01", years[0])
	}
	return s, dr, years[0], true
}

// infoboxProse returns the display prose of a raw infobox date, or "".
func infoboxProse(raw string) string {
	s, _, _, _ := infoboxDateProse(raw)
	return s
}

// templateNumbers returns the positional numeric parameters of a template body,
// skipping named ones such as df=y.
func templateNumbers(body string) []int {
	var out []int
	for _, p := range strings.Split(body, "|") {
		if strings.Contains(p, "=") {
			continue
		}
		if n, err := strconv.Atoi(strings.TrimSpace(p)); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// dateFromParts renders year, month and day numbers as "4 June 1937", "June
// 1937" or "1937", using as many parts as are present and valid.
func dateFromParts(nums []int) string {
	switch {
	case len(nums) == 0:
		return ""
	case len(nums) >= 3 && nums[1] >= 1 && nums[1] <= 12 && nums[2] >= 1 && nums[2] <= 31:
		return fmt.Sprintf("%d %s %d", nums[2], monthNames[nums[1]], nums[0])
	case len(nums) >= 2 && nums[1] >= 1 && nums[1] <= 12:
		return fmt.Sprintf("%s %d", monthNames[nums[1]], nums[0])
	}
	return strconv.Itoa(nums[0])
}

// infoboxBacksWikidata reports whether an infobox date leaves Wikidata's year
// standing over the row's: it names no year at all, or it names the Wikidata
// year and not the row's. An infobox naming both ("166 BC or 165 BC") or a third
// year is a dispute.
func infoboxBacksWikidata(infoboxDate string, wikidataYear, rowYear int) bool {
	years := candidateYears(infoboxDate)
	return len(years) == 0 || slices.Contains(years, wikidataYear) && !slices.Contains(years, rowYear)
}

// sameDayOtherYear reports whether a day-precision Wikidata date names the same
// month and day as the row's single-day range in another year. That is a year
// typo on one side, and the row's own date, read from the article, is kept.
func sameDayOtherYear(dr DateRange, wikidataDate string, precision int) bool {
	if precision < precisionDay || dr.Start == "" || dr.Start != dr.End || len(dr.Start) < 10 ||
		len(wikidataDate) < 10 {
		return false
	}
	return dr.Start[len(dr.Start)-5:] == wikidataDate[len(wikidataDate)-5:]
}

// coarsePrecision returns the precision the padded-day guard of
// canonicalISODate assumes for a padded ISO date: year on 1 January, month on
// the first of any other month, day otherwise.
func coarsePrecision(iso string) int {
	t, ok := parseWikidataTime(iso, 0)
	switch {
	case !ok:
		return 0
	case t.Month == 1 && t.Day == 1:
		return precisionYear
	case t.Day == 1:
		return precisionMonth
	}
	return precisionDay
}

// reconcileSourceDates checks every wikidata row that carries Wikidata facts
// against them and applies planReconcile. Every changed row is logged with its
// reasons. Rows never checked against Wikidata are left alone.
func reconcileSourceDates(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, year, date, date_start, date_end, war, lat, lng, verified,
		wikidata_date, wikidata_precision, wikidata_end, wikidata_end_precision, wikidata_conflict,
		infobox_date, infobox_checked FROM battles WHERE source = 'wikidata' AND wikidata_checked != ''`)
	if err != nil {
		return 0, fmt.Errorf("query reconcile rows: %w", err)
	}
	type update struct {
		id  string
		fix reconcileFix
	}
	var updates []update
	for rows.Next() {
		var r reconcileRow
		var verified int
		var infoboxChecked string
		if err := rows.Scan(&r.ID, &r.Year, &r.Date, &r.DateStart, &r.DateEnd, &r.War, &r.Lat, &r.Lng, &verified,
			&r.WikidataDate, &r.Precision, &r.WikidataEnd, &r.EndPrecision, &r.Conflict, &r.InfoboxDate,
			&infoboxChecked); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan reconcile row: %w", err)
		}
		r.Verified = verified == 1
		r.InfoboxChecked = infoboxChecked != ""
		if fix, ok := planReconcile(r); ok {
			updates = append(updates, update{id: r.ID, fix: fix})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate reconcile rows: %w", err)
	}
	if len(updates) == 0 {
		return 0, nil
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin reconcile tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET era = CASE WHEN year = ? THEN era ELSE ? END,
		year = ?, date = ?, date_start = ?, date_end = ?, war = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare reconcile update: %w", err)
	}
	defer stmt.Close()
	for _, u := range updates {
		f := u.fix
		if _, err := stmt.ExecContext(ctx, f.Year, yearToEra(f.Year), f.Year, f.Date, f.Range.Start, f.Range.End, f.War,
			u.id); err != nil {
			return 0, fmt.Errorf("reconcile %s: %w", u.id, err)
		}
		log.Printf("reconcile: %s: %s", u.id, strings.Join(f.Reasons, "; "))
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit reconcile: %w", err)
	}
	return len(updates), nil
}
