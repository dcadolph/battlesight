package voice

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

var (
	// wordPattern matches a word: a run of letters, with an apostrophe allowed inside.
	wordPattern = regexp.MustCompile(`\p{L}+(?:['’]\p{L}+)*`)
	// sentenceEnd matches a mark that ends a sentence or opens a quotation, with any space after it.
	sentenceEnd = regexp.MustCompile(`[.!?:;"“”]\s*$`)
)

// Lexicon holds ordinary English words in lower case.
type Lexicon map[string]struct{}

// LoadLexicon reads a word list, one word a line, and keeps its lower-case entries, so a proper
// noun the list capitalizes stays a name.
func LoadLexicon(path string) (Lexicon, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrLexicon, err)
	}
	defer f.Close() //nolint:errcheck // Read-only file.
	words := Lexicon{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		word := strings.TrimSpace(scanner.Text())
		if r, _ := utf8.DecodeRuneInString(word); unicode.IsLower(r) {
			words[word] = struct{}{}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("%w: %s: %w", ErrLexicon, path, err)
	}
	if len(words) == 0 {
		return nil, fmt.Errorf("%w: %s holds no lower-case words", ErrLexicon, path)
	}
	return words, nil
}

// Name is one word the narrator must be told how to say.
type Name struct {
	// Word is the name as the speakable text spells it, the key in the name list.
	Word string
	// Spellings lists the source spellings that fold to Word, set only when one differs from it.
	Spellings []string
}

// Finder finds the names in narration.
type Finder struct {
	// english holds ordinary English words in lower case.
	english Lexicon
	// lower holds every word the narration writes in lower case.
	lower map[string]struct{}
}

// NewFinder returns a Finder for a body of narration, given all of its speakable texts. A
// capitalized word that starts a sentence counts as English when the narration writes it in lower
// case elsewhere. It panics on a nil lexicon.
func NewFinder(english Lexicon, speakables []string) *Finder {
	if english == nil {
		panic("voice: NewFinder requires a lexicon")
	}
	lower := map[string]struct{}{}
	for _, text := range speakables {
		for _, word := range wordPattern.FindAllString(text, -1) {
			if r, _ := utf8.DecodeRuneInString(word); unicode.IsLower(r) {
				lower[word] = struct{}{}
			}
		}
	}
	return &Finder{english: english, lower: lower}
}

// Names returns the names in one phase, given its source text and its speakable text, in reading
// order and each once. A name is a capitalized word that is not ordinary English, or any word that
// carried a letter outside English in the source, whatever its case.
func (f *Finder) Names(source, speakable string) []Name {
	accented := accentedWords(source)
	var names []Name
	seen := map[string]bool{}
	for _, loc := range wordPattern.FindAllStringIndex(speakable, -1) {
		word := trimPossessive(speakable[loc[0]:loc[1]])
		if seen[word] {
			continue
		}
		spellings, wasAccented := accented[word]
		if !wasAccented && !f.isName(word, startsSentence(speakable, loc[0])) {
			continue
		}
		seen[word] = true
		names = append(names, Name{Word: word, Spellings: spellings})
	}
	return names
}

// isName reports whether a word outside the source's accented words is a name: capitalized, longer
// than one letter, not an initialism, and not ordinary English.
func (f *Finder) isName(word string, initial bool) bool {
	first, size := utf8.DecodeRuneInString(word)
	if size == len(word) || !unicode.IsUpper(first) {
		return false
	}
	if utf8.RuneCountInString(word) <= 4 && strings.ToUpper(word) == word {
		return false
	}
	lower := strings.ToLower(word)
	if _, ok := f.english[lower]; ok {
		return false
	}
	if _, ok := f.lower[lower]; ok && initial {
		return false
	}
	return true
}

// accentedWords maps the folded form of each source word that has a letter outside English to the
// source spellings that fold to it.
func accentedWords(source string) map[string][]string {
	var out map[string][]string
	for _, word := range wordPattern.FindAllString(source, -1) {
		word = trimPossessive(word)
		if !strings.ContainsFunc(word, isForeignLetter) {
			continue
		}
		folded := foldLetters(word)
		if out == nil {
			out = map[string][]string{}
		}
		if !slices.Contains(out[folded], word) {
			out[folded] = append(out[folded], word)
		}
	}
	return out
}

// isForeignLetter reports whether a rune is a letter outside English.
func isForeignLetter(r rune) bool {
	return r > unicode.MaxASCII && unicode.IsLetter(r)
}

// trimPossessive drops a possessive ending from a word.
func trimPossessive(word string) string {
	for _, suffix := range []string{"'s", "’s"} {
		if trimmed, ok := strings.CutSuffix(word, suffix); ok && trimmed != "" {
			return trimmed
		}
	}
	return word
}

// startsSentence reports whether the word at byte offset start opens the text, a sentence, or a
// quotation, judged by the three characters before it.
func startsSentence(text string, start int) bool {
	from := start
	for range 3 {
		if from == 0 {
			break
		}
		_, size := utf8.DecodeLastRuneInString(text[:from])
		from -= size
	}
	return start == 0 || sentenceEnd.MatchString(text[from:start])
}
