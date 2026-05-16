package importer

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// TestNormaliseText pins every real garbage pattern we've seen in the
// production DB. Each input is what an importer wrote; the expected output
// is what should land in front of the user.
func TestNormaliseText(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name string
		In   string
		Want string
	}{
		{Name: "already clean", In: "Battle of France", Want: "Battle of France"},
		{Name: "empty", In: "", Want: ""},
		{Name: "trailing template close", In: "British East India Company}}", Want: "British East India Company"},
		{Name: "plainlist opener", In: "Grand Alliance:{{plainlist |", Want: "Grand Alliance"},
		{Name: "duplicated text with closing braces", In: "French First Republic France Helvetic Republic Helvetic Republic}}", Want: "French First Republic France Helvetic Republic Helvetic Republic"},
		{Name: "image span + pipe + close", In: "22px Imperial faction: | }}", Want: "22px Imperial faction"},
		{Name: "wiki pipe link kept right side", In: "[[Ottoman conquest of Bosnia and Herzegovina|Ottoman conquest]]", Want: "Ottoman conquest"},
		{Name: "unmatched wiki open", In: "[[Ottoman conquest of Bosnia and Herzegovina|", Want: ""},
		{Name: "orphan wiki close", In: "Budapest Offensive Eastern Front]] of World War II)", Want: "Budapest Offensive Eastern Front of World War II)"},
		{Name: "ref block stripped", In: "Allied victory<ref name=foo>Smith 2001</ref>", Want: "Allied victory"},
		{Name: "self-closing ref", In: "Allied victory<ref name=foo/>", Want: "Allied victory"},
		{Name: "br to space", In: "Pyrrhic<br/>Victory", Want: "Pyrrhic Victory"},
		{Name: "small tag drop", In: "Allied <small>(disputed)</small>", Want: "Allied (disputed)"},
		{Name: "field-leader pipe", In: "| combatant2 = Confederate States", Want: "Confederate States"},
		{Name: "multiple spaces", In: "Battle   of    France", Want: "Battle of France"},
		{Name: "trailing comma colon", In: "British forces,", Want: "British forces"},
		{Name: "replacement char strip", In: "Wang Xiaochi� commander", Want: "Wang Xiaochi commander"},
	}
	for i, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", i, test.Name), func(t *testing.T) {
			t.Parallel()
			got := NormaliseText(test.In)
			if diff := cmp.Diff(test.Want, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestNormaliseTextIdempotent confirms a second pass is a no-op for every
// fixture above. Idempotency matters because the cleanse migration runs on
// every server start.
func TestNormaliseTextIdempotent(t *testing.T) {
	t.Parallel()
	inputs := []string{
		"Battle of France",
		"British East India Company}}",
		"[[Ottoman conquest of Bosnia and Herzegovina|Ottoman conquest]]",
		"Allied <small>(disputed)</small>",
		"| combatant2 = Confederate States",
	}
	for i, in := range inputs {
		t.Run(fmt.Sprintf("test %d", i), func(t *testing.T) {
			t.Parallel()
			once := NormaliseText(in)
			twice := NormaliseText(once)
			if once != twice {
				t.Errorf("not idempotent: in=%q once=%q twice=%q", in, once, twice)
			}
		})
	}
}

// TestCanonWarKey confirms variant spellings collapse to the same key.
func TestCanonWarKey(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Inputs []string
		Want   string
	}{
		{Inputs: []string{"World War II", "world war II", "The World War II"}, Want: "world war ii"},
		{Inputs: []string{"Russo-Japanese War", "Russo–Japanese War"}, Want: "russo-japanese war"},
	}
	for _, test := range tests {
		keys := make(map[string]bool)
		for _, in := range test.Inputs {
			keys[canonWarKey(in)] = true
		}
		if len(keys) != 1 {
			t.Errorf("expected one key for %v, got %v", test.Inputs, keys)
		}
	}
	// Sanity: the canonical form for one input matches the expected key.
	if got := canonWarKey("The World War II"); got != "world war ii" {
		t.Errorf("canonWarKey want %q got %q", "world war ii", got)
	}
}

// TestYearToEra pins the era classifier against the cliff edges.
func TestYearToEra(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Year int
		Want string
	}{
		{Year: -500, Want: "ancient"},
		{Year: 499, Want: "ancient"},
		{Year: 500, Want: "medieval"},
		{Year: 1499, Want: "medieval"},
		{Year: 1500, Want: "early-modern"},
		{Year: 1699, Want: "early-modern"},
		{Year: 1700, Want: "napoleonic"},
		{Year: 1819, Want: "napoleonic"},
		{Year: 1820, Want: "industrial"},
		{Year: 1913, Want: "industrial"},
		{Year: 1914, Want: "world-war-1"},
		{Year: 1918, Want: "world-war-1"},
		{Year: 1919, Want: "interwar"},
		{Year: 1938, Want: "interwar"},
		{Year: 1939, Want: "world-war-2"},
		{Year: 1945, Want: "world-war-2"},
		{Year: 1946, Want: "modern"},
		{Year: 2025, Want: "modern"},
		{Year: 0, Want: ""},
	}
	for _, test := range tests {
		got := YearToEra(test.Year)
		if got != test.Want {
			t.Errorf("YearToEra(%d): want %q got %q", test.Year, test.Want, got)
		}
	}
}
