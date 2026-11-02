package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	infoboxRe    = regexp.MustCompile(`(?si)\{\{[Ii]nfobox (?:military conflict|battle|military engagement)(.*?)\n\}\}`)
	fieldRe      = regexp.MustCompile(`(?m)^[ \t]*\|[ \t]*(\w+)[ \t]*=[ \t]*(.*)$`)
	wikiLink     = regexp.MustCompile(`\[\[(?:[^|\]]*\|)?([^\]]+)\]\]`)
	htmlTag      = regexp.MustCompile(`<[^>]+>`)
	refTag       = regexp.MustCompile(`(?s)<ref[^>]*>.*?</ref>|<ref[^/]*/?>`)
	brTag        = regexp.MustCompile(`(?i)<br\b[^>]*>`)
	template     = regexp.MustCompile(`\{\{[^}]*\}\}`)
	flagTemplate = regexp.MustCompile(`\{\{(?:flag(?:icon|country)?|flagdeco|flagcountry)\|([^|}]+)[^}]*\}\}`)
	plainTmpl    = regexp.MustCompile(`\{\{(?:lang|small|nowrap|nobold|sortname)\|[^|}]*\|?([^|}]*)\}\}`)

	// redirectFullRe reads a redirect target including any #section fragment.
	redirectFullRe = regexp.MustCompile(`(?i)^\s*#redirect\s*\[\[([^\]|]+)`)
	// victoryRe finds each "victory" in an infobox result.
	victoryRe = regexp.MustCompile(`(?i)\bvictor(?:y|ies)\b`)
	// inconclusiveRe matches a result that names no winner.
	inconclusiveRe = regexp.MustCompile(`(?i)^\s*(?:inconclusive|indecisive|stalemate|draw)\b`)
	// sideLeftoverRe matches markup that survived cleaning, which marks a broken field.
	sideLeftoverRe = regexp.MustCompile(`\{\{|\}\}|\[\[|\]\]|\||^\s*=|=\s*$`)
	// victorDigitRe matches a digit, which no victor name carries.
	victorDigitRe = regexp.MustCompile(`[0-9]`)
	// victoryForRe reads the party after "victory for" or "victory of".
	victoryForRe = regexp.MustCompile(`(?i)^\s+(?:for|of)\s+(?:the\s+)?([^,;(]+)`)
	// horizontalRuleRe matches a "----" rule that separates groups in a field.
	horizontalRuleRe = regexp.MustCompile(`-{4,}`)
	// fileLinkRe matches an image link such as a flag drawn with [[File:...]].
	fileLinkRe = regexp.MustCompile(`(?i)\[\[\s*(?:file|image)\s*:[^\]]*\]\]`)
)

// wikiRevisionsResponse is the Action API shape for prop=revisions with content.
type wikiRevisionsResponse struct {
	// Query holds the pages keyed by page id.
	Query struct {
		// Pages maps a page id to its title and latest revision.
		Pages map[string]struct {
			// Title is the normalized page title.
			Title string `json:"title"`
			// Revisions holds the latest revision when the page exists.
			Revisions []struct {
				// Slots holds the revision's content slots.
				Slots struct {
					// Main is the article wikitext slot.
					Main struct {
						// Content is the raw wikitext.
						Content string `json:"*"`
					} `json:"main"`
				} `json:"slots"`
			} `json:"revisions"`
		} `json:"pages"`
	} `json:"query"`
}

// parsedInfobox holds the plain-text fields the infobox stage reads from one
// military conflict infobox.
type parsedInfobox struct {
	// combatant1 is the first belligerent list, comma separated.
	combatant1 string
	// combatant2 is the second belligerent list, comma separated.
	combatant2 string
	// commander1 lists the first side's commanders.
	commander1 string
	// commander2 lists the second side's commanders.
	commander2 string
	// strength1 is the first side's strength text.
	strength1 string
	// strength2 is the second side's strength text.
	strength2 string
	// casualties1 is the first side's casualty text.
	casualties1 string
	// casualties2 is the second side's casualty text.
	casualties2 string
	// result is the outcome line, items joined by commas.
	result string
	// partof is the raw partof value with refs and comments removed and links
	// kept, the form the war fill reads from infobox_partof.
	partof string
	// broken counts fields dropped because markup survived cleaning.
	broken int
}

// infoboxCandidate is one row the infobox stage may fill.
type infoboxCandidate struct {
	// id is the battle id.
	id string
	// title is the stored Wikipedia title.
	title string
	// needSides is true when the row has no side rows.
	needSides bool
	// needVictor is true when the row's victor is empty.
	needVictor bool
	// needPartof is true when the row has no war and no stored partof.
	needPartof bool
}

// InfoboxReport counts what one infobox run read and wrote.
type InfoboxReport struct {
	// Candidates is the number of rows selected for filling.
	Candidates int
	// Read is the number of rows whose article carried a military infobox.
	Read int
	// NoArticle is the number of rows whose title returned no page.
	NoArticle int
	// NoInfobox is the number of rows whose article has no military infobox.
	NoInfobox int
	// RedirectFollowed is the number of rows read through a rename redirect.
	RedirectFollowed int
	// RedirectSkipped is the number of rows whose title redirects to a section,
	// to another row's article, or to a target several rows share.
	RedirectSkipped int
	// SidesAdded is the number of rows that gained side rows.
	SidesAdded int
	// VictorsSet is the number of rows that gained a victor.
	VictorsSet int
	// PartofSet is the number of rows that gained an infobox_partof value.
	PartofSet int
	// BrokenFields is the number of fields dropped for surviving markup.
	BrokenFields int
}

// EnrichInfoboxes fills sides, victor and infobox_partof from the article
// infobox for unverified wikidata rows that lack them. It never writes the
// date, year, war or battle type columns, never touches curated or verified
// rows, and never replaces existing sides or a victor already set. A stored
// title that redirects is read through the redirect only when the target is a
// rename of the same event (see renameRedirect), so a sub-battle never takes
// its parent campaign's figures.
func EnrichInfoboxes(ctx context.Context, db *sql.DB) (InfoboxReport, error) {
	return enrichInfoboxes(ctx, db, fetchArticleTexts, cachedCanonicalTitle)
}

// wikitextFetchFunc returns wikitext keyed by requested title, with what it
// read so far when it fails part way.
type wikitextFetchFunc func(ctx context.Context, titles []string) (map[string]string, error)

// canonicalTitleFunc returns the redirect target of a stored title when known.
type canonicalTitleFunc func(title string) (string, bool)

// cachedCanonicalTitle reads the -resolve-titles cache.
func cachedCanonicalTitle(title string) (string, bool) {
	return wikiCacheGet(titleCanonicalNamespace, title)
}

// enrichInfoboxes is EnrichInfoboxes with the wikitext source and the
// redirect cache supplied by the caller.
func enrichInfoboxes(ctx context.Context, db *sql.DB, fetch wikitextFetchFunc,
	canon canonicalTitleFunc) (InfoboxReport, error) {
	var rep InfoboxReport
	cands, err := loadInfoboxCandidates(ctx, db)
	if err != nil {
		return rep, err
	}
	rep.Candidates = len(cands)
	if len(cands) == 0 {
		return rep, nil
	}
	log.Printf("infobox: %d candidate rows", len(cands))

	owned, shared, err := redirectOwnership(ctx, db, canon)
	if err != nil {
		return rep, err
	}
	titles := make([]string, 0, len(cands))
	for _, c := range cands {
		titles = append(titles, c.title)
	}
	art, fetchErr := readArticles(ctx, "infobox", titles, fetch, canon, owned, shared)
	texts, skipped := art.texts, art.skipped

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return rep, fmt.Errorf("begin infobox tx: %w", err)
	}
	defer tx.Rollback()
	insertSide, err := tx.PrepareContext(ctx,
		`INSERT INTO battle_sides (battle_id, side_index, name, commander, strength, casualties) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return rep, fmt.Errorf("prepare side insert: %w", err)
	}
	defer insertSide.Close()
	setVictor, err := tx.PrepareContext(ctx, `UPDATE battles SET victor = ? WHERE id = ? AND victor = ''`)
	if err != nil {
		return rep, fmt.Errorf("prepare victor update: %w", err)
	}
	defer setVictor.Close()
	setPartof, err := tx.PrepareContext(ctx,
		`UPDATE battles SET infobox_partof = ? WHERE id = ? AND infobox_partof = ''`)
	if err != nil {
		return rep, fmt.Errorf("prepare partof update: %w", err)
	}
	defer setPartof.Close()

	for _, c := range cands {
		text, ok := texts[c.title]
		switch {
		case skipped[c.title]:
			rep.RedirectSkipped++
			continue
		case !ok:
			rep.NoArticle++
			continue
		}
		if art.followed[c.title] {
			rep.RedirectFollowed++
		}
		info, found := parseInfobox(text)
		if !found {
			rep.NoInfobox++
			continue
		}
		rep.Read++
		rep.BrokenFields += info.broken
		if c.needSides && (info.combatant1 != "" || info.combatant2 != "") {
			sides := [][4]string{
				{info.combatant1, info.commander1, info.strength1, info.casualties1},
				{info.combatant2, info.commander2, info.strength2, info.casualties2},
			}
			for i, s := range sides {
				if s[0] == "" {
					continue
				}
				if _, err := insertSide.ExecContext(ctx, c.id, i, s[0], s[1], s[2], s[3]); err != nil {
					return rep, fmt.Errorf("insert side for %s: %w", c.id, err)
				}
			}
			rep.SidesAdded++
		}
		if c.needVictor {
			if v := inferVictor(info); v != "" {
				if _, err := setVictor.ExecContext(ctx, v, c.id); err != nil {
					return rep, fmt.Errorf("set victor for %s: %w", c.id, err)
				}
				rep.VictorsSet++
			}
		}
		if c.needPartof && info.partof != "" {
			if _, err := setPartof.ExecContext(ctx, info.partof, c.id); err != nil {
				return rep, fmt.Errorf("set partof for %s: %w", c.id, err)
			}
			rep.PartofSet++
		}
	}
	if err := tx.Commit(); err != nil {
		return rep, fmt.Errorf("commit infobox: %w", err)
	}
	return rep, fetchErr
}

// articleSet holds article wikitext keyed by stored title.
type articleSet struct {
	// texts maps a stored title to its article wikitext, read through a rename redirect when
	// the stored title redirects.
	texts map[string]string
	// followed marks stored titles read through a rename redirect.
	followed map[string]bool
	// skipped marks stored titles whose redirect is not a rename of the same event.
	skipped map[string]bool
}

// readArticles fetches the article behind each stored title. A title that
// redirects, by its page text or by the -resolve-titles cache, is read through
// the redirect only when the target is a rename of the same event (see
// renameRedirect); otherwise it is marked skipped, so a sub-battle never takes
// its parent campaign's text. The cache check matters because older runs cached
// some redirecting titles under the target article's text. On a fetch error it
// returns what it read so far with the error.
func readArticles(ctx context.Context, stage string, titles []string, fetch wikitextFetchFunc,
	canon canonicalTitleFunc, owned map[string]bool, shared map[string]int) (articleSet, error) {
	art := articleSet{followed: map[string]bool{}, skipped: map[string]bool{}}
	uniq := make([]string, 0, len(titles))
	seen := make(map[string]bool, len(titles))
	for _, t := range titles {
		if seen[t] {
			continue
		}
		seen[t] = true
		if c, ok := canon(t); ok && c != "" && c != t && !renameRedirect(t, c, owned, shared) {
			art.skipped[t] = true
			log.Printf("%s: %q redirects to %q, not a rename: skipped", stage, t, c)
			continue
		}
		uniq = append(uniq, t)
	}
	texts, fetchErr := fetch(ctx, uniq)
	if texts == nil {
		texts = map[string]string{}
	}
	art.texts = texts

	hops := map[string]string{}
	for _, t := range uniq {
		m := redirectFullRe.FindStringSubmatch(texts[t])
		if m == nil {
			continue
		}
		target := strings.TrimSpace(strings.ReplaceAll(m[1], "_", " "))
		delete(texts, t)
		if !renameRedirect(t, target, owned, shared) {
			art.skipped[t] = true
			log.Printf("%s: %q redirects to %q, not a rename: skipped", stage, t, target)
			continue
		}
		hops[t] = target
	}
	if len(hops) == 0 || fetchErr != nil {
		return art, fetchErr
	}
	targets := make([]string, 0, len(hops))
	for _, to := range hops {
		targets = append(targets, to)
	}
	got, err := fetch(ctx, targets)
	for from, to := range hops {
		if text := got[to]; text != "" && redirectFullRe.FindString(text) == "" {
			texts[from] = text
			art.followed[from] = true
			log.Printf("%s: %q read through redirect to %q", stage, from, to)
		}
	}
	return art, err
}

// redirectParentPrefixes mark a redirect target that covers several events.
var redirectParentPrefixes = []string{"battles ", "sieges ", "list of ", "timeline of ", "campaigns "}

// renameRedirect reports whether a stored title's redirect is a rename of the
// same event, so the target's infobox describes the row: the target is a whole
// article, no row stores it, no other stored title redirects to it, it is not a
// plural or list article, no ordinal or number sits on one name only, and the
// names are as alike as redirect twins must be.
func renameRedirect(from, to string, owned map[string]bool, shared map[string]int) bool {
	if strings.Contains(to, "#") || owned[to] || shared[to] > 1 {
		return false
	}
	lt := strings.ToLower(to)
	for _, p := range redirectParentPrefixes {
		if strings.HasPrefix(lt, p) {
			return false
		}
	}
	return !ordinalMismatch(from, to) && twinSimilarity(from, to) >= twinMinSimilarity
}

// loadInfoboxCandidates selects unverified wikidata rows with a title that lack
// sides, a victor, or (with no war) a stored partof.
func loadInfoboxCandidates(ctx context.Context, db *sql.DB) ([]infoboxCandidate, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, wikipedia_title,
		NOT EXISTS (SELECT 1 FROM battle_sides s WHERE s.battle_id = b.id),
		victor = '',
		war = '' AND infobox_partof = ''
		FROM battles b
		WHERE source = 'wikidata' AND verified = 0 AND wikipedia_title != ''
		ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("query infobox candidates: %w", err)
	}
	defer rows.Close()
	var out []infoboxCandidate
	for rows.Next() {
		var c infoboxCandidate
		if err := rows.Scan(&c.id, &c.title, &c.needSides, &c.needVictor, &c.needPartof); err != nil {
			return nil, fmt.Errorf("scan infobox candidate: %w", err)
		}
		if c.needSides || c.needVictor || c.needPartof {
			out = append(out, c)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate infobox candidates: %w", err)
	}
	return out, nil
}

// redirectOwnership returns the set of stored titles across every row, and how
// many stored titles redirect to each target per the -resolve-titles cache. A
// redirect target that is some row's stored title, or that several titles
// share, is a parent or list article, not a rename.
func redirectOwnership(ctx context.Context, db *sql.DB, canon canonicalTitleFunc) (map[string]bool,
	map[string]int, error) {
	all, err := loadTitleRows(ctx, db)
	if err != nil {
		return nil, nil, err
	}
	owned := make(map[string]bool, len(all))
	shared := map[string]int{}
	for _, r := range all {
		owned[r.Title] = true
	}
	for t := range owned {
		if c, ok := canon(t); ok && c != "" && c != t {
			shared[c]++
		}
	}
	return owned, shared, nil
}

// fetchArticleTexts returns wikitext keyed by the requested title (spaces, not
// underscores), fetching in batches. On a fetch error it returns what it read
// so far with the error, so the caller can write partial progress.
func fetchArticleTexts(ctx context.Context, titles []string) (map[string]string, error) {
	out := make(map[string]string, len(titles))
	for start := 0; start < len(titles); start += wikitextBatch {
		batch := titles[start:min(start+wikitextBatch, len(titles))]
		got, err := fetchWikitext(ctx, underscored(batch))
		if err != nil {
			return out, fmt.Errorf("wikitext batch at %d: %w", start, err)
		}
		for _, t := range batch {
			if text, ok := got[t]; ok {
				out[t] = text
				continue
			}
			for k, text := range got {
				if strings.EqualFold(k, t) {
					out[t] = text
					break
				}
			}
		}
		if start/wikitextBatch%5 == 0 {
			log.Printf("wikitext: fetched %d/%d titles", min(start+wikitextBatch, len(titles)), len(titles))
		}
	}
	return out, nil
}

// fetchWikitext gets raw wikitext for up to 50 pages via the Wikipedia
// Action API. Cached titles bypass the network entirely; only the uncached
// subset is fetched, and successful responses are written back to the cache
// so the next run for the same title is free.
func fetchWikitext(ctx context.Context, titles []string) (map[string]string, error) {
	out := make(map[string]string, len(titles))
	var missing []string
	for _, t := range titles {
		if v, ok := wikiCacheGet("wikitext", t); ok {
			out[strings.ReplaceAll(t, "_", " ")] = v
			continue
		}
		missing = append(missing, t)
	}
	if len(missing) == 0 {
		return out, nil
	}

	params := url.Values{
		"action":  {"query"},
		"prop":    {"revisions"},
		"rvprop":  {"content"},
		"rvslots": {"main"},
		"titles":  {strings.Join(missing, "|")},
		"format":  {"json"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wikipediaAPI+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "BattleSight/1.0 (https://github.com/dcadolph/battlesight)")

	resp, err := wikiHTTPDo(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wikipedia returned %d", resp.StatusCode)
	}

	var result wikiRevisionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	for _, page := range result.Query.Pages {
		if len(page.Revisions) > 0 {
			body := page.Revisions[0].Slots.Main.Content
			out[page.Title] = body
			wikiCacheSet("wikitext", strings.ReplaceAll(page.Title, " ", "_"), body)
		}
	}
	time.Sleep(300 * time.Millisecond)
	return out, nil
}

// parseInfobox reads the first military conflict infobox in the article,
// handling multiline values and nested templates. It reports false when the
// article has none.
func parseInfobox(wikitext string) (parsedInfobox, bool) {
	span, ok := findMilitaryInfobox(bfCommentRe.ReplaceAllString(wikitext, ""))
	if !ok {
		return parsedInfobox{}, false
	}
	var info parsedInfobox
	field := func(name string) string {
		raw, _ := infoboxParam(span, name)
		s, ok := cleanSideText(raw)
		if !ok {
			info.broken++
		}
		return s
	}
	info.combatant1 = field("combatant1")
	info.combatant2 = field("combatant2")
	info.commander1 = field("commander1")
	info.commander2 = field("commander2")
	info.strength1 = field("strength1")
	info.strength2 = field("strength2")
	info.casualties1 = field("casualties1")
	info.casualties2 = field("casualties2")
	info.result = field("result")
	if raw, _ := infoboxParam(span, "partof", "part_of"); raw != "" {
		info.partof = strings.Join(strings.Fields(refTag.ReplaceAllString(raw, "")), " ")
	}
	return info, true
}

// sideListTemplates lists templates that wrap a list of items; their items
// render as separate lines.
var sideListTemplates = map[string]bool{
	"plainlist": true, "plain list": true, "unbulleted list": true, "ubl": true, "ublist": true,
	"flatlist": true, "hlist": true, "collapsible list": true, "bulleted list": true,
	"bulletedlist": true, "flowlist": true, "indented plainlist": true, "endplainlist": true,
}

// sideUnwrapTemplates lists layout wrappers seen around side values whose
// last positional parameter is the text, beyond the shared bfUnwrapTemplates.
var sideUnwrapTemplates = map[string]bool{
	"center": true, "centre": true, "nobr": true, "resize": true, "font": true, "color": true,
	"colour": true, "font color": true, "align": true, "left": true, "right": true, "smallcaps": true,
	"sc": true, "nowrap begin": true, "transl": true, "transliteration": true, "noitalic": true,
}

// sideFlagNameTemplates lists templates that render the party their first
// parameter names: flags, coats of arms, and service-branch flags.
var sideFlagNameTemplates = map[string]bool{
	"flag": true, "flagcountry": true, "flagu": true, "flag country": true, "country": true,
	"coat of arms": true, "navy": true, "naval": true, "army": true, "air force": true,
}

// sideCountryCodes maps country-code templates such as {{ISR}}, which render a
// flag and the country name, to that name.
var sideCountryCodes = map[string]string{
	"afg": "Afghanistan", "aus": "Australia", "can": "Canada", "chn": "China", "dprk": "North Korea",
	"egy": "Egypt", "fra": "France", "gbr": "United Kingdom", "ger": "Germany", "ind": "India",
	"irn": "Iran", "irq": "Iraq", "isr": "Israel", "ita": "Italy", "jpn": "Japan", "kor": "South Korea",
	"nzl": "New Zealand", "pak": "Pakistan", "pol": "Poland", "prk": "North Korea", "rok": "South Korea",
	"rus": "Russia", "esp": "Spain", "syr": "Syria", "tur": "Turkey", "uk": "United Kingdom",
	"ukr": "Ukraine", "usa": "United States", "ussr": "Soviet Union", "vnm": "Vietnam",
	"ukgbi": "United Kingdom", "csa": "Confederate States", "us": "United States",
}

// sideMarkTemplates maps status templates to the short mark they render.
var sideMarkTemplates = map[string]string{
	"kia": "(KIA)", "pow": "(POW)", "wia": "(WIA)", "dow": "(DOW)", "mia": "(MIA)",
	"executed": "(executed)", "surrendered": "(surrendered)",
}

// sideTextTemplates maps character templates to the text they render.
var sideTextTemplates = map[string]string{
	"nbsp": " ", "ndash": "–", "mdash": "—", "snd": " – ", "spaced ndash": " – ", "•": "\n",
	"dot": "\n", "middot": "\n", "bull": "\n",
}

// cleanSideText flattens one infobox field to plain text for display: flag
// templates keep the country name and icon templates drop, list templates,
// bullets and line breaks become a comma list, status marks such as {{KIA}}
// render, links keep their label, repeated items collapse, and the result is
// capped at 300 runes. A
// value that still carries markup after cleaning returns "" and false.
func cleanSideText(raw string) (string, bool) {
	s := renderSideText(raw)
	if sideLeftoverRe.MatchString(s) {
		return "", false
	}
	return truncateRunes(s, 300), true
}

// renderSideText does the flattening for cleanSideText without the checks.
func renderSideText(raw string) string {
	s := bfCommentRe.ReplaceAllString(raw, "")
	s = refTag.ReplaceAllString(s, "")
	s = fileLinkRe.ReplaceAllString(s, "")
	s = brTag.ReplaceAllString(s, "\n")
	s = horizontalRuleRe.ReplaceAllString(s, "\n")
	s = dropTemplatesWith(s, sideTemplateReplacement)
	s = strings.ReplaceAll(s, "•", "\n")
	var items []string
	seen := map[string]bool{}
	for _, line := range strings.Split(s, "\n") {
		line = bfBulletRe.ReplaceAllString(line, "")
		line = stripWikitextMarkup(line)
		line = bfWhitespaceRe.ReplaceAllString(line, " ")
		line = strings.Trim(line, " ,;:")
		if line == "" || seen[strings.ToLower(line)] {
			continue
		}
		seen[strings.ToLower(line)] = true
		items = append(items, line)
	}
	out := strings.Join(items, ", ")
	out = strings.ReplaceAll(out, " ,", ",")
	out = strings.ReplaceAll(out, "( ", "(")
	out = strings.ReplaceAll(out, " )", ")")
	return out
}

// sideTemplateReplacement renders one template inside a side field.
func sideTemplateReplacement(span string) string {
	if len(span) < 4 {
		return ""
	}
	parts := splitTemplateParams(span[2 : len(span)-2])
	name := strings.ToLower(strings.TrimSpace(parts[0]))
	pos := positionalParams(parts[1:])
	first := func() string {
		if len(pos) == 0 {
			return ""
		}
		return pos[0]
	}
	switch {
	case sideFlagNameTemplates[name] || strings.HasSuffix(name, " participant"):
		if c := sideCountryCodes[strings.ToLower(first())]; c != "" {
			return c
		}
		return first()
	case len(parts) == 1 && sideCountryCodes[name] != "":
		return sideCountryCodes[name]
	case sideListTemplates[name]:
		var lines []string
		for _, p := range pos {
			lines = append(lines, dropTemplatesWith(p, sideTemplateReplacement))
		}
		return "\n" + strings.Join(lines, "\n") + "\n"
	case sideMarkTemplates[name] != "":
		return " " + sideMarkTemplates[name]
	case sideTextTemplates[name] != "":
		return sideTextTemplates[name]
	case strings.HasPrefix(name, "formatnum:"):
		return strings.TrimSpace(strings.TrimSpace(parts[0])[len("formatnum:"):])
	case name == "circa" || name == "c." || name == "c":
		if f := first(); f != "" {
			return "c. " + dropTemplatesWith(f, sideTemplateReplacement)
		}
		return "c."
	case name == "abbr" || name == "tooltip" || name == "abbrlink":
		return dropTemplatesWith(first(), sideTemplateReplacement)
	case bfUnwrapTemplates[name] || sideUnwrapTemplates[name] || name == "sortname":
		repl := ""
		for _, p := range pos {
			if p != "" {
				repl = p
			}
		}
		if name == "sortname" && len(pos) >= 2 {
			repl = pos[0] + " " + pos[1]
		}
		return dropTemplatesWith(repl, sideTemplateReplacement)
	}
	return templateReplacement(span)
}

// truncateRunes caps s at n runes without splitting a character.
func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n]))
}

// stripWikitextMarkup removes wiki templates, refs, HTML tags, flag
// templates, bold/italic markers and named entities from raw wikitext.
// Returns the cleaned string without applying any length cap; callers that
// need a short field value (e.g. infobox combatant) call cleanWikitext
// instead, which adds the 300-char cap on top.
func stripWikitextMarkup(s string) string {
	s = refTag.ReplaceAllString(s, "")
	s = brTag.ReplaceAllString(s, ", ")
	s = flagTemplate.ReplaceAllString(s, "$1")
	s = plainTmpl.ReplaceAllString(s, "$1")
	s = wikiLink.ReplaceAllString(s, "$1")
	s = template.ReplaceAllString(s, "")
	s = htmlTag.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "'''", "")
	s = strings.ReplaceAll(s, "''", "")
	// Decode the named entities that appear in date/result/place fields.
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	s = strings.ReplaceAll(s, "&ndash;", "–")
	s = strings.ReplaceAll(s, "&mdash;", "—")
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&quot;", "\"")
	s = strings.ReplaceAll(s, "&#39;", "'")
	s = strings.ReplaceAll(s, "&apos;", "'")
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	return strings.TrimSpace(s)
}

// cleanWikitext strips wiki markup like stripWikitextMarkup, then applies
// the 300-rune cap and the "no leading pipe" rejection used by infobox
// field values. Long-form callers (significance, summary) should use
// stripWikitextMarkup and apply their own cap.
func cleanWikitext(s string) string {
	s = stripWikitextMarkup(s)
	// Reject template-fragment leftovers like "| image       =" or "|date=".
	// These reach us when the parser sees a multi-line value that crossed
	// into the next infobox field. Storing them as user-facing text causes
	// "war = | image =" gibberish in the UI; better to drop them entirely.
	if strings.HasPrefix(s, "|") {
		return ""
	}
	// Strip leading "the " from partof fields.
	if strings.HasPrefix(strings.ToLower(s), "the ") && len(s) > 4 {
		s = s[4:]
	}
	return truncateRunes(s, 300)
}

// victorQualifiers lists words that grade a victory rather than name the victor.
var victorQualifiers = map[string]bool{
	"decisive": true, "strategic": true, "tactical": true, "pyrrhic": true, "major": true,
	"minor": true, "narrow": true, "overall": true, "clear": true, "limited": true,
	"partial": true, "operational": true, "nominal": true, "marginal": true, "crushing": true,
	"complete": true, "total": true, "initial": true, "eventual": true, "ultimate": true,
	"overwhelming": true, "costly": true, "a": true, "an": true, "the": true, "military": true,
	"political": true, "diplomatic": true, "moral": true, "temporary": true, "local": true,
	"significant": true, "important": true, "great": true, "resounding": true, "qualified": true,
	"defensive": true, "offensive": true, "successful": true,
}

// victorRefusals lists words that mean the text before "victory" is prose
// about the result, not the name of a victor.
var victorRefusals = map[string]bool{
	"both": true, "sides": true, "claimed": true, "claim": true, "claims": true, "see": true,
	"each": true, "neither": true, "no": true, "not": true, "disputed": true, "unclear": true,
	"without": true,
}

// inferVictor names the winner from the infobox result: the words before the
// first "victory" with grading qualifiers removed, in their original case, or
// the party after "victory for" when nothing precedes it. A
// result that names no winner (inconclusive, stalemate, draw) returns
// "Inconclusive". A result that claims victory for two different parties, a
// victor longer than four words, or one carrying digits returns "".
func inferVictor(info parsedInfobox) string {
	r := strings.TrimSpace(info.result)
	if r == "" {
		return ""
	}
	if inconclusiveRe.MatchString(r) {
		return "Inconclusive"
	}
	locs := victoryRe.FindAllStringIndex(r, -1)
	if len(locs) == 0 {
		return ""
	}
	names := make([]string, 0, len(locs))
	prev := 0
	for _, loc := range locs {
		names = append(names, victorName(r[prev:loc[0]]))
		prev = loc[1]
	}
	if names[0] == "" {
		if m := victoryForRe.FindStringSubmatch(r[locs[0][1]:]); m != nil {
			names[0] = victorName(m[1])
		}
	}
	v := names[0]
	for _, n := range names[1:] {
		if n != "" && !strings.EqualFold(n, v) {
			return ""
		}
	}
	if v == "" || len(strings.Fields(v)) > 4 || victorDigitRe.MatchString(v) {
		return ""
	}
	return v
}

// victorName returns the party named by the text before one "victory": the
// last clause, minus grading qualifiers, with the first letter capitalized.
func victorName(before string) string {
	if i := strings.LastIndexAny(before, ",;:("); i >= 0 {
		before = before[i+1:]
	}
	var kept []string
	for _, w := range strings.Fields(before) {
		lw := strings.ToLower(w)
		if victorRefusals[lw] {
			return ""
		}
		if victorQualifiers[lw] {
			continue
		}
		kept = append(kept, w)
	}
	v := strings.Trim(strings.Join(kept, " "), " ,;:-–")
	if v == "" {
		return ""
	}
	r, size := utf8.DecodeRuneInString(v)
	return string(unicode.ToUpper(r)) + v[size:]
}
