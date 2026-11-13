package voice

import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

func TestPhonemeSymbols(t *testing.T) {
	t.Parallel()
	if got := len(phonemeSymbols); got != 88 {
		t.Errorf("phoneme symbols: got %d, want 88 of the voice's 114", got)
	}
	for _, r := range "ˈˌːɡɹʃŋ̃" {
		if !phonemeSymbols[r] {
			t.Errorf("phoneme symbols lack %q", r)
		}
	}
	for _, r := range "g ,.?AQ→…" {
		if phonemeSymbols[r] {
			t.Errorf("phoneme symbols hold %q", r)
		}
	}
	if listed := PhonemeSymbols(); strings.ContainsRune(listed, '̃') || !strings.Contains(listed, "ɡ") {
		t.Errorf("PhonemeSymbols() = %q, want every symbol but the combining tilde", listed)
	}
}

func TestNormalizeReading(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantReading string
		WantOutside []rune
		In          string
	}{{ // Test 0: An espeak reading stays as it is.
		In: "bˈɑːxmʊt", WantReading: "bˈɑːxmʊt",
	}, { // Test 1: A stress mark at the start of its syllable moves before the vowel.
		In: "ˈbɑːx.mʊt", WantReading: "bˈɑːxmʊt",
	}, { // Test 2: Slashes, ASCII g and r, and a colon for length are rewritten.
		In: "/ˈgrɑ:d/", WantReading: "ɡɹˈɑːd",
	}, { // Test 3: Tie bars, tone letters, and digits are dropped.
		In: "ˈt͡ʃa˥˩ŋ2", WantReading: "tʃˈaŋ",
	}, { // Test 4: Sounds the voice lacks map to their nearest kin.
		In: "ˈʐɵɦa", WantReading: "ʒˈoha",
	}, { // Test 5: Nasal vowels and a cedilla survive, and spaces go.
		In: "ʒɑ̃ fʁɑ̃ˈswa ɡaˈʁaʒ ˈça", WantReading: "ʒɑ̃fʁɑ̃swˈaɡaʁˈaʒçˈa",
	}, { // Test 6: A symbol outside the voice's set is reported once.
		In: "ⁿdaⁿ", WantReading: "ⁿdaⁿ", WantOutside: []rune{'ⁿ'},
	}, { // Test 7: Capital letters are outside the voice's set.
		In: "mOskQ", WantReading: "mOskQ", WantOutside: []rune{'O', 'Q'},
	}, { // Test 8: A primary mark wins over a secondary one held for the same vowel.
		In: "ˌˈa", WantReading: "ˈa",
	}, { // Test 9: A mark with no vowel after it is dropped.
		In: "mˈ", WantReading: "m",
	}, { // Test 10: An empty reading stays empty.
		In: "  ", WantReading: "",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			gotReading, gotOutside := NormalizeReading(test.In)
			if diff := cmp.Diff(test.WantReading, gotReading); diff != "" {
				t.Errorf("reading mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantOutside, gotOutside, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("outside symbols mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestReadingsAgree(t *testing.T) {
	t.Parallel()
	tests := []struct {
		A, B string
		Want bool
	}{{ // Test 0: The same reading agrees.
		A: "bˈɑːxmʊt", B: "bˈɑːxmʊt", Want: true,
	}, { // Test 1: Vowels of the same class agree.
		A: "bˈɑːxmʊt", B: "bˈæxmuːt", Want: true,
	}, { // Test 2: Stress on another vowel fails.
		A: "bˈɑːxmʊt", B: "bɑːxmˈʊt",
	}, { // Test 3: A consonant of another class fails, as k for the Ukrainian kh.
		A: "bˈɑːxmʊt", B: "bˈɑːkmʊt",
	}, { // Test 4: A vowel of another class fails.
		A: "bˈɑːxmʊt", B: "bˈɑːxmət",
	}, { // Test 5: An affricate written apart agrees with its single symbol.
		A: "tʃˈɛn", B: "ʧˈɛn", Want: true,
	}, { // Test 6: A reading without stress does not fail on stress.
		A: "vˈaːɡnɐ", B: "vaːɡnɐ", Want: true,
	}, { // Test 7: A diphthong counts as one vowel sound.
		A: "mˈɒskəʊ", B: "mˈɔskə", Want: true,
	}, { // Test 8: W for V fails.
		A: "vˈaːɡnɐ", B: "wˈaːɡnɐ",
	}, { // Test 9: An empty reading agrees with nothing.
		A: "", B: "a",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if got := ReadingsAgree(test.A, test.B); got != test.Want {
				t.Errorf("ReadingsAgree(%q, %q) = %t, want %t", test.A, test.B, got, test.Want)
			}
			if got := ReadingsAgree(test.B, test.A); got != test.Want {
				t.Errorf("ReadingsAgree(%q, %q) = %t, want %t", test.B, test.A, got, test.Want)
			}
		})
	}
}
