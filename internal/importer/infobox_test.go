package importer

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/dcadolph/battlesight/internal/db"
)

// TestInferVictor covers result-line parsing from Wikipedia infoboxes.
func TestInferVictor(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		Result     string
	}{{ // Test 0: Graded adjective victory.
		Result: "Decisive Athenian victory", WantResult: "Athenian",
	}, { // Test 1: Party name before victory.
		Result: "Athens victory", WantResult: "Athens",
	}, { // Test 2: Original case survives for a multiword party.
		Result: "United States victory", WantResult: "United States",
	}, { // Test 3: Qualifiers anywhere before victory drop.
		Result: "Russian tactical victory", WantResult: "Russian",
	}, { // Test 4: Later clauses do not change the victor.
		Result: "Ukrainian victory, Russian withdrawal from Kyiv Oblast", WantResult: "Ukrainian",
	}, { // Test 5: Two different victors is a mixed result.
		Result: "Ukrainian tactical victory, Russian strategic victory",
	}, { // Test 6: Stalemate is inconclusive.
		Result: "Stalemate", WantResult: "Inconclusive",
	}, { // Test 7: Indecisive with prose is inconclusive.
		Result: "Indecisive, both sides claim victory", WantResult: "Inconclusive",
	}, { // Test 8: Prose about claims names no victor.
		Result: "Both sides claimed victory",
	}, { // Test 9: Ongoing names no victor.
		Result: "Ongoing",
	}, { // Test 10: Empty result.
	}, { // Test 11: A long phrase is not a victor name.
		Result: "Eventually after a long struggle the defenders won a victory",
	}, { // Test 12: Digits are not a victor name.
		Result: "1st Army victory",
	}, { // Test 13: Only a qualifier before victory reads the party after it.
		Result: "Pyrrhic victory for Rome", WantResult: "Rome",
	}, { // Test 14: The same victor named twice is fine.
		Result: "Roman victory, Roman victory at sea", WantResult: "Roman",
	}, { // Test 15: Each day won by a different side is a mixed result.
		Result: "Coalition victory – 12th, French victory – 13th",
	}, { // Test 16: Abbreviations keep their periods.
		Result: "U.S. victory", WantResult: "U.S.",
	}, { // Test 17: Victory for a named party, later clause ignored.
		Result: "Victory for False Dmitry I, Novhorod-Siverskyi besieged", WantResult: "False Dmitry I",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := inferVictor(parsedInfobox{result: test.Result})
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestCleanSideText covers flattening one infobox side field to display text.
func TestCleanSideText(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		In         string
		WantOK     bool
	}{{ // Test 0: Flag templates keep the country, list lines join with commas.
		In:         "{{flag|Russia}}\n{{flagicon image|Flag.svg}} [[Donetsk People's Republic|DPR]]",
		WantResult: "Russia, DPR", WantOK: true,
	}, { // Test 1: Icon flags drop and status marks render.
		In:         "{{flagicon|Israel}} [[Zvika Barkai]]<br>{{flagicon|Israel}} [[Moshe Kaplinsky]] {{WIA}}",
		WantResult: "Zvika Barkai, Moshe Kaplinsky (WIA)", WantOK: true,
	}, { // Test 2: Plainlist with bullets.
		In:         "{{plainlist|\n* {{flagcountry|Kingdom of England}}\n* [[Disinherited]] Scots\n}}",
		WantResult: "Kingdom of England, Disinherited Scots", WantOK: true,
	}, { // Test 3: Unbulleted list positional items.
		In:         "{{ubl|[[Robert E. Lee]]|[[James Longstreet]]}}",
		WantResult: "Robert E. Lee, James Longstreet", WantOK: true,
	}, { // Test 4: Circa, formatnum and refs.
		In:         "{{circa|20,000}}<ref>Smith, p. 4</ref><br/>{{formatnum:1200}} cavalry",
		WantResult: "c. 20,000, 1200 cavalry", WantOK: true,
	}, { // Test 5: Bold markers and nested small inside nowrap.
		In:         "'''Jam Nizamuddin II''' {{nowrap|{{small|(regent)}}}}",
		WantResult: "Jam Nizamuddin II (regent)", WantOK: true,
	}, { // Test 6: Image flag link drops instead of leaving pipe fragments.
		In:         "[[File:Flag of Sindh.svg|22px|border]] Samma dynasty",
		WantResult: "Samma dynasty", WantOK: true,
	}, { // Test 7: Unbalanced template is refused.
		In: "{{plainlist|\n* Russia", WantResult: "", WantOK: false,
	}, { // Test 8: Empty field.
		In: "", WantResult: "", WantOK: true,
	}, { // Test 9: Comments drop.
		In: "Unknown<!-- editors: add figures -->", WantResult: "Unknown", WantOK: true,
	}, { // Test 10: Layout wrapper keeps its text.
		In: "{{center|[[Mercia]]}}", WantResult: "Mercia", WantOK: true,
	}, { // Test 11: Coat of arms, participant and country-code templates name the party.
		In:         "{{Coat of arms|Kingdom of Scotland}}<br>{{Hungarian Revolution of 1848 participant|Hungary}}<br>{{ISR}}",
		WantResult: "Kingdom of Scotland, Hungary, Israel", WantOK: true,
	}, { // Test 12: An equals sign inside a nested citation does not name the list item.
		In: "{{Indented plainlist|\n* Coalition victory – 12th{{sfn|Bodart|1908|p=478}}\n" +
			"* French victory – 13th\n}}",
		WantResult: "Coalition victory – 12th, French victory – 13th", WantOK: true,
	}, { // Test 13: Uppercase break, rule lines, repeats and flag codes.
		In:         "[[Qutayba ibn Muslim]]<Br>Waki<br clear=\"all\">----\n{{flag|UKGBI}}<br>{{flagcountry|UKGBI}}",
		WantResult: "Qutayba ibn Muslim, Waki, United Kingdom", WantOK: true,
	}, { // Test 14: Bullet characters and bullet templates separate items.
		In:         "• Nicolas Haxo{{•}}Louis Guérin •Jean Couëtus",
		WantResult: "Nicolas Haxo, Louis Guérin, Jean Couëtus", WantOK: true,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got, ok := cleanSideText(test.In)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("text mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantOK, ok); diff != "" {
				t.Errorf("ok mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// testInfoboxArticle is a military conflict infobox with multiline values.
const testInfoboxArticle = `{{Short description|Battle}}
{{Infobox military conflict
| conflict    = Battle of Example
| partof      = the [[Russo-Ukrainian War]]<ref>cite</ref>
| date        = {{start date|2024|2|17}}
| result      = Russian victory
| combatant1  = {{flag|Russia}}
| combatant2  = {{plainlist|
* {{flag|Ukraine}}
* {{flagicon|Ukraine}} [[Territorial Defense Forces (Ukraine)|Territorial Defense]]
}}
| commander1  = [[Andrey Mordvichev]]
| commander2  = [[Oleksandr Tarnavskyi]]
| strength1   = {{circa|40,000}}
| strength2   = Unknown
| casualties1 = Heavy
| casualties2 = Heavy
}}
'''Battle of Example''' was a battle.`

// TestParseInfobox checks the multiline parse of a full article.
func TestParseInfobox(t *testing.T) {
	t.Parallel()
	got, ok := parseInfobox(testInfoboxArticle)
	if !ok {
		t.Fatal("infobox not found")
	}
	want := parsedInfobox{
		combatant1: "Russia", combatant2: "Ukraine, Territorial Defense",
		commander1: "Andrey Mordvichev", commander2: "Oleksandr Tarnavskyi",
		strength1: "c. 40,000", strength2: "Unknown", casualties1: "Heavy", casualties2: "Heavy",
		result: "Russian victory", partof: "the [[Russo-Ukrainian War]]",
	}
	if diff := cmp.Diff(want, got, cmp.AllowUnexported(parsedInfobox{})); diff != "" {
		t.Errorf("mismatch (-want +got):\n%s", diff)
	}
	modern, ok := parseInfobox("{{Infobox military conflict\n| part_of = [[Social War (91–87 BC)|Social War]]\n}}")
	if diff := cmp.Diff("[[Social War (91–87 BC)|Social War]]", modern.partof); !ok || diff != "" {
		t.Errorf("part_of mismatch (-want +got):\n%s", diff)
	}
	if _, ok := parseInfobox("'''Battle''' has no infobox."); ok {
		t.Error("parsed an infobox from an article without one")
	}
}

// infoboxSeed is one battle row for the infobox stage test.
type infoboxSeed struct {
	// ID is the battle slug.
	ID string
	// Title is the stored Wikipedia title.
	Title string
	// Source is curated or wikidata.
	Source string
	// Verified is 1 for a hand-checked row.
	Verified int
	// Victor is the stored victor.
	Victor string
	// War is the stored war.
	War string
	// Side is a side name to seed, empty for none.
	Side string
}

// openInfoboxDB seeds a temp db with the rows.
func openInfoboxDB(t *testing.T, seeds []infoboxSeed) *sql.DB {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "infobox.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	ctx := context.Background()
	for _, s := range seeds {
		if _, err := conn.ExecContext(ctx, `INSERT INTO battles (id, name, year, date, date_start, date_end,
			lat, lng, era, war, battle_type, victor, summary, significance, source, source_id, verified,
			wikipedia_title) VALUES (?, ?, 2024, '2024', '2024-01-01', '2024-12-31', 48, 37, 'contemporary', ?,
			'land', ?, '', '', ?, '', ?, ?)`, s.ID, s.ID, s.War, s.Victor, s.Source, s.Verified, s.Title); err != nil {
			t.Fatalf("insert %s: %v", s.ID, err)
		}
		if s.Side != "" {
			if _, err := conn.ExecContext(ctx, `INSERT INTO battle_sides (battle_id, side_index, name, commander,
				strength, casualties) VALUES (?, 0, ?, '', '', '')`, s.ID, s.Side); err != nil {
				t.Fatalf("insert side %s: %v", s.ID, err)
			}
		}
	}
	return conn
}

// TestEnrichInfoboxes verifies the stage fills only missing values on
// unverified wikidata rows and reads a redirect only when it is a rename.
func TestEnrichInfoboxes(t *testing.T) {
	t.Parallel()
	conn := openInfoboxDB(t, []infoboxSeed{
		{ID: "fill", Title: "Battle of Example", Source: "wikidata"},
		{ID: "curated", Title: "Battle of Example", Source: "curated"},
		{ID: "verified", Title: "Battle of Example", Source: "wikidata", Verified: 1},
		{ID: "has-both", Title: "Battle of Example", Source: "wikidata", Victor: "Ukrainian", Side: "Kept", War: "X"},
		{ID: "has-sides", Title: "Battle of Example", Source: "wikidata", Side: "Kept", War: "X"},
		{ID: "renamed", Title: "Battle of Exampel", Source: "wikidata"},
		{ID: "plural", Title: "Battle of Krithia", Source: "wikidata"},
		{ID: "sub-battle", Title: "Siege of Part", Source: "wikidata"},
		{ID: "parent", Title: "Big campaign", Source: "wikidata", Side: "Kept", Victor: "Kept", War: "X"},
		{ID: "section", Title: "Skirmish", Source: "wikidata"},
		{ID: "missing", Title: "No such page", Source: "wikidata"},
		{ID: "no-box", Title: "Plain article", Source: "wikidata"},
	})
	pages := map[string]string{
		"Battle of Example":        testInfoboxArticle,
		"Battle of Exampel":        "#REDIRECT [[Battle of Example (2024)]]",
		"Battle of Example (2024)": testInfoboxArticle,
		"Battle of Krithia":        "#REDIRECT [[Battles of Krithia]]",
		"Battles of Krithia":       testInfoboxArticle,
		"Siege of Part":            "#REDIRECT [[Big campaign]]",
		"Big campaign":             testInfoboxArticle,
		"Skirmish":                 "#REDIRECT [[Other campaign#Skirmish]]",
		"Plain article":            "'''Plain''' prose.",
	}
	fetch := func(_ context.Context, titles []string) (map[string]string, error) {
		out := map[string]string{}
		for _, ti := range titles {
			if p, ok := pages[ti]; ok {
				out[ti] = p
			}
		}
		return out, nil
	}
	canon := func(title string) (string, bool) {
		c, ok := map[string]string{
			"Battle of Exampel": "Battle of Example (2024)", "Siege of Part": "Big campaign",
			"Battle of Krithia": "Battles of Krithia",
		}[title]
		return c, ok
	}
	ctx := context.Background()
	rep, err := enrichInfoboxes(ctx, conn, fetch, canon)
	if err != nil {
		t.Fatal(err)
	}
	wantRep := InfoboxReport{
		Candidates: 8, Read: 3, NoArticle: 1, NoInfobox: 1, RedirectFollowed: 1, RedirectSkipped: 3,
		SidesAdded: 2, VictorsSet: 3, PartofSet: 2,
	}
	if diff := cmp.Diff(wantRep, rep); diff != "" {
		t.Errorf("report mismatch (-want +got):\n%s", diff)
	}
	wantRows := []string{
		"curated||0|",
		"fill|Russian|2|the [[Russo-Ukrainian War]]",
		"has-both|Ukrainian|1|",
		"has-sides|Russian|1|",
		"missing||0|",
		"no-box||0|",
		"parent|Kept|1|",
		"plural||0|",
		"renamed|Russian|2|the [[Russo-Ukrainian War]]",
		"section||0|",
		"sub-battle||0|",
		"verified||0|",
	}
	gotRows := queryStrings(t, conn, `SELECT id || '|' || victor || '|' ||
		(SELECT count(*) FROM battle_sides s WHERE s.battle_id = b.id) || '|' || infobox_partof
		FROM battles b ORDER BY id`)
	if diff := cmp.Diff(wantRows, gotRows); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
	gotSides := queryStrings(t, conn, `SELECT side_index || ':' || name || ':' || commander || ':' || strength
		FROM battle_sides WHERE battle_id = 'fill' ORDER BY side_index`)
	wantSides := []string{
		"0:Russia:Andrey Mordvichev:c. 40,000",
		"1:Ukraine, Territorial Defense:Oleksandr Tarnavskyi:Unknown",
	}
	if diff := cmp.Diff(wantSides, gotSides); diff != "" {
		t.Errorf("sides mismatch (-want +got):\n%s", diff)
	}
	again, err := enrichInfoboxes(ctx, conn, fetch, canon)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(0, again.SidesAdded+again.VictorsSet+again.PartofSet); diff != "" {
		t.Errorf("second run wrote (-want +got):\n%s", diff)
	}
}

// TestEnrichInfoboxesPartialFetch verifies rows read before a fetch failure
// are written and the error is returned.
func TestEnrichInfoboxesPartialFetch(t *testing.T) {
	t.Parallel()
	conn := openInfoboxDB(t, []infoboxSeed{
		{ID: "a", Title: "Battle of Example", Source: "wikidata"},
		{ID: "b", Title: "Unreached", Source: "wikidata"},
	})
	errBusy := errors.New("busy")
	fetch := func(_ context.Context, _ []string) (map[string]string, error) {
		return map[string]string{"Battle of Example": testInfoboxArticle}, errBusy
	}
	canon := func(string) (string, bool) { return "", false }
	rep, err := enrichInfoboxes(context.Background(), conn, fetch, canon)
	if !errors.Is(err, errBusy) {
		t.Errorf("want busy error, got %v", err)
	}
	if diff := cmp.Diff(1, rep.SidesAdded); diff != "" {
		t.Errorf("sides mismatch (-want +got):\n%s", diff)
	}
}

// TestCleanWikitext checks the Wikipedia markup stripping pipeline on
// representative scraps (refs, links, templates, formatting, br tags).
func TestCleanWikitext(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		In         string
	}{{ // Test 0: Strip wiki link with display text.
		In: "[[Battle of Marathon|Marathon]]", WantResult: "Marathon",
	}, { // Test 1: Strip ref tag.
		In: "Some text<ref>citation</ref> more", WantResult: "Some text more",
	}, { // Test 2: Line break to comma.
		In: "Line one<br/>Line two", WantResult: "Line one, Line two",
	}, { // Test 3: Strip bold and italic markers.
		In: "'''bold''' and ''italic''", WantResult: "bold and italic",
	}, { // Test 4: Strip the leading article.
		In: "the Hundred Years' War", WantResult: "Hundred Years' War",
	}, { // Test 5: Decode ndash entity.
		In: "11&ndash;15 December 1862", WantResult: "11–15 December 1862",
	}, { // Test 6: Decode mdash entity.
		In: "First Wave &mdash; Approach", WantResult: "First Wave — Approach",
	}, { // Test 7: Decode amp entity.
		In: "Rosenthal &amp; Smith", WantResult: "Rosenthal & Smith",
	}, { // Test 8: Decode nbsp.
		In: "30&nbsp;September 1939", WantResult: "30 September 1939",
	}, { // Test 9: The cap never splits a character.
		In: strings.Repeat("a", 299) + "жж", WantResult: strings.Repeat("a", 299) + "ж",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, cleanWikitext(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
