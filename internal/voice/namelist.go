package voice

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"slices"
)

// Entry is how the two voices say one name.
type Entry struct {
	// British is the reading for the British voice, in the voice's symbols.
	British string `json:"british"`
	// American is the reading for the American voice, in the voice's symbols.
	American string `json:"american"`
	// Spellings lists the source spellings that fold to the name, when one differs from it.
	Spellings []string `json:"spellings,omitempty"`
	// Writers names the writers whose readings agreed, or the one that settled a disagreement.
	Writers []string `json:"writers"`
	// Reason is the one-line reason for a settled disagreement, empty when the writers agreed.
	Reason string `json:"reason,omitempty"`
}

// NameList maps each name, as the speakable text spells it, to how the voices say it.
type NameList map[string]Entry

// LoadNameList reads a name list file. A missing file is an empty list.
func LoadNameList(path string) (NameList, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return NameList{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrNameList, err)
	}
	list := NameList{}
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("%w: %s: %w", ErrNameList, path, err)
	}
	return list, nil
}

// Save writes the list as indented JSON, names in order.
func (l NameList) Save(path string) error {
	data, err := json.MarshalIndent(l, "", "  ")
	if err != nil {
		return fmt.Errorf("%w: %w", ErrNameList, err)
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil { //nolint:gosec // Committed data file.
		return fmt.Errorf("%w: %w", ErrNameList, err)
	}
	return nil
}

// Problems returns a problem for every reading in the list that is empty or holds a symbol the
// voice does not have, which its tokenizer would drop without a word.
func (l NameList) Problems() []Problem {
	var problems []Problem
	for _, name := range slices.Sorted(maps.Keys(l)) {
		entry := l[name]
		for _, reading := range []string{entry.British, entry.American} {
			if reading == "" {
				problems = append(problems, Problem{Rule: RulePhoneme, Word: name + ": empty reading"})
				continue
			}
			if outside := OutsideSymbols(reading); len(outside) > 0 {
				problems = append(problems, Problem{Rule: RulePhoneme, Word: name + ": " + string(outside)})
			}
		}
	}
	return problems
}
