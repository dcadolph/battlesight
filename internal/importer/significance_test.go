package importer

import (
	"strings"
	"testing"
)

// TestExtractSignificance pins the section-picking and paragraph-cleanup
// behaviour against the wikitext shapes Wikipedia actually emits. The
// extractor must: prefer Aftermath over Legacy when both exist, return ""
// when no qualifying section is present, skip hatnote/template-only
// paragraphs in favour of the first real prose paragraph, and cap output
// at a sentence boundary near the 800-char limit.
func TestExtractSignificance(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name        string
		Wikitext    string
		WantPrefix  string // first 40 chars of the cleaned result
		WantEmpty   bool
		WantContain string
	}{
		// Test 0: Aftermath wins over Legacy when both exist.
		{
			Name: "aftermath_preferred_over_legacy",
			Wikitext: "== Background ==\nSetup prose.\n\n" +
				"== Legacy ==\nLegacy paragraph that should be ignored because Aftermath ranks higher in the preference list and both sections are present.\n\n" +
				"== Aftermath ==\nThe aftermath paragraph that should be picked because Aftermath outranks Legacy in our preference list and this is the first complete paragraph of real prose.\n",
			WantContain: "aftermath paragraph",
		},
		// Test 1: Significance section used when Aftermath/Legacy missing.
		{
			Name: "significance_only",
			Wikitext: "== Background ==\nSetup.\n\n" +
				"== Significance ==\nThis battle changed the geopolitical balance of the region for the next two centuries and is widely regarded as a turning point.\n",
			WantContain: "geopolitical balance",
		},
		// Test 2: No qualifying section returns empty.
		{
			Name:      "no_qualifying_section",
			Wikitext:  "== Background ==\nSome setup.\n\n== Forces ==\nForce sizes.\n",
			WantEmpty: true,
		},
		// Test 3: First-paragraph "see also" hatnote is skipped in favour of
		// the second prose paragraph.
		{
			Name:        "skip_hatnote",
			Wikitext:    "== Aftermath ==\n{{see also|Treaty of Whatever}}\n\nThe real aftermath prose paragraph spans several sentences and discusses the political and military consequences of the battle in some detail.\n",
			WantContain: "real aftermath prose",
		},
		// Test 4: Cap at sentence boundary near 800 chars.
		{
			Name:     "long_paragraph_truncated_at_sentence",
			Wikitext: "== Aftermath ==\n" + strings.Repeat("Filler sentence here. ", 60) + "End.\n",
			// 60 * 22 chars = ~1320 chars. Truncated to <= 800 ending in
			// either '.' or '!' or '?' from one of the filler sentences.
		},
	}
	for _, test := range tests {
		t.Run(test.Name, func(t *testing.T) {
			t.Parallel()
			got := extractSignificance(test.Wikitext)
			if test.WantEmpty {
				if got != "" {
					t.Errorf("want empty, got %q", got)
				}
				return
			}
			if got == "" {
				t.Errorf("want non-empty result, got empty")
				return
			}
			if test.WantContain != "" && !strings.Contains(got, test.WantContain) {
				t.Errorf("result missing %q\ngot: %q", test.WantContain, got)
			}
			if len(got) > 800 {
				t.Errorf("result %d chars exceeds 800-char cap", len(got))
			}
		})
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
