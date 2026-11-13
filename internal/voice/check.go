package voice

import (
	"regexp"
	"strings"
	"unicode"
)

// Rule names one text rule that speakable text must pass.
type Rule string

const (
	// RuleDigits fails a number shape the voice misreads: four or more digits without commas, which
	// the voice reads as a count even when it is a year, and digits joined to letters.
	RuleDigits Rule = "digits"
	// RuleRoman fails a Roman numeral the voice would read as letters.
	RuleRoman Rule = "roman"
	// RuleMarkup fails wiki or HTML markup.
	RuleMarkup Rule = "markup"
	// RuleEllipsis fails an ellipsis, which marks a name cut short.
	RuleEllipsis Rule = "ellipsis"
	// RuleLetter fails a letter outside English, which the voice spells out or skips.
	RuleLetter Rule = "letter"
	// RuleSymbol fails a symbol the voice reads aloud or skips.
	RuleSymbol Rule = "symbol"
)

// Problem is one word in speakable text that fails a rule.
type Problem struct {
	// Rule is the rule the word fails.
	Rule Rule `json:"rule"`
	// Word is the word or mark that fails it.
	Word string `json:"word"`
}

var (
	// allowedNumber matches the digit shapes the voice reads correctly: numbers below a thousand,
	// counts with comma separators, decimals, and ordinals such as "21st".
	allowedNumber = regexp.MustCompile(`^(?:\d{1,3}|\d{1,3}(?:,\d{3})+|\d{1,3}\.\d+|\d+(?:st|nd|rd|th)|\d?\d0s)$`)
	// eraBeforeNumber matches an era written before its year, which the voice reads as a word.
	eraBeforeNumber = regexp.MustCompile(`\bAD\s+\d`)
	// markupPattern matches wiki and HTML markup.
	markupPattern = regexp.MustCompile(`\[\[|\]\]|\{\{|\}\}|''|<[^>]*>|&[A-Za-z]+;|\||https?:|www\.|\d+px\b`)
	// numeralPattern matches a word of two or more numeral letters, or a lower-case numeral.
	numeralPattern = regexp.MustCompile(`\b(?:[IVXLC]{2,}|ii|iii|iv|vi|vii|viii|ix|xi|xii|xiii|xiv|xv|xvi|` +
		`xvii|xviii|xix|xx)\b`)
	// lonePattern matches a lone I, V, or X directly after a word, not followed by a period, a hyphen,
	// or an apostrophe, which would mark an initial, a designator, or a contraction.
	lonePattern = regexp.MustCompile(`([A-Za-z][A-Za-z'-]*) ([IVX])(?:\b[^.\-']|$)`)
	// tokenTrim lists the marks trimmed from a word before it is reported.
	tokenTrim = `.,;:!?"'()`
)

// allowedMarks lists the punctuation speakable text may hold.
const allowedMarks = `.,;:!?'"- `

// Check returns every problem in speakable text, in reading order within each rule.
func Check(speakable string) []Problem {
	var problems []Problem
	add := func(rule Rule, word string) {
		problems = append(problems, Problem{Rule: rule, Word: word})
	}
	for _, m := range markupPattern.FindAllString(speakable, -1) {
		add(RuleMarkup, m)
	}
	if strings.Contains(speakable, "…") || strings.Contains(speakable, "...") {
		for _, word := range strings.Fields(speakable) {
			if strings.Contains(word, "…") || strings.Contains(word, "...") {
				add(RuleEllipsis, word)
			}
		}
	}
	for _, m := range eraBeforeNumber.FindAllString(speakable, -1) {
		add(RuleDigits, m)
	}
	for _, word := range strings.Fields(speakable) {
		if problem, ok := checkWord(word); ok {
			problems = append(problems, problem)
		}
	}
	for _, m := range numeralPattern.FindAllString(speakable, -1) {
		if romanValue(strings.ToUpper(m)) > 0 {
			add(RuleRoman, m)
		}
	}
	for _, m := range lonePattern.FindAllStringSubmatch(speakable, -1) {
		if isRulerName(m[1]) {
			add(RuleRoman, m[1]+" "+m[2])
		}
	}
	return problems
}

// checkWord returns the first letter, symbol, or digit problem in one whitespace-separated word.
func checkWord(word string) (Problem, bool) {
	trimmed := strings.Trim(word, tokenTrim)
	for _, r := range word {
		switch {
		case r == '…':
		case unicode.IsLetter(r) && r > unicode.MaxASCII:
			return Problem{Rule: RuleLetter, Word: trimmed}, true
		case unicode.IsLetter(r) || unicode.IsDigit(r) && r <= unicode.MaxASCII:
		case !strings.ContainsRune(allowedMarks, r):
			return Problem{Rule: RuleSymbol, Word: string(r) + " in " + trimmed}, true
		}
	}
	if !strings.ContainsAny(trimmed, "0123456789") {
		return Problem{}, false
	}
	for _, part := range strings.Split(trimmed, "-") {
		if part != "" && strings.ContainsAny(part, "0123456789") && !allowedNumber.MatchString(part) {
			return Problem{Rule: RuleDigits, Word: trimmed}, true
		}
	}
	return Problem{}, false
}
