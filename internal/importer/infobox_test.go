package importer

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// TestInferVictor covers result-line parsing from Wikipedia infoboxes.
func TestInferVictor(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name string
		In   parsedInfobox
		Want string
	}{
		{
			Name: "decisive victory by combatant1",
			In:   parsedInfobox{combatant1: "Athens", combatant2: "Persia", result: "Decisive Athenian victory"},
			Want: "Athenian",
		},
		{
			Name: "direct combatant prefix",
			In:   parsedInfobox{combatant1: "Athens", combatant2: "Persia", result: "Athens victory"},
			Want: "Athens",
		},
		{
			Name: "second side wins",
			In:   parsedInfobox{combatant1: "Rome", combatant2: "Carthage", result: "Carthaginian victory"},
			Want: "Carthaginian",
		},
		{
			Name: "no victory text",
			In:   parsedInfobox{combatant1: "France", combatant2: "Britain", result: "Stalemate"},
			Want: "",
		},
		{
			Name: "empty result",
			In:   parsedInfobox{combatant1: "X", combatant2: "Y", result: ""},
			Want: "",
		},
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			got := inferVictor(test.In)
			if diff := cmp.Diff(test.Want, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestInferBattleType covers heuristic mapping from text to battle category.
func TestInferBattleType(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name string
		In   parsedInfobox
		Want string
	}{
		{Name: "naval keyword", In: parsedInfobox{place: "off Cape Trafalgar", combatant1: "Royal Navy fleet"}, Want: "naval"},
		{Name: "siege keyword", In: parsedInfobox{result: "Successful siege"}, Want: "siege"},
		{Name: "aerial keyword", In: parsedInfobox{place: "skies over England", result: "Air superiority"}, Want: "aerial"},
		{Name: "land default empty", In: parsedInfobox{result: "Victory", place: "near a town"}, Want: ""},
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			got := inferBattleType(test.In)
			if diff := cmp.Diff(test.Want, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestCleanWikitext checks the Wikipedia markup stripping pipeline on
// representative scraps (refs, links, templates, formatting, br tags).
func TestCleanWikitext(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name string
		In   string
		Want string
	}{
		{
			Name: "strip wiki link with display text",
			In:   "[[Battle of Marathon|Marathon]]",
			Want: "Marathon",
		},
		{
			Name: "strip ref tag",
			In:   "Some text<ref>citation</ref> more",
			Want: "Some text more",
		},
		{
			Name: "br to comma",
			In:   "Line one<br/>Line two",
			Want: "Line one, Line two",
		},
		{
			Name: "strip bold italic markers",
			In:   "'''bold''' and ''italic''",
			Want: "bold and italic",
		},
		{
			Name: "strip the prefix",
			In:   "the Hundred Years' War",
			Want: "Hundred Years' War",
		},
		{
			Name: "decode ndash entity",
			In:   "11&ndash;15 December 1862",
			Want: "11–15 December 1862",
		},
		{
			Name: "decode mdash entity",
			In:   "First Wave &mdash; Approach",
			Want: "First Wave — Approach",
		},
		{
			Name: "decode amp entity",
			In:   "Rosenthal &amp; Smith",
			Want: "Rosenthal & Smith",
		},
		{
			Name: "decode nbsp",
			In:   "30&nbsp;September 1939",
			Want: "30 September 1939",
		},
	}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			got := cleanWikitext(test.In)
			if diff := cmp.Diff(test.Want, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
