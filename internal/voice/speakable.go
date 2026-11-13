// Package voice turns replay narration into speakable text: the words the narrator voice reads exactly
// as written. It also checks speakable text for anything the voice would misread.
package voice

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// Speakable rewrites narration for the voice by rule. It removes markup and bracket notes, reads
// prose asides as asides, spells out abbreviations and symbols, folds letters outside English to their
// English base, says years, clock times, eras, and Roman numerals in words, and leaves counts the voice
// reads correctly as digits. Anything no rule settles is left as it is, for Check to report.
func Speakable(text string) string {
	text = stripMarkup(text)
	text = foldSymbols(text)
	text = readBrackets(text)
	text = foldLetters(text)
	text = expandAbbreviations(text)
	text = readNumbers(text)
	text = readRoman(text)
	text = readInitialisms(text)
	return tidy(text)
}

var (
	// refPattern matches a citation with its contents.
	refPattern = regexp.MustCompile(`(?is)<ref[^>/]*>.*?</ref>|<ref[^>]*/>`)
	// tagPattern matches any other HTML tag.
	tagPattern = regexp.MustCompile(`</?[A-Za-z][^>]*>`)
	// templatePattern matches an innermost wiki template.
	templatePattern = regexp.MustCompile(`\{\{[^{}]*\}\}`)
	// fileLinkPattern matches a wiki image or file link.
	fileLinkPattern = regexp.MustCompile(`\[\[(?:File|Image):[^\]]*\]\]`)
	// pipedLinkPattern matches a wiki link with display text.
	pipedLinkPattern = regexp.MustCompile(`\[\[[^\]|]*\|([^\]]*)\]\]`)
	// linkPattern matches a plain wiki link.
	linkPattern = regexp.MustCompile(`\[\[([^\]]*)\]\]`)
	// quoteMarkupPattern matches wiki bold and italic marks.
	quoteMarkupPattern = regexp.MustCompile(`'{2,}`)
	// entityPattern matches an HTML entity.
	entityPattern = regexp.MustCompile(`&[A-Za-z]+;|&#\d+;`)
	// urlPattern matches a web address.
	urlPattern = regexp.MustCompile(`(?:https?://|www\.)\S+`)
	// commentPattern matches an HTML comment, or the opening of one left cut short.
	commentPattern = regexp.MustCompile(`(?s)<!--.*?-->|:?\s*<!-*`)
	// imageDebrisPattern matches what a flag image leaves behind once its brackets are gone: sizes such
	// as "24px" or "23x23px" even when joined to a word, file names, "border=no" style options, and
	// link targets with underscores.
	imageDebrisPattern = regexp.MustCompile(`\d*x?\d+[pP]x|\S*\.(?:svg|png|jpe?g|gif)\b|\b\w+=\w*|=no|` +
		`\S*_\S*|\bnbsp\b`)
	// anchorPattern matches a link anchor joined to a word, as in "Denmark#Middle_Ages".
	anchorPattern = regexp.MustCompile(`([A-Za-z])#\S*`)
)

// entities maps the HTML entities that stand for text.
var entities = map[string]string{
	"&nbsp;": " ", "&amp;": "&", "&ndash;": "–", "&mdash;": "—", "&quot;": `"`, "&apos;": "'",
	"&lt;": "", "&gt;": "", "&minus;": "−",
}

// stripMarkup removes wiki and HTML markup, keeping the text a link displays.
func stripMarkup(text string) string {
	text = refPattern.ReplaceAllString(text, "")
	text = tagPattern.ReplaceAllString(text, " ")
	for templatePattern.MatchString(text) {
		text = templatePattern.ReplaceAllString(text, "")
	}
	text = fileLinkPattern.ReplaceAllString(text, "")
	text = pipedLinkPattern.ReplaceAllString(text, "$1")
	text = linkPattern.ReplaceAllString(text, "$1")
	text = strings.NewReplacer("[[", "", "]]", "", "{{", "", "}}", "").Replace(text)
	text = quoteMarkupPattern.ReplaceAllString(text, "")
	text = entityPattern.ReplaceAllStringFunc(text, func(e string) string { return entities[e] })
	text = urlPattern.ReplaceAllString(text, "")
	text = commentPattern.ReplaceAllString(text, "")
	text = imageDebrisPattern.ReplaceAllString(text, " ")
	text = anchorPattern.ReplaceAllString(text, "$1")
	return strings.NewReplacer("|", " ", "<", " ", ">", " ").Replace(text)
}

var (
	// slashPairPattern matches two words joined by a slash, as in "Sauk/Meskwaki".
	slashPairPattern = regexp.MustCompile(`([A-Za-z])\s*/\s*([A-Za-z])`)
	// tildePattern matches a tilde before a number, as in "~5,000".
	tildePattern = regexp.MustCompile(`~\s*(\d)`)
	// percentPattern matches a percent sign after a number.
	percentPattern = regexp.MustCompile(`(\d)\s*%`)
	// degreePattern matches a degree sign after a number, with an optional scale letter.
	degreePattern = regexp.MustCompile(`(\d)\s*°\s*([CF]\b)?`)
	// currencyPattern matches a dollar or pound sign before an amount, with an optional scale word.
	currencyPattern = regexp.MustCompile(`([$£€])\s?(\d[\d,.]*)(\s(?:million|billion|thousand))?`)
	// numberSignPattern matches a number sign before a number.
	numberSignPattern = regexp.MustCompile(`#\s?(\d)`)
	// dashBetweenWords matches an en dash joining two words, as in "Polish–Lithuanian".
	dashBetweenWords = regexp.MustCompile(`(\p{L})–(\p{L})`)
	// dashBetweenNumbers matches an en or em dash joining two numbers, as in "1914–1918".
	dashBetweenNumbers = regexp.MustCompile(`(\d)\s*[–—]\s*(\d)`)
	// letterPlusNumber matches a letter joined to a number with a plus, as in "D+7".
	letterPlusNumber = regexp.MustCompile(`\b([A-Z])\+(\d+)`)
)

// currencyNames names the currency of each sign.
var currencyNames = map[string]string{"$": "dollars", "£": "pounds", "€": "euros"}

// symbolReplacer turns marks the voice would read aloud or skip into plain punctuation or words.
var symbolReplacer = strings.NewReplacer(
	"‘", "'", "’", "'", "‚", "'", "“", `"`, "”", `"`, "„", `"`, "«", `"`, "»", `"`,
	"—", ", ", "―", ", ", "‐", "-", "‑", "-", "−", "minus ", "†", "", "‡", "", "*", "",
	"\u00a0", " ", "\u200b", "", "\ufeff", "", "\ufffd", "", "&", " and ", "+", " and ", "×", " by ",
	"（", "(", "）", ")", "［", "[", "］", "]", "\u2009", " ", "\u202f", " ", "·", " ", "`", "",
	"¹", "", "²", "", "³", "", "⁴", "", "⁵", "", "⁶", "", "⁷", "", "⁸", "", "⁹", "", "⁰", "",
	"~", " ",
)

// foldSymbols replaces symbols with the words or punctuation a narrator would use.
func foldSymbols(text string) string {
	text = letterPlusNumber.ReplaceAllString(text, "$1 plus $2")
	text = dashBetweenNumbers.ReplaceAllString(text, "$1-$2")
	text = tildePattern.ReplaceAllString(text, "about $1")
	text = percentPattern.ReplaceAllString(text, "$1 percent")
	text = degreePattern.ReplaceAllStringFunc(text, func(m string) string {
		parts := degreePattern.FindStringSubmatch(m)
		return parts[1] + " degrees" + map[string]string{"C": " Celsius", "F": " Fahrenheit"}[parts[2]]
	})
	text = numberSignPattern.ReplaceAllString(text, "number $1")
	text = strings.ReplaceAll(text, "#", " ")
	text = currencyPattern.ReplaceAllStringFunc(text, func(m string) string {
		parts := currencyPattern.FindStringSubmatch(m)
		return parts[2] + parts[3] + " " + currencyNames[parts[1]]
	})
	text = dashBetweenWords.ReplaceAllString(text, "$1-$2")
	text = strings.ReplaceAll(text, "and/or", "or")
	text = strings.ReplaceAll(text, "and /or", "or")
	text = slashPairPattern.ReplaceAllString(text, "$1 and $2")
	text = strings.ReplaceAll(text, "–", ", ")
	return symbolReplacer.Replace(text)
}

var (
	// bracketPattern matches an innermost bracketed note.
	bracketPattern = regexp.MustCompile(`[(\[{]([^()\[\]{}]*)[)\]}]`)
	// unclosedBracketPattern matches a bracket opened and never closed, through the end of the text.
	unclosedBracketPattern = regexp.MustCompile(`[(\[{][^()\[\]{}]*$`)
	// asideWordPattern matches a word of two or more letters, which a bracketed aside must hold.
	asideWordPattern = regexp.MustCompile(`\b[A-Za-z][A-Za-z']+\b`)
)

// readBrackets reads a bracketed aside such as "(light infantry)" or "(Dead Man's Hill)" as an aside
// set off by commas, and drops a bracketed note such as "(KIA)", "(Union)", "(1912–1949)", or a gloss
// in another script. An aside has two or more words that are not all numbers, and no letters outside
// the Latin script.
func readBrackets(text string) string {
	for bracketPattern.MatchString(text) {
		text = bracketPattern.ReplaceAllStringFunc(text, func(m string) string {
			inner := strings.TrimSpace(m[1 : len(m)-1])
			if isAside(inner) {
				return ", " + inner + ", "
			}
			return " "
		})
	}
	text = unclosedBracketPattern.ReplaceAllString(text, "")
	return strings.NewReplacer("(", " ", ")", " ", "[", " ", "]", " ", "{", " ", "}", " ").Replace(text)
}

// isAside reports whether bracketed text reads as part of the sentence rather than as a note.
func isAside(inner string) bool {
	if len(strings.Fields(inner)) < 2 || !asideWordPattern.MatchString(inner) {
		return false
	}
	for _, r := range inner {
		if unicode.IsLetter(r) && !unicode.Is(unicode.Latin, r) {
			return false
		}
	}
	return true
}

// letterFolds maps the Latin letters that do not decompose into an English letter and a mark.
var letterFolds = strings.NewReplacer(
	"ł", "l", "Ł", "L", "ø", "o", "Ø", "O", "đ", "d", "Đ", "D", "ð", "d", "Ð", "D", "þ", "th",
	"Þ", "Th", "ß", "ss", "æ", "ae", "Æ", "Ae", "œ", "oe", "Œ", "Oe", "ı", "i", "ħ", "h", "Ħ", "H",
	"ŋ", "ng", "Ŋ", "Ng", "ə", "e", "Ə", "E", "ɛ", "e", "ʻ", "", "ʼ", "'", "ʿ", "", "ʾ", "",
	"ʽ", "", "ꞌ", "'", "Ꞌ", "'", "ǃ", "", "ǁ", "", "ǂ", "", "ǀ", "", "ɨ", "i", "ʉ", "u", "ɔ", "o",
	"Ɔ", "O", "ɗ", "d", "Ɗ", "D", "ɓ", "b", "Ɓ", "B", "ƙ", "k", "Ƙ", "K", "ƴ", "y", "Ƴ", "Y",
	"ʃ", "sh", "ʒ", "zh", "ɲ", "ny", "ɣ", "gh", "Ɣ", "Gh", "ʔ", "", "ƒ", "f", "ª", "a", "º", "o",
)

// cyrillicFolds writes Cyrillic letters in Latin, so a Cyrillic name, or a Latin name carrying a
// Cyrillic look-alike letter, reaches the voice in letters it reads.
var cyrillicFolds = strings.NewReplacer(
	"Щ", "Shch", "щ", "shch", "Ж", "Zh", "ж", "zh", "Х", "Kh", "х", "kh", "Ц", "Ts", "ц", "ts",
	"Ч", "Ch", "ч", "ch", "Ш", "Sh", "ш", "sh", "Ю", "Yu", "ю", "yu", "Я", "Ya", "я", "ya",
	"Ё", "Yo", "ё", "yo", "Ї", "Yi", "ї", "yi", "Є", "Ye", "є", "ye", "Љ", "Lj", "љ", "lj",
	"Њ", "Nj", "њ", "nj", "Ђ", "Dj", "ђ", "dj", "Џ", "Dz", "џ", "dz", "А", "A", "а", "a",
	"Б", "B", "б", "b", "В", "V", "в", "v", "Г", "G", "г", "g", "Ґ", "G", "ґ", "g", "Д", "D",
	"д", "d", "Е", "E", "е", "e", "З", "Z", "з", "z", "И", "I", "и", "i", "І", "I", "і", "i",
	"Й", "Y", "й", "y", "Ј", "J", "ј", "j", "К", "K", "к", "k", "Л", "L", "л", "l", "М", "M",
	"м", "m", "Н", "N", "н", "n", "О", "O", "о", "o", "П", "P", "п", "p", "Р", "R", "р", "r",
	"С", "S", "с", "s", "Т", "T", "т", "t", "Ћ", "C", "ћ", "c", "У", "U", "у", "u", "Ф", "F",
	"ф", "f", "Ы", "Y", "ы", "y", "Э", "E", "э", "e", "Ъ", "", "ъ", "", "Ь", "", "ь", "",
)

// foldLetters folds Latin letters outside English to their English base, as in "Trưởng" to "Truong"
// and "Władysław" to "Wladyslaw", and writes Cyrillic in Latin letters. Letters of other scripts are
// left for the check to report.
func foldLetters(text string) string {
	// Marks come off first, so a letter such as the Cyrillic "ӑ" is a plain "а" before the table maps
	// it. A text the transform cannot read keeps its marks, and the check reports them.
	fold := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	if folded, _, err := transform.String(fold, text); err == nil {
		text = folded
	}
	text = letterFolds.Replace(text)
	return cyrillicFolds.Replace(text)
}

// abbreviations spells out the abbreviations that end with a period, longest first so "Lt. Gen."
// reads before "Gen.".
var abbreviations = []struct {
	// pattern matches the abbreviation.
	pattern *regexp.Regexp
	// words is what the narrator says.
	words string
}{
	{regexp.MustCompile(`\b2(?:Lt|LT)\b\.?`), "Second Lieutenant"},
	{regexp.MustCompile(`\b1(?:Lt|LT)\b\.?`), "First Lieutenant"},
	{regexp.MustCompile(`\bLt\.\s?Gen\.`), "Lieutenant General"},
	{regexp.MustCompile(`\bMaj\.\s?Gen\.`), "Major General"},
	{regexp.MustCompile(`\bBrig\.\s?Gen\.`), "Brigadier General"},
	{regexp.MustCompile(`\bLt\.\s?Col\.`), "Lieutenant Colonel"},
	{regexp.MustCompile(`\bLt\.\s?Cdr\.`), "Lieutenant Commander"},
	{regexp.MustCompile(`\bGen\.`), "General"},
	{regexp.MustCompile(`\bLt\.`), "Lieutenant"},
	{regexp.MustCompile(`\bCol\.`), "Colonel"},
	{regexp.MustCompile(`\bMaj\.`), "Major"},
	{regexp.MustCompile(`\bBrig\.`), "Brigadier"},
	{regexp.MustCompile(`\bCapt\.`), "Captain"},
	{regexp.MustCompile(`\bCdr\.|\bCmdr\.`), "Commander"},
	{regexp.MustCompile(`\bAdm\.`), "Admiral"},
	{regexp.MustCompile(`\bSgt\.`), "Sergeant"},
	{regexp.MustCompile(`\bCpl\.`), "Corporal"},
	{regexp.MustCompile(`\bPvt\.`), "Private"},
	{regexp.MustCompile(`\bGov\.`), "Governor"},
	{regexp.MustCompile(`\bPres\.`), "President"},
	{regexp.MustCompile(`\bSen\.`), "Senator"},
	{regexp.MustCompile(`\bRev\.`), "Reverend"},
	{regexp.MustCompile(`\bFr\.`), "Father"},
	{regexp.MustCompile(`\bDr\.`), "Doctor"},
	{regexp.MustCompile(`\bJr\.`), "Junior"},
	{regexp.MustCompile(`\bSr\.`), "Senior"},
	{regexp.MustCompile(`\bSt\.`), "Saint"},
	{regexp.MustCompile(`\bSte\.`), "Sainte"},
	{regexp.MustCompile(`\bMt\.`), "Mount"},
	{regexp.MustCompile(`\bFt\.`), "Fort"},
	{regexp.MustCompile(`\bNo\.\s?(\d)`), "number $1"},
	{regexp.MustCompile(`\bNos\.\s?(\d)`), "numbers $1"},
	{regexp.MustCompile(`\bvs\.?\s`), "versus "},
	{regexp.MustCompile(`\bapprox\.\s?`), "about "},
	{regexp.MustCompile(`\best\.\s?`), "an estimated "},
	{regexp.MustCompile(`\be\.g\.\s?`), "for example "},
	{regexp.MustCompile(`\bi\.e\.\s?`), "that is "},
	{regexp.MustCompile(`\betc\.`), "and so on"},
}

// expandAbbreviations spells out abbreviations, so the voice says them and their period does not end
// a sentence.
func expandAbbreviations(text string) string {
	for _, a := range abbreviations {
		text = a.pattern.ReplaceAllString(text, a.words)
	}
	return text
}

// initialisms rewrites the capital-letter words the voice misreads in context. Each maps to the words a
// narrator says, or to the letters with periods so the voice says each letter.
var initialisms = map[string]string{
	"UKGBI": "United Kingdom",
	"IS":    "Islamic State",
	"KIA":   "killed in action",
	"WIA":   "wounded in action",
	"MIA":   "missing in action",
	"POW":   "prisoner of war",
	"POWs":  "prisoners of war",
	"SMOM":  "Order of Malta",
	"INF":   "Infantry",
}

// ranks spells out the capital-letter rank codes written before a name, as in "LTC William Weise".
var ranks = map[string]string{
	"LT": "Lieutenant", "CPT": "Captain", "MAJ": "Major", "COL": "Colonel", "LTC": "Lieutenant Colonel",
	"GEN": "General", "MG": "Major General", "BG": "Brigadier General", "SGT": "Sergeant",
	"SSG": "Staff Sergeant", "SFC": "Sergeant First Class", "MSG": "Master Sergeant",
	"CPL": "Corporal", "PFC": "Private First Class",
}

// rankPattern matches a capital-letter rank code followed by a capitalized name.
var rankPattern = regexp.MustCompile(`\b(LTC|LT|CPT|MAJ|COL|GEN|MG|BG|SGT|SSG|SFC|MSG|CPL|PFC) ([A-Z])`)

// initialismPattern matches a word of two to five capital letters, with an optional plural "s".
var initialismPattern = regexp.MustCompile(`\b[A-Z]{2,5}s?\b`)

// readInitialisms rewrites the capital-letter words listed in initialisms, and rank codes before a
// name.
func readInitialisms(text string) string {
	text = rankPattern.ReplaceAllStringFunc(text, func(m string) string {
		parts := rankPattern.FindStringSubmatch(m)
		return ranks[parts[1]] + " " + parts[2]
	})
	return initialismPattern.ReplaceAllStringFunc(text, func(w string) string {
		if words, ok := initialisms[w]; ok {
			return words
		}
		return w
	})
}

var (
	// spaceRun matches a run of spaces and tabs.
	spaceRun = regexp.MustCompile(`[ \t\r\n]+`)
	// spaceBeforeMark matches spaces before a punctuation mark other than a period.
	spaceBeforeMark = regexp.MustCompile(` +([,;:!?])`)
	// spaceBeforeStop matches spaces before a period that does not start a decimal, as ".30" does.
	spaceBeforeStop = regexp.MustCompile(` +\.(\D|$)`)
	// repeatedCommas matches commas with nothing between them.
	repeatedCommas = regexp.MustCompile(`,(?:\s*,)+`)
	// commaBeforeStop matches a comma directly before another mark.
	commaBeforeStop = regexp.MustCompile(`,\s*([.;:!?])`)
	// commaAfterStop matches a comma directly after another mark.
	commaAfterStop = regexp.MustCompile(`([.;:!?])\s*,`)
	// markAtStart matches commas left at the start of the text.
	markAtStart = regexp.MustCompile(`^[\s,;:]+`)
)

// tidy collapses the spacing and stray punctuation the rewrites leave behind.
func tidy(text string) string {
	text = spaceRun.ReplaceAllString(text, " ")
	text = spaceBeforeMark.ReplaceAllString(text, "$1")
	text = spaceBeforeStop.ReplaceAllString(text, ".$1")
	text = repeatedCommas.ReplaceAllString(text, ",")
	text = commaBeforeStop.ReplaceAllString(text, "$1")
	text = commaAfterStop.ReplaceAllString(text, "$1")
	text = markAtStart.ReplaceAllString(text, "")
	return strings.TrimSpace(text)
}
