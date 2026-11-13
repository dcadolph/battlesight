package voice

import (
	"regexp"
	"strings"
)

var (
	// romanCandidate matches a word that may be a Roman numeral: upper case, or the lower-case forms of
	// two or more letters that mangled sources leave behind.
	romanCandidate = regexp.MustCompile(`\b(?:[IVXLC]+|ii|iii|iv|vi|vii|viii|ix|xi|xii|xiii|xiv|xv|xvi|` +
		`xvii|xviii|xix|xx)\b`)
	// canonicalRoman matches a Roman numeral written in its standard form.
	canonicalRoman = regexp.MustCompile(`^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$`)
	// wordBefore matches the word directly before a position, separated by one space.
	wordBefore = regexp.MustCompile(`([A-Za-z][A-Za-z'-]*) $`)
	// twoWordsBefore matches the two words directly before a position.
	twoWordsBefore = regexp.MustCompile(`([A-Za-z]+) ([A-Za-z]+) $`)
	// capitalizedRun matches up to four capitalized words at the start of a text.
	capitalizedRun = regexp.MustCompile(`^(?: [A-Z][A-Za-z-]*){1,4}`)
	// nameAfterInitial matches the start of a name after an initial, as in ". K. Krishna" or ". Smith".
	nameAfterInitial = regexp.MustCompile(`^\. ([A-Z][A-Za-z'-]*)`)
	// pronounContraction matches the contractions that mark "I" as the pronoun.
	pronounContraction = regexp.MustCompile(`^'(?:m|ll|d|ve)\b`)
)

var (
	// romanDigits maps each numeral letter to its value.
	romanDigits = map[byte]int{'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100}
	// militaryUnits are the words that end a numbered formation, as in "VI Corps".
	militaryUnits = map[string]bool{
		"Corps": true, "Army": true, "Armies": true, "Division": true, "Divisions": true,
		"Brigade": true, "Brigades": true, "Fleet": true, "Legion": true, "Squadron": true,
		"Wing": true, "Group": true, "Battalion": true, "Regiment": true, "Front": true,
		"Command": true, "Flotilla": true, "Cohort": true,
	}
	// cardinalContexts are the words after which a numeral is read as a plain number, as in "Mark IV"
	// or "Panzer IV".
	cardinalContexts = map[string]bool{
		"Type": true, "Mark": true, "Mk": true, "Panzer": true, "Panzers": true, "Tiger": true,
		"Panther": true, "Phase": true, "Part": true, "Act": true, "Book": true, "Volume": true,
		"Vol": true, "Chapter": true, "Section": true, "Article": true, "Stage": true,
		"Vatican": true, "Apollo": true, "Plan": true, "Unit": true, "Force": true, "Hill": true,
		"Legio": true, "Leopard": true, "Challenger": true, "Patriot": true, "Series": true,
		"Class": true, "Block": true, "Level": true, "Zone": true, "Sector": true, "Camp": true,
		"Model": true, "Mod": true,
	}
	// stopwords are capitalized English words that are never a ruler's name, so a numeral after one
	// is not regnal. They keep "When I" and "Then V" from reading as kings.
	stopwords = map[string]bool{
		"The": true, "A": true, "An": true, "When": true, "Then": true, "If": true, "As": true,
		"But": true, "And": true, "Or": true, "So": true, "Now": true, "There": true, "Here": true,
		"What": true, "Where": true, "Why": true, "How": true, "Who": true, "Whom": true,
		"This": true, "That": true, "These": true, "Those": true, "It": true, "He": true,
		"She": true, "We": true, "You": true, "They": true, "His": true, "Her": true, "Their": true,
		"Our": true, "My": true, "Your": true, "Its": true, "In": true, "On": true, "At": true,
		"By": true, "For": true, "From": true, "To": true, "Of": true, "With": true, "After": true,
		"Before": true, "During": true, "Since": true, "Until": true, "While": true, "Though": true,
		"Although": true, "Because": true, "Yet": true, "Still": true, "Once": true, "Today": true,
		"Yes": true, "No": true, "Not": true, "Never": true, "Only": true, "Even": true, "Also": true,
		"Indeed": true, "Sir": true, "Sire": true, "Do": true, "Did": true, "Can": true,
		"Could": true, "Should": true, "Would": true, "Will": true, "Shall": true, "May": true,
		"Might": true, "Must": true, "Am": true, "Is": true, "Are": true, "Was": true, "Were": true,
		"Have": true, "Has": true, "Had": true, "Let": true, "Unless": true, "Whether": true,
	}
)

// romanValue returns the value of an upper-case Roman numeral in standard form, or 0 when s is not
// one.
func romanValue(s string) int {
	if s == "" || !canonicalRoman.MatchString(s) {
		return 0
	}
	total := 0
	for i := 0; i < len(s); i++ {
		v := romanDigits[s[i]]
		if i+1 < len(s) && romanDigits[s[i+1]] > v {
			total -= v
			continue
		}
		total += v
	}
	return total
}

// readRoman rewrites the Roman numerals whose reading the context settles: "World War II" as "World
// War Two", "VI Corps" as "Sixth Corps", "Mark IV" as "Mark Four", and a ruler's "Louis XIV" as "Louis
// the Fourteenth". A numeral no rule settles is left for the check to report.
func readRoman(text string) string {
	var out strings.Builder
	last := 0
	for _, loc := range romanCandidate.FindAllStringIndex(text, -1) {
		start, end := loc[0], loc[1]
		words, ok := romanWords(text[start:end], text[:start], text[end:])
		if !ok {
			continue
		}
		out.WriteString(text[last:start])
		out.WriteString(words)
		last = end
	}
	out.WriteString(text[last:])
	return out.String()
}

// romanWords returns the spoken form of the numeral token given the text before and after it, and
// false when the context does not settle that the token is a numeral.
func romanWords(token, before, after string) (string, bool) {
	lower := token == strings.ToLower(token)
	value := romanValue(strings.ToUpper(token))
	if value == 0 {
		return "", false
	}
	if lower {
		if wordBefore.MatchString(before) {
			return "the " + titleWords(ordinal(value)), true
		}
		return "", false
	}
	if m := twoWordsBefore.FindStringSubmatch(before); m != nil && strings.EqualFold(m[1]+" "+m[2], "World War") {
		return titleWords(cardinal(value)), value <= 10
	}
	if value <= 100 && formationFollows(after) {
		return titleWords(ordinal(value)), true
	}
	prev := ""
	if m := wordBefore.FindStringSubmatch(before); m != nil {
		prev = m[1]
	}
	if prev == "" {
		return "", false
	}
	if cardinalContexts[prev] || isAcronym(prev) {
		return titleWords(cardinal(value)), value <= 100
	}
	if !isRulerName(prev) || value > 39 || strings.ContainsAny(token, "LC") {
		return "", false
	}
	if len(token) == 1 && !singleLetterIsNumeral(token, after) {
		return "", false
	}
	return "the " + titleWords(ordinal(value)), true
}

// formationFollows reports whether the text after a numeral names a military formation, as in " Corps"
// or " SS Panzer Corps".
func formationFollows(after string) bool {
	run := capitalizedRun.FindString(after)
	if run == "" {
		return false
	}
	for _, word := range strings.Fields(run) {
		if militaryUnits[word] {
			return true
		}
	}
	return false
}

// isRulerName reports whether a word can be the name a regnal numeral follows: it holds a capital
// letter, as "Louis" or "al-Rahman" do, and is not a capitalized English function word.
func isRulerName(word string) bool {
	return strings.ToLower(word) != word && !stopwords[word] && strings.ToUpper(word) != word
}

// singleLetterIsNumeral reports whether a lone I, V, or X after a name is a numeral rather than an
// initial or the pronoun: "Henry V led" and "Henry V. The" are numerals, "John V. Smith" and
// "Ulysses S." are not.
func singleLetterIsNumeral(token, after string) bool {
	if token == "I" && pronounContraction.MatchString(after) {
		return false
	}
	if !strings.HasPrefix(after, ".") {
		return true
	}
	m := nameAfterInitial.FindStringSubmatch(after)
	return m == nil || stopwords[m[1]]
}

// isAcronym reports whether a word is written in capitals, as "CM-FPR" is, so a numeral after it
// is part of a name read as a number.
func isAcronym(word string) bool {
	letters := 0
	for _, r := range word {
		switch {
		case r >= 'A' && r <= 'Z':
			letters++
		case r != '-':
			return false
		}
	}
	return letters >= 2
}

// titleWords capitalizes each word of a number in words, as in "Twenty-First".
func titleWords(words string) string {
	b := []byte(words)
	for i := range b {
		if (i == 0 || b[i-1] == ' ' || b[i-1] == '-') && b[i] >= 'a' && b[i] <= 'z' {
			b[i] -= 'a' - 'A'
		}
	}
	return string(b)
}
