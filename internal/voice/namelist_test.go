package voice

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

func TestNameListProblems(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantProblems []Problem
		List         NameList
	}{{ // Test 0: Readings in the voice's symbols pass.
		List: NameList{"Bakhmut": {British: "bˈɑːxmʊt", American: "bˈɑːkmuːt", Writers: []string{"chatgpt"}}},
	}, { // Test 1: An empty reading fails.
		List:         NameList{"Ney": {British: "nˈeɪ"}},
		WantProblems: []Problem{{Rule: RulePhoneme, Word: "Ney: empty reading"}},
	}, { // Test 2: A symbol the voice lacks fails, named in the problem.
		List:         NameList{"Murat": {British: "mjʊɹˈɑː", American: "mjʊɹˈɑ:"}},
		WantProblems: []Problem{{Rule: RulePhoneme, Word: "Murat: :"}},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantProblems, test.List.Problems(), cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("problems mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestNameListSaveLoad(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "names.json")
	list := NameList{
		"Bakhmut": {British: "bˈɑːxmʊt", American: "bˈɑːkmuːt", Writers: []string{"chatgpt", "gemini"}},
		"fleches": {British: "flˈɛʃ", American: "flˈɛʃ", Spellings: []string{"flèches"}, Writers: []string{"settle"},
			Reason: "French field works."},
	}
	if err := list.Save(path); err != nil {
		t.Fatal(err)
	}
	got, err := LoadNameList(path)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(list, got); diff != "" {
		t.Errorf("round trip mismatch (-want +got):\n%s", diff)
	}
	empty, err := LoadNameList(filepath.Join(dir, "missing.json"))
	if err != nil || len(empty) != 0 {
		t.Errorf("missing file: got %v, %v, want an empty list", empty, err)
	}
	bad := filepath.Join(dir, "bad.json")
	if err := os.WriteFile(bad, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadNameList(bad); !errors.Is(err, ErrNameList) {
		t.Errorf("malformed file: got %v, want %v", err, ErrNameList)
	}
}
