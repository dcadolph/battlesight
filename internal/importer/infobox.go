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
)

var (
	infoboxRe    = regexp.MustCompile(`(?si)\{\{[Ii]nfobox (?:military conflict|battle|military engagement)(.*?)\n\}\}`)
	fieldRe      = regexp.MustCompile(`(?m)^\s*\|\s*(\w+)\s*=\s*(.*)$`)
	wikiLink     = regexp.MustCompile(`\[\[(?:[^|\]]*\|)?([^\]]+)\]\]`)
	htmlTag      = regexp.MustCompile(`<[^>]+>`)
	refTag       = regexp.MustCompile(`(?s)<ref[^>]*>.*?</ref>|<ref[^/]*/?>`)
	brTag        = regexp.MustCompile(`<br\s*/?>`)
	template     = regexp.MustCompile(`\{\{[^}]*\}\}`)
	flagTemplate = regexp.MustCompile(`\{\{(?:flag(?:icon|country)?|flagdeco|flagcountry)\|([^|}]+)[^}]*\}\}`)
	plainTmpl    = regexp.MustCompile(`\{\{(?:lang|small|nowrap|nobold|sortname)\|[^|}]*\|?([^|}]*)\}\}`)
)

type wikiRevisionsResponse struct {
	Query struct {
		Pages map[string]struct {
			Title     string `json:"title"`
			Revisions []struct {
				Slots struct {
					Main struct {
						Content string `json:"*"`
					} `json:"main"`
				} `json:"slots"`
			} `json:"revisions"`
		} `json:"pages"`
	} `json:"query"`
}

type parsedInfobox struct {
	combatant1  string
	combatant2  string
	commander1  string
	commander2  string
	strength1   string
	strength2   string
	casualties1 string
	casualties2 string
	result      string
	partof      string
	date        string
	place       string
	battleType  string
}

// EnrichInfoboxes fetches Wikipedia infobox data for all battles with a
// wikipedia_title. Updates war, date, place, sides, commander, casualties,
// victor, and battle type.
func EnrichInfoboxes(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, wikipedia_title FROM battles WHERE wikipedia_title != '' LIMIT 10000`)
	if err != nil {
		return 0, fmt.Errorf("query battles: %w", err)
	}

	type ref struct {
		id    string
		title string
	}
	var pending []ref
	for rows.Next() {
		var r ref
		rows.Scan(&r.id, &r.title)
		pending = append(pending, r)
	}
	rows.Close()

	if len(pending) == 0 {
		return 0, nil
	}

	log.Printf("enriching infoboxes for %d battles", len(pending))

	// Check which battles already have sides.
	hasSides := make(map[string]bool)
	sideRows, err := db.QueryContext(ctx, `SELECT DISTINCT battle_id FROM battle_sides`)
	if err == nil {
		for sideRows.Next() {
			var bid string
			sideRows.Scan(&bid)
			hasSides[bid] = true
		}
		sideRows.Close()
	}

	insertSide, err := db.PrepareContext(ctx,
		`INSERT INTO battle_sides (battle_id, side_index, name, commander, strength, casualties) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return 0, fmt.Errorf("prepare side insert: %w", err)
	}
	defer insertSide.Close()

	updateBattle, err := db.PrepareContext(ctx,
		`UPDATE battles SET
			war = CASE WHEN ? != '' THEN ? ELSE war END,
			date = CASE WHEN ? != '' THEN ? ELSE date END,
			date_start = CASE WHEN ? != '' THEN ? ELSE date_start END,
			date_end = CASE WHEN ? != '' THEN ? ELSE date_end END,
			victor = CASE WHEN ? != '' THEN ? ELSE victor END,
			battle_type = CASE WHEN ? != '' AND battle_type = 'land' THEN ? ELSE battle_type END
		WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare battle update: %w", err)
	}
	defer updateBattle.Close()

	var enriched int
	batchSize := 15

	for i := 0; i < len(pending); i += batchSize {
		end := i + batchSize
		if end > len(pending) {
			end = len(pending)
		}
		batch := pending[i:end]

		titles := make([]string, len(batch))
		titleMap := make(map[string]ref, len(batch))
		for j, r := range batch {
			wt := strings.ReplaceAll(r.title, " ", "_")
			titles[j] = wt
			titleMap[r.title] = r
		}

		pages, err := fetchWikitext(ctx, titles)
		if err != nil {
			log.Printf("batch %d-%d failed: %v", i, end, err)
			time.Sleep(2 * time.Second)
			continue
		}

		for pageTitle, wikitext := range pages {
			normalTitle := strings.ReplaceAll(pageTitle, "_", " ")
			r, ok := titleMap[normalTitle]
			if !ok {
				for t, rr := range titleMap {
					if strings.EqualFold(t, normalTitle) {
						r = rr
						ok = true
						break
					}
				}
			}
			if !ok {
				continue
			}

			info := parseInfobox(wikitext)

			// Parse dates into sortable ISO format.
			dr := ParseDateRange(info.date, 0)

			// Update battle metadata (war, date, dates, victor, type).
			victor := inferVictor(info)
			btype := inferBattleType(info)
			updateBattle.ExecContext(ctx,
				info.partof, info.partof,
				info.date, info.date,
				dr.Start, dr.Start,
				dr.End, dr.End,
				victor, victor,
				btype, btype,
				r.id)

			// Insert sides if not already present.
			if !hasSides[r.id] && (info.combatant1 != "" || info.combatant2 != "") {
				if info.combatant1 != "" {
					insertSide.ExecContext(ctx, r.id, 0, info.combatant1, info.commander1, info.strength1, info.casualties1)
				}
				if info.combatant2 != "" {
					insertSide.ExecContext(ctx, r.id, 1, info.combatant2, info.commander2, info.strength2, info.casualties2)
				}
			}

			enriched++
		}

		if (i/batchSize)%20 == 0 {
			log.Printf("enriched infoboxes: %d/%d battles", enriched, len(pending))
		}

		time.Sleep(300 * time.Millisecond)
	}

	return enriched, nil
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
	return out, nil
}

// parseInfobox extracts military conflict infobox fields from wikitext.
func parseInfobox(wikitext string) parsedInfobox {
	match := infoboxRe.FindString(wikitext)
	if match == "" {
		return parsedInfobox{}
	}

	fields := make(map[string]string)
	for _, m := range fieldRe.FindAllStringSubmatch(match, -1) {
		fields[strings.ToLower(m[1])] = strings.TrimSpace(m[2])
	}

	return parsedInfobox{
		combatant1:  cleanWikitext(fields["combatant1"]),
		combatant2:  cleanWikitext(fields["combatant2"]),
		commander1:  cleanWikitext(fields["commander1"]),
		commander2:  cleanWikitext(fields["commander2"]),
		strength1:   cleanWikitext(fields["strength1"]),
		strength2:   cleanWikitext(fields["strength2"]),
		casualties1: cleanWikitext(fields["casualties1"]),
		casualties2: cleanWikitext(fields["casualties2"]),
		result:      cleanWikitext(fields["result"]),
		partof:      cleanWikitext(fields["partof"]),
		date:        cleanWikitext(fields["date"]),
		place:       cleanWikitext(fields["place"]),
	}
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
// the 300-char cap and the "no leading pipe" rejection used by infobox
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
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}

// inferVictor determines the winning side from the result field.
func inferVictor(info parsedInfobox) string {
	r := strings.ToLower(info.result)

	if !strings.Contains(r, "victory") {
		return ""
	}

	// Strip common prefixes.
	r = strings.TrimSpace(r)
	for _, prefix := range []string{"decisive ", "strategic ", "tactical ", "pyrrhic ", "major ", "minor ", "narrow ", "overall ", "clear "} {
		r = strings.TrimPrefix(r, prefix)
	}

	c1 := strings.ToLower(info.combatant1)
	c2 := strings.ToLower(info.combatant2)

	// Direct combatant match.
	if c1 != "" && strings.HasPrefix(r, c1) {
		return info.combatant1
	}
	if c2 != "" && strings.HasPrefix(r, c2) {
		return info.combatant2
	}

	// Extract the word(s) before "victory" and try matching.
	parts := strings.SplitN(r, "victory", 2)
	if len(parts) == 0 {
		return ""
	}
	before := strings.TrimSpace(parts[0])
	if before == "" {
		return ""
	}

	// Try substring matching against combatants.
	if c1 != "" && (strings.Contains(c1, before) || strings.Contains(before, c1)) {
		return info.combatant1
	}
	if c2 != "" && (strings.Contains(c2, before) || strings.Contains(before, c2)) {
		return info.combatant2
	}

	// Try matching first word of each combatant.
	beforeFirst := strings.Fields(before)[0]
	if c1 != "" && strings.Contains(c1, beforeFirst) {
		return info.combatant1
	}
	if c2 != "" && strings.Contains(c2, beforeFirst) {
		return info.combatant2
	}

	// If no combatant match, use the raw text before "victory" as the victor name.
	// Capitalize first letter.
	victor := strings.TrimRight(before, " ,;:-")
	if len(victor) > 1 {
		return strings.ToUpper(victor[:1]) + victor[1:]
	}
	return ""
}

// inferBattleType guesses the battle type from the result or place fields.
func inferBattleType(info parsedInfobox) string {
	combined := strings.ToLower(info.result + " " + info.place + " " + info.combatant1 + " " + info.combatant2)
	if strings.Contains(combined, "naval") || strings.Contains(combined, "fleet") || strings.Contains(combined, "sea") {
		return "naval"
	}
	if strings.Contains(combined, "siege") {
		return "siege"
	}
	if strings.Contains(combined, "aerial") || strings.Contains(combined, "air") || strings.Contains(combined, "bombing") {
		return "aerial"
	}
	return ""
}
