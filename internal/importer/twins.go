package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/dcadolph/battlesight/internal/battles"
)

const (
	// twinMinSimilarity is the core-name similarity a redirect twin must reach.
	twinMinSimilarity = 0.78
	// twinMergeCap stops a pass that finds more twins than a sound rule would,
	// since that means the title cache or the rule has gone wrong.
	twinMergeCap = 20
)

// duplicatesPath is the reviewed allowlist of twin rows the redirect-twin rule refuses.
var duplicatesPath = filepath.Join("data", "duplicates.json")

var (
	// reTwinParen matches a parenthetical such as "(1555)".
	reTwinParen = regexp.MustCompile(`\([^)]*\)`)
	// reTwinToken matches one ASCII word or number.
	reTwinToken = regexp.MustCompile(`[a-z0-9]+`)
	// twinStopWords are the connectors dropped from a name core. Type words
	// and ordinals stay, since they tell a battle from a siege of the same place.
	twinStopWords = map[string]bool{
		"of": true, "the": true, "at": true, "in": true, "on": true, "de": true, "la": true, "le": true,
		"el": true, "al": true, "and": true, "da": true, "di": true, "du": true, "des": true, "del": true,
	}
	// twinOrdinals mark a numbered engagement in a series.
	twinOrdinals = map[string]bool{
		"first": true, "second": true, "third": true, "fourth": true, "fifth": true,
		"1st": true, "2nd": true, "3rd": true, "4th": true, "i": true, "ii": true, "iii": true, "iv": true,
	}
)

// DuplicatePair is one reviewed allowlist entry: Merge folds into Keep.
type DuplicatePair struct {
	// Keep is the id of the row that survives.
	Keep string `json:"keep"`
	// Merge is the id of the row folded into Keep.
	Merge string `json:"merge"`
	// Note says why the two rows are one event.
	Note string `json:"note"`
}

// DuplicatesFile is the shape of data/duplicates.json.
type DuplicatesFile struct {
	// Pairs lists the reviewed twin pairs.
	Pairs []DuplicatePair `json:"pairs"`
}

// twinRow is the slice of a battle row the twin rules read.
type twinRow struct {
	// ID is the battle slug.
	ID string
	// Name is the display name.
	Name string
	// Year is the stored year.
	Year int
	// Title is the stored Wikipedia title.
	Title string
	// Source is curated or wikidata.
	Source string
	// Verified is true for hand-checked rows.
	Verified bool
}

// twinPair is a pair the redirect-twin rule matched.
type twinPair struct {
	// Anchor is the row whose stored title is the canonical article. It survives.
	Anchor twinRow
	// Twin is the row whose stored title redirects to the anchor's article.
	Twin twinRow
	// Canonical is the shared article title.
	Canonical string
	// Similarity is the core-name similarity of the two rows.
	Similarity float64
}

// protected reports whether a row may never be merged away by a rule.
func (r twinRow) protected() bool {
	return r.Source != "wikidata" || r.Verified
}

// LoadDuplicates reads the allowlist at path. A missing file is an empty list.
func LoadDuplicates(path string) ([]DuplicatePair, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var f DuplicatesFile
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return f.Pairs, nil
}

// ValidateDuplicates checks the allowlist: both ids set and distinct, no id in
// two pairs, and no curated id on either side, since curated rows are never
// merged by a pass.
func ValidateDuplicates(pairs []DuplicatePair, curated []battles.Battle) ValidationReport {
	var rep ValidationReport
	isCurated := map[string]bool{}
	for _, b := range curated {
		isCurated[b.ID] = true
	}
	seen := map[string]int{}
	for i, p := range pairs {
		field := fmt.Sprintf("pairs[%d]", i)
		if p.Keep == "" || p.Merge == "" {
			rep.Errors = append(rep.Errors, ValidationError{Field: field, Message: "keep and merge are both required"})
			continue
		}
		if p.Keep == p.Merge {
			rep.Errors = append(rep.Errors, ValidationError{Field: field, Message: "keep and merge name the same row"})
			continue
		}
		for _, id := range []string{p.Keep, p.Merge} {
			if isCurated[id] {
				rep.Errors = append(rep.Errors, ValidationError{ID: id, Field: field,
					Message: "curated rows are never merged by the allowlist"})
			}
			if prev, ok := seen[id]; ok {
				rep.Errors = append(rep.Errors, ValidationError{ID: id, Field: field,
					Message: fmt.Sprintf("id already listed in pairs[%d]", prev)})
			}
			seen[id] = i
		}
	}
	return rep
}

// twinCore folds a name to the form the twin rule compares: diacritics
// stripped, lower case, parentheticals and connectors dropped, tokens joined
// with no spaces so "Wad Kaltabu" and "Wadkaltabu" meet.
func twinCore(name string) string {
	return strings.Join(twinTokens(name), "")
}

// twinTokens returns the significant tokens of a name in order.
func twinTokens(name string) []string {
	t := transform.Chain(norm.NFKD, runes.Remove(runes.In(unicode.Mn)))
	folded, _, err := transform.String(t, name)
	if err != nil {
		folded = name
	}
	folded = reTwinParen.ReplaceAllString(strings.ToLower(folded), " ")
	var out []string
	for _, tok := range reTwinToken.FindAllString(folded, -1) {
		if !twinStopWords[tok] {
			out = append(out, tok)
		}
	}
	return out
}

// twinSimilarity scores two names 0 to 1 by edit distance over their cores.
func twinSimilarity(a, b string) float64 {
	ca, cb := twinCore(a), twinCore(b)
	m := max(len([]rune(ca)), len([]rune(cb)))
	if m == 0 {
		return 1
	}
	return 1 - float64(battles.Levenshtein(ca, cb))/float64(m)
}

// ordinalMismatch reports whether an ordinal or a number sits in one name only,
// which marks two engagements of a series rather than two spellings of one.
func ordinalMismatch(a, b string) bool {
	ta, tb := map[string]bool{}, map[string]bool{}
	for _, t := range twinTokens(a) {
		ta[t] = true
	}
	for _, t := range twinTokens(b) {
		tb[t] = true
	}
	odd := func(t string) bool {
		return twinOrdinals[t] || strings.ContainsAny(t, "0123456789")
	}
	for t := range ta {
		if !tb[t] && odd(t) {
			return true
		}
	}
	for t := range tb {
		if !ta[t] && odd(t) {
			return true
		}
	}
	return false
}

// twinCandidates pairs rows whose stored titles resolve to one article when
// exactly one of the two stored titles is that article (the anchor), the
// years match and are known, no ordinal or number sits on one side only, and
// the core names are at least twinMinSimilarity alike. Parent and list
// articles are nobody's stored title, so sub-events that redirect to one never
// pair. Protection is left to the caller. Output is sorted by canonical title,
// then twin id, so a run prints the same list twice.
func twinCandidates(rows []twinRow, canon map[string]string) []twinPair {
	groups := map[string][]twinRow{}
	for _, r := range rows {
		if r.Title == "" {
			continue
		}
		c, ok := canon[r.Title]
		if !ok || c == "" {
			continue
		}
		groups[c] = append(groups[c], r)
	}
	var out []twinPair
	for c, g := range groups {
		if len(g) < 2 {
			continue
		}
		for i := 0; i < len(g); i++ {
			for j := i + 1; j < len(g); j++ {
				a, b := g[i], g[j]
				aAnchor, bAnchor := strings.TrimSpace(a.Title) == c, strings.TrimSpace(b.Title) == c
				if aAnchor == bAnchor {
					continue
				}
				if !aAnchor {
					a, b = b, a
				}
				if a.Year == 0 || a.Year != b.Year || ordinalMismatch(a.Name, b.Name) {
					continue
				}
				s := twinSimilarity(a.Name, b.Name)
				if s < twinMinSimilarity {
					continue
				}
				out = append(out, twinPair{Anchor: a, Twin: b, Canonical: c, Similarity: s})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Canonical != out[j].Canonical {
			return out[i].Canonical < out[j].Canonical
		}
		return out[i].Twin.ID < out[j].Twin.ID
	})
	return out
}

// redirectTwins keeps the candidates where neither row is protected.
func redirectTwins(rows []twinRow, canon map[string]string) []twinPair {
	var out []twinPair
	for _, p := range twinCandidates(rows, canon) {
		if !p.Anchor.protected() && !p.Twin.protected() {
			out = append(out, p)
		}
	}
	return out
}

// curatedTwins keeps the candidates where a row is protected. They are never
// merged by a pass, and a curated edit settles them.
func curatedTwins(rows []twinRow, canon map[string]string) []twinPair {
	var out []twinPair
	for _, p := range twinCandidates(rows, canon) {
		if p.Anchor.protected() || p.Twin.protected() {
			out = append(out, p)
		}
	}
	return out
}

// loadTwinRows reads every row with a stored Wikipedia title.
func loadTwinRows(ctx context.Context, db *sql.DB) ([]twinRow, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, name, year, wikipedia_title, source, verified
		FROM battles WHERE wikipedia_title != ''`)
	if err != nil {
		return nil, fmt.Errorf("scan twin rows: %w", err)
	}
	defer rows.Close()
	var out []twinRow
	for rows.Next() {
		var r twinRow
		var verified int
		if err := rows.Scan(&r.ID, &r.Name, &r.Year, &r.Title, &r.Source, &verified); err != nil {
			return nil, fmt.Errorf("scan twin row: %w", err)
		}
		r.Verified = verified != 0
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate twin rows: %w", err)
	}
	return out, nil
}

// cachedCanonicalForTwins reads the -resolve-titles cache for the stored titles.
func cachedCanonicalForTwins(rows []twinRow) map[string]string {
	out := map[string]string{}
	for _, r := range rows {
		if _, done := out[r.Title]; done {
			continue
		}
		if c, ok := wikiCacheGet(titleCanonicalNamespace, r.Title); ok {
			out[r.Title] = c
		}
	}
	return out
}

// mergeDuplicates folds the reviewed allowlist pairs, then the redirect twins
// found through the -resolve-titles cache, into their surviving rows.
func mergeDuplicates(ctx context.Context, db *sql.DB) (int, error) {
	pairs, err := LoadDuplicates(duplicatesPath)
	if err != nil {
		return 0, err
	}
	return mergeTwins(ctx, db, pairs, cachedCanonicalForTwins)
}

// mergeTwins folds pairs, then the redirect twins over the titles canonOf
// resolves. A run that would merge more than twinMergeCap rule pairs merges
// none of them and says so, since a sound rule over a sound title cache finds
// a handful.
func mergeTwins(ctx context.Context, db *sql.DB, pairs []DuplicatePair,
	canonOf func([]twinRow) map[string]string) (int, error) {
	rows, err := loadTwinRows(ctx, db)
	if err != nil {
		return 0, err
	}
	twins := redirectTwins(rows, canonOf(rows))
	if len(twins) > twinMergeCap {
		log.Printf("twins: %d redirect twins exceed the cap of %d: merging none, check the title cache",
			len(twins), twinMergeCap)
		twins = nil
	}
	if len(pairs) == 0 && len(twins) == 0 {
		return 0, nil
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin twin tx: %w", err)
	}
	defer tx.Rollback()
	merged := 0
	gone := map[string]bool{}
	for _, p := range pairs {
		ok, err := mergeAllowlisted(ctx, tx, p, gone)
		if err != nil {
			return 0, err
		}
		if ok {
			merged++
		}
	}
	for _, p := range twins {
		if gone[p.Anchor.ID] || gone[p.Twin.ID] {
			continue
		}
		log.Printf("twins: merged %s (%s) into %s (%s): %s, similarity %.2f",
			p.Twin.ID, p.Twin.Name, p.Anchor.ID, p.Anchor.Name, p.Canonical, p.Similarity)
		if err := mergeRow(ctx, tx, p.Anchor.ID, p.Anchor.Name, p.Twin.ID, p.Twin.Name); err != nil {
			return 0, err
		}
		gone[p.Twin.ID] = true
		merged++
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit twin merges: %w", err)
	}
	return merged, nil
}

// mergeAllowlisted folds one allowlist pair when both rows exist and neither
// is curated or verified. An absent row means the pair already merged.
func mergeAllowlisted(ctx context.Context, tx *sql.Tx, p DuplicatePair, gone map[string]bool) (bool, error) {
	type info struct {
		name     string
		source   string
		verified int
	}
	read := func(id string) (info, bool, error) {
		var i info
		err := tx.QueryRowContext(ctx, `SELECT name, source, verified FROM battles WHERE id = ?`, id).
			Scan(&i.name, &i.source, &i.verified)
		if errors.Is(err, sql.ErrNoRows) {
			return i, false, nil
		}
		if err != nil {
			return i, false, fmt.Errorf("read allowlist row %s: %w", id, err)
		}
		return i, true, nil
	}
	keep, okKeep, err := read(p.Keep)
	if err != nil {
		return false, err
	}
	drop, okDrop, err := read(p.Merge)
	if err != nil {
		return false, err
	}
	if !okKeep || !okDrop {
		return false, nil
	}
	if keep.source != "wikidata" || drop.source != "wikidata" || keep.verified != 0 || drop.verified != 0 {
		log.Printf("twins: allowlist pair %s <- %s skipped: a curated or verified row is never merged", p.Keep, p.Merge)
		return false, nil
	}
	log.Printf("twins: merged %s (%s) into %s (%s): allowlist", p.Merge, drop.name, p.Keep, keep.name)
	if err := mergeRow(ctx, tx, p.Keep, keep.name, p.Merge, drop.name); err != nil {
		return false, err
	}
	gone[p.Merge] = true
	return true, nil
}

// mergeRow folds the row dropID into keepID: the dropped name and every alias
// it carries become aliases of the kept row, its sides move over only when
// the kept row has none, its references go, and the row is deleted.
func mergeRow(ctx context.Context, tx *sql.Tx, keepID, keepName, dropID, dropName string) error {
	if err := carryAlias(ctx, tx, keepID, keepName, dropName, ""); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT name, by_text FROM battle_aliases WHERE battle_id = ? ORDER BY alias_index`,
		dropID)
	if err != nil {
		return fmt.Errorf("read aliases of %s: %w", dropID, err)
	}
	type alias struct{ name, by string }
	var aliases []alias
	for rows.Next() {
		var a alias
		if err := rows.Scan(&a.name, &a.by); err != nil {
			rows.Close()
			return fmt.Errorf("scan alias of %s: %w", dropID, err)
		}
		aliases = append(aliases, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate aliases of %s: %w", dropID, err)
	}
	for _, a := range aliases {
		if err := carryAlias(ctx, tx, keepID, keepName, a.name, a.by); err != nil {
			return err
		}
	}
	var keepSides int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM battle_sides WHERE battle_id = ?`, keepID).
		Scan(&keepSides); err != nil {
		return fmt.Errorf("count sides of %s: %w", keepID, err)
	}
	if keepSides == 0 {
		if _, err := tx.ExecContext(ctx, `UPDATE battle_sides SET battle_id = ? WHERE battle_id = ?`,
			keepID, dropID); err != nil {
			return fmt.Errorf("move sides of %s: %w", dropID, err)
		}
	}
	for _, q := range []string{
		`DELETE FROM battle_sides WHERE battle_id = ?`,
		`DELETE FROM battle_references WHERE battle_id = ?`,
		`DELETE FROM battle_aliases WHERE battle_id = ?`,
		`DELETE FROM battles WHERE id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, q, dropID); err != nil {
			return fmt.Errorf("delete merged row %s: %w", dropID, err)
		}
	}
	return nil
}
