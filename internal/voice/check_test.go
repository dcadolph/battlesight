package voice

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

func TestCheck(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In           string
		WantProblems []Problem
	}{{ // Test 0: Clean speakable text passes.
		In: "Louis the Fourteenth fields about 10,000 men in sixteen thirty-two, 21st Division.",
	}, { // Test 1: A year left as digits fails.
		In: "Granada falls in 1492.", WantProblems: []Problem{{Rule: RuleDigits, Word: "1492"}},
	}, { // Test 2: An era before its year fails.
		In: "in AD 79", WantProblems: []Problem{{Rule: RuleDigits, Word: "AD 7"}},
	}, { // Test 3: Digits joined to letters fail.
		In: "M113s advance", WantProblems: []Problem{{Rule: RuleDigits, Word: "M113s"}},
	}, { // Test 4: A Roman numeral of two letters or more fails.
		In: "Louis XIV marches", WantProblems: []Problem{{Rule: RuleRoman, Word: "XIV"}},
	}, { // Test 5: A lone numeral after a name fails, an initial passes.
		In:           "Henry V leads and John V. Smith follows",
		WantProblems: []Problem{{Rule: RuleRoman, Word: "Henry V"}},
	}, { // Test 6: Markup fails.
		In: "'''Putin''' and 20px", WantProblems: []Problem{
			{Rule: RuleMarkup, Word: "''"}, {Rule: RuleMarkup, Word: "''"}, {Rule: RuleMarkup, Word: "20px"},
			{Rule: RuleDigits, Word: "20px"},
		},
	}, { // Test 7: A name cut short fails.
		In: "Commonw… faces Sweden", WantProblems: []Problem{{Rule: RuleEllipsis, Word: "Commonw…"}},
	}, { // Test 8: A letter outside English fails.
		In: "Trưởng holds", WantProblems: []Problem{{Rule: RuleLetter, Word: "Trưởng"}},
	}, { // Test 9: A symbol fails.
		In: "Army + militia", WantProblems: []Problem{{Rule: RuleSymbol, Word: "+ in +"}},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantProblems, Check(test.In), cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestSpeakablePassesCheck runs the raw forms through Speakable and confirms the check finds nothing,
// the positive half of the negative controls above.
func TestSpeakablePassesCheck(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In string
	}{{ // Test 0: A year.
		In: "Granada falls in 1492.",
	}, { // Test 1: An era before its year.
		In: "in AD 79",
	}, { // Test 2: A designator.
		In: "M113s advance",
	}, { // Test 3: A ruler.
		In: "Louis XIV marches",
	}, { // Test 4: A lone numeral after a name.
		In: "Henry V leads and John V. Smith follows",
	}, { // Test 5: Markup.
		In: "'''Putin''' and 20px",
	}, { // Test 6: A letter outside English.
		In: "Trưởng holds",
	}, { // Test 7: A symbol.
		In: "Army + militia",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			speakable := Speakable(test.In)
			if diff := cmp.Diff([]Problem(nil), Check(speakable), cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("speakable %q mismatch (-want +got):\n%s", speakable, diff)
			}
		})
	}
}
