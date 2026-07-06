package importer

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"
)

// significanceHeaders is the ordered list of Wikipedia article section names
// we look for to source a battle's "significance" prose. Order is meaningful:
// the first present section wins, and "Aftermath" tends to be the richest
// narrative summary of why a battle mattered.
var significanceHeaders = []string{
	"Aftermath",
	"Legacy",
	"Significance",
	"Consequences",
	"Results",
	"Result",
	"Outcome",
	"Importance",
}

// sectionStartRe matches a section header like "== Aftermath ==" or
// "===Legacy===" at the start of a line. The capture group returns the
// header text so we can pick out the section we want. We do not match
// sub-section headers (=== or deeper) because we want the top-level section
// body and let any descendants ride along with it.
var sectionStartRe = regexp.MustCompile(`(?m)^==\s*([^=]+?)\s*==\s*$`)

// EnrichSignificance fills the significance column for battles whose value
// is empty or implausibly thin (<80 chars). Uses the disk-cached wikitext
// fetched by EnrichInfoboxes, so a typical run with the cache warm is
// network-free. Idempotent: only writes when the new value is non-empty
// and meaningfully longer than the current one.
func EnrichSignificance(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, wikipedia_title, COALESCE(significance, '')
		 FROM battles
		 WHERE wikipedia_title != ''
		   AND (significance IS NULL OR LENGTH(significance) < 80)`)
	if err != nil {
		return 0, fmt.Errorf("query battles needing significance: %w", err)
	}
	type ref struct {
		id      string
		title   string
		current string
	}
	var pending []ref
	for rows.Next() {
		var r ref
		if err := rows.Scan(&r.id, &r.title, &r.current); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan: %w", err)
		}
		pending = append(pending, r)
	}
	rows.Close()
	if len(pending) == 0 {
		return 0, nil
	}

	log.Printf("enriching significance for %d battles", len(pending))

	updateStmt, err := db.PrepareContext(ctx,
		`UPDATE battles SET significance = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare update: %w", err)
	}
	defer updateStmt.Close()

	var enriched int
	batchSize := 15

	for i := 0; i < len(pending); i += batchSize {
		end := min(i+batchSize, len(pending))
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
			log.Printf("significance batch %d-%d failed: %v", i, end, err)
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

			significance := extractSignificance(wikitext)
			if significance == "" {
				continue
			}
			// Only write when the new value is meaningfully longer than
			// what is already there. A 100-char stub should yield to a
			// 400-char aftermath paragraph but not be overwritten by a
			// shorter one.
			if len(significance) <= len(r.current)+40 {
				continue
			}

			if _, err := updateStmt.ExecContext(ctx, significance, r.id); err == nil {
				enriched++
			}
		}

		if (i/batchSize)%20 == 0 {
			log.Printf("significance enriched: %d/%d", enriched, len(pending))
		}
		time.Sleep(300 * time.Millisecond)
	}

	return enriched, nil
}

// extractSignificance walks the wikitext looking for the first section whose
// header matches our preferred ordering, then returns the cleaned first
// paragraph of that section (capped at ~800 characters so the UI does not
// have to render an essay). Returns "" when no qualifying section exists.
func extractSignificance(wikitext string) string {
	matches := sectionStartRe.FindAllStringSubmatchIndex(wikitext, -1)
	if len(matches) == 0 {
		return ""
	}

	// Build a list of (header, bodyStart, bodyEnd) tuples in wikitext order
	// so we can prefer earlier sections that also rank higher in our list.
	type span struct {
		header string
		start  int
		end    int
	}
	var spans []span
	for i, m := range matches {
		header := strings.TrimSpace(wikitext[m[2]:m[3]])
		bodyStart := m[1]
		bodyEnd := len(wikitext)
		if i+1 < len(matches) {
			bodyEnd = matches[i+1][0]
		}
		spans = append(spans, span{header: header, start: bodyStart, end: bodyEnd})
	}

	// Score by preferred-order index. Lower is better; -1 means not in list.
	score := func(h string) int {
		l := strings.ToLower(h)
		for idx, want := range significanceHeaders {
			if strings.EqualFold(l, strings.ToLower(want)) {
				return idx
			}
		}
		return -1
	}

	var chosen *span
	chosenScore := -1
	for i := range spans {
		s := score(spans[i].header)
		if s < 0 {
			continue
		}
		if chosenScore < 0 || s < chosenScore {
			chosen = &spans[i]
			chosenScore = s
		}
	}
	if chosen == nil {
		return ""
	}

	body := wikitext[chosen.start:chosen.end]
	// First paragraph: trim leading whitespace, then cut at the first blank
	// line. Wikipedia sections often open with a templated quote or hatnote
	// like {{see also|...}} that we want to skip past, so we iterate over
	// candidate paragraphs until we find one with real prose.
	paragraphs := strings.SplitSeq(body, "\n\n")
	for p := range paragraphs {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		clean := stripWikitextMarkup(p)
		// Skip hatnotes and "see also" templates, which become almost
		// empty after stripping wiki markup. Also skip lines that start
		// with bullet/numbered list markers and infobox fragments.
		if len(clean) < 80 || strings.HasPrefix(clean, "|") {
			continue
		}
		if len(clean) > 800 {
			clean = clean[:800]
			// Cut at the last sentence boundary so the result reads
			// like a complete thought, not a dangling fragment.
			if i := strings.LastIndexAny(clean, ".!?"); i > 400 {
				clean = clean[:i+1]
			}
		}
		return clean
	}
	return ""
}
