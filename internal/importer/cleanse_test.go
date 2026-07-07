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
		{Name: "infobox combatant leak", In: "Kingdom of Italy|combatant2=Austria-Hungary", Want: "Kingdom of Italy"},
		{Name: "infobox commander leak", In: "Napoleon|commander2=Wellington", Want: "Napoleon"},
		{Name: "truncated ref tag", In: "Nikolai Yudenich, Andranik Ozanian<ref name=\"foo, 1917\"", Want: "Nikolai Yudenich, Andranik Ozanian"},
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

// TestCapitalizeSentences pins sentence-start capitalization with the
// abbreviation and version guards.
func TestCapitalizeSentences(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name string
		In   string
		Want string
	}{
		{Name: "lowercase initial", In: "the army held.", Want: "The army held."},
		{Name: "mid-sentence start", In: "The city fell. the Persians looted it.", Want: "The city fell. The Persians looted it."},
		{Name: "spare e.g.", In: "Many powers, e.g. france, joined.", Want: "Many powers, e.g. france, joined."},
		{Name: "spare i.e.", In: "One side, i.e. the rebels, lost.", Want: "One side, i.e. the rebels, lost."},
		{Name: "spare vs", In: "Union vs confederate forces met.", Want: "Union vs confederate forces met."},
		{Name: "spare version", In: "Built on v9.3. see notes.", Want: "Built on v9.3. see notes."},
		{Name: "ellipsis untouched", In: "He paused... then charged.", Want: "He paused... then charged."},
		{Name: "already clean", In: "The battle began. It ended by noon.", Want: "The battle began. It ended by noon."},
		{Name: "empty", In: "", Want: ""},
	}
	for i, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", i, test.Name), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.Want, capitalizeSentences(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestCleanseProse pins caption blanking, pipe-tail truncation, and
// capitalization for summary and significance fields.
func TestCleanseProse(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name string
		In   string
		Want string
	}{
		{Name: "leaked caption blanks", In: "thumbnail|Markers at the Monument show the dead.", Want: ""},
		{Name: "thumb space caption blanks", In: "thumb | Memorial at the church.", Want: ""},
		{Name: "File caption blanks", In: "File:Foo.jpg|The victory tapestry.", Want: ""},
		{Name: "ref group tail truncated", In: "Adherbal was reinforced by Carthalo with 70 ships.|group=note", Want: "Adherbal was reinforced by Carthalo with 70 ships."},
		{Name: "lowercase sentence fixed", In: "the city fell. the enemy fled.", Want: "The city fell. The enemy fled."},
		{Name: "clean prose untouched", In: "Rome mustered its largest army. Hannibal destroyed it.", Want: "Rome mustered its largest army. Hannibal destroyed it."},
	}
	for i, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", i, test.Name), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.Want, cleanseProse(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestCleanseSideName pins flag-template, border, align, and pipe residue
// removal for belligerent names.
func TestCleanseSideName(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name string
		In   string
		Want string
	}{
		{Name: "border pipe residue", In: "Denmark |border| Lübeck", Want: "Denmark, Lübeck"},
		{Name: "leading border pipe", In: "|border Sheikhdom of Kuwait", Want: "Sheikhdom of Kuwait"},
		{Name: "flag of scrap", In: "|Flag of the National Revolutionary Army", Want: "National Revolutionary Army"},
		{Name: "leading pipe acronym", In: "|PLA People's Liberation Army", Want: "PLA People's Liberation Army"},
		{Name: "align word residue", In: "left Duchy of Greater Poland", Want: "Duchy of Greater Poland"},
		{Name: "lowercase initial raised", In: "the Crown of Aragon", Want: "The Crown of Aragon"},
		{Name: "already clean", In: "Roman Republic", Want: "Roman Republic"},
	}
	for i, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", i, test.Name), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.Want, cleanseSideName(test.In)); diff != "" {
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
		// Pure WW aliases must collapse onto the canonical roman form.
		{Inputs: []string{"World War II", "Second World War", "the Second World War"}, Want: "world war ii"},
		{Inputs: []string{"World War I", "First World War", "Great War", "The Great War"}, Want: "world war i"},
		// Parenthetical theaters and British "theatre" spelling collapse.
		{Inputs: []string{"Eastern Front of World War II", "Eastern Front (World War II)"}, Want: "eastern front of world war ii"},
		{Inputs: []string{"Pacific Theater of World War II", "Pacific Theatre of World War II"}, Want: "pacific theater of world war ii"},
		// "Of the Second World War" rewrites end-to-end so theater names align.
		{Inputs: []string{"Battle of the Mediterranean of World War II", "Battle of the Mediterranean of the Second World War"}, Want: "battle of the mediterranean of world war ii"},
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

// TestRepairCommaWar pins every real-world comma-joined war name we have to
// the canonical form the user should see in the wars list.
func TestRepairCommaWar(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In   string
		Want string
	}{
		// Comma after a preposition: drop the comma, keep both halves.
		{In: "Trans-Mississippi Theater of the, American Civil War", Want: "Trans-Mississippi Theater of the American Civil War"},
		{In: "Muslim conquest of Syria, (Arab–Byzantine wars)", Want: "Muslim conquest of Syria"},
		// Comma after a conjunction: keep only the head war.
		{In: "Haitian Revolution and the, War of the First Coalition", Want: "Haitian Revolution"},
		{In: "Thirty Years' War and the , Franco-Spanish War (1635–59)", Want: "Thirty Years' War"},
		// Two distinct wars joined by a comma: keep the first segment.
		{In: "Dakota War of 1862, American Civil War", Want: "Dakota War of 1862"},
		{In: "American Civil War, Apache Wars", Want: "American Civil War"},
		{In: "Italian Front, (World War I)", Want: "Italian Front"},
		{In: "World War II, Pacific War", Want: "World War II"},
		{In: "Pacific War, World War II", Want: "Pacific War"},
		// Empty first segment (double comma).
		{In: "Sri Lankan Civil War,, 2008–2009 SLA Northern offensive", Want: "Sri Lankan Civil War"},
		// No comma is a no-op.
		{In: "American Civil War", Want: "American Civil War"},
	}
	for _, test := range tests {
		got := repairCommaWar(test.In)
		if got != test.Want {
			t.Errorf("repairCommaWar(%q): want %q got %q", test.In, test.Want, got)
		}
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
		{Year: 1946, Want: "cold-war"},
		{Year: 1990, Want: "cold-war"},
		{Year: 1991, Want: "contemporary"},
		{Year: 2025, Want: "contemporary"},
		{Year: 0, Want: ""},
	}
	for _, test := range tests {
		got := YearToEra(test.Year)
		if got != test.Want {
			t.Errorf("YearToEra(%d): want %q got %q", test.Year, test.Want, got)
		}
	}
}
