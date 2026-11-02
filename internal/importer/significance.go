package importer

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
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

// significanceMaxBytes caps a significance value so the UI does not render an essay.
const significanceMaxBytes = 800

// significanceMinLen is the length under which a stored significance counts as missing.
const significanceMinLen = 80

var (
	// sectionStartRe matches a top-level section header like "== Aftermath ==".
	// Sub-section headers (=== or deeper) ride along inside the section body.
	sectionStartRe = regexp.MustCompile(`(?m)^==\s*([^=]+?)\s*==\s*$`)
	// proseHeadingRe matches a heading line of any depth.
	proseHeadingRe = regexp.MustCompile(`^\s*=+[^=].*=+\s*$`)
	// proseGalleryRe matches a gallery block, which holds only image captions.
	proseGalleryRe = regexp.MustCompile(`(?is)<gallery[^>]*>.*?</gallery>`)
	// proseExtLinkRe matches a labeled external link: [https://x label].
	proseExtLinkRe = regexp.MustCompile(`\[https?://[^\s\]]+\s+([^\]]+)\]`)
	// proseBareLinkRe matches an unlabeled external link: [https://x].
	proseBareLinkRe = regexp.MustCompile(`\[https?://[^\s\]]+\]`)
	// proseLeftoverRe matches markup that must never survive into stored prose.
	proseLeftoverRe = regexp.MustCompile(`\[\[|\]\]|\{\{|\}\}|\{\||\||={2,}|https?://|<|>|` +
		`(?i:\balt=|\b\d+\s*px\b)`)
	// proseResidueRe matches the holes a dropped template leaves in a sentence:
	// empty brackets, a space before a closing parenthesis, a currency sign with
	// no amount.
	proseResidueRe = regexp.MustCompile(`\(\s*\)|\[\s*\]|\s\)|[£$€¥]\s+[a-z(]|[£$€¥]\s*$`)
	// proseSpacePunctRe matches the space a dropped ref leaves before punctuation.
	proseSpacePunctRe = regexp.MustCompile(`\s+([.,;:!?])`)
	// proseSentenceBreakRe matches the end of a sentence, closing quotes included.
	proseSentenceBreakRe = regexp.MustCompile(`[.!?]["'”’)]*(?:\s|$)`)
)

// SignificanceReport counts what the significance stage did.
type SignificanceReport struct {
	// Candidates is the number of rows selected.
	Candidates int
	// NoArticle counts titles with no page.
	NoArticle int
	// RedirectFollowed counts titles read through a rename redirect.
	RedirectFollowed int
	// RedirectSkipped counts titles whose redirect is not a rename.
	RedirectSkipped int
	// NoProse counts articles with no qualifying section or no clean paragraph in it.
	NoProse int
	// NotLonger counts rows whose found prose was not meaningfully longer than the stored value.
	NotLonger int
	// Written counts rows whose significance was set.
	Written int
}

// EnrichSignificance fills the significance column of unverified wikidata rows
// whose value is empty or implausibly thin, from the article's aftermath or
// legacy section. Curated and verified rows are never read or written.
func EnrichSignificance(ctx context.Context, db *sql.DB) (SignificanceReport, error) {
	return enrichSignificance(ctx, db, fetchArticleTexts, cachedCanonicalTitle)
}

// significanceCandidate is one row the significance stage may write.
type significanceCandidate struct {
	id      string
	title   string
	current string
}

// enrichSignificance is EnrichSignificance with the wikitext source and the
// redirect cache supplied by the caller.
func enrichSignificance(ctx context.Context, db *sql.DB, fetch wikitextFetchFunc,
	canon canonicalTitleFunc) (SignificanceReport, error) {
	var rep SignificanceReport
	rows, err := db.QueryContext(ctx, `SELECT id, wikipedia_title, significance FROM battles
		WHERE source = 'wikidata' AND verified = 0 AND wikipedia_title != ''
		  AND LENGTH(significance) < ? ORDER BY id`, significanceMinLen)
	if err != nil {
		return rep, fmt.Errorf("query significance candidates: %w", err)
	}
	var cands []significanceCandidate
	for rows.Next() {
		var c significanceCandidate
		if err := rows.Scan(&c.id, &c.title, &c.current); err != nil {
			rows.Close()
			return rep, fmt.Errorf("scan significance candidate: %w", err)
		}
		cands = append(cands, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return rep, fmt.Errorf("iterate significance candidates: %w", err)
	}
	rep.Candidates = len(cands)
	if len(cands) == 0 {
		return rep, nil
	}
	log.Printf("significance: %d candidate rows", len(cands))

	owned, shared, err := redirectOwnership(ctx, db, canon)
	if err != nil {
		return rep, err
	}
	titles := make([]string, 0, len(cands))
	for _, c := range cands {
		titles = append(titles, c.title)
	}
	art, fetchErr := readArticles(ctx, "significance", titles, fetch, canon, owned, shared)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return rep, fmt.Errorf("begin significance tx: %w", err)
	}
	defer tx.Rollback()
	update, err := tx.PrepareContext(ctx, `UPDATE battles SET significance = ?
		WHERE id = ? AND source = 'wikidata' AND verified = 0`)
	if err != nil {
		return rep, fmt.Errorf("prepare significance update: %w", err)
	}
	defer update.Close()

	for _, c := range cands {
		text, ok := art.texts[c.title]
		switch {
		case art.skipped[c.title]:
			rep.RedirectSkipped++
			continue
		case !ok:
			rep.NoArticle++
			continue
		}
		if art.followed[c.title] {
			rep.RedirectFollowed++
		}
		sig := extractSignificance(text)
		if sig == "" {
			rep.NoProse++
			continue
		}
		// A 60-char stub yields to a 400-char aftermath paragraph, never to a
		// value barely longer than itself.
		if len(sig) <= len(c.current)+40 {
			rep.NotLonger++
			continue
		}
		if _, err := update.ExecContext(ctx, sig, c.id); err != nil {
			return rep, fmt.Errorf("set significance for %s: %w", c.id, err)
		}
		rep.Written++
	}
	if err := tx.Commit(); err != nil {
		return rep, fmt.Errorf("commit significance: %w", err)
	}
	return rep, fetchErr
}

// extractSignificance returns the first clean prose paragraph of the
// best-ranked aftermath-style section, capped near 800 bytes at a sentence
// boundary. Image captions, galleries, headings, tables and lists never count
// as prose. Returns "" when no qualifying section or paragraph exists.
func extractSignificance(wikitext string) string {
	wikitext = bfCommentRe.ReplaceAllString(wikitext, "")
	matches := sectionStartRe.FindAllStringSubmatchIndex(wikitext, -1)
	best, bestRank := -1, len(significanceHeaders)
	for i, m := range matches {
		header := strings.TrimSpace(wikitext[m[2]:m[3]])
		for rank, want := range significanceHeaders {
			if rank < bestRank && strings.EqualFold(header, want) {
				best, bestRank = i, rank
				break
			}
		}
	}
	if best < 0 {
		return ""
	}
	end := len(wikitext)
	if best+1 < len(matches) {
		end = matches[best+1][0]
	}
	body := proseBody(wikitext[matches[best][1]:end])
	for p := range strings.SplitSeq(body, "\n\n") {
		if clean := proseParagraph(p); clean != "" {
			return capProse(clean, significanceMaxBytes)
		}
	}
	return ""
}

// proseBody removes the non-prose structures of a section body: refs,
// galleries, image links, templates, and the lines of headings, tables, lists
// and categories. A removed line becomes a blank line, so a heading always
// ends the paragraph before it.
func proseBody(s string) string {
	s = refTag.ReplaceAllString(s, "")
	s = proseGalleryRe.ReplaceAllString(s, "")
	s = dropMediaLinks(s)
	s = dropTemplates(s)
	lines := strings.Split(s, "\n")
	tableDepth := 0
	for i, line := range lines {
		t := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(t, "{|"):
			tableDepth++
			lines[i] = ""
		case tableDepth > 0:
			if strings.HasPrefix(t, "|}") {
				tableDepth--
			}
			lines[i] = ""
		case proseHeadingRe.MatchString(t), strings.HasPrefix(t, "__"),
			t != "" && strings.ContainsRune("*#:;|!", rune(t[0])),
			strings.HasPrefix(strings.ToLower(t), "[[category:"):
			lines[i] = ""
		}
	}
	return strings.Join(lines, "\n")
}

// proseParagraph joins a paragraph's lines, strips inline markup, and ends it
// on its last complete sentence. It returns "" when the result is too short to
// be prose, does not open like a sentence, introduces a quote or list that is
// not there, or still carries markup or a dropped template's hole.
func proseParagraph(p string) string {
	p = strings.Join(strings.Fields(p), " ")
	if p == "" {
		return ""
	}
	p = proseExtLinkRe.ReplaceAllString(p, "$1")
	p = proseBareLinkRe.ReplaceAllString(p, "")
	clean := stripWikitextMarkup(p)
	clean = proseSpacePunctRe.ReplaceAllString(clean, "$1")
	if strings.HasSuffix(clean, ":") || proseLeftoverRe.MatchString(clean) || proseResidueRe.MatchString(clean) {
		return ""
	}
	clean = lastSentenceEnd(clean)
	if len(clean) < significanceMinLen {
		return ""
	}
	first, _ := utf8.DecodeRuneInString(clean)
	if !unicode.IsLetter(first) && !unicode.IsDigit(first) && !strings.ContainsRune(`"'“‘(`, first) {
		return ""
	}
	return clean
}

// lastSentenceEnd trims s back to the end of its last complete sentence, or
// returns "" when it has none.
func lastSentenceEnd(s string) string {
	locs := proseSentenceBreakRe.FindAllStringIndex(s, -1)
	if len(locs) == 0 {
		return ""
	}
	return strings.TrimSpace(s[:locs[len(locs)-1][1]])
}

// capProse cuts s to at most n bytes without splitting a character, ending at
// the last sentence boundary past the halfway point, else at the last space
// with an ellipsis.
func capProse(s string, n int) string {
	if len(s) <= n {
		return s
	}
	cut := n
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	s = s[:cut]
	if i := strings.LastIndexAny(s, ".!?"); i > n/2 {
		return s[:i+1]
	}
	ell := "…"
	if i := strings.LastIndexByte(s[:len(s)-len(ell)], ' '); i > 0 {
		return strings.TrimRight(s[:i], ",;:") + ell
	}
	return s
}

// dropMediaLinks removes [[File:...]] and [[Image:...]] links, nested links in
// their captions included.
func dropMediaLinks(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		if strings.HasPrefix(s[i:], "[[") && isMediaLink(s[i+2:]) {
			if j := linkEnd(s[i:]); j > 0 {
				i += j
				continue
			}
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// isMediaLink reports whether a link body names a file.
func isMediaLink(body string) bool {
	l := strings.ToLower(strings.TrimLeft(body, " :"))
	return strings.HasPrefix(l, "file:") || strings.HasPrefix(l, "image:")
}

// linkEnd returns the length of the [[...]] link at the start of s, counting
// nested links, or 0 when it never closes.
func linkEnd(s string) int {
	depth := 0
	for i := 0; i+1 < len(s); i++ {
		switch {
		case s[i] == '[' && s[i+1] == '[':
			depth++
			i++
		case s[i] == ']' && s[i+1] == ']':
			depth--
			i++
			if depth == 0 {
				return i + 1
			}
		}
	}
	return 0
}
