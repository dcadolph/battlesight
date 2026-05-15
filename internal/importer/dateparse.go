package importer

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var months = map[string]int{
	"january": 1, "february": 2, "march": 3, "april": 4,
	"may": 5, "june": 6, "july": 7, "august": 8,
	"september": 9, "october": 10, "november": 11, "december": 12,
	"jan": 1, "feb": 2, "mar": 3, "apr": 4,
	"jun": 6, "jul": 7, "aug": 8, "sep": 9,
	"oct": 10, "nov": 11, "dec": 12,
}

// DateRange holds parsed start and end dates in ISO format.
type DateRange struct {
	Start string
	End   string
}

var (
	// "14 July 1864" or "July 14, 1864"
	dmyRe  = regexp.MustCompile(`(?i)(\d{1,2})\s+([A-Za-z]+)\s+(\d{3,4})`)
	mdyRe  = regexp.MustCompile(`(?i)([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{3,4})`)
	// "July 14–15, 1864" or "14–15 July 1864"
	dayRangeRe1 = regexp.MustCompile(`(?i)([A-Za-z]+)\s+(\d{1,2})\s*[–\-]\s*(\d{1,2}),?\s+(\d{3,4})`)
	dayRangeRe2 = regexp.MustCompile(`(?i)(\d{1,2})\s*[–\-]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{3,4})`)
	// "10 July - 31 October 1940" or "July 10 - October 31, 1940"
	fullRangeRe1 = regexp.MustCompile(`(?i)(\d{1,2})\s+([A-Za-z]+)\s*(\d{3,4})?\s*[–\-]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{3,4})`)
	fullRangeRe2 = regexp.MustCompile(`(?i)([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{3,4})\s*[–\-]\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{3,4})`)
	// "September 1939" or "1939"
	monthYearRe = regexp.MustCompile(`(?i)([A-Za-z]+)\s+(\d{3,4})`)
	yearOnlyRe  = regexp.MustCompile(`^-?\d{3,4}$`)
	// BC dates
	bcRe = regexp.MustCompile(`(?i)(\d+)\s*BC`)
	// ISO-ish "1939-09-01"
	isoRe = regexp.MustCompile(`(\d{4})-(\d{2})-(\d{2})`)
)

// ParseDateRange extracts start and end ISO dates from a Wikipedia date string.
// Returns empty strings for unparseable dates.
func ParseDateRange(s string, fallbackYear int) DateRange {
	s = strings.TrimSpace(s)
	if s == "" || s == "0" {
		return yearFallback(fallbackYear)
	}

	// ISO format already.
	if m := isoRe.FindStringSubmatch(s); len(m) == 4 {
		d := m[0]
		return DateRange{Start: d, End: d}
	}

	// BC dates.
	if m := bcRe.FindStringSubmatch(s); len(m) > 1 {
		y, _ := strconv.Atoi(m[1])
		return DateRange{
			Start: fmt.Sprintf("-%04d-01-01", y),
			End:   fmt.Sprintf("-%04d-12-31", y),
		}
	}

	// Full range: "10 July 1940 – 31 October 1940" or "10 July – 31 October 1940"
	if m := fullRangeRe1.FindStringSubmatch(s); len(m) >= 7 {
		d1, m1, y1str := m[1], m[2], m[3]
		d2, m2, y2str := m[4], m[5], m[6]
		if y1str == "" {
			y1str = y2str
		}
		start := buildDate(y1str, m1, d1)
		end := buildDate(y2str, m2, d2)
		if start != "" && end != "" {
			return DateRange{Start: start, End: end}
		}
	}

	// Full range MDY: "July 10, 1940 – October 31, 1940"
	if m := fullRangeRe2.FindStringSubmatch(s); len(m) >= 7 {
		start := buildDate(m[3], m[1], m[2])
		end := buildDate(m[6], m[4], m[5])
		if start != "" && end != "" {
			return DateRange{Start: start, End: end}
		}
	}

	// Day range: "July 14–15, 1864"
	if m := dayRangeRe1.FindStringSubmatch(s); len(m) >= 5 {
		start := buildDate(m[4], m[1], m[2])
		end := buildDate(m[4], m[1], m[3])
		if start != "" && end != "" {
			return DateRange{Start: start, End: end}
		}
	}

	// Day range: "14–15 July 1864"
	if m := dayRangeRe2.FindStringSubmatch(s); len(m) >= 5 {
		start := buildDate(m[4], m[3], m[1])
		end := buildDate(m[4], m[3], m[2])
		if start != "" && end != "" {
			return DateRange{Start: start, End: end}
		}
	}

	// Single date MDY: "July 14, 1864"
	if m := mdyRe.FindStringSubmatch(s); len(m) >= 4 {
		d := buildDate(m[3], m[1], m[2])
		if d != "" {
			return DateRange{Start: d, End: d}
		}
	}

	// Single date DMY: "14 July 1864"
	if m := dmyRe.FindStringSubmatch(s); len(m) >= 4 {
		d := buildDate(m[3], m[2], m[1])
		if d != "" {
			return DateRange{Start: d, End: d}
		}
	}

	// "September 1939"
	if m := monthYearRe.FindStringSubmatch(s); len(m) >= 3 {
		mon := monthNum(m[1])
		if mon > 0 {
			y, _ := strconv.Atoi(m[2])
			if y > 0 {
				return DateRange{
					Start: fmt.Sprintf("%04d-%02d-01", y, mon),
					End:   fmt.Sprintf("%04d-%02d-28", y, mon),
				}
			}
		}
	}

	// Year only.
	if yearOnlyRe.MatchString(s) {
		y, _ := strconv.Atoi(s)
		return yearFallback(y)
	}

	return yearFallback(fallbackYear)
}

// buildDate creates an ISO date string from year, month name, and day strings.
func buildDate(yearStr, monthStr, dayStr string) string {
	y, err := strconv.Atoi(yearStr)
	if err != nil || y == 0 {
		return ""
	}
	mon := monthNum(monthStr)
	if mon == 0 {
		return ""
	}
	d, err := strconv.Atoi(dayStr)
	if err != nil || d < 1 || d > 31 {
		return ""
	}
	return fmt.Sprintf("%04d-%02d-%02d", y, mon, d)
}

// monthNum converts a month name to its number.
func monthNum(s string) int {
	return months[strings.ToLower(strings.TrimSpace(s))]
}

// yearFallback creates a date range from just a year.
func yearFallback(y int) DateRange {
	if y == 0 {
		return DateRange{}
	}
	if y < 0 {
		return DateRange{
			Start: fmt.Sprintf("-%04d-01-01", -y),
			End:   fmt.Sprintf("-%04d-12-31", -y),
		}
	}
	return DateRange{
		Start: fmt.Sprintf("%04d-01-01", y),
		End:   fmt.Sprintf("%04d-12-31", y),
	}
}
