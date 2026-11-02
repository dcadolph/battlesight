package battles

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

// TestWarAliases verifies the alias map and every collision it refuses.
func TestWarAliases(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult map[string]string
		Want       error
		In         map[string]WarNarrative
	}{{ // Test 0: Two wars with aliases map each alias to its war.
		In: map[string]WarNarrative{
			"Gaza war":            {Aliases: []string{"Israel–Hamas war"}},
			"Russo-Ukrainian War": {Aliases: []string{"Russia-Ukraine War", "Russo-Ukrainian war"}},
		},
		WantResult: map[string]string{
			"Israel–Hamas war":    "Gaza war",
			"Russia-Ukraine War":  "Russo-Ukrainian War",
			"Russo-Ukrainian war": "Russo-Ukrainian War",
		},
	}, { // Test 1: No aliases gives an empty map.
		In:         map[string]WarNarrative{"World War II": {}},
		WantResult: map[string]string{},
	}, { // Test 2: An alias listed under two wars is refused.
		In: map[string]WarNarrative{
			"A war": {Aliases: []string{"Shared"}},
			"B war": {Aliases: []string{"Shared"}},
		},
		Want: ErrWarAlias,
	}, { // Test 3: An alias that is also a key is refused.
		In: map[string]WarNarrative{
			"Russo-Ukrainian War": {Aliases: []string{"Russia-Ukraine War"}},
			"Russia-Ukraine War":  {},
		},
		Want: ErrWarAlias,
	}, { // Test 4: A war that lists itself is refused.
		In:   map[string]WarNarrative{"Gaza war": {Aliases: []string{"Gaza war"}}},
		Want: ErrWarAlias,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got, err := WarAliases(test.In)
			if !errors.Is(err, test.Want) {
				t.Fatalf("error mismatch: want %v, got %v", test.Want, err)
			}
			if diff := cmp.Diff(test.WantResult, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestWarsGetAlias verifies Get and Canonical resolve aliases after Load.
func TestWarsGetAlias(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "wars.json")
	data := `{"Gaza war": {"outcome": "Ongoing.", "aliases": ["Israel–Hamas war"]}, "World War II": {"outcome": "Allied victory."}}`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	w := NewWars()
	if _, err := w.Load(path); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		WantOutcome   string
		WantCanonical string
		In            string
		WantFound     bool
	}{{ // Test 0: Canonical key.
		In: "Gaza war", WantOutcome: "Ongoing.", WantCanonical: "Gaza war", WantFound: true,
	}, { // Test 1: Alias resolves to the canonical entry.
		In: "Israel–Hamas war", WantOutcome: "Ongoing.", WantCanonical: "Gaza war", WantFound: true,
	}, { // Test 2: War without aliases.
		In: "World War II", WantOutcome: "Allied victory.", WantCanonical: "World War II", WantFound: true,
	}, { // Test 3: Unknown name.
		In: "Unknown war", WantCanonical: "Unknown war",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got, ok := w.Get(test.In)
			if ok != test.WantFound {
				t.Fatalf("found mismatch: want %v, got %v", test.WantFound, ok)
			}
			if diff := cmp.Diff(test.WantOutcome, got.Outcome); diff != "" {
				t.Errorf("outcome mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantCanonical, w.Canonical(test.In)); diff != "" {
				t.Errorf("canonical mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestWarsLoadAliasConflict verifies Load refuses a colliding alias and keeps
// the previous registry.
func TestWarsLoadAliasConflict(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "wars.json")
	data := `{"A war": {"aliases": ["B war"]}, "B war": {}}`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	w := NewWars()
	if _, err := w.Load(path); !errors.Is(err, ErrWarAlias) {
		t.Fatalf("want ErrWarAlias, got %v", err)
	}
	if _, ok := w.Get("A war"); ok {
		t.Error("registry changed after a refused load")
	}
}
