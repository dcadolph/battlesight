package battles

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// FlagNames holds the state names that infobox flag icons leave as text around commander names, as
// "Kingdom of France" does in "Kingdom of France Louis de Soissons". Generated narration drops them.
type FlagNames struct {
	// names lists the flag names, longest first, so the longest match wins.
	names []string
}

var (
	// stateWords are the words that mark a name as the name of a state, as "Empire" does in "Holy
	// Roman Empire".
	stateWords = map[string]bool{
		"Kingdom": true, "Empire": true, "Republic": true, "Monarchy": true, "Commonwealth": true,
		"Confederacy": true, "Confederation": true, "Sultanate": true, "Khanate": true,
		"Caliphate": true, "Emirate": true, "Duchy": true, "Principality": true, "Tsardom": true,
		"Electorate": true, "Dynasty": true, "dynasty": true, "State": true, "States": true,
		"Union": true, "Federation": true, "Shogunate": true, "Horde": true, "Margraviate": true,
		"Landgraviate": true, "Protectorate": true, "Mandate": true, "Colony": true, "SFSR": true,
		"SSR": true, "Hetmanate": true, "Hetmanat": true,
	}
	// historicStates are state names the present-day country list does not hold.
	historicStates = []string{
		"England", "Scotland", "Wales", "Ireland", "Great Britain", "Britain", "Prussia", "Bavaria",
		"Saxony", "Venice", "Genoa", "Castile", "Aragon", "Navarre", "Burgundy", "Persia", "Siam",
		"Burma", "Byzantium", "Yugoslavia", "Czechoslovakia", "Bohemia", "Moldavia", "Wallachia",
		"Georgia", "Croatia", "Bosnia", "Montenegro", "Albania", "Lithuania", "Latvia", "Estonia",
		"Belarus", "Chile", "Peru", "Bolivia", "Paraguay", "Uruguay", "Colombia", "Venezuela",
		"Ecuador", "Cuba", "Nicaragua", "Honduras", "Guatemala", "Morocco", "Algeria", "Tunisia",
		"Nigeria", "Kenya", "Uganda", "Tanzania", "Mozambique", "Angola", "Rhodesia", "Zimbabwe",
		"Congo", "Chad", "Eritrea", "Jordan", "Kuwait", "Oman", "Qatar", "Bahrain", "Thailand",
		"Cambodia", "Laos", "Indonesia", "Malaysia", "Philippines", "Taiwan", "Tibet", "Nepal",
		"Bangladesh", "Sri Lanka", "Hamas", "Hezbollah",
	}
	// flagCodes are the capital-letter codes flag templates print in place of a state's name.
	flagCodes = map[string]bool{
		"USA": true, "US": true, "UK": true, "GBR": true, "ENG": true, "SCO": true, "FRA": true,
		"GER": true, "FRG": true, "GDR": true, "ITA": true, "ESP": true, "POR": true, "NED": true,
		"BEL": true, "AUT": true, "HUN": true, "POL": true, "RUS": true, "URS": true, "UKR": true,
		"SWE": true, "NOR": true, "DEN": true, "FIN": true, "GRE": true, "TUR": true, "BUL": true,
		"ROU": true, "SRB": true, "YUG": true, "CRO": true, "JPN": true, "CHN": true, "ROC": true,
		"PRC": true, "KOR": true, "PRK": true, "VIE": true, "IND": true, "PAK": true, "AFG": true,
		"IRN": true, "IRQ": true, "SYR": true, "ISR": true, "LBN": true, "EGY": true, "LBY": true,
		"SUD": true, "ETH": true, "SOM": true, "RSA": true, "CAN": true, "AUS": true, "NZL": true,
		"MEX": true, "BRA": true, "ARG": true, "CHI": true, "PER": true, "CUB": true, "INA": true,
		"PHI": true, "THA": true, "CAR": true, "CSA": true, "SMOM": true, "WIC": true, "VOC": true,
		"KDP": true, "UKGBI": true, "USSR": true, "SFSR": true,
	}
	// titleWords start a name that is a title, such as "Duke of Burgundy", never a flag.
	titleWords = map[string]bool{
		"Duke": true, "Earl": true, "Count": true, "King": true, "Queen": true, "Prince": true,
		"Princess": true, "Lord": true, "Lady": true, "Emperor": true, "Empress": true,
		"Sultan": true, "Khan": true, "Shah": true, "Tsar": true, "Czar": true, "Archduke": true,
		"Grand": true, "Margrave": true, "Elector": true, "Bishop": true, "Archbishop": true,
		"Pope": true, "Caliph": true, "Emir": true, "Sir": true, "General": true, "Admiral": true,
		"Marshal": true,
	}
	// nameLinkWords are the lower-case words that join a name to a place, as in "Leo of Galicia". A
	// flag name after one of them is part of the name, not a flag.
	nameLinkWords = map[string]bool{
		"of": true, "de": true, "von": true, "van": true, "der": true, "the": true, "la": true,
		"le": true, "du": true, "da": true, "di": true, "al": true, "el": true, "bin": true,
		"ibn": true, "zu": true, "y": true, "and": true,
	}
	// unknownNames are the values that stand for a missing name.
	unknownNames = map[string]bool{
		"unknown": true, "n/a": true, "na": true, "none": true, "?": true, "-": true, "—": true,
		"unidentified": true, "various": true, "not known": true, "unk": true, "unk.": true,
	}
	// unknownPrefixes start a value that describes a missing name, as in "Unknown Chu commander".
	unknownPrefixes = []string{"unknown ", "several unknown", "unidentified ", "various "}
)

var (
	// sideSeparators splits a side name into the parties it lists.
	sideSeparators = regexp.MustCompile(`\s*(?:,|;|/|\+|\band\b)\s*`)
	// bracketNote matches a bracketed note, as in "(Union)" or "(1912–1949)", or one left unclosed.
	bracketNote = regexp.MustCompile(`\s*[(（\[][^)）\]]*(?:[)）\]]|$)`)
	// leadingBracketNote matches a bracketed note at the start of a text.
	leadingBracketNote = regexp.MustCompile(`^[(（\[][^)）\]]*[)）\]]\s*`)
	// commanderSeparators splits a commander field into names.
	commanderSeparators = regexp.MustCompile(`\s*(?:,|;|\n|\band\b|&)\s*`)
	// flagAltText matches the text a flag image leaves before a pipe, as in "Flag of Poland (1927–1980)|".
	flagAltText = regexp.MustCompile(`Flag of [^|,]*\|`)
	// commanderMarkup matches wiki markup and marks left in commander fields, and what a flag image
	// leaves behind once its brackets are gone: sizes such as "25px" even when joined to a name, file
	// names, "border=no" style options, and link targets with underscores.
	commanderMarkup = regexp.MustCompile(`'{2,}|\[\[|\]\]|\{\{|\}\}|\||[†‡\x{FFFD}]|\d*x?\d+[pP]x|` +
		`\S*\.(?:svg|png|jpe?g|gif)\b|\b\w+=\w*|=no|\S*_\S*`)
	// flagOfPrefix matches the words a flag image's caption puts before the state it names.
	flagOfPrefix = regexp.MustCompile(`^Flag of (?:the )?`)
	// stateNames holds the present-day and historic state names, keyed by name.
	stateNames = countryNames()
	// datedFlagCaption matches a flag image caption that carries dates, through the comma after it,
	// as in "Flag of Poland (1927–1980), ".
	datedFlagCaption = regexp.MustCompile(`Flag of [^,()]*\([^)]*\)\s*,?\s*`)
	// flagCaption matches the words of any other flag image caption, as in "Flag of the ".
	flagCaption = regexp.MustCompile(`Flag of (?:the )?`)
	// supportedBy matches the label that introduces a side's supporters.
	supportedBy = regexp.MustCompile(`\s*,?\s*[Ss]upported by:?\s*,?\s*`)
)

// NewFlagNames returns the flag names found among the catalog's side names, taking each side name
// whole and each party it lists: flag codes such as "USA" or "UKGBI", names that hold a state word
// such as "Holy Roman Empire", and names whose last word is a country such as "Nazi Germany". A title
// such as "Duke of Burgundy" is never a flag.
func NewFlagNames(sideNames []string) FlagNames {
	seen := map[string]bool{}
	for _, side := range sideNames {
		whole := strings.TrimSpace(bracketNote.ReplaceAllString(side, ""))
		for _, name := range append(sideParts(side), whole) {
			if isFlagName(name) {
				seen[name] = true
			}
		}
	}
	names := make([]string, 0, len(seen))
	for name := range seen {
		names = append(names, name)
	}
	sortLongestFirst(names)
	return FlagNames{names: names}
}

// countryNames returns the present-day and historic state names, keyed by name.
func countryNames() map[string]bool {
	countries := map[string]bool{}
	for _, p := range countryPatterns {
		countries[p.Name] = true
	}
	for _, name := range historicStates {
		countries[name] = true
	}
	return countries
}

// isFlagName reports whether a name reads as a state name a flag icon stands for.
func isFlagName(name string) bool {
	words := strings.Fields(name)
	switch {
	case len(words) == 0 || titleWords[words[0]]:
		return false
	case len(words) == 1:
		return stateNames[name] || flagCodes[name] || isFlagCode(name)
	case stateNames[name] || stateNames[words[len(words)-1]]:
		return true
	}
	for _, w := range words {
		if stateWords[w] {
			return true
		}
	}
	return false
}

// isFlagCode reports whether a word is a capital-letter code of two to six letters, as "CSA" is.
func isFlagCode(word string) bool {
	if len(word) < 2 || len(word) > 6 {
		return false
	}
	for _, r := range word {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

// sideParts splits a side name into its parties, without bracketed notes.
func sideParts(side string) []string {
	side = bracketNote.ReplaceAllString(side, "")
	var parts []string
	for _, part := range sideSeparators.Split(side, -1) {
		if part = strings.TrimSpace(part); len(part) >= 2 {
			parts = append(parts, part)
		}
	}
	return parts
}

// sortLongestFirst orders names longest first, then alphabetically.
func sortLongestFirst(names []string) {
	sort.Slice(names, func(i, j int) bool {
		if len(names[i]) != len(names[j]) {
			return len(names[i]) > len(names[j])
		}
		return names[i] < names[j]
	})
}

// spokenName returns a side or victor name for a spoken line: the whole name, without flag image
// captions, said once when the source repeats it, or "" when the value stands for a missing name.
func spokenName(name string) string {
	name = datedFlagCaption.ReplaceAllString(name, "")
	name = flagCaption.ReplaceAllString(name, "")
	name = supportedBy.ReplaceAllString(name, ", supported by ")
	name = strings.Trim(strings.TrimSpace(name), ",")
	if isUnknownName(name) {
		return ""
	}
	core := strings.Join(strings.Fields(bracketNote.ReplaceAllString(name, " ")), " ")
	if half := len(core) / 2; len(core)%2 == 1 && core[half] == ' ' && core[:half] == core[half+1:] {
		return core[:half]
	}
	return name
}

// isUnknownName reports whether a value stands for a missing name, as "Unknown", "N/A", "Unknown
// (not mentioned in the history record)", or "National Revolutionary Army Unknown" do.
func isUnknownName(name string) bool {
	core := strings.ToLower(strings.TrimSpace(bracketNote.ReplaceAllString(name, "")))
	if core == "" || unknownNames[core] || strings.HasSuffix(core, " unknown") {
		return true
	}
	for _, prefix := range unknownPrefixes {
		if strings.HasPrefix(core, prefix) {
			return true
		}
	}
	return false
}

// spokenCommanders returns the commanders of a side as separate names for a spoken line: markup and
// flag names removed, names split where a flag name ran them together, and missing or unspeakable
// names dropped.
func spokenCommanders(side Side, b Battle, flags FlagNames) []string {
	raw := flagAltText.ReplaceAllString(side.Commander, ",")
	raw = commanderMarkup.ReplaceAllString(raw, " ")
	lists := [][]string{ownSideNames(b), flags.names}
	for _, names := range lists {
		for _, flag := range names {
			if strings.Contains(flag, " and ") || strings.Contains(flag, ",") {
				raw = strings.ReplaceAll(raw, flag, ",")
			}
		}
	}
	var names []string
	seen := map[string]bool{}
	for _, item := range splitOutsideBrackets(raw) {
		if strings.HasSuffix(strings.TrimSpace(item), ":") {
			continue
		}
		for _, name := range splitAtFlags(item, lists) {
			name = strings.Trim(strings.Join(strings.Fields(name), " "), " :-*•")
			if name == "" || seen[name] || isUnknownName(name) || !hasLatinLetter(name) {
				continue
			}
			seen[name] = true
			names = append(names, name)
		}
	}
	return names
}

// bracketSeparators hides the separators inside brackets, so a note such as "(SDF, YPJ overall)" stays
// with its name, and bracketSeparatorsBack restores them.
var (
	bracketSeparators     = strings.NewReplacer(",", "\x00", ";", "\x01", "&", "\x02", "\n", " ", " and ", " \x03 ")
	bracketSeparatorsBack = strings.NewReplacer("\x00", ",", "\x01", ";", "\x02", "&", "\x03", "and")
)

// splitOutsideBrackets splits a commander field into names at the separators outside brackets.
func splitOutsideBrackets(raw string) []string {
	var b strings.Builder
	depth, last := 0, 0
	for i, r := range raw {
		switch r {
		case '(', '[', '（':
			if depth == 0 {
				b.WriteString(raw[last:i])
				last = i
			}
			depth++
		case ')', ']', '）':
			if depth == 1 {
				b.WriteString(bracketSeparators.Replace(raw[last:i]))
				last = i
			}
			depth = max(depth-1, 0)
		}
	}
	if depth > 0 {
		b.WriteString(bracketSeparators.Replace(raw[last:]))
	} else {
		b.WriteString(raw[last:])
	}
	items := commanderSeparators.Split(b.String(), -1)
	for i, item := range items {
		items[i] = bracketSeparatorsBack.Replace(item)
	}
	return items
}

// ownSideNames returns the battle's side names, whole and by party, longest first. Any of them is a
// flag in front of a commander of this battle.
func ownSideNames(b Battle) []string {
	seen := map[string]bool{}
	for _, s := range b.Sides {
		whole := strings.TrimSpace(bracketNote.ReplaceAllString(s.Name, ""))
		for _, name := range append(sideParts(s.Name), whole) {
			if len(name) >= 2 && !titleWords[strings.Fields(name)[0]] {
				seen[name] = true
			}
		}
	}
	names := make([]string, 0, len(seen))
	for name := range seen {
		names = append(names, name)
	}
	sortLongestFirst(names)
	return names
}

// splitAtFlags removes flag names from one commander item: a flag name at the start or the end is
// dropped, and a flag name between two names splits them, as in "Barrientos Jr. Philippines Ibrahim
// Macadato".
func splitAtFlags(item string, lists [][]string) []string {
	item = flagOfPrefix.ReplaceAllString(strings.Trim(item, " *•"), "")
	for {
		stripped := stripLeadingFlag(item, lists)
		if stripped == item {
			break
		}
		item = stripped
	}
	for _, names := range lists {
		for _, flag := range names {
			at := findFlagBetweenNames(item, flag)
			if at < 0 {
				continue
			}
			left := strings.TrimSpace(item[:at])
			right := strings.TrimSpace(item[at+len(flag):])
			return append(splitAtFlags(left, lists), splitAtFlags(right, lists)...)
		}
	}
	return []string{stripTrailingFlag(item, lists)}
}

// stripLeadingFlag drops one flag name from the start of item when a capitalized name follows it: a
// listed flag name with any bracketed note after it, a flag code, or a run of capitalized words that
// ends in a state word, as "Mongolian People's Republic" does.
func stripLeadingFlag(item string, lists [][]string) string {
	for _, names := range lists {
		for _, flag := range names {
			rest, ok := strings.CutPrefix(item, flag)
			if !ok || rest == "" || rest[0] != ' ' {
				continue
			}
			rest = leadingBracketNote.ReplaceAllString(strings.TrimSpace(rest), "")
			if startsName(rest) {
				return rest
			}
		}
	}
	words := strings.Fields(item)
	if len(words) > 1 && flagCodes[words[0]] && startsUpper(words[1]) {
		return strings.Join(words[1:], " ")
	}
	return stripStatePhrase(words, item, lists)
}

// stripStatePhrase drops a leading state name no list holds: up to four capitalized words that end in
// a state word, as in "Mongolian People's Republic Bataar", or a state word with "of" and a country,
// as in "Kingdom of Hungary Ivan Hindy". A run that holds a listed flag name is a person's name
// followed by a flag, as in "Mahmud II Ottoman Empire", and is left for the split. It returns item
// unchanged when no state name leads it.
func stripStatePhrase(words []string, item string, lists [][]string) string {
	for i := 0; i < len(words)-1 && i < 4; i++ {
		if !startsUpper(words[i]) {
			return item
		}
		if !stateWords[words[i]] {
			continue
		}
		if holdsListedFlag(strings.Join(words[:i+1], " "), lists) {
			return item
		}
		if startsUpper(words[i+1]) {
			return strings.Join(words[i+1:], " ")
		}
		if words[i+1] != "of" {
			return item
		}
		j := i + 2
		if j < len(words) && words[j] == "the" {
			j++
		}
		for size := 2; size >= 1; size-- {
			if j+size < len(words) && stateNames[strings.Join(words[j:j+size], " ")] && startsUpper(words[j+size]) {
				return strings.Join(words[j+size:], " ")
			}
		}
		return item
	}
	return item
}

// holdsListedFlag reports whether a phrase holds a listed flag name as whole words.
func holdsListedFlag(phrase string, lists [][]string) bool {
	padded := " " + phrase + " "
	for _, names := range lists {
		for _, flag := range names {
			if strings.Contains(padded, " "+flag+" ") {
				return true
			}
		}
	}
	return false
}

// stripTrailingFlag drops a listed flag name from the end of item, as in "Robert Stopford United
// Kingdom", unless a word such as "of" ties it to the name, as in "Eugen of Austria".
func stripTrailingFlag(item string, lists [][]string) string {
	for _, names := range lists {
		for _, flag := range names {
			before, ok := strings.CutSuffix(item, " "+flag)
			if !ok {
				continue
			}
			words := strings.Fields(before)
			if len(words) > 0 && !nameLinkWords[words[len(words)-1]] {
				return strings.TrimSpace(before)
			}
		}
	}
	return item
}

// findFlagBetweenNames returns where flag stands as a whole word between two names inside item, or
// -1. The word before it must not join a name to a place, as "of" does in "Eugen of Austria", and a
// capitalized name must follow it.
func findFlagBetweenNames(item, flag string) int {
	from := 0
	for {
		at := strings.Index(item[from:], " "+flag+" ")
		if at < 0 {
			return -1
		}
		at += from + 1
		before := strings.Fields(item[:at])
		after := strings.TrimSpace(item[at+len(flag):])
		if len(before) > 0 && !nameLinkWords[before[len(before)-1]] && startsUpper(after) {
			return at
		}
		from = at + len(flag)
	}
}

// nameParticles are the lower-case words a name can start with, as "de" does in "de Guebriant".
var nameParticles = map[string]bool{
	"de": true, "von": true, "van": true, "der": true, "du": true, "da": true, "di": true,
	"la": true, "le": true, "al": true, "el": true, "ibn": true, "bin": true, "del": true,
	"della": true, "dos": true, "das": true, "do": true, "ten": true, "ter": true, "zu": true,
}

// nameParticlePrefix matches a name that starts with a joined particle, as in "al-Mansur" or
// "d'Estrees".
var nameParticlePrefix = regexp.MustCompile(`^(?:al|el|ad|ar|as|at|az|ash|d')[-']?\p{Lu}`)

// startsName reports whether text starts with a name: a capital letter, a particle and a capitalized
// word as in "de Guebriant", or a joined particle as in "al-Mansur".
func startsName(text string) bool {
	if startsUpper(text) || nameParticlePrefix.MatchString(text) {
		return true
	}
	words := strings.Fields(text)
	return len(words) > 1 && nameParticles[words[0]] && startsUpper(words[1])
}

// startsUpper reports whether text starts with a capital letter.
func startsUpper(text string) bool {
	for _, r := range text {
		return unicode.IsUpper(r)
	}
	return false
}

// hasLatinLetter reports whether a name holds a Latin letter, so the voice can say it.
func hasLatinLetter(name string) bool {
	for _, r := range name {
		if unicode.Is(unicode.Latin, r) {
			return true
		}
	}
	return false
}

// joinNames joins names as a spoken list with a serial comma, as in "A, B, and C".
func joinNames(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	case 2:
		return names[0] + " and " + names[1]
	}
	return strings.Join(names[:len(names)-1], ", ") + ", and " + names[len(names)-1]
}

// verbFor returns the singular verb for one name and the plural verb for a list.
func verbFor(names []string, singular, plural string) string {
	if len(names) > 1 {
		return plural
	}
	return singular
}
