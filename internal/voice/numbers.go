package voice

import (
	"regexp"
	"strconv"
	"strings"
)

var (
	// ones names the numbers below twenty.
	ones = []string{
		"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
		"eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
		"nineteen",
	}
	// tens names the multiples of ten, indexed by the tens digit.
	tens = []string{"", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"}
	// ordinalIrregular maps the number words whose ordinal is not formed by adding "th".
	ordinalIrregular = map[string]string{
		"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth",
		"nine": "ninth", "twelve": "twelfth",
	}
)

// cardinal returns n in words, as in "one hundred and five". It covers 0 to 999,999.
func cardinal(n int) string {
	switch {
	case n < 20:
		return ones[n]
	case n < 100:
		if n%10 == 0 {
			return tens[n/10]
		}
		return tens[n/10] + "-" + ones[n%10]
	case n < 1000:
		words := ones[n/100] + " hundred"
		if n%100 != 0 {
			words += " and " + cardinal(n%100)
		}
		return words
	}
	words := cardinal(n/1000) + " thousand"
	switch rest := n % 1000; {
	case rest == 0:
	case rest < 100:
		words += " and " + cardinal(rest)
	default:
		words += " " + cardinal(rest)
	}
	return words
}

// ordinal returns n as an ordinal in words, as in "fourteenth" or "twenty-first".
func ordinal(n int) string {
	words := cardinal(n)
	cut := strings.LastIndexAny(words, " -") + 1
	head, last := words[:cut], words[cut:]
	if word, ok := ordinalIrregular[last]; ok {
		return head + word
	}
	if strings.HasSuffix(last, "y") {
		return head + strings.TrimSuffix(last, "y") + "ieth"
	}
	return head + last + "th"
}

// yearWords returns a year from 1000 to 2099 the way a narrator says it, as in "sixteen thirty-two",
// "nineteen oh five", "eleven hundred", or "two thousand and twenty-two".
func yearWords(year int) string {
	if year == 1000 {
		return "one thousand"
	}
	if year >= 2000 {
		if year == 2000 {
			return "two thousand"
		}
		return "two thousand and " + cardinal(year-2000)
	}
	hi, lo := year/100, year%100
	switch {
	case lo == 0:
		return cardinal(hi) + " hundred"
	case lo < 10:
		return cardinal(hi) + " oh " + cardinal(lo)
	}
	return cardinal(hi) + " " + cardinal(lo)
}

// decadeWords returns a decade written as "1630s" the way a narrator says it, as in "sixteen thirties",
// "nineteen hundreds", or "twenty tens".
func decadeWords(year int) string {
	words := yearWords(year)
	if year >= 2010 {
		words = "twenty " + cardinal(year-2000)
	}
	if strings.HasSuffix(words, "y") {
		return strings.TrimSuffix(words, "y") + "ies"
	}
	return words + "s"
}

// clockWords returns a four-digit military time with a leading zero, such as "0215", as in
// "oh two fifteen" or "oh eight hundred".
func clockWords(hhmm string) string {
	hour, _ := strconv.Atoi(hhmm[:2])
	minute, _ := strconv.Atoi(hhmm[2:])
	words := "oh " + cardinal(hour)
	if hour == 0 {
		words = "zero"
	}
	switch {
	case minute == 0:
		return words + " hundred"
	case minute < 10:
		return words + " oh " + cardinal(minute)
	}
	return words + " " + cardinal(minute)
}

// colonClockWords returns a clock time written with a colon the way a narrator says it: "seven
// forty-five", "four o'clock" for a whole hour up to twelve, and "seventeen hundred" for a whole hour
// after.
func colonClockWords(hour, minute string) string {
	h, _ := strconv.Atoi(hour)
	m, _ := strconv.Atoi(minute)
	switch {
	case m == 0 && h >= 1 && h <= 12:
		return cardinal(h) + " o'clock"
	case m == 0:
		return cardinal(h) + " hundred"
	case m < 10:
		return cardinal(h) + " oh " + cardinal(m)
	}
	return cardinal(h) + " " + cardinal(m)
}

// groupThousands writes a run of digits with comma separators, as in "12,500", so the voice reads it
// as a count.
func groupThousands(digits string) string {
	var out strings.Builder
	lead := len(digits) % 3
	if lead == 0 {
		lead = 3
	}
	out.WriteString(digits[:lead])
	for i := lead; i < len(digits); i += 3 {
		out.WriteByte(',')
		out.WriteString(digits[i : i+3])
	}
	return out.String()
}

// countNouns are words that mark a number before them as a count rather than a year.
var countNouns = regexp.MustCompile(`^\s*(?:more\s+|fresh\s+|new\s+|of\s+(?:his|their|the)\s+)?` +
	`(?:men|man|soldiers|troops|infantry|cavalry|horsemen|riders|archers|sailors|marines|warriors|` +
	`fighters|guns|cannon|cannons|tanks|ships|vessels|aircraft|planes|vehicles|horses|elephants|` +
	`chariots|killed|dead|wounded|captured|casualties|prisoners|civilians|people|strong|` +
	`kilometers|kilometres|km|miles|meters|metres|feet|yards|pounds|kilograms|tons|tonnes|rounds|` +
	`shells|rockets|missiles|bombs|sorties|strikes|drones|paces|steps)\b`)

var (
	// circaPattern matches "c." or "ca." or "circa" written before a number.
	circaPattern = regexp.MustCompile(`\b(?:c|ca|circa)\.?\s+(\d)`)
	// adBeforePattern matches the era written before its year, as in "AD 79" or "A.D. 79".
	adBeforePattern = regexp.MustCompile(`\b(?:AD|A\.D\.)\s+(\d{1,4})\b`)
	// eraDotsPattern matches eras written with periods, which would end a sentence early.
	eraDotsPattern = regexp.MustCompile(`\b(B\.C\.E\.|B\.C\.|C\.E\.|A\.D\.)`)
	// rangePattern matches two numbers joined by a dash, as in "1914–1918" or "6-8".
	rangePattern = regexp.MustCompile(`(\d[\d,]*)\s*[–—-]\s*(\d[\d,]*)`)
	// shortYearRange matches a year range whose second year has two digits, as in "1944–45".
	shortYearRange = regexp.MustCompile(`\b(1\d|20)(\d{2})\s*[–—-]\s*(\d{2})\b`)
	// slashOrdinalPattern matches unit numbers such as "2/13th".
	slashOrdinalPattern = regexp.MustCompile(`\b(\d{1,3})/(\d{1,3})(?:st|nd|rd|th)\b`)
	// unitPattern matches a number followed by a unit abbreviation.
	unitPattern = regexp.MustCompile(`(\d[\d,.]*)\s?(km/h|km|mi|ft|mm|cm|kg|lbs|lb|mph|nmi|kt|m)\b`)
	// designatorPattern matches a letter prefix joined to a number, as in "FAB-3000", "Shahed-136", or
	// "M113s".
	designatorPattern = regexp.MustCompile(`\b([A-Z][A-Za-z]{0,7})-?(\d{1,4})(s?)\b`)
	// decadePattern matches a decade written as "1630s".
	decadePattern = regexp.MustCompile(`\b(1\d\d0|20[0-9]0)s\b`)
	// longNumberPattern matches a run of digits.
	longNumberPattern = regexp.MustCompile(`\d+`)
	// countRangeAfter matches the rest of a count range after its first number, as in " to 2000 men".
	countRangeAfter = regexp.MustCompile(`^\s*to\s+[\d,]+`)
	// caliberPattern matches a caliber written as a decimal, as in ".30 calibre".
	caliberPattern = regexp.MustCompile(`(^|\s)\.(\d{2,3})(?:\s|-)?(?:calibre|caliber|cal)\b`)
	// clockPattern matches a clock time written with a colon, as in "17:00" or "7:45".
	clockPattern = regexp.MustCompile(`\b([01]?\d|2[0-3]):([0-5]\d)\b`)
	// dottedNumberPattern matches a number in dotted parts, as in "77.4.3".
	dottedNumberPattern = regexp.MustCompile(`\b\d+(?:\.\d+){2,}\b`)
	// letterDotNumber matches a designator written with a period, as in "P.11".
	letterDotNumber = regexp.MustCompile(`\b([A-Z])\.(\d{1,3})\b`)
	// capsDesignator matches a designator written in capitals and digits, as in "T-72", "M1A1", or
	// "AGM-114R9X".
	capsDesignator = regexp.MustCompile(`\b[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\b`)
	// numberLetter matches a number with a capital letter joined after it, as in "861A".
	numberLetter = regexp.MustCompile(`\b(\d{2,4})([A-Z])\b`)
	// wordNumberGlue matches a lower-case letter joined to a digit, as in "States9th".
	wordNumberGlue = regexp.MustCompile(`([a-z])(\d)`)
	// digitSlashPattern matches unit numbers joined by a slash, as in "3/7 Marines".
	digitSlashPattern = regexp.MustCompile(`\b(\d{1,2})/(\d{1,2})\b`)
	// digitRunPattern matches a run of digits or of letters inside a designator.
	digitRunPattern = regexp.MustCompile(`\d+|[A-Z]+`)
	// countLead matches the words that mark the number after them as a count, as in "about 1800".
	countLead = regexp.MustCompile(`(?i)\b(?:about|around|some|nearly|almost|roughly|approximately|over|` +
		`under|only|just|another|than|totaling|totalling|numbering)\s+$`)
)

// unitWords spells out unit abbreviations.
var unitWords = map[string][2]string{
	"km":   {"kilometer", "kilometers"},
	"km/h": {"kilometer per hour", "kilometers per hour"},
	"mi":   {"mile", "miles"},
	"ft":   {"foot", "feet"},
	"mm":   {"millimeter", "millimeter"},
	"cm":   {"centimeter", "centimeters"},
	"kg":   {"kilogram", "kilograms"},
	"lb":   {"pound", "pounds"},
	"lbs":  {"pound", "pounds"},
	"mph":  {"mile per hour", "miles per hour"},
	"nmi":  {"nautical mile", "nautical miles"},
	"kt":   {"knot", "knots"},
	"m":    {"meter", "meters"},
}

// readNumbers rewrites the numbers the voice would misread: years, decades, clock times, eras, ranges,
// units, and digits joined to letters. Counts written with commas and numbers below a thousand stay as
// digits, since the voice reads those correctly in each dialect.
func readNumbers(text string) string {
	text = caliberPattern.ReplaceAllString(text, "$1$2 caliber")
	text = clockPattern.ReplaceAllStringFunc(text, func(m string) string {
		parts := clockPattern.FindStringSubmatch(m)
		return colonClockWords(parts[1], parts[2])
	})
	text = dottedNumberPattern.ReplaceAllStringFunc(text, func(m string) string {
		return strings.ReplaceAll(m, ".", " point ")
	})
	text = letterDotNumber.ReplaceAllStringFunc(text, func(m string) string {
		parts := letterDotNumber.FindStringSubmatch(m)
		return parts[1] + "-" + designatorNumber(parts[2])
	})
	text = capsDesignator.ReplaceAllStringFunc(text, func(m string) string {
		runs := digitRunPattern.FindAllString(m, -1)
		for i, run := range runs {
			if isDigit(run[0]) {
				runs[i] = designatorNumber(run)
			}
		}
		return strings.Join(runs, "-")
	})
	text = numberLetter.ReplaceAllStringFunc(text, func(m string) string {
		parts := numberLetter.FindStringSubmatch(m)
		return designatorNumber(parts[1]) + " " + parts[2]
	})
	text = wordNumberGlue.ReplaceAllString(text, "$1 $2")
	text = circaPattern.ReplaceAllString(text, "around $1")
	text = eraDotsPattern.ReplaceAllStringFunc(text, func(era string) string {
		return strings.ReplaceAll(era, ".", "")
	})
	text = adBeforePattern.ReplaceAllString(text, "$1 AD")
	text = slashOrdinalPattern.ReplaceAllStringFunc(text, func(m string) string {
		parts := slashOrdinalPattern.FindStringSubmatch(m)
		a, _ := strconv.Atoi(parts[1])
		b, _ := strconv.Atoi(parts[2])
		return ordinal(a) + " " + ordinal(b)
	})
	text = digitSlashPattern.ReplaceAllString(text, "$1 $2")
	text = strings.ReplaceAll(text, "/", " ")
	text = shortYearRange.ReplaceAllString(text, "$1$2 to $1$3")
	text = rangePattern.ReplaceAllString(text, "$1 to $2")
	text = unitPattern.ReplaceAllStringFunc(text, func(m string) string {
		parts := unitPattern.FindStringSubmatch(m)
		words := unitWords[parts[2]]
		if parts[1] == "1" {
			return parts[1] + " " + words[0]
		}
		return parts[1] + " " + words[1]
	})
	text = decadePattern.ReplaceAllStringFunc(text, func(m string) string {
		year, _ := strconv.Atoi(m[:4])
		return decadeWords(year)
	})
	text = designatorPattern.ReplaceAllStringFunc(text, func(m string) string {
		parts := designatorPattern.FindStringSubmatch(m)
		words := designatorNumber(parts[2])
		if parts[3] != "" {
			words = pluralWords(words)
		}
		return parts[1] + "-" + words
	})
	return readLongNumbers(text)
}

// pluralWords returns a number in words made plural, as in "B-fifty-twos", "A-sixes", or
// "C-one thirties".
func pluralWords(words string) string {
	switch {
	case strings.HasSuffix(words, "y"):
		return strings.TrimSuffix(words, "y") + "ies"
	case strings.HasSuffix(words, "x"):
		return words + "es"
	}
	return words + "s"
}

// designatorNumber says the number in a weapon or unit designator the way it is spoken: round hundreds
// and thousands as counts, three-digit numbers in two parts, as in "one thirteen" or "one oh nine".
func designatorNumber(digits string) string {
	n, _ := strconv.Atoi(digits)
	switch {
	case len(digits) <= 2 || n%100 == 0:
		return cardinal(n)
	case len(digits) == 3:
		if n%100 < 10 {
			return cardinal(n/100) + " oh " + cardinal(n%100)
		}
		return cardinal(n/100) + " " + cardinal(n%100)
	}
	return cardinal(n)
}

// readLongNumbers rewrites every run of four or more digits that is not part of a comma count or a
// decimal: a leading zero reads as a clock time, a year from 1000 to 2099 reads as a year unless a
// count noun follows, and anything else gets comma separators so the voice reads it as a count.
func readLongNumbers(text string) string {
	var out strings.Builder
	last := 0
	for _, loc := range longNumberPattern.FindAllStringIndex(text, -1) {
		start, end := loc[0], loc[1]
		digits := text[start:end]
		if len(digits) < 4 || partOfLargerNumber(text, start, end) {
			continue
		}
		out.WriteString(text[last:start])
		out.WriteString(longNumberWords(digits, text[:start], text[end:]))
		last = end
	}
	out.WriteString(text[last:])
	return out.String()
}

// partOfLargerNumber reports whether the digits at text[start:end] belong to a comma count or a decimal,
// such as the "000" in "12,000" or the "5" in "1.5".
func partOfLargerNumber(text string, start, end int) bool {
	if start > 0 && (text[start-1] == ',' || text[start-1] == '.') && start > 1 && isDigit(text[start-2]) {
		return true
	}
	if end+1 < len(text) && (text[end] == ',' || text[end] == '.') && isDigit(text[end+1]) {
		return true
	}
	return false
}

// longNumberWords returns the spoken form of a run of four or more digits, given the text before and
// after it.
func longNumberWords(digits, before, after string) string {
	n, _ := strconv.Atoi(digits)
	switch {
	case len(digits) == 4 && digits[0] == '0':
		return clockWords(digits)
	case len(digits) == 4 && n >= 1000 && n <= 2099 && !isCount(before, after):
		return yearWords(n)
	}
	return groupThousands(digits)
}

// isCount reports whether the words around a number mark it as a count, as in "about 1800 men" or
// "1500 to 2000 horsemen".
func isCount(before, after string) bool {
	if countLead.MatchString(before) || countNouns.MatchString(after) {
		return true
	}
	if m := countRangeAfter.FindString(after); m != "" {
		return countNouns.MatchString(after[len(m):])
	}
	return false
}

// isDigit reports whether b is an ASCII digit.
func isDigit(b byte) bool {
	return b >= '0' && b <= '9'
}
