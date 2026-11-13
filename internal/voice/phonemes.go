package voice

import (
	_ "embed"
	"encoding/json"
	"slices"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// vocabJSON is the voice model's symbol list: Kokoro v1.0's 114 symbols as the kokoro-onnx config
// lists them. The voice's tokenizer drops any other symbol without a word.
//
//go:embed voice_vocab.json
var vocabJSON []byte

// nasalMark is the combining tilde, the one combining mark the voice reads.
const nasalMark = '̃'

// vowels lists the voice's vowel symbols, which a stress mark sits before.
const vowels = "aeiouyæøœɐɑɒɔəɚɛɜɤɨɪɯʊʌᵊᵻ"

// phonemeSymbols holds the symbols a reading may use: the voice's list without its punctuation,
// space, arrows, and the capital letters its own text front end uses as shorthand.
var phonemeSymbols = loadPhonemeSymbols(vocabJSON)

// readingFolds maps the notation writers use to the voice's symbols: ASCII stand-ins, sounds the
// voice lacks mapped to their nearest kin, and marks it ignores mapped to nothing.
var readingFolds = strings.NewReplacer(
	"g", "ɡ", "r", "ɹ", ":", "ː", "'", "ˈ", "’", "ˈ", "ˑ", "",
	"ʐ", "ʒ", "ʑ", "ʒ", "ɵ", "o", "ʏ", "y", "ɦ", "h", "ħ", "h", "ʕ", "ʔ", "ɝ", "ɜ", "ɫ", "l",
	"ɬ", "l", "ʀ", "ʁ", "ɘ", "ə", "ʉ", "u", "ɞ", "ɜ", "ʍ", "w", "ɧ", "ʃ",
	"ʷ", "", "ʼ", "", "ˠ", "", "ˤ", "", "/", "", "[", "", "]", "", ".", "", "-", "", " ", "",
	"|", "", "‿", "", "˥", "", "˦", "", "˧", "", "˨", "", "˩", "",
)

// loadPhonemeSymbols reads the voice's symbol list and keeps the phoneme symbols. It panics on a
// malformed list, which is a fault in the embedded file.
func loadPhonemeSymbols(data []byte) map[rune]bool {
	var list []string
	if err := json.Unmarshal(data, &list); err != nil {
		panic("voice: symbol list is not a JSON list of strings: " + err.Error())
	}
	symbols := make(map[rune]bool, len(list))
	for _, s := range list {
		r := []rune(s)
		if len(r) != 1 {
			panic("voice: symbol list entry is not one symbol: " + s)
		}
		c := r[0]
		if !unicode.IsPunct(c) && !unicode.IsSpace(c) && !unicode.IsSymbol(c) && !unicode.IsUpper(c) {
			symbols[c] = true
		}
	}
	return symbols
}

// PhonemeSymbols returns the symbols a reading may use, in order and separated by spaces, without
// the combining tilde, which a prompt describes in words.
func PhonemeSymbols() string {
	list := make([]string, 0, len(phonemeSymbols))
	for r := range phonemeSymbols {
		if r != nasalMark {
			list = append(list, string(r))
		}
	}
	slices.Sort(list)
	return strings.Join(list, " ")
}

// OutsideSymbols returns each symbol of a reading that the voice does not have, once each, in
// reading order.
func OutsideSymbols(reading string) []rune {
	var outside []rune
	for _, r := range reading {
		if !phonemeSymbols[r] && !slices.Contains(outside, r) {
			outside = append(outside, r)
		}
	}
	return outside
}

// NormalizeReading rewrites a writer's reading in the voice's notation: folded to the voice's
// symbols, every mark the voice ignores dropped, and each stress mark moved to sit right before its
// vowel, where espeak puts it. It returns the reading and the symbols left outside the voice's set.
func NormalizeReading(reading string) (string, []rune) {
	s := norm.NFD.String(strings.TrimSpace(reading))
	s = strings.ReplaceAll(s, "ç", "ç")
	s = readingFolds.Replace(s)
	kept := make([]rune, 0, len(s))
	for _, r := range s {
		if unicode.IsDigit(r) || unicode.Is(unicode.Mn, r) && r != nasalMark {
			continue
		}
		kept = append(kept, r)
	}
	normalized := string(placeStress(kept))
	return normalized, OutsideSymbols(normalized)
}

// placeStress moves each stress mark from the start of its syllable to right before the syllable's
// vowel, and drops a mark with no vowel after it. A primary mark wins over a secondary one held for
// the same vowel.
func placeStress(in []rune) []rune {
	out := make([]rune, 0, len(in))
	var held rune
	for _, r := range in {
		switch {
		case r == 'ˈ' || r == 'ˌ':
			if held == 0 || r == 'ˈ' {
				held = r
			}
		case strings.ContainsRune(vowels, r):
			if held != 0 {
				out = append(out, held)
				held = 0
			}
			out = append(out, r)
		default:
			out = append(out, r)
		}
	}
	return out
}

// vowelClasses maps each vowel to a coarse class, so the agreement rule ignores vowel detail an
// English narrator cannot carry over.
var vowelClasses = classTable(map[string]rune{
	"aɑɐæʌ": 'A', "ɒɔoɵ": 'O', "əɚɜɝeɛɘœøɤᵊ": 'E', "iɪɨyʏᵻ": 'I', "uʊɯʉ": 'U',
})

// consonantClasses maps consonants to the class the agreement rule compares, so a sound and its near
// kin match. A consonant missing here is its own class, and an empty class is dropped.
var consonantClasses = map[rune]string{
	'ɡ': "g", 'ɣ': "g", 'χ': "x", 'ç': "x", 'ħ': "h", 'ɦ': "h", 'ɹ': "r", 'ɾ': "r", 'ʁ': "r",
	'ʀ': "r", 'ɻ': "r", 'ɽ': "r", 'ɫ': "l", 'ɬ': "l", 'ʎ': "l", 'ʃ': "S", 'ʂ': "S", 'ɕ': "S",
	'ʒ': "Z", 'ʐ': "Z", 'ʑ': "Z", 'ʋ': "v", 'β': "v", 'ɥ': "w", 'ɲ': "n", 'ŋ': "N", 'θ': "T",
	'ð': "D", 'ʔ': "", 'q': "k", 'c': "k", 'ɟ': "g", 'ʝ': "j", 'ɸ': "f", 'ʕ': "", 'ʧ': "C",
	'ʤ': "J", 'ʦ': "ts", 'ʣ': "dz", 'ʨ': "C", 'ʥ': "J",
}

// affricates merges a stop and a fricative written apart into the class of the joined sound.
var affricates = map[string]rune{"tS": 'C', "dZ": 'J'}

// shapeDrops lists the marks the agreement rule ignores.
const shapeDrops = "ˌːˑʲʰʷˠˤ.‿'’-()˥˦˧˨˩0123456789 "

// classTable expands a map from groups of runes to a class into a map from each rune.
func classTable(groups map[string]rune) map[rune]rune {
	table := map[rune]rune{}
	for chars, class := range groups {
		for _, r := range chars {
			table[r] = class
		}
	}
	return table
}

// shape is the coarse form of a reading that the agreement rule compares.
type shape struct {
	// consonants lists the consonant classes in order, affricates merged and doubles collapsed.
	consonants string
	// vowels lists the class of each vowel sound, a diphthong counting once.
	vowels string
	// stress is the index of the stressed vowel sound, or -1 when the reading marks none.
	stress int
}

// shapeUnit is one sound of a reading on its way to a shape.
type shapeUnit struct {
	// vowel is true for a vowel and false for a consonant.
	vowel bool
	// class is the sound's class.
	class rune
	// stressed is true for a vowel the reading marks with primary stress.
	stressed bool
}

// shapeOf returns the shape of a reading, and false for an empty one.
func shapeOf(reading string) (shape, bool) {
	var units []shapeUnit
	stressNext := false
	for _, r := range norm.NFD.String(strings.ToLower(reading)) {
		switch {
		case r == 'ˈ':
			stressNext = true
		case unicode.Is(unicode.Mn, r):
			if r == nasalMark && len(units) > 0 && units[len(units)-1].vowel {
				units = append(units, shapeUnit{class: 'n'})
			}
		case strings.ContainsRune(shapeDrops, r):
		default:
			if class, ok := vowelClasses[r]; ok {
				units = append(units, shapeUnit{vowel: true, class: class, stressed: stressNext})
				stressNext = false
				continue
			}
			class, ok := consonantClasses[r]
			if !ok {
				class = string(r)
			}
			if class == "" {
				units = append(units, shapeUnit{})
			}
			for _, c := range class {
				units = append(units, shapeUnit{class: c})
			}
		}
	}
	return foldUnits(units)
}

// foldUnits builds a shape from a reading's sounds: vowels in a row count as one vowel sound, a
// stop and fricative pair joins as an affricate, and a doubled consonant counts once.
func foldUnits(units []shapeUnit) (shape, bool) {
	var consonants, vowelSounds []rune
	stress := -1
	previousVowel := false
	for _, u := range units {
		if u.vowel {
			if !previousVowel {
				vowelSounds = append(vowelSounds, u.class)
				previousVowel = true
			}
			if u.stressed && stress < 0 {
				stress = len(vowelSounds) - 1
			}
			continue
		}
		previousVowel = false
		if u.class == 0 {
			continue
		}
		if n := len(consonants); n > 0 {
			if joined, ok := affricates[string([]rune{consonants[n-1], u.class})]; ok {
				consonants[n-1] = joined
				continue
			}
			if consonants[n-1] == u.class {
				continue
			}
		}
		consonants = append(consonants, u.class)
	}
	if len(consonants) == 0 && len(vowelSounds) == 0 {
		return shape{}, false
	}
	return shape{consonants: string(consonants), vowels: string(vowelSounds), stress: stress}, true
}

// ReadingsAgree reports whether two readings say a name the same way: consonants match class for
// class, the vowel sounds match class for class, and the stress falls on the same vowel sound when
// both readings mark it. An empty reading agrees with nothing.
func ReadingsAgree(a, b string) bool {
	shapeA, okA := shapeOf(a)
	shapeB, okB := shapeOf(b)
	if !okA || !okB || shapeA.consonants != shapeB.consonants || shapeA.vowels != shapeB.vowels {
		return false
	}
	return shapeA.stress < 0 || shapeB.stress < 0 || shapeA.stress == shapeB.stress
}
