package importer

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"time"
)

// refOpenRe matches an opening <ref ...> tag, capturing the inner attributes
// so the closing tag scan can pick up name= attributes (Wikipedia commonly
// reuses a named ref: <ref name="foo"/>).
var (
	refBlockRe = regexp.MustCompile(`(?s)<ref(?:\s+[^>]*)?>(.*?)</ref>`)
	// citeURLRe extracts the |url= argument from any of the {{cite ...}}
	// template families that Wikipedia uses for citations. Stops at the
	// next | or }} so we do not greedily eat the rest of the template.
	citeURLRe   = regexp.MustCompile(`(?i)\|\s*url\s*=\s*([^|}\n]+)`)
	citeTitleRe = regexp.MustCompile(`(?i)\|\s*title\s*=\s*([^|}\n]+)`)
	citeYearRe  = regexp.MustCompile(`(?i)\|\s*(?:year|date)\s*=\s*([^|}\n]+)`)
	citeAuthRe  = regexp.MustCompile(`(?i)\|\s*(?:author|last|last1|authors)\s*=\s*([^|}\n]+)`)
	bareURLRe   = regexp.MustCompile(`(?i)https?://[^\s\]<|]+`)
)

// EnrichReferences walks every battle's Wikipedia article and lifts the
// citations out of its <ref>...</ref> blocks into the battle_references
// table. Three sources, in priority order: {{cite web|url=...|title=...}}
// style templates, bare URLs inside refs, and {{cite book|...|title=...}}
// style templates with no URL (book references). Idempotent — skips any
// (battle_id, url, title) triple already present.
func EnrichReferences(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, wikipedia_title FROM battles WHERE wikipedia_title != ''`)
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
		if err := rows.Scan(&r.id, &r.title); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan: %w", err)
		}
		pending = append(pending, r)
	}
	rows.Close()
	if len(pending) == 0 {
		return 0, nil
	}

	// Existing references — used as the dedup key so re-runs are idempotent.
	// A composite of (battle_id, url, title) catches both URL-bearing and
	// book references where url='' but title is the discriminator.
	existing := make(map[string]bool)
	exRows, err := db.QueryContext(ctx,
		`SELECT battle_id, COALESCE(url, ''), COALESCE(title, '') FROM battle_references`)
	if err == nil {
		for exRows.Next() {
			var bid, url, title string
			exRows.Scan(&bid, &url, &title)
			existing[bid+"|"+url+"|"+title] = true
		}
		exRows.Close()
	}

	insertStmt, err := db.PrepareContext(ctx,
		`INSERT INTO battle_references (battle_id, ref_type, title, author, year, url, note)
		 VALUES (?, ?, ?, ?, ?, ?, '')`)
	if err != nil {
		return 0, fmt.Errorf("prepare insert: %w", err)
	}
	defer insertStmt.Close()

	log.Printf("extracting references for %d battles", len(pending))

	var added int
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
			log.Printf("references batch %d-%d failed: %v", i, end, err)
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

			cites := extractCitations(wikitext)
			for _, c := range cites {
				key := r.id + "|" + c.URL + "|" + c.Title
				if existing[key] {
					continue
				}
				existing[key] = true
				if _, err := insertStmt.ExecContext(ctx, r.id, c.Type, c.Title, c.Author, c.Year, c.URL); err == nil {
					added++
				}
			}
		}

		if (i/batchSize)%20 == 0 {
			log.Printf("references added: %d (after %d battles)", added, end)
		}
		time.Sleep(300 * time.Millisecond)
	}

	return added, nil
}

// citation is the structured form of one entry pulled out of a <ref> block.
type citation struct {
	Type   string // "web", "book", "journal", or "" for bare URLs
	Title  string
	Author string
	Year   int
	URL    string
}

// extractCitations pulls every <ref>...</ref> block out of the wikitext and
// converts each into one citation. Inside each block we look first for a
// {{cite ...}} template (the structured form), then fall back to a bare URL
// in the ref body. Refs that yield neither are skipped — they are usually
// inline editorial comments like "as noted by".
func extractCitations(wikitext string) []citation {
	matches := refBlockRe.FindAllStringSubmatch(wikitext, -1)
	if len(matches) == 0 {
		return nil
	}
	// Dedup within one article so the same source cited 12 times only
	// adds one row.
	seen := make(map[string]bool)
	var out []citation
	for _, m := range matches {
		inner := strings.TrimSpace(m[1])
		if inner == "" {
			continue
		}
		c := parseCitationBlock(inner)
		if c.URL == "" && c.Title == "" {
			continue
		}
		key := c.URL + "|" + strings.ToLower(c.Title)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, c)
	}
	// Stable ordering by URL then Title keeps re-runs producing the same
	// row order, which makes diffs across enrichment runs auditable.
	sort.Slice(out, func(i, j int) bool {
		if out[i].URL != out[j].URL {
			return out[i].URL < out[j].URL
		}
		return out[i].Title < out[j].Title
	})
	return out
}

// parseCitationBlock turns the inner text of a single <ref> block into one
// citation row. Recognises the major Wikipedia citation templates by name
// and falls back to a bare URL scan when no template is present.
func parseCitationBlock(inner string) citation {
	c := citation{}
	low := strings.ToLower(inner)
	switch {
	case strings.Contains(low, "{{cite web") || strings.Contains(low, "{{citation web") || strings.Contains(low, "{{cite news"):
		c.Type = "web"
	case strings.Contains(low, "{{cite book"):
		c.Type = "book"
	case strings.Contains(low, "{{cite journal") || strings.Contains(low, "{{cite magazine"):
		c.Type = "journal"
	default:
		c.Type = ""
	}

	if m := citeURLRe.FindStringSubmatch(inner); len(m) == 2 {
		c.URL = strings.TrimSpace(m[1])
	} else if m := bareURLRe.FindString(inner); m != "" {
		c.URL = strings.TrimSpace(m)
	}
	if m := citeTitleRe.FindStringSubmatch(inner); len(m) == 2 {
		c.Title = stripWikitextMarkup(m[1])
	}
	if m := citeAuthRe.FindStringSubmatch(inner); len(m) == 2 {
		c.Author = stripWikitextMarkup(m[1])
	}
	if m := citeYearRe.FindStringSubmatch(inner); len(m) == 2 {
		// Find the first 4-digit year in the matched value. Dates in
		// Wikipedia citations vary wildly ("2014-03-21", "March 2014",
		// "2014", "c. 2014") so we hunt for any plausible year.
		for k := 0; k+4 <= len(m[1]); k++ {
			s := m[1][k : k+4]
			y := 0
			ok := true
			for _, ch := range s {
				if ch < '0' || ch > '9' {
					ok = false
					break
				}
				y = y*10 + int(ch-'0')
			}
			if ok && y >= 1000 && y <= 2100 {
				c.Year = y
				break
			}
		}
	}

	// Cap title and author lengths so the references table stays sane;
	// the UI does not render essay-length citation titles.
	if len(c.Title) > 240 {
		c.Title = c.Title[:240]
	}
	if len(c.Author) > 120 {
		c.Author = c.Author[:120]
	}
	if len(c.URL) > 480 {
		c.URL = c.URL[:480]
	}
	// If no title but URL is present, synthesise a placeholder from the
	// host so the UI has something to render.
	if c.Title == "" && c.URL != "" {
		if i := strings.Index(c.URL, "://"); i >= 0 {
			host := c.URL[i+3:]
			if j := strings.IndexAny(host, "/?#"); j > 0 {
				host = host[:j]
			}
			c.Title = host
		}
	}
	return c
}
