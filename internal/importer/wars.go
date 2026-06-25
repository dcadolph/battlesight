package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"time"
)

// warNarrative mirrors battles.WarNarrative on the importer side so we can
// read and write data/wars.json without pulling the battles package in
// (avoids a dependency cycle). Field tags must match exactly so the same
// JSON file round-trips between import and serve.
type warNarrative struct {
	Outcome   string   `json:"outcome,omitempty"`
	Aftermath string   `json:"aftermath,omitempty"`
	KeyTerms  string   `json:"keyTerms,omitempty"`
	Notable   []string `json:"notable,omitempty"`
}

// minBattlesForWarEnrich is the floor on how many battles a war must have
// in our catalog before we go fetch a Wikipedia article for it. Wars with
// one or two battles are usually parser artifacts (a phrase that looks
// like a war name but is actually a place or a campaign fragment), so
// gating on a small minimum count prevents the enricher from spending
// bandwidth on noise.
const minBattlesForWarEnrich = 3

// EnrichWars walks every distinct war name that has at least
// minBattlesForWarEnrich associated battles, fetches the war's Wikipedia
// article, extracts outcome/aftermath/key terms, and merges the result
// into data/wars.json. Hand-curated entries that already have a richer
// narrative are never overwritten. Returns the count of new or improved
// entries.
func EnrichWars(ctx context.Context, db *sql.DB, warsPath string) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT war, COUNT(*) FROM battles
		 WHERE war != '' GROUP BY war HAVING COUNT(*) >= ?
		 ORDER BY COUNT(*) DESC`, minBattlesForWarEnrich)
	if err != nil {
		return 0, fmt.Errorf("query wars: %w", err)
	}
	type warCount struct {
		name  string
		count int
	}
	var wars []warCount
	for rows.Next() {
		var w warCount
		if err := rows.Scan(&w.name, &w.count); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan war row: %w", err)
		}
		wars = append(wars, w)
	}
	rows.Close()
	if len(wars) == 0 {
		return 0, nil
	}

	existing, err := loadWarsFile(warsPath)
	if err != nil {
		return 0, fmt.Errorf("load wars.json: %w", err)
	}

	log.Printf("enriching narratives for %d wars (%d already curated)", len(wars), len(existing))

	added := 0
	for i, w := range wars {
		cur, hadEntry := existing[w.name]
		if hadEntry && narrativeRichness(cur) >= 3 {
			// Already 3+ fields populated, treat as authoritative.
			continue
		}
		got, err := fetchWarNarrative(ctx, w.name)
		if err != nil {
			continue
		}
		merged := mergeWarNarrative(cur, got)
		if narrativeRichness(merged) <= narrativeRichness(cur) {
			continue
		}
		existing[w.name] = merged
		added++
		if i%20 == 0 {
			log.Printf("war enrichment: %d/%d processed, %d added", i, len(wars), added)
		}
		// Courtesy delay so we do not hammer Wikipedia. Cache hits skip
		// the sleep further down inside fetchWarNarrative.
		time.Sleep(300 * time.Millisecond)
	}

	if added == 0 {
		return 0, nil
	}
	if err := writeWarsFile(warsPath, existing); err != nil {
		return added, fmt.Errorf("write wars.json: %w", err)
	}
	return added, nil
}

// narrativeRichness scores how complete a narrative is from 0 to 4. Used
// as the merge guard so the enricher cannot overwrite a hand-curated
// 4-field entry with a 2-field auto-generated one.
func narrativeRichness(n warNarrative) int {
	score := 0
	if n.Outcome != "" {
		score++
	}
	if n.Aftermath != "" {
		score++
	}
	if n.KeyTerms != "" {
		score++
	}
	if len(n.Notable) > 0 {
		score++
	}
	return score
}

// mergeWarNarrative produces the union of two narratives: prefer the
// non-empty value, and use the longer of two non-empty strings so a
// fuller aftermath replaces a shorter one. Lists merge with dedup.
func mergeWarNarrative(a, b warNarrative) warNarrative {
	pick := func(x, y string) string {
		if x == "" {
			return y
		}
		if y == "" {
			return x
		}
		if len(y) > len(x)*2 {
			// Strongly longer: treat the longer string as the better one.
			return y
		}
		return x
	}
	out := warNarrative{
		Outcome:   pick(a.Outcome, b.Outcome),
		Aftermath: pick(a.Aftermath, b.Aftermath),
		KeyTerms:  pick(a.KeyTerms, b.KeyTerms),
	}
	seen := map[string]bool{}
	for _, n := range a.Notable {
		if !seen[n] {
			seen[n] = true
			out.Notable = append(out.Notable, n)
		}
	}
	for _, n := range b.Notable {
		if !seen[n] {
			seen[n] = true
			out.Notable = append(out.Notable, n)
		}
	}
	return out
}

// fetchWarNarrative pulls the war's Wikipedia article (caching as a side
// effect via fetchWikitext) and extracts outcome/aftermath/key terms.
// Returns an empty narrative when nothing useful is parseable; callers
// should treat that as a soft miss.
func fetchWarNarrative(ctx context.Context, warName string) (warNarrative, error) {
	candidates := wikipediaCandidates(warName)
	for _, title := range candidates {
		t := strings.ReplaceAll(title, " ", "_")
		pages, err := fetchWikitext(ctx, []string{t})
		if err != nil {
			continue
		}
		for _, body := range pages {
			if !looksLikeWarArticle(body) {
				continue
			}
			n := parseWarNarrative(body)
			if narrativeRichness(n) > 0 {
				return n, nil
			}
		}
	}
	return warNarrative{}, nil
}

// wikipediaCandidates returns the ordered list of titles to try when
// looking up a war. Wikipedia's title space is messy: "World War II"
// resolves directly, but "Second Punic War" sometimes ships as
// "Second Punic War" and sometimes as just "Punic Wars" with a section.
// We try the exact name first, then a few common rewrites.
func wikipediaCandidates(warName string) []string {
	out := []string{warName}
	if strings.HasSuffix(warName, " War") {
		out = append(out, warName+"s")
	}
	if !strings.HasSuffix(warName, " War") && !strings.HasSuffix(warName, " Wars") {
		out = append(out, warName+" War")
	}
	return out
}

// looksLikeWarArticle reports whether the wikitext appears to be about a
// war or campaign, used so we do not accidentally pick up an article
// about a place or person that happens to share the war's name. The test
// is permissive: presence of any of a small set of marker phrases is
// enough.
func looksLikeWarArticle(wikitext string) bool {
	low := strings.ToLower(wikitext)
	if strings.Contains(low, "{{infobox military conflict") ||
		strings.Contains(low, "{{infobox war") ||
		strings.Contains(low, "{{infobox civil conflict") {
		return true
	}
	// Some wars use the campaignbox template rather than a top infobox.
	if strings.Contains(low, "campaignbox") {
		return true
	}
	return false
}

// parseWarNarrative pulls outcome/aftermath/key terms from a war article.
// Outcome comes from the infobox result field. Aftermath comes from the
// first qualifying section (using the same preference list as battle
// significance). KeyTerms is sourced from the infobox dates so curators
// can later overwrite with a treaty-specific line.
func parseWarNarrative(wikitext string) warNarrative {
	out := warNarrative{}

	if match := infoboxRe.FindString(wikitext); match != "" {
		fields := map[string]string{}
		for _, m := range fieldRe.FindAllStringSubmatch(match, -1) {
			fields[strings.ToLower(m[1])] = strings.TrimSpace(m[2])
		}
		// Result becomes the outcome line: "Allied victory; Treaty of X
		// ended the war". Strip wiki markup before storing.
		if r := stripWikitextMarkup(fields["result"]); r != "" {
			if len(r) > 280 {
				r = r[:280]
				if i := strings.LastIndexAny(r, ".!?"); i > 140 {
					r = r[:i+1]
				}
			}
			out.Outcome = r
		}
		// Dates feed the KeyTerms slot as a low-priority placeholder. A
		// curator will usually overwrite this with a treaty name.
		if d := stripWikitextMarkup(fields["date"]); d != "" {
			out.KeyTerms = "Conflict dates: " + d
		}
	}

	// Aftermath / Legacy / Consequences section, same picker as battles.
	if af := extractSignificance(wikitext); af != "" {
		out.Aftermath = af
	}

	return out
}

// loadWarsFile reads the existing wars.json (if any) into a map keyed by
// war name. Returns an empty map when the file is missing.
func loadWarsFile(path string) (map[string]warNarrative, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]warNarrative{}, nil
		}
		return nil, err
	}
	out := map[string]warNarrative{}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// writeWarsFile re-serialises the map to disk with stable key ordering so
// every run produces a deterministic diff. Indented for hand-readability
// since curators occasionally hand-edit the file.
func writeWarsFile(path string, m map[string]warNarrative) error {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// Build an ordered structure rather than relying on json.Marshal's
	// non-deterministic map iteration. SQL-style "ordered map" pattern.
	var b strings.Builder
	b.WriteString("{\n")
	for i, k := range keys {
		entry, err := json.MarshalIndent(m[k], "  ", "  ")
		if err != nil {
			return fmt.Errorf("marshal %q: %w", k, err)
		}
		keyJSON, _ := json.Marshal(k)
		b.WriteString("  ")
		b.Write(keyJSON)
		b.WriteString(": ")
		b.Write(entry)
		if i < len(keys)-1 {
			b.WriteString(",")
		}
		b.WriteString("\n")
	}
	b.WriteString("}\n")
	return os.WriteFile(path, []byte(b.String()), 0o644)
}
