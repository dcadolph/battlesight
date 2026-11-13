package voice

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
)

func TestRomanValue(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In        string
		WantValue int
	}{{ // Test 0: One.
		In: "I", WantValue: 1,
	}, { // Test 1: Subtractive form.
		In: "XIV", WantValue: 14,
	}, { // Test 2: Forty.
		In: "XL", WantValue: 40,
	}, { // Test 3: Not in standard form.
		In: "IIII", WantValue: 0,
	}, { // Test 4: Not a numeral.
		In: "VC", WantValue: 0,
	}, { // Test 5: Empty.
		In: "", WantValue: 0,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantValue, romanValue(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestReadRoman(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		In         string
	}{{ // Test 0: A ruler.
		In: "Louis XIV marches.", WantResult: "Louis the Fourteenth marches.",
	}, { // Test 1: A ruler's possessive.
		In: "Otto IV's army", WantResult: "Otto the Fourth's army",
	}, { // Test 2: A corps.
		In: "VI Corps holds.", WantResult: "Sixth Corps holds.",
	}, { // Test 3: A corps with words between.
		In: "II SS Panzer Corps", WantResult: "Second SS Panzer Corps",
	}, { // Test 4: The world wars.
		In: "after World War II.", WantResult: "after World War Two.",
	}, { // Test 5: A model number reads as a number.
		In: "a Panzer IV and a Mark V", WantResult: "a Panzer Four and a Mark Five",
	}, { // Test 6: A numeral after an acronym reads as a number.
		In: "CM-FPR II faces", WantResult: "CM-FPR Two faces",
	}, { // Test 7: A ruler at the end of a sentence.
		In: "crowned Henry V. The army", WantResult: "crowned Henry the Fifth. The army",
	}, { // Test 8: An initial stays a letter.
		In: "John V. Smith and Franklin C. Sibert", WantResult: "John V. Smith and Franklin C. Sibert",
	}, { // Test 9: The pronoun stays a word.
		In: "When I arrive, Ney said I'm late", WantResult: "When I arrive, Ney said I'm late",
	}, { // Test 10: A lower-case numeral after a name.
		In: "Khosrow ii holds", WantResult: "Khosrow the Second holds",
	}, { // Test 11: Washington DC is no numeral.
		In: "Washington DC", WantResult: "Washington DC",
	}, { // Test 12: A ruler named in a list.
		In: "Mahmud II, Abdulmecid I, and Robert Stopford", WantResult: "Mahmud the Second, " +
			"Abdulmecid the First, and Robert Stopford",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, readRoman(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
