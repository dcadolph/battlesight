package importer

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Cleanse is the data-quality migration. Runs after MigrateDates on every
// server start. Walks every battle and every side row, normalising fields
// that the importers couldn't (or didn't) clean up. Idempotent: only writes
// rows where the normalised value differs from what's stored, so the second
// run is a no-op. Returns a small report so the caller can log what changed.
//
// Order of operations matters: text normalisation happens first so the
// year/era/canonicalisation passes operate on clean strings. War-name
// canonicalisation runs last because it needs the cleaned-up names to group
// variants correctly.
func Cleanse(ctx context.Context, db *sql.DB) (CleanseReport, error) {
	var rep CleanseReport
	if n, err := cleanseBattleText(ctx, db); err != nil {
		return rep, err
	} else {
		rep.BattleTextFixed = n
	}
	if n, err := cleanseSides(ctx, db); err != nil {
		return rep, err
	} else {
		rep.SideTextFixed = n
	}
	if n, err := backfillMissingDate(ctx, db); err != nil {
		return rep, err
	} else {
		rep.MissingDatesBackfilled = n
	}
	if n, err := canoniseDateStrings(ctx, db); err != nil {
		return rep, err
	} else {
		rep.DateStringsNormalised = n
	}
	if n, err := alignYearToDate(ctx, db); err != nil {
		return rep, err
	} else {
		rep.YearsAligned = n
	}
	if n, err := deriveYearFromDate(ctx, db); err != nil {
		return rep, err
	} else {
		rep.YearsDerived = n
	}
	if n, err := recomputeEra(ctx, db); err != nil {
		return rep, err
	} else {
		rep.ErasRecomputed = n
	}
	if n, err := dropBlankSides(ctx, db); err != nil {
		return rep, err
	} else {
		rep.BlankSidesDropped = n
	}
	if n, err := canonicaliseWarNames(ctx, db); err != nil {
		return rep, err
	} else {
		rep.WarNamesCanonicalised = n
	}
	if n, err := deduplicateWikipedia(ctx, db); err != nil {
		return rep, err
	} else {
		rep.DuplicatesRemoved = n
	}
	if n, err := applyCoordOverrides(ctx, db); err != nil {
		return rep, err
	} else {
		rep.CoordsOverridden = n
	}
	if n, err := rebuildRichSearch(ctx, db); err != nil {
		return rep, err
	} else {
		rep.RichSearchRowsIndexed = n
	}
	return rep, nil
}

// rebuildRichSearch rebuilds the battles_rich_fts index from a per-battle
// denormalized blob that pulls in everything searchable: side names
// (countries / factions), commanders, era, battle type, date, victor, war,
// summary, significance. This is the index Search queries; the older
// battles_fts is left alone for backwards compatibility but is no longer
// the authoritative search corpus.
//
// Wipe-and-reload rather than incremental updates because cleanse runs once
// per server start and the corpus is small enough that a full rebuild costs
// less than maintaining triggers across two tables.
func rebuildRichSearch(ctx context.Context, db *sql.DB) (int, error) {
	if _, err := db.ExecContext(ctx, "DELETE FROM battles_rich_fts"); err != nil {
		return 0, fmt.Errorf("clear rich fts: %w", err)
	}

	rows, err := db.QueryContext(ctx, `
		SELECT
			b.id,
			b.name || ' ' ||
			COALESCE(b.war, '') || ' ' ||
			COALESCE(b.victor, '') || ' ' ||
			COALESCE(b.summary, '') || ' ' ||
			COALESCE(b.significance, '') || ' ' ||
			COALESCE(b.battle_type, '') || ' ' ||
			COALESCE(b.era, '') || ' ' ||
			COALESCE(b.date, '') || ' ' ||
			COALESCE((
				SELECT GROUP_CONCAT(s.name || ' ' || COALESCE(s.commander, ''), ' ')
				FROM battle_sides s
				WHERE s.battle_id = b.id
			), '') || ' ' ||
			COALESCE((
				SELECT GROUP_CONCAT(a.name || ' ' || COALESCE(a.by_text, ''), ' ')
				FROM battle_aliases a
				WHERE a.battle_id = b.id
			), '') AS blob
		FROM battles b
	`)
	if err != nil {
		return 0, fmt.Errorf("query battle text: %w", err)
	}
	defer rows.Close()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin rich fts tx: %w", err)
	}
	stmt, err := tx.PrepareContext(ctx, "INSERT INTO battles_rich_fts(battle_id, blob) VALUES (?, ?)")
	if err != nil {
		tx.Rollback()
		return 0, fmt.Errorf("prepare rich fts insert: %w", err)
	}
	defer stmt.Close()

	n := 0
	for rows.Next() {
		var id, blob string
		if err := rows.Scan(&id, &blob); err != nil {
			tx.Rollback()
			return n, fmt.Errorf("scan rich fts row: %w", err)
		}
		if _, err := stmt.ExecContext(ctx, id, blob); err != nil {
			tx.Rollback()
			return n, fmt.Errorf("insert rich fts row %s: %w", id, err)
		}
		n++
	}
	if err := rows.Err(); err != nil {
		tx.Rollback()
		return n, fmt.Errorf("iter rich fts rows: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return n, fmt.Errorf("commit rich fts: %w", err)
	}
	return n, nil
}

// CoordOverride is a curated correction for a single battle whose imported
// coordinates were wrong. Wikidata occasionally returns a centroid that
// places a land battle at a default meridian or equator, dropping the
// battle into the wrong ocean. Curated corrections live here in code so
// the fix is reviewable and survives reimport.
type CoordOverride struct {
	// ID is the canonical battle ID slug.
	ID string
	// Lat is the corrected latitude in decimal degrees.
	Lat float64
	// Lng is the corrected longitude in decimal degrees.
	Lng float64
	// Note explains why this battle was corrected; kept for the next
	// curator to read.
	Note string
}

// coordOverrides lists every known-wrong import we have hand-corrected.
// Add to this list whenever a user reports a battle in the wrong place;
// always include a Note so the next curator does not undo the fix.
var coordOverrides = []CoordOverride{
	{
		ID:   "courland-pocket",
		Lat:  57.0,
		Lng:  22.5,
		Note: "Latvia, Courland peninsula. Wikidata imported lng=0 which put it in the North Sea.",
	},
	{
		ID:   "battle-of-darzab-2018",
		Lat:  36.4,
		Lng:  65.6,
		Note: "Darzab district, Jowzjan province, Afghanistan. Imported lng was 0.",
	},
	{
		ID:   "ethnic-cleansing-of-georgians-in-sukhumi",
		Lat:  43.0,
		Lng:  41.0,
		Note: "Sukhumi, Abkhazia, Georgia. Imported lng was 0.",
	},
	{
		ID:   "battle-of-the-atlantic",
		Lat:  50.0,
		Lng:  -30.0,
		Note: "Ocean-spanning Atlantic campaign. Centroid placed on the North Atlantic convoy lanes (~mid-Atlantic, 50N) rather than the equator default the importer produced.",
	},
	{
		ID:   "battle-of-shen-liao",
		Lat:  40.0,
		Lng:  117.5,
		Note: "Shen-Liao region of north-east China (Liaoning area). Imported lng=0.",
	},
	{
		ID:   "action-of-10-march-1917",
		Lat:  50.0,
		Lng:  -30.0,
		Note: "First World War North Atlantic action. Importer left at (0,-30).",
	},
	{
		ID:   "operation-teardrop",
		Lat:  50.0,
		Lng:  -30.0,
		Note: "Atlantic U-boat hunt, April-May 1945. Centroid placed on the North Atlantic.",
	},
}

// applyCoordOverrides updates each curated entry's lat/lng in place. Returns
// the number of rows updated so the cleanse report shows the work done.
// Idempotent: rerunning is a no-op when the DB already matches.
func applyCoordOverrides(ctx context.Context, db *sql.DB) (int, error) {
	var updated int
	for _, ov := range coordOverrides {
		res, err := db.ExecContext(ctx,
			"UPDATE battles SET lat = ?, lng = ? WHERE id = ? AND (lat != ? OR lng != ?)",
			ov.Lat, ov.Lng, ov.ID, ov.Lat, ov.Lng,
		)
		if err != nil {
			return updated, fmt.Errorf("coord override %s: %w", ov.ID, err)
		}
		if n, err := res.RowsAffected(); err == nil {
			updated += int(n)
		}
	}
	return updated, nil
}

// CleanseReport is what the migration returns so the caller can log the work
// performed without a second pass over the data.
type CleanseReport struct {
	BattleTextFixed        int
	SideTextFixed          int
	MissingDatesBackfilled int
	DateStringsNormalised  int
	YearsAligned           int
	YearsDerived           int
	ErasRecomputed         int
	BlankSidesDropped      int
	WarNamesCanonicalised  int
	DuplicatesRemoved      int
	CoordsOverridden       int
	RichSearchRowsIndexed  int
}

// Total returns the sum of every fix bucket. Cheap signal for "did the
// migration do any work this start."
func (r CleanseReport) Total() int {
	return r.BattleTextFixed + r.SideTextFixed + r.MissingDatesBackfilled +
		r.DateStringsNormalised + r.YearsAligned + r.YearsDerived +
		r.ErasRecomputed + r.BlankSidesDropped + r.WarNamesCanonicalised +
		r.DuplicatesRemoved + r.CoordsOverridden + r.RichSearchRowsIndexed
}

// --- Text normalisation -----------------------------------------------------

var (
	// Paired {{template|args}}. Looped to also strip nested templates after
	// the inner pair is removed.
	rePairedCurly = regexp.MustCompile(`\{\{[^{}]*\}\}`)
	// Unmatched "{{plainlist |..." → strip from there to end of string.
	reCurlyOpenEOL = regexp.MustCompile(`\{\{.*$`)
	// Orphan "}}" left when the importer dropped the opening template.
	reOrphanCurly = regexp.MustCompile(`\}\}`)
	// [[link|text]] → text; [[text]] → text.
	reWikiPipe  = regexp.MustCompile(`\[\[([^\[\]|]+\|)?([^\[\]]+)\]\]`)
	reWikiPlain = regexp.MustCompile(`\[\[([^\[\]]+)\]\]`)
	// Unmatched "[[topic|..." → strip from there to end of string.
	reWikiOpenEOL = regexp.MustCompile(`\[\[.*$`)
	// Orphan "]]" left when the importer dropped the opening link.
	reOrphanWiki = regexp.MustCompile(`\]\]`)
	// <ref>...</ref> with optional attributes, plus self-closing <ref />.
	reRefBlock = regexp.MustCompile(`(?is)<ref\b[^>]*>.*?</ref>`)
	reRefSelf  = regexp.MustCompile(`(?is)<ref\b[^/]*/>`)
	// Truncated <ref attr="value" ...  with no matching close tag. Cuts the
	// rest of the string off, since the data after a mid-attribute truncation
	// is reliably garbage.
	reRefUnclosed = regexp.MustCompile(`(?is)<ref\b.*$`)
	// HTML structural tags we never want to render: <br>, <br/>, <br />.
	reBR = regexp.MustCompile(`(?i)<br\s*/?>`)
	// Generic stripper for safe inline tags whose contents we keep.
	reSmallTag = regexp.MustCompile(`(?is)</?(?:small|sub|sup|center|nowrap|span|i|b)[^>]*>`)
	// Multiple spaces -> single space.
	reMultiSpace = regexp.MustCompile(`\s{2,}`)
	// Field-leader leakage: "| combatant2 = ..." at the start of a value.
	reFieldLead = regexp.MustCompile(`^\s*\|\s*[a-zA-Z0-9_]+\s*=\s*`)
	// Mid-string infobox leak: "Kingdom of Italy|combatant2=Austria-Hungary"
	// is the parser stuffing two sides into one cell. Cut at the next infobox
	// field marker so we keep the first side and drop the rest.
	reInfoboxCombatantLeak = regexp.MustCompile(`(?i)\s*\|\s*(combatant|commander|strength|casualties|result)\d*\s*=.*$`)

	// Leaked image / align directives at the head of a field, each ending in a
	// pipe: "thumb|", "thumbnail|", "left|", "200px|", "upright=1.2|",
	// "File:Foo.jpg|". Applied in a loop so chains ("thumb|left|200px|") strip.
	reLeadDirective = regexp.MustCompile(`(?i)^\s*(?:thumb|thumbnail|frame|frameless|border|bottom|top|centre|center|left|right|none|upright(?:=[0-9.]+)?|alt=[^|]*|link=[^|]*|\d+\s*px|File:[^|]*|Image:[^|]*)\s*\|\s*`)
	// Flag-template scrap: "|Flag of the National Revolutionary Army" leaves
	// the name, "| border" and "border|" and bullet points get dropped.
	reFlagScrap   = regexp.MustCompile(`(?i)\|\s*Flag of (?:the )?`)
	reBorderScrap = regexp.MustCompile(`(?i)\|\s*border\s*\|?|\bborder\s*\|`)
	reBullet      = regexp.MustCompile(`[•]`)
	// Reference-group residue: "...70 ships.|group=note".
	reGroupRef = regexp.MustCompile(`(?i)\|\s*group\s*=\s*\S+`)
	// Leading structural punctuation left after the strips above.
	reLeadPunct = regexp.MustCompile(`^\s*[|•;,]+\s*`)
	// Side-name align residue with no pipe: "left Duchy of...", "thumb Foo".
	// RE2 has no lookahead, so the following capitalized letter is captured
	// and re-emitted by the caller's "$1" replacement.
	reSideAlignLead = regexp.MustCompile(`(?i)^(?:left|right|thumb|thumbnail|bottom|none|upright)\s+(\p{Lu})`)
	// Residual pipe between belligerent entities becomes a comma separator.
	reInnerPipe = regexp.MustCompile(`\s*\|\s*`)
	// Collapse runs of separators ("; ,", ",,", "; ;") into one comma.
	reDupSeparator = regexp.MustCompile(`\s*[;,](?:\s*[;,])+\s*`)

	// Sentence boundary followed by a lowercase letter: the group captures the
	// preceding token so the caller can spare abbreviations and version numbers.
	reSentenceCap = regexp.MustCompile(`(\S+)([.!?])(\s+)(\p{Ll})`)
)

// sentenceAbbrev holds tokens that end in a period mid-sentence, so the word
// after them must not be capitalized.
var sentenceAbbrev = map[string]bool{
	"e.g": true, "i.e": true, "etc": true, "vs": true, "al": true, "no": true,
	"mr": true, "mrs": true, "dr": true, "st": true, "inc": true, "ltd": true,
	"u.s": true, "u.k": true, "ca": true, "cf": true, "fig": true, "vol": true,
	"esp": true, "approx": true, "cap": true,
}

// reCaptionLead detects a field whose content is a leaked image caption
// ("thumbnail|Markers at the...", "File:Foo.jpg|..."). Such a field held no
// real significance to begin with, so the caller blanks it for re-curation.
var reCaptionLead = regexp.MustCompile(`(?i)^\s*(?:thumb|thumbnail|frame|frameless|bottom|upright(?:=[0-9.]+)?|alt=|File:|Image:|\d+\s*px)\b`)

// upperInitial capitalizes the first letter of s, leaving leading markup or
// punctuation untouched.
func upperInitial(s string) string {
	for i, r := range s {
		if unicode.IsLetter(r) {
			if unicode.IsLower(r) {
				return s[:i] + string(unicode.ToUpper(r)) + s[i+len(string(r)):]
			}
			return s
		}
	}
	return s
}

// capitalizeSentences raises the first letter of s and of every sentence
// after a period, question mark, or exclamation, sparing abbreviations,
// version numbers, and ellipses.
func capitalizeSentences(s string) string {
	if s == "" {
		return s
	}
	s = upperInitial(s)
	return reSentenceCap.ReplaceAllStringFunc(s, func(m string) string {
		sub := reSentenceCap.FindStringSubmatch(m)
		word, punct, sp, ch := sub[1], sub[2], sub[3], sub[4]
		if strings.HasSuffix(word, "..") {
			return m // ellipsis, not a sentence boundary
		}
		if punct == "." {
			lw := strings.ToLower(strings.TrimRight(word, ".!?"))
			if sentenceAbbrev[lw] {
				return m
			}
			wr := []rune(word)
			if len(wr) > 0 && unicode.IsDigit(wr[len(wr)-1]) {
				return m // version or decimal, e.g. "9.3. x"
			}
		}
		return word + punct + sp + strings.ToUpper(ch)
	})
}

// cleanseProse cleans a summary or significance field. A field that is a
// leaked image caption blanks out for re-curation. Otherwise markup is
// stripped, any reference or caption pipe-tail is truncated, and sentence
// starts are capitalized.
func cleanseProse(s string) string {
	if reCaptionLead.MatchString(s) {
		return ""
	}
	s = NormaliseText(s)
	if i := strings.IndexByte(s, '|'); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	return capitalizeSentences(s)
}

// cleanseSideName cleans a belligerent name: shared markup strip, align-word
// residue removal, residual pipes turned into separators, and a raised
// initial.
func cleanseSideName(s string) string {
	s = NormaliseText(s)
	s = reSideAlignLead.ReplaceAllString(s, "$1")
	s = reInnerPipe.ReplaceAllString(s, ", ")
	s = reDupSeparator.ReplaceAllString(s, ", ")
	s = reMultiSpace.ReplaceAllString(s, " ")
	s = strings.TrimSpace(strings.Trim(s, ",;| "))
	return upperInitial(s)
}

// NormaliseText strips Wikipedia / infobox markup that leaked through the
// importer, replaces invalid UTF-8 with nothing, collapses whitespace, and
// trims the result. Idempotent for already-clean strings.
func NormaliseText(s string) string {
	if s == "" {
		return ""
	}
	// Drop invalid UTF-8 by re-encoding rune-by-rune. utf8.DecodeRuneInString
	// returns U+FFFD for malformed sequences; we skip those positions entirely.
	if !utf8.ValidString(s) {
		var b strings.Builder
		b.Grow(len(s))
		for i := 0; i < len(s); {
			r, size := utf8.DecodeRuneInString(s[i:])
			if r == utf8.RuneError && size == 1 {
				i++
				continue
			}
			b.WriteRune(r)
			i += size
		}
		s = b.String()
	}

	// Strip any U+FFFD that survived (e.g. already-present replacement glyphs).
	s = strings.ReplaceAll(s, "�", "")

	// Field-leader before tags so "| combatant2 = [[X]]" cleans to "X".
	s = reFieldLead.ReplaceAllString(s, "")
	// Mid-string infobox field leak: "Italy|combatant2=Austria-Hungary" -> "Italy".
	s = reInfoboxCombatantLeak.ReplaceAllString(s, "")
	// Leaked image / align directive chains at the head ("thumb|left|200px|").
	for {
		before := s
		s = reLeadDirective.ReplaceAllString(s, "")
		if s == before {
			break
		}
	}
	// Flag-template and border scraps from {{flagicon|...|border}} leaks.
	// Border becomes a pipe so a side-name pass can turn the gap between
	// two belligerents into a comma; the flag prefix and bullets drop.
	s = reFlagScrap.ReplaceAllString(s, " ")
	s = reBorderScrap.ReplaceAllString(s, "|")
	s = reBullet.ReplaceAllString(s, " ")
	s = reGroupRef.ReplaceAllString(s, "")
	s = reLeadPunct.ReplaceAllString(s, "")

	// Tags first (so brace strippers don't see template fragments embedded
	// inside ref tags or vice versa). The unclosed-ref pass runs LAST in
	// the tag group so paired refs are removed cleanly before we strip the
	// open-only ones to end of string.
	s = reRefBlock.ReplaceAllString(s, "")
	s = reRefSelf.ReplaceAllString(s, "")
	s = reRefUnclosed.ReplaceAllString(s, "")
	s = reBR.ReplaceAllString(s, " ")
	s = reSmallTag.ReplaceAllString(s, "")

	// Templates: paired form first (loop so nested templates collapse
	// outside-in), then strip unmatched openers all the way to end of string,
	// then drop any orphan closers that survive.
	for {
		before := s
		s = rePairedCurly.ReplaceAllString(s, "")
		if s == before {
			break
		}
	}
	s = reCurlyOpenEOL.ReplaceAllString(s, "")
	s = reOrphanCurly.ReplaceAllString(s, "")

	// Wiki links: [[A|B]] -> B, [[A]] -> A. Loop to handle nested links.
	// Then unmatched openers go to end-of-string and orphan closers get dropped.
	for {
		before := s
		s = reWikiPipe.ReplaceAllString(s, "$2")
		s = reWikiPlain.ReplaceAllString(s, "$1")
		if s == before {
			break
		}
	}
	s = reWikiOpenEOL.ReplaceAllString(s, "")
	s = reOrphanWiki.ReplaceAllString(s, "")

	// Collapse whitespace and trim. The right-trim drops trailing
	// pipe/colon/comma/semicolon left over after structural strips, but
	// keeps a terminal period so prose sentences stay intact.
	s = reMultiSpace.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, ",:;| \t")
	return s
}

// --- Battle text pass -------------------------------------------------------

func cleanseBattleText(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, name, war, victor, summary, significance FROM battles`)
	if err != nil {
		return 0, fmt.Errorf("scan battle text: %w", err)
	}
	type row struct {
		id, name, war, victor, summary, significance string
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.name, &r.war, &r.victor, &r.summary, &r.significance); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan battle text row: %w", err)
		}
		batch = append(batch, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate battle text rows: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin battle text tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx,
		`UPDATE battles SET name = ?, war = ?, victor = ?, summary = ?, significance = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare battle text update: %w", err)
	}
	defer stmt.Close()

	var updated int
	for _, r := range batch {
		name := NormaliseText(r.name)
		war := NormaliseText(r.war)
		victor := NormaliseText(r.victor)
		summary := cleanseProse(r.summary)
		significance := cleanseProse(r.significance)
		if name == r.name && war == r.war && victor == r.victor &&
			summary == r.summary && significance == r.significance {
			continue
		}
		if _, err := stmt.ExecContext(ctx, name, war, victor, summary, significance, r.id); err != nil {
			return updated, fmt.Errorf("update battle text for %s: %w", r.id, err)
		}
		updated++
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit battle text cleanse: %w", err)
	}
	return updated, nil
}

// --- Sides pass -------------------------------------------------------------

func cleanseSides(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT battle_id, side_index, name, commander, strength, casualties FROM battle_sides`)
	if err != nil {
		return 0, fmt.Errorf("scan sides: %w", err)
	}
	type row struct {
		battleID                              string
		sideIndex                             int
		name, commander, strength, casualties string
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.battleID, &r.sideIndex, &r.name, &r.commander, &r.strength, &r.casualties); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan side row: %w", err)
		}
		batch = append(batch, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate side rows: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin side tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx,
		`UPDATE battle_sides SET name = ?, commander = ?, strength = ?, casualties = ?
		 WHERE battle_id = ? AND side_index = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare side update: %w", err)
	}
	defer stmt.Close()

	var updated int
	for _, r := range batch {
		name := cleanseSideName(r.name)
		commander := NormaliseText(r.commander)
		strength := NormaliseText(r.strength)
		casualties := NormaliseText(r.casualties)
		if name == r.name && commander == r.commander &&
			strength == r.strength && casualties == r.casualties {
			continue
		}
		if _, err := stmt.ExecContext(ctx, name, commander, strength, casualties,
			r.battleID, r.sideIndex); err != nil {
			return updated, fmt.Errorf("update side %s/%d: %w", r.battleID, r.sideIndex, err)
		}
		updated++
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit side cleanse: %w", err)
	}
	return updated, nil
}

// --- Date back-fill ---------------------------------------------------------

// backfillMissingDate fills in the user-facing `date` column for rows that
// only carry `year`. The fall-back is the plain "1850" or "490 BC" string,
// matching what users see elsewhere when no finer date is available.
func backfillMissingDate(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, year FROM battles WHERE date = '' AND year != 0`)
	if err != nil {
		return 0, fmt.Errorf("scan missing-date battles: %w", err)
	}
	type row struct {
		id   string
		year int
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.year); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan missing-date row: %w", err)
		}
		batch = append(batch, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate missing-date rows: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin date backfill tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx,
		`UPDATE battles SET date = ?, date_start = ?, date_end = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare date backfill: %w", err)
	}
	defer stmt.Close()

	var updated int
	for _, r := range batch {
		date := formatYearLabel(r.year)
		dr := yearFallback(r.year)
		if _, err := stmt.ExecContext(ctx, date, dr.Start, dr.End, r.id); err != nil {
			return updated, fmt.Errorf("backfill date for %s: %w", r.id, err)
		}
		updated++
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit date backfill: %w", err)
	}
	return updated, nil
}

// formatYearLabel mirrors what the UI shows ("490 BC" / "1066").
func formatYearLabel(y int) string {
	if y < 0 {
		return fmt.Sprintf("%d BC", -y)
	}
	return fmt.Sprintf("%d", y)
}

// --- Year/date alignment ---------------------------------------------------

// reAmbiguousDate matches prose that names several candidate years (the
// importer guessed one; the prose lists all of them). When the date string
// is ambiguous we trust `year` because it's a single curated value rather
// than rewriting it to whichever number our parser happened to pick first.
var reAmbiguousDate = regexp.MustCompile(`(?i)\b(or|between|approximately|c\.|circa|disputed|estimated|chronology|/)\b`)

// reYearToken finds every standalone 3-4 digit year token in a date string.
// Used alongside reBCToken to enumerate every plausible year so we can detect
// when a stored `year` is inside a multi-year range (1213-1215, 686-690).
var reYearToken = regexp.MustCompile(`\b(\d{3,4})\b`)
var reBCToken = regexp.MustCompile(`(\d+)\s*BC`)

// candidateYears returns the list of years a prose date string mentions.
// Mirrors scripts/audit_db.py's year_candidates so the two stay in lockstep.
func candidateYears(date string) []int {
	if date == "" {
		return nil
	}
	var out []int
	for _, m := range reBCToken.FindAllStringSubmatch(date, -1) {
		var n int
		fmt.Sscanf(m[1], "%d", &n)
		out = append(out, -n)
	}
	cleaned := reBCToken.ReplaceAllString(date, "")
	for _, m := range reYearToken.FindAllStringSubmatch(cleaned, -1) {
		var n int
		fmt.Sscanf(m[1], "%d", &n)
		out = append(out, n)
	}
	return out
}

// alignYearToDate trusts the prose `date` over the `year` column whenever
// the prose is unambiguous and the two disagree. This catches the common BC
// off-by-one ("1457 BC" stored as -1456) plus any larger discrepancy where
// the prose lists a single canonical year ("AD 316" vs year=314). Ambiguous
// prose ("574, 580, or 590") leaves year alone — that case keeps the curated
// year and lets the audit recognise the ambiguity instead of flagging it.
func alignYearToDate(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, year, date FROM battles WHERE date != ''`)
	if err != nil {
		return 0, fmt.Errorf("scan align-year rows: %w", err)
	}
	type row struct {
		id   string
		year int
		date string
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.year, &r.date); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan align row: %w", err)
		}
		batch = append(batch, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate align rows: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin year align tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx,
		`UPDATE battles SET year = ?, era = ?, date_start = ?, date_end = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare align update: %w", err)
	}
	defer stmt.Close()

	var updated int
	for _, r := range batch {
		// Ambiguous prose: leave year alone. The audit treats this as a
		// recognised case rather than an error.
		if reAmbiguousDate.MatchString(r.date) {
			continue
		}
		cands := candidateYears(r.date)
		if len(cands) == 0 {
			continue
		}
		// If `year` already matches a candidate or sits within the candidate
		// envelope, the row is fine — same rule the audit applies.
		if yearAcceptable(r.year, cands) {
			continue
		}
		// Pick the smallest candidate as the canonical year (matches the
		// start-of-engagement convention used by date_start). This makes the
		// alignment deterministic and easy to predict.
		target := cands[0]
		for _, c := range cands {
			if c < target {
				target = c
			}
		}
		// Re-derive date_start / date_end from prose when possible, falling
		// back to "year only" so the dates always agree with year.
		dr := ParseDateRange(r.date, target)
		if yearFromISO(dr.Start) != target {
			dr = yearFallback(target)
		}
		era := YearToEra(target)
		if _, err := stmt.ExecContext(ctx, target, era, dr.Start, dr.End, r.id); err != nil {
			return updated, fmt.Errorf("align year for %s: %w", r.id, err)
		}
		updated++
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit year align: %w", err)
	}
	return updated, nil
}

// yearAcceptable answers "is this stored year consistent with the prose date".
// Year matches a single explicit candidate, OR sits inside the min-max
// envelope when prose gives a range. Mirrors the audit's logic so a row that
// passes cleanse will also pass audit.
func yearAcceptable(year int, candidates []int) bool {
	if len(candidates) == 0 {
		return true
	}
	if slices.Contains(candidates, year) {
		return true
	}
	if len(candidates) >= 2 {
		lo, hi := candidates[0], candidates[0]
		for _, c := range candidates {
			if c < lo {
				lo = c
			}
			if c > hi {
				hi = c
			}
		}
		if year >= lo && year <= hi {
			return true
		}
	}
	return false
}

func yearFromISO(iso string) int {
	if iso == "" {
		return 0
	}
	// Handles "-0490-01-01" and "1066-12-31".
	neg := strings.HasPrefix(iso, "-")
	rest := iso
	if neg {
		rest = iso[1:]
	}
	if len(rest) < 4 {
		return 0
	}
	var y int
	if _, err := fmt.Sscanf(rest[:4], "%d", &y); err != nil {
		return 0
	}
	if neg {
		return -y
	}
	return y
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// --- Year derived from date string -----------------------------------------

// deriveYearFromDate fills `year` when it's zero but the date string parses to
// a known year. Without this, era recomputation skips the row and the audit
// keeps flagging "era empty" on records that actually do have date prose.
func deriveYearFromDate(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, date FROM battles WHERE year = 0 AND date != ''`)
	if err != nil {
		return 0, fmt.Errorf("scan derive-year rows: %w", err)
	}
	type row struct{ id, date string }
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.date); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan derive row: %w", err)
		}
		batch = append(batch, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate derive rows: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin derive year tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx,
		`UPDATE battles SET year = ?, era = ?, date_start = ?, date_end = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare derive year update: %w", err)
	}
	defer stmt.Close()

	var updated int
	for _, r := range batch {
		dr := ParseDateRange(r.date, 0)
		py := yearFromISO(dr.Start)
		if py == 0 {
			continue
		}
		era := YearToEra(py)
		if _, err := stmt.ExecContext(ctx, py, era, dr.Start, dr.End, r.id); err != nil {
			return updated, fmt.Errorf("derive year for %s: %w", r.id, err)
		}
		updated++
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit derive year: %w", err)
	}
	return updated, nil
}

// --- Drop blank sides ------------------------------------------------------

// dropBlankSides deletes battle_sides rows whose name became empty after
// NormaliseText stripped wiki/template markup. A side without a name carries
// no information and rendering it shows an empty bubble. The battles
// themselves stay; only the unusable side rows go.
func dropBlankSides(ctx context.Context, db *sql.DB) (int, error) {
	res, err := db.ExecContext(ctx,
		`DELETE FROM battle_sides WHERE TRIM(name) = ''`)
	if err != nil {
		return 0, fmt.Errorf("drop blank sides: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// --- Era recompute ----------------------------------------------------------

// YearToEra mirrors importer.yearToEra (private) plus the audit script. Kept
// in this file so the cleanse can apply it without poking into wikidata.go.
// Post-1945 years split at 1991 (Soviet collapse) into cold-war and
// contemporary, matching validErasSet and the front-end ERA_COLORS taxonomy.
func YearToEra(y int) string {
	switch {
	case y == 0:
		return ""
	case y < 500:
		return "ancient"
	case y < 1500:
		return "medieval"
	case y < 1700:
		return "early-modern"
	case y < 1820:
		return "napoleonic"
	case y < 1914:
		return "industrial"
	case y < 1919:
		return "world-war-1"
	case y < 1939:
		return "interwar"
	case y < 1946:
		return "world-war-2"
	case y < 1991:
		return "cold-war"
	default:
		return "contemporary"
	}
}

func recomputeEra(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, year, era FROM battles WHERE year != 0`)
	if err != nil {
		return 0, fmt.Errorf("scan era rows: %w", err)
	}
	type row struct {
		id, era string
		year    int
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.year, &r.era); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan era row: %w", err)
		}
		batch = append(batch, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate era rows: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin era tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET era = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare era update: %w", err)
	}
	defer stmt.Close()

	var updated int
	for _, r := range batch {
		want := YearToEra(r.year)
		if want == "" || want == r.era {
			continue
		}
		if _, err := stmt.ExecContext(ctx, want, r.id); err != nil {
			return updated, fmt.Errorf("recompute era for %s: %w", r.id, err)
		}
		updated++
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit era recompute: %w", err)
	}
	return updated, nil
}

// --- War-name canonicalisation ---------------------------------------------

// warCount is the count-by-name aggregation used by the two canonicalisation
// passes. Defined at package scope so helpers can take it as a parameter.
type warCount struct {
	name  string
	count int
}

// canonicaliseWarNames performs two passes:
//  1. Repair comma-joined war names ("Trans-Mississippi Theater of the,
//     American Civil War" → "Trans-Mississippi Theater of the American Civil
//     War") by recognising whether the comma split a single name or joined
//     two distinct wars, and producing a clean canonical string for either
//     case. The existing warParent classifier then groups the cleaned name
//     under its parent (American Civil War, World War I, etc.).
//  2. Collapse spelling variants of the same war (dash style, leading
//     "the") onto the variant with the most battles.
func canonicaliseWarNames(ctx context.Context, db *sql.DB) (int, error) {
	loadCounts := func() ([]warCount, error) {
		rows, err := db.QueryContext(ctx,
			`SELECT war, COUNT(*) FROM battles WHERE war != '' GROUP BY war`)
		if err != nil {
			return nil, fmt.Errorf("scan war counts: %w", err)
		}
		defer rows.Close()
		var out []warCount
		for rows.Next() {
			var w warCount
			if err := rows.Scan(&w.name, &w.count); err != nil {
				return nil, fmt.Errorf("scan war row: %w", err)
			}
			out = append(out, w)
		}
		return out, rows.Err()
	}

	wars, err := loadCounts()
	if err != nil {
		return 0, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin war tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET war = ? WHERE war = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare war update: %w", err)
	}
	defer stmt.Close()

	rewrite := func(from, to string) (int, error) {
		if from == to {
			return 0, nil
		}
		res, err := stmt.ExecContext(ctx, to, from)
		if err != nil {
			return 0, fmt.Errorf("rewrite war %q -> %q: %w", from, to, err)
		}
		n, _ := res.RowsAffected()
		return int(n), nil
	}

	var updated int

	// Pass 1: repair comma-joined war names.
	for _, w := range wars {
		if !strings.Contains(w.name, ",") {
			continue
		}
		clean := repairCommaWar(w.name)
		if clean == "" || clean == w.name {
			continue
		}
		n, err := rewrite(w.name, clean)
		if err != nil {
			return updated, err
		}
		updated += n
	}
	if err := tx.Commit(); err != nil {
		return updated, fmt.Errorf("commit war repair: %w", err)
	}

	// Pass 2: collapse spelling variants. Re-read after pass 1 so the variant
	// grouping sees the cleaned-up names.
	wars, err = loadCounts()
	if err != nil {
		return updated, err
	}

	tx2, err := db.BeginTx(ctx, nil)
	if err != nil {
		return updated, fmt.Errorf("begin war variant tx: %w", err)
	}
	defer tx2.Rollback()
	stmt2, err := tx2.PrepareContext(ctx, `UPDATE battles SET war = ? WHERE war = ?`)
	if err != nil {
		return updated, fmt.Errorf("prepare war variant update: %w", err)
	}
	defer stmt2.Close()

	groups := make(map[string][]warCount)
	for _, w := range wars {
		groups[canonWarKey(w.name)] = append(groups[canonWarKey(w.name)], w)
	}
	for _, variants := range groups {
		if len(variants) < 2 {
			continue
		}
		// Prefer the canonical surface form over alias phrasings even when
		// counts tilt the other way. "Second World War", "Great War", British
		// "theatre", and parenthetical "(World War I/II)" labels all carry an
		// alias scent the user does not want surfaced.
		sort.Slice(variants, func(i, j int) bool {
			iAlias := hasAliasPhrase(variants[i].name)
			jAlias := hasAliasPhrase(variants[j].name)
			if iAlias != jAlias {
				return !iAlias
			}
			if variants[i].count != variants[j].count {
				return variants[i].count > variants[j].count
			}
			return variants[i].name < variants[j].name
		})
		canon := variants[0].name
		for _, v := range variants[1:] {
			if v.name == canon {
				continue
			}
			res, err := stmt2.ExecContext(ctx, canon, v.name)
			if err != nil {
				return updated, fmt.Errorf("variant rewrite %q -> %q: %w", v.name, canon, err)
			}
			n, _ := res.RowsAffected()
			updated += int(n)
		}
	}
	if err := tx2.Commit(); err != nil {
		return updated, fmt.Errorf("commit war variants: %w", err)
	}
	return updated, nil
}

// joinPreps and splitConjs decide how to treat a comma whose left side ends
// in one of these words. A join-suffix means the comma is an artifact and
// the two halves form a single name ("Trans-Mississippi Theater of the,
// American Civil War"). A split-conj means the comma joined two distinct
// wars connected by a conjunction, so we keep only the head ("Haitian
// Revolution and the, War of the First Coalition" → "Haitian Revolution").
var (
	joinPreps  = []string{" of the", " of"}
	splitConjs = []string{" and the", " and"}
)

// repairCommaWar normalises a comma-joined Wikidata war name into a single
// canonical form, handling the three real-world cases we see:
//  1. Artifact comma after a preposition → drop the comma, keep both halves
//     ("Trans-Mississippi Theater of the, American Civil War" →
//     "Trans-Mississippi Theater of the American Civil War").
//  2. Artifact conjunction → keep only the head war
//     ("Haitian Revolution and the, War of the First Coalition" →
//     "Haitian Revolution").
//  3. Two distinct wars joined by a comma → keep the first segment
//     ("Dakota War of 1862, American Civil War" → "Dakota War of 1862").
//
// In every case the result is a clean human-readable name. The existing
// warParent classifier then groups it under its parent war when applicable.
func repairCommaWar(name string) string {
	before, after, ok := strings.Cut(name, ",")
	if !ok {
		return name
	}
	before = strings.TrimSpace(before)
	after = strings.TrimSpace(after)
	// Drop wrapping parens that wiki templates leave around the second half.
	after = strings.TrimSpace(strings.TrimPrefix(after, "("))
	after = strings.TrimSpace(strings.TrimSuffix(after, ")"))
	if before == "" {
		return after
	}
	low := strings.ToLower(before)
	for _, suf := range splitConjs {
		if strings.HasSuffix(low, suf) {
			cleaned := strings.TrimSpace(before[:len(before)-len(suf)])
			if cleaned != "" {
				return cleaned
			}
			return before
		}
	}
	for _, suf := range joinPreps {
		if strings.HasSuffix(low, suf) {
			if after == "" {
				return before
			}
			return strings.TrimSpace(before + " " + after)
		}
	}
	return before
}

// hasAliasPhrase reports whether the war name uses an alias surface form
// that the user should not see when a canonical phrasing exists. Used as
// the primary sort key in the variant-collapse pass so the canonical form
// always wins, regardless of which variant happens to have more battles.
func hasAliasPhrase(name string) bool {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "second world war"),
		strings.Contains(n, "first world war"),
		strings.Contains(n, "great war"),
		strings.Contains(n, "theatre"),
		strings.Contains(n, "(world war i"):
		return true
	}
	return false
}

// canonWarKey normalises a war name into a stable lookup key so variant
// spellings of the same conflict collapse into one bucket. The variant pass
// in canonicaliseWarNames groups all rows that share a key and rewrites
// every variant to whichever exact form has the most battles, so the user
// sees one entry per real war instead of a fragmented list. Rules:
//   - Lowercase, trim, normalise dash glyphs, drop a leading "the ".
//   - "Second World War" ⇄ "World War II", "First/Great War" ⇄ "World War I"
//     (pure aliases; identical conflict under a different surface form).
//   - "(World War II)" ⇄ "World War II" inside compound names, so
//     "Eastern Front (World War II)" and "Eastern Front of World War II"
//     collapse to the same theater.
//   - British "theatre" → American "theater" so the panel doesn't list
//     "Pacific Theatre" beside "Pacific Theater".
//   - Strip the "of (the) " connector between a sub-conflict and its parent
//     so "Battle of the Mediterranean of World War II" and "Battle of the
//     Mediterranean of the Second World War" share a key.
func canonWarKey(w string) string {
	s := strings.ToLower(strings.TrimSpace(w))
	s = strings.NewReplacer("–", "-", "—", "-", "−", "-").Replace(s)
	if strings.HasPrefix(s, "the ") {
		s = s[4:]
	}
	// Fold WW alias surface forms to their canonical roman-numeral form.
	// Order matters: "second world war" must rewrite before any rule that
	// touches "world war" alone, and "first world war" before "great war"
	// rewrites (no overlap, but kept explicit for the reader).
	s = strings.ReplaceAll(s, "second world war", "world war ii")
	s = strings.ReplaceAll(s, "first world war", "world war i")
	s = strings.ReplaceAll(s, "the great war", "world war i")
	if s == "great war" {
		s = "world war i"
	}
	// Collapse parenthetical "(World War II)" suffixes used by Wikidata
	// labels into the prose form so the variant pass treats them as the
	// same theater.
	s = strings.ReplaceAll(s, "(world war ii)", "of world war ii")
	s = strings.ReplaceAll(s, "(world war i)", "of world war i")
	// Spelling normalisations.
	s = strings.ReplaceAll(s, "theatre", "theater")
	// Strip the "of (the) " connector before "world war" so "Battle of X of
	// World War II" and "Battle of X of the Second World War" (already
	// rewritten to "world war ii" above) collapse.
	s = strings.ReplaceAll(s, "of the world war", "of world war")
	// Collapse run-on whitespace introduced by the rewrites.
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	return strings.TrimSpace(s)
}

// --- Wikipedia-title duplicates --------------------------------------------

// deduplicateWikipedia removes duplicate rows that share a wikipedia_title.
// Keeps the row with the most filled fields (sides count, summary length, and
// verified flag). The discarded row's sides and references are dropped via
// foreign-key cascade.
func deduplicateWikipedia(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, wikipedia_title, verified, COALESCE(LENGTH(summary), 0),
		       (SELECT COUNT(*) FROM battle_sides s WHERE s.battle_id = battles.id)
		FROM battles WHERE wikipedia_title != ''`)
	if err != nil {
		return 0, fmt.Errorf("scan duplicates: %w", err)
	}
	type row struct {
		id, title string
		verified  int
		summary   int
		sides     int
	}
	groups := make(map[string][]row)
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.title, &r.verified, &r.summary, &r.sides); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan duplicate row: %w", err)
		}
		groups[r.title] = append(groups[r.title], r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate duplicate rows: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin dedupe tx: %w", err)
	}
	defer tx.Rollback()

	var removed int
	for _, dupes := range groups {
		if len(dupes) < 2 {
			continue
		}
		// Sort so the row to KEEP is first. Verified beats non-verified, more
		// sides beats fewer, longer summary beats shorter, alphabetical id is
		// the tie-breaker so the result is deterministic.
		sort.Slice(dupes, func(i, j int) bool {
			a, b := dupes[i], dupes[j]
			if a.verified != b.verified {
				return a.verified > b.verified
			}
			if a.sides != b.sides {
				return a.sides > b.sides
			}
			if a.summary != b.summary {
				return a.summary > b.summary
			}
			return a.id < b.id
		})
		for _, d := range dupes[1:] {
			if _, err := tx.ExecContext(ctx, `DELETE FROM battle_sides WHERE battle_id = ?`, d.id); err != nil {
				return removed, fmt.Errorf("delete sides for %s: %w", d.id, err)
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM battle_references WHERE battle_id = ?`, d.id); err != nil {
				return removed, fmt.Errorf("delete refs for %s: %w", d.id, err)
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM battles WHERE id = ?`, d.id); err != nil {
				return removed, fmt.Errorf("delete duplicate %s: %w", d.id, err)
			}
			removed++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit dedupe: %w", err)
	}
	return removed, nil
}
