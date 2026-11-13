package voice

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
)

func TestCardinalAndOrdinal(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantCardinal string
		WantOrdinal  string
		In           int
	}{{ // Test 0: Zero.
		In: 0, WantCardinal: "zero", WantOrdinal: "zeroth",
	}, { // Test 1: Irregular ordinal.
		In: 1, WantCardinal: "one", WantOrdinal: "first",
	}, { // Test 2: Twelve.
		In: 12, WantCardinal: "twelve", WantOrdinal: "twelfth",
	}, { // Test 3: Round tens take "ieth".
		In: 20, WantCardinal: "twenty", WantOrdinal: "twentieth",
	}, { // Test 4: Hyphenated tens.
		In: 21, WantCardinal: "twenty-one", WantOrdinal: "twenty-first",
	}, { // Test 5: Hundreds take "and".
		In: 105, WantCardinal: "one hundred and five", WantOrdinal: "one hundred and fifth",
	}, { // Test 6: Thousands with a small remainder take "and".
		In: 3005, WantCardinal: "three thousand and five", WantOrdinal: "three thousand and fifth",
	}, { // Test 7: Thousands with hundreds.
		In: 117871, WantCardinal: "one hundred and seventeen thousand eight hundred and seventy-one",
		WantOrdinal: "one hundred and seventeen thousand eight hundred and seventy-first",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantCardinal, cardinal(test.In)); diff != "" {
				t.Errorf("cardinal mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantOrdinal, ordinal(test.In)); diff != "" {
				t.Errorf("ordinal mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestYearWords(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		In         int
	}{{ // Test 0: The year one thousand.
		In: 1000, WantResult: "one thousand",
	}, { // Test 1: A year in the first decade of a century.
		In: 1003, WantResult: "ten oh three",
	}, { // Test 2: A plain year.
		In: 1066, WantResult: "ten sixty-six",
	}, { // Test 3: A round century.
		In: 1100, WantResult: "eleven hundred",
	}, { // Test 4: The narrator's example.
		In: 1632, WantResult: "sixteen thirty-two",
	}, { // Test 5: Early twentieth century.
		In: 1905, WantResult: "nineteen oh five",
	}, { // Test 6: The year two thousand.
		In: 2000, WantResult: "two thousand",
	}, { // Test 7: Twenty-first century years.
		In: 2022, WantResult: "two thousand and twenty-two",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, yearWords(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestReadNumbers(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		In         string
	}{{ // Test 0: A year in prose.
		In: "Granada falls in 1492.", WantResult: "Granada falls in fourteen ninety-two.",
	}, { // Test 1: A count without commas before a count noun keeps its digits with commas.
		In: "about 1500 men", WantResult: "about 1,500 men",
	}, { // Test 2: A count after a lead word.
		In: "some 1800 Cossacks", WantResult: "some 1,800 Cossacks",
	}, { // Test 3: A count range.
		In: "1500-2000 horsemen", WantResult: "1,500 to 2,000 horsemen",
	}, { // Test 4: A year range with a short second year.
		In: "in 1944-45", WantResult: "in nineteen forty-four to nineteen forty-five",
	}, { // Test 5: Counts with commas stay digits.
		In: "about 117,000 men", WantResult: "about 117,000 men",
	}, { // Test 6: Military time with a leading zero.
		In: "at 0215", WantResult: "at oh two fifteen",
	}, { // Test 7: Clock time with a colon.
		In: "at 7:45 and 17:00 and 04:00", WantResult: "at seven forty-five and seventeen hundred and four o'clock",
	}, { // Test 8: Era written before the year moves after it.
		In: "in AD 79", WantResult: "in 79 AD",
	}, { // Test 9: Circa reads as around.
		In: "c. 480 BC", WantResult: "around 480 BC",
	}, { // Test 10: A decade.
		In: "the 1630s and 2010s", WantResult: "the sixteen thirties and twenty tens",
	}, { // Test 11: Weapon designators.
		In: "M113s, T-72, FAB-3000, Shahed-136, A-6s, C-130s",
		WantResult: "M-one thirteens, T-seventy-two, FAB-three thousand, Shahed-one thirty-six, A-sixes, " +
			"C-one thirties",
	}, { // Test 12: Mixed capital designators.
		In: "M1A1 and AGM-114R9X", WantResult: "M-one-A-one and AGM-one fourteen-R-nine-X",
	}, { // Test 13: Units after a number.
		In: "6-8 km and a 57mm gun", WantResult: "6 to 8 kilometers and a 57 millimeter gun",
	}, { // Test 14: Unit numbers with slashes.
		In: "the 2/13th and 3/7 Marines", WantResult: "the second thirteenth and 3 7 Marines",
	}, { // Test 15: A caliber written as a decimal.
		In: "their .30 calibre guns", WantResult: "their 30 caliber guns",
	}, { // Test 16: Hill numbers with a letter.
		In: "861A and 881S", WantResult: "eight sixty-one A and eight eighty-one S",
	}, { // Test 17: Five digits without commas gain them.
		In: "117871 casualties", WantResult: "117,871 casualties",
	}, { // Test 18: A decimal with a scale word stays.
		In: "1.6 million", WantResult: "1.6 million",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, readNumbers(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
