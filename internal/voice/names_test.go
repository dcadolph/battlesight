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

func TestFinderNames(t *testing.T) {
	t.Parallel()
	english := Lexicon{}
	for _, w := range []string{"the", "army", "of", "falls", "fall", "at", "on", "meets", "marches", "town"} {
		english[w] = struct{}{}
	}
	finder := NewFinder(english, []string{"The army is advancing at dawn."})
	tests := []struct {
		WantNames []Name
		Source    string
		Speakable string
	}{{ // Test 0: A capitalized word outside English is a name, an English one is not.
		Speakable: "The army of Bakhmut falls.", WantNames: []Name{{Word: "Bakhmut"}},
	}, { // Test 1: A capitalized English word inside a sentence is not a name.
		Speakable: "The Army falls.",
	}, { // Test 2: An initialism is not a name.
		Speakable: "NATO marches.",
	}, { // Test 3: A sentence opener the narration writes in lower case elsewhere is not a name.
		Speakable: "Advancing on Bakhmut.", WantNames: []Name{{Word: "Bakhmut"}},
	}, { // Test 4: A word that had a letter outside English is a name whatever its case.
		Source:    "The flèches at Borodino fall.",
		Speakable: "The fleches at Borodino fall.",
		WantNames: []Name{{Word: "fleches", Spellings: []string{"flèches"}}, {Word: "Borodino"}},
	}, { // Test 5: A possessive is trimmed and a repeated name counts once.
		Speakable: "Kutuzov's army meets Kutuzov.", WantNames: []Name{{Word: "Kutuzov"}},
	}, { // Test 6: A single capital letter is not a name.
		Speakable: "A town falls.",
	}, { // Test 7: A word after an opening quotation counts as a sentence opener.
		Speakable: `He says “Advancing now.”`, WantNames: []Name{{Word: "He"}},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			source := test.Source
			if source == "" {
				source = test.Speakable
			}
			got := finder.Names(source, test.Speakable)
			if diff := cmp.Diff(test.WantNames, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("names mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestNewFinderPanicsOnNilLexicon(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Error("NewFinder(nil, nil) did not panic")
		}
	}()
	NewFinder(nil, nil)
}

func TestLoadLexicon(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	words := filepath.Join(dir, "words")
	if err := os.WriteFile(words, []byte("Napoleon\narmy\n\nzebra\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	capitals := filepath.Join(dir, "capitals")
	if err := os.WriteFile(capitals, []byte("Napoleon\nParis\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		WantLexicon Lexicon
		Want        error
		Path        string
	}{{ // Test 0: Lower-case entries are kept and capitalized ones dropped.
		Path: words, WantLexicon: Lexicon{"army": {}, "zebra": {}},
	}, { // Test 1: A list with no lower-case entry fails.
		Path: capitals, Want: ErrLexicon,
	}, { // Test 2: A missing file fails.
		Path: filepath.Join(dir, "missing"), Want: ErrLexicon,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got, err := LoadLexicon(test.Path)
			if !errors.Is(err, test.Want) {
				t.Fatalf("error: got %v, want %v", err, test.Want)
			}
			if diff := cmp.Diff(test.WantLexicon, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("lexicon mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
