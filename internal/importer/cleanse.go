package importer

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strings"
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
	return rep, nil
}

// CleanseReport is what the migration returns so the caller can log the work
// performed without a second pass over the data.
type CleanseReport struct {
	BattleTextFixed       int
	SideTextFixed         int
	MissingDatesBackfilled int
	YearsAligned          int
	YearsDerived          int
	ErasRecomputed        int
	BlankSidesDropped     int
	WarNamesCanonicalised int
	DuplicatesRemoved     int
}

// Total returns the sum of every fix bucket. Cheap signal for "did the
// migration do any work this start."
func (r CleanseReport) Total() int {
	return r.BattleTextFixed + r.SideTextFixed + r.MissingDatesBackfilled +
		r.YearsAligned + r.YearsDerived + r.ErasRecomputed +
		r.BlankSidesDropped + r.WarNamesCanonicalised + r.DuplicatesRemoved
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
	// HTML structural tags we never want to render: <br>, <br/>, <br />.
	reBR = regexp.MustCompile(`(?i)<br\s*/?>`)
	// Generic stripper for safe inline tags whose contents we keep.
	reSmallTag = regexp.MustCompile(`(?is)</?(?:small|sub|sup|center|nowrap|span|i|b)[^>]*>`)
	// Multiple spaces -> single space.
	reMultiSpace = regexp.MustCompile(`\s{2,}`)
	// Field-leader leakage: "| combatant2 = ..." at the start of a value.
	reFieldLead = regexp.MustCompile(`^\s*\|\s*[a-zA-Z0-9_]+\s*=\s*`)
)

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

	// Tags first (so brace strippers don't see template fragments embedded
	// inside ref tags or vice versa).
	s = reRefBlock.ReplaceAllString(s, "")
	s = reRefSelf.ReplaceAllString(s, "")
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

	// Collapse whitespace and trim. The right-trim also drops trailing
	// pipe/colon/comma/semicolon left over after structural strips.
	s = reMultiSpace.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, ",:;|. \t")
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
		summary := NormaliseText(r.summary)
		significance := NormaliseText(r.significance)
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
		battleID  string
		sideIndex int
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
		name := NormaliseText(r.name)
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
		dr := ParseDateRange(r.date, r.year)
		py := yearFromISO(dr.Start)
		if py == 0 || py == r.year {
			continue
		}
		// Ambiguous prose: leave year alone. The audit treats this as a
		// recognised case rather than an error.
		if reAmbiguousDate.MatchString(r.date) {
			continue
		}
		era := YearToEra(py)
		if _, err := stmt.ExecContext(ctx, py, era, dr.Start, dr.End, r.id); err != nil {
			return updated, fmt.Errorf("align year for %s: %w", r.id, err)
		}
		updated++
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit year align: %w", err)
	}
	return updated, nil
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
	default:
		return "modern"
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

// canonicaliseWarNames collapses spelling variants of the same war onto a
// single canonical form (the variant with the most battles). Two wars are
// considered the same when their canonical key matches: lowercase, all
// dash variants flattened to "-", leading "the " dropped.
func canonicaliseWarNames(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT war, COUNT(*) FROM battles WHERE war != '' GROUP BY war`)
	if err != nil {
		return 0, fmt.Errorf("scan war counts: %w", err)
	}
	type warVariant struct {
		name  string
		count int
	}
	groups := make(map[string][]warVariant)
	for rows.Next() {
		var name string
		var count int
		if err := rows.Scan(&name, &count); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan war row: %w", err)
		}
		groups[canonWarKey(name)] = append(groups[canonWarKey(name)], warVariant{name: name, count: count})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate war rows: %w", err)
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

	var updated int
	for _, variants := range groups {
		if len(variants) < 2 {
			continue
		}
		// Canonical name = the one with the most battles. On ties, the
		// alphabetically first variant wins so the choice is deterministic.
		sort.Slice(variants, func(i, j int) bool {
			if variants[i].count != variants[j].count {
				return variants[i].count > variants[j].count
			}
			return variants[i].name < variants[j].name
		})
		canon := variants[0].name
		for _, v := range variants[1:] {
			res, err := stmt.ExecContext(ctx, canon, v.name)
			if err != nil {
				return updated, fmt.Errorf("canonicalise war %q -> %q: %w", v.name, canon, err)
			}
			n, _ := res.RowsAffected()
			updated += int(n)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit war canonicalise: %w", err)
	}
	return updated, nil
}

func canonWarKey(w string) string {
	s := strings.ToLower(strings.TrimSpace(w))
	s = strings.NewReplacer("–", "-", "—", "-", "−", "-").Replace(s)
	if strings.HasPrefix(s, "the ") {
		s = s[4:]
	}
	return s
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
