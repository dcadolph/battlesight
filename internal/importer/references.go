package importer

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
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

// ReferenceReport counts what the references stage did.
type ReferenceReport struct {
	// Candidates is the number of rows selected.
	Candidates int
	// NoArticle counts titles with no page.
	NoArticle int
	// RedirectFollowed counts titles read through a rename redirect.
	RedirectFollowed int
	// RedirectSkipped counts titles whose redirect is not a rename.
	RedirectSkipped int
	// Added counts reference rows inserted.
	Added int
}

// EnrichReferences lifts the citations out of each unverified wikidata row's
// Wikipedia article into battle_references. Three sources, in priority order:
// {{cite web|url=...|title=...}} style templates, bare URLs inside refs, and
// {{cite book|...|title=...}} style templates with no URL. Curated rows are
// skipped because the curated seed owns their reference list and rewrites it
// on every boot; verified rows are skipped because they are hand-checked.
// Idempotent: a (battle_id, url, title) triple already present is skipped.
func EnrichReferences(ctx context.Context, db *sql.DB) (ReferenceReport, error) {
	return enrichReferences(ctx, db, fetchArticleTexts, cachedCanonicalTitle)
}

// enrichReferences is EnrichReferences with the wikitext source and the
// redirect cache supplied by the caller.
func enrichReferences(ctx context.Context, db *sql.DB, fetch wikitextFetchFunc,
	canon canonicalTitleFunc) (ReferenceReport, error) {
	var rep ReferenceReport
	rows, err := db.QueryContext(ctx, `SELECT id, wikipedia_title FROM battles
		WHERE source = 'wikidata' AND verified = 0 AND wikipedia_title != '' ORDER BY id`)
	if err != nil {
		return rep, fmt.Errorf("query reference candidates: %w", err)
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
			return rep, fmt.Errorf("scan reference candidate: %w", err)
		}
		pending = append(pending, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return rep, fmt.Errorf("iterate reference candidates: %w", err)
	}
	rep.Candidates = len(pending)
	if len(pending) == 0 {
		return rep, nil
	}

	existing := make(map[string]bool)
	exRows, err := db.QueryContext(ctx,
		`SELECT battle_id, COALESCE(url, ''), COALESCE(title, '') FROM battle_references`)
	if err != nil {
		return rep, fmt.Errorf("query existing references: %w", err)
	}
	for exRows.Next() {
		var bid, url, title string
		if err := exRows.Scan(&bid, &url, &title); err != nil {
			exRows.Close()
			return rep, fmt.Errorf("scan existing reference: %w", err)
		}
		existing[bid+"|"+url+"|"+title] = true
	}
	exRows.Close()

	owned, shared, err := redirectOwnership(ctx, db, canon)
	if err != nil {
		return rep, err
	}
	titles := make([]string, 0, len(pending))
	for _, r := range pending {
		titles = append(titles, r.title)
	}
	log.Printf("references: %d candidate rows", len(pending))
	art, fetchErr := readArticles(ctx, "references", titles, fetch, canon, owned, shared)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return rep, fmt.Errorf("begin references tx: %w", err)
	}
	defer tx.Rollback()
	insert, err := tx.PrepareContext(ctx,
		`INSERT INTO battle_references (battle_id, ref_type, title, author, year, url, note)
		 VALUES (?, ?, ?, ?, ?, ?, '')`)
	if err != nil {
		return rep, fmt.Errorf("prepare reference insert: %w", err)
	}
	defer insert.Close()

	for _, r := range pending {
		text, ok := art.texts[r.title]
		switch {
		case art.skipped[r.title]:
			rep.RedirectSkipped++
			continue
		case !ok:
			rep.NoArticle++
			continue
		}
		if art.followed[r.title] {
			rep.RedirectFollowed++
		}
		for _, c := range extractCitations(text) {
			key := r.id + "|" + c.URL + "|" + c.Title
			if existing[key] {
				continue
			}
			existing[key] = true
			if _, err := insert.ExecContext(ctx, r.id, c.Type, c.Title, c.Author, c.Year, c.URL); err != nil {
				return rep, fmt.Errorf("insert reference for %s: %w", r.id, err)
			}
			rep.Added++
		}
	}
	if err := tx.Commit(); err != nil {
		return rep, fmt.Errorf("commit references: %w", err)
	}
	return rep, fetchErr
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
	c.Title = truncateRunes(c.Title, 240)
	c.Author = truncateRunes(c.Author, 120)
	c.URL = truncateRunes(c.URL, 480)
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
