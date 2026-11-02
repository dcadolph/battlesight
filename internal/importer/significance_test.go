package importer

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/go-cmp/cmp"
)

// testProse is one clean paragraph long enough to count as significance.
const testProse = "The war ended with the treaty, and the victors held the river line for the next forty " +
	"years while the losers rebuilt their army."

// TestExtractSignificance pins section choice and prose cleanup against the
// wikitext shapes Wikipedia emits, including the image captions, sub-section
// headings and tables that leaked into stored text before.
func TestExtractSignificance(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		Wikitext   string
	}{{ // Test 0: Aftermath wins over Legacy when both exist.
		Wikitext: "== Legacy ==\nLegacy paragraph that should be ignored because Aftermath ranks higher in the " +
			"preference list and both sections exist.\n\n== Aftermath ==\n" + testProse + "\n",
		WantResult: testProse,
	}, { // Test 1: Significance is used when Aftermath and Legacy are missing.
		Wikitext:   "== Background ==\nSetup.\n\n== Significance ==\n" + testProse + "\n",
		WantResult: testProse,
	}, { // Test 2: No qualifying section returns empty.
		Wikitext: "== Background ==\nSome setup.\n\n== Forces ==\nForce sizes.\n",
	}, { // Test 3: A hatnote paragraph is skipped for the first prose paragraph.
		Wikitext:   "== Aftermath ==\n{{see also|Treaty of Whatever}}\n\n" + testProse + "\n",
		WantResult: testProse,
	}, { // Test 4: An image link with a nested link in its caption is dropped whole.
		Wikitext: "== Aftermath ==\n[[File:Elisabeth Farnese.jpg|thumb|upright|alt=Portrait|Elisabeth Farnese, " +
			"[[Queen of Spain]], who pressed for the [[Italian War]] that followed the battle and the treaty]]\n" +
			testProse + "\n",
		WantResult: testProse,
	}, { // Test 5: A sub-section heading glued to its prose is dropped, the prose kept.
		Wikitext:   "== Aftermath ==\n===Reconcentration of the army===\n" + testProse + "\n",
		WantResult: testProse,
	}, { // Test 6: A heading between paragraphs ends the paragraph before it.
		Wikitext:   "== Aftermath ==\nShort lead.\n===Reconcentration===\n" + testProse + "\n",
		WantResult: testProse,
	}, { // Test 7: A table and a gallery are dropped.
		Wikitext: "== Aftermath ==\n{| class=wikitable\n|-\n| Losses || 4,000 men killed and wounded in the " +
			"fighting near the river crossing over three days\n|}\n<gallery>\nFoo.jpg|The left panel shows a " +
			"cherub with palms open beside the fallen standard bearer of the army\n</gallery>\n" + testProse + "\n",
		WantResult: testProse,
	}, { // Test 8: A leaked caption with no link brackets is refused.
		Wikitext: "== Aftermath ==\nthumb|upright|alt=Painting|The surrender of the garrison, painted forty " +
			"years later for the royal collection\n\n" + testProse + "\n",
		WantResult: testProse,
	}, { // Test 9: A list is not prose.
		Wikitext: "== Aftermath ==\n* The garrison surrendered and the governor was sent home under escort " +
			"by sea.\n* The fort was razed.\n",
	}, { // Test 10: A paragraph opening on punctuation is a caption fragment.
		Wikitext: "== Aftermath ==\n. The left panel shows a cherub with palms open and the right panel the " +
			"fallen standard bearer of the army.\n",
	}, { // Test 11: Labeled external links keep their label.
		Wikitext: "== Aftermath ==\nThe treaty is held in the [https://example.org/a national archive] and " +
			"was signed by both commanders a week after the last shots of the battle.\n",
		WantResult: "The treaty is held in the national archive and was signed by both commanders a week after " +
			"the last shots of the battle.",
	}, { // Test 12: A paragraph introducing a dropped quote is skipped.
		Wikitext: "== Aftermath ==\nOn 5 November a jubilant Hill, made a Knight of the Bath for the action, " +
			"wrote to his sister:\n\n" + testProse + "\n",
		WantResult: testProse,
	}, { // Test 13: A paragraph cut by a dropped quote ends on its last sentence.
		Wikitext: "== Aftermath ==\n" + testProse + " Herwig estimates the losses at " +
			"\"one-third of the army's combat effectives\",\n",
		WantResult: testProse,
	}, { // Test 14: The space a dropped ref leaves before punctuation closes.
		Wikitext: "== Aftermath ==\nHe arrived too late, as Dattaji had already fallen in the Battle of Barari " +
			"Ghat<ref>Sarkar</ref> , and the army withdrew north<ref name=a/> .\n",
		WantResult: "He arrived too late, as Dattaji had already fallen in the Battle of Barari Ghat, and the " +
			"army withdrew north.",
	}, { // Test 15: The hole a dropped inflation template leaves refuses the paragraph.
		Wikitext: "== Aftermath ==\nThe repairs totaled £12,500 (the equivalent of £{{Inflation|UK|12500|1795}} " +
			"as of {{CURRENTYEAR}}), a large sum for the navy of the day.\n\n" + testProse + "\n",
		WantResult: testProse,
	}, { // Test 16: Comments are removed before the section scan.
		Wikitext:   "<!-- == Aftermath == -->\n== Legacy ==\n" + testProse + "\n",
		WantResult: testProse,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := extractSignificance(test.Wikitext)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestCapProse pins the byte cap: a sentence boundary when one is past the
// halfway point, else a word boundary with an ellipsis, never a split
// character.
func TestCapProse(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		In         string
		N          int
	}{{ // Test 0: Short text is unchanged.
		In: "Short.", N: 20, WantResult: "Short.",
	}, { // Test 1: Cut at the last sentence boundary past the halfway point.
		In: "One two three. Four five six. Seven eight", N: 32, WantResult: "One two three. Four five six.",
	}, { // Test 2: No sentence boundary past halfway cuts at a word with an ellipsis.
		In: "Alpha. bravo charlie delta echo foxtrot", N: 30, WantResult: "Alpha. bravo charlie delta…",
	}, { // Test 3: A multibyte character at the cut is not split.
		In: strings.Repeat("ж", 10) + " end", N: 7, WantResult: "жжж",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := capProse(test.In, test.N)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
			if !utf8.ValidString(got) {
				t.Errorf("invalid UTF-8: %q", got)
			}
		})
	}
}

// testSignificancePages is the fake Wikipedia for the significance and
// references stage tests.
func testSignificancePages() (wikitextFetchFunc, canonicalTitleFunc) {
	article := "Lead.<ref>{{cite web|url=https://example.org/a|title=Source A|year=2024}}</ref>\n\n" +
		"== Aftermath ==\n" + testProse + "\n"
	pages := map[string]string{
		"Battle of Example":        article,
		"Battle of Exampel":        "#REDIRECT [[Battle of Example (2024)]]",
		"Battle of Example (2024)": article,
		"Siege of Part":            "#REDIRECT [[Big campaign]]",
		"Big campaign":             article,
		"Siege of Cached":          article,
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
			"Siege of Cached": "Big campaign",
		}[title]
		return c, ok
	}
	return fetch, canon
}

// testSignificanceSeeds returns the rows both stage tests start from.
func testSignificanceSeeds() []infoboxSeed {
	return []infoboxSeed{
		{ID: "fill", Title: "Battle of Example", Source: "wikidata"},
		{ID: "curated", Title: "Battle of Example", Source: "curated"},
		{ID: "verified", Title: "Battle of Example", Source: "wikidata", Verified: 1},
		{ID: "long", Title: "Battle of Example", Source: "wikidata"},
		{ID: "renamed", Title: "Battle of Exampel", Source: "wikidata"},
		{ID: "sub-battle", Title: "Siege of Part", Source: "wikidata"},
		{ID: "cached-parent", Title: "Siege of Cached", Source: "wikidata"},
		{ID: "parent", Title: "Big campaign", Source: "wikidata"},
		{ID: "missing", Title: "No such page", Source: "wikidata"},
		{ID: "no-prose", Title: "Plain article", Source: "wikidata"},
	}
}

// TestEnrichSignificance verifies the stage writes only unverified wikidata
// rows, never replaces a long value, and reads a redirect only when it is a
// rename, also when the cache holds the target's text under the redirect.
func TestEnrichSignificance(t *testing.T) {
	t.Parallel()
	conn := openInfoboxDB(t, testSignificanceSeeds())
	ctx := context.Background()
	if _, err := conn.ExecContext(ctx, `UPDATE battles SET significance = ? WHERE id = 'long'`,
		strings.Repeat("Kept. ", 20)); err != nil {
		t.Fatal(err)
	}
	fetch, canon := testSignificancePages()
	rep, err := enrichSignificance(ctx, conn, fetch, canon)
	if err != nil {
		t.Fatal(err)
	}
	wantRep := SignificanceReport{
		Candidates: 7, NoArticle: 1, RedirectFollowed: 1, RedirectSkipped: 2, NoProse: 1, Written: 3,
	}
	if diff := cmp.Diff(wantRep, rep); diff != "" {
		t.Errorf("report mismatch (-want +got):\n%s", diff)
	}
	got := queryStrings(t, conn, `SELECT id || '|' || CASE significance WHEN '' THEN '-'
		WHEN ? THEN 'prose' ELSE 'other' END FROM battles ORDER BY id`, testProse)
	want := []string{
		"cached-parent|-", "curated|-", "fill|prose", "long|other", "missing|-", "no-prose|-", "parent|prose", "renamed|prose",
		"sub-battle|-", "verified|-",
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
}

// TestEnrichReferences verifies the stage adds citations only to unverified
// wikidata rows, follows only rename redirects, and adds nothing on a rerun.
func TestEnrichReferences(t *testing.T) {
	t.Parallel()
	conn := openInfoboxDB(t, testSignificanceSeeds())
	ctx := context.Background()
	fetch, canon := testSignificancePages()
	rep, err := enrichReferences(ctx, conn, fetch, canon)
	if err != nil {
		t.Fatal(err)
	}
	wantRep := ReferenceReport{Candidates: 8, NoArticle: 1, RedirectFollowed: 1, RedirectSkipped: 2, Added: 4}
	if diff := cmp.Diff(wantRep, rep); diff != "" {
		t.Errorf("report mismatch (-want +got):\n%s", diff)
	}
	got := queryStrings(t, conn, `SELECT battle_id || '|' || url || '|' || title FROM battle_references
		ORDER BY battle_id`)
	want := []string{
		"fill|https://example.org/a|Source A", "long|https://example.org/a|Source A",
		"parent|https://example.org/a|Source A", "renamed|https://example.org/a|Source A",
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}
	rep, err = enrichReferences(ctx, conn, fetch, canon)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(0, rep.Added); diff != "" {
		t.Errorf("rerun added mismatch (-want +got):\n%s", diff)
	}
}

// TestParseCitationBlock pins citation-template parsing against the real
// shapes we see from Wikipedia. Each shape must yield the right fields.
func TestParseCitationBlock(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name      string
		In        string
		WantType  string
		WantURL   string
		WantTitle string
		WantYear  int
	}{
		// Test 0: cite web with url+title+year.
		{
			Name:      "cite_web_full",
			In:        "{{cite web|url=https://example.com/x|title=Battle of Foo|year=1815|author=Smith}}",
			WantType:  "web",
			WantURL:   "https://example.com/x",
			WantTitle: "Battle of Foo",
			WantYear:  1815,
		},
		// Test 1: cite book without url falls back to title-only.
		{
			Name:      "cite_book_no_url",
			In:        "{{cite book|title=A History of Wars|author=Doe|year=2010}}",
			WantType:  "book",
			WantURL:   "",
			WantTitle: "A History of Wars",
			WantYear:  2010,
		},
		// Test 2: Bare URL with no template produces a host-derived title.
		{
			Name:      "bare_url",
			In:        "https://history.example.org/battle-of-bar.html",
			WantType:  "",
			WantURL:   "https://history.example.org/battle-of-bar.html",
			WantTitle: "history.example.org",
		},
		// Test 3: cite news yields web type.
		{
			Name:      "cite_news",
			In:        "{{cite news|url=https://news.example/article|title=Big Story|date=2014-03-21}}",
			WantType:  "web",
			WantURL:   "https://news.example/article",
			WantTitle: "Big Story",
			WantYear:  2014,
		},
	}
	for _, test := range tests {
		t.Run(test.Name, func(t *testing.T) {
			t.Parallel()
			got := parseCitationBlock(test.In)
			if got.Type != test.WantType {
				t.Errorf("Type: want %q got %q", test.WantType, got.Type)
			}
			if got.URL != test.WantURL {
				t.Errorf("URL: want %q got %q", test.WantURL, got.URL)
			}
			if got.Title != test.WantTitle {
				t.Errorf("Title: want %q got %q", test.WantTitle, got.Title)
			}
			if got.Year != test.WantYear {
				t.Errorf("Year: want %d got %d", test.WantYear, got.Year)
			}
		})
	}
}
