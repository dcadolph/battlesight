package importer

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	// partofLinkRe matches the first wiki link target in an infobox partof value.
	partofLinkRe = regexp.MustCompile(`\[\[([^\]|#]+)`)
	// bareQIDRe matches a Wikidata Q-id that had no English label.
	bareQIDRe = regexp.MustCompile(`^Q\d+$`)
	// conflictTitleRe matches an article title that names a conflict. An
	// infobox partof link to a state, dynasty, people, person or period is
	// not a war, so a link must match to be one.
	conflictTitleRe = regexp.MustCompile(`(?i)\b(?:wars?|warfare|campaigns?|conflicts?|revolutions?|` +
		`rebellions?|revolts?|risings?|uprisings?|insurgenc(?:y|ies)|insurrections?|invasions?|` +
		`(?:counter)?offensives?|crusades?|conquests?|reconquista|crisis|expeditions?|theat(?:er|re)s?|` +
		`fronts?|operations?|sieges?|battles?|raids?|interventions?|independence|fitna|jihad|disputes?|` +
		`expansions?|resistance|intifada|mutin(?:y|ies)|clashes|skirmishes|hostilities|incursions?|` +
		`occupation|blockade|emergency|troubles|feuds?|struggle|unrest|coup|massacres?|movement|` +
		`pacification|suppression|advance|bombing|genocide|conspiracy|incident|disturbances|rivalry|` +
		`liberation|piracy|anarchy|guerra|attacks?|fronde|chouannerie|march|confrontations?|razz?ias?|` +
		`upheaval|wooing|year of the (?:four|five|six) emperors)\b`)
)

// WarNames is the wars.json view Cleanse files rows by.
type WarNames struct {
	// Keys holds every canonical war name.
	Keys map[string]bool
	// Aliases maps each alias to its canonical war name.
	Aliases map[string]string
	// Spans maps each key and alias, folded by canonWarKey, to its year span.
	Spans map[string]WarSpan
}

// warFromSources returns the war a source states for a row: the first labeled
// entry of the Wikidata conflict facts, else the first link of the infobox
// partof value whose title names a conflict. List articles are never a war.
func warFromSources(conflict, partof string) string {
	for _, l := range strings.Split(conflict, "|") {
		l = strings.TrimSpace(l)
		if l != "" && !bareQIDRe.MatchString(l) && !strings.HasPrefix(l, "List of") {
			return l
		}
	}
	for _, m := range partofLinkRe.FindAllStringSubmatch(partof, -1) {
		t := strings.TrimSpace(strings.ReplaceAll(m[1], "_", " "))
		if t != "" && !strings.HasPrefix(t, "List of") && conflictTitleRe.MatchString(t) {
			return t
		}
	}
	return ""
}

// clearNonConflictWars empties the war of each unverified wikidata row whose
// war is not a wars.json key or alias, not one of the row's own Wikidata
// conflict labels, and names no conflict: a state, dynasty, period, person or
// text fragment that a retired free-text pass wrote. fillWarFromWikidata then
// refills the row from its sources on the same start.
func clearNonConflictWars(ctx context.Context, db *sql.DB, wars WarNames) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, war, wikidata_conflict FROM battles
		WHERE war != '' AND source = 'wikidata' AND verified = 0`)
	if err != nil {
		return 0, fmt.Errorf("scan wars to check: %w", err)
	}
	var clear []string
	for rows.Next() {
		var id, war, conflict string
		if err := rows.Scan(&id, &war, &conflict); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan war to check: %w", err)
		}
		if !sourcedWar(war, conflict, wars) {
			clear = append(clear, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate wars to check: %w", err)
	}
	if len(clear) == 0 {
		return 0, nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin war clear tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET war = '' WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare war clear: %w", err)
	}
	defer stmt.Close()
	for _, id := range clear {
		if _, err := stmt.ExecContext(ctx, id); err != nil {
			return 0, fmt.Errorf("clear war for %s: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit war clear: %w", err)
	}
	return len(clear), nil
}

// sourcedWar reports whether a stored war stands on a source: a wars.json key
// or alias, one of the row's Wikidata conflict labels in any case (text
// cleanse capitalizes a label that starts lower case), or a title that names a
// conflict.
func sourcedWar(war, conflict string, wars WarNames) bool {
	if wars.Keys[war] || wars.Aliases[war] != "" || conflictTitleRe.MatchString(war) {
		return true
	}
	for _, l := range strings.Split(conflict, "|") {
		if strings.EqualFold(strings.TrimSpace(l), war) {
			return true
		}
	}
	return false
}

// fillWarFromWikidata sets the war of each war-less, unverified wikidata row
// from its Wikidata conflict facts or its infobox partof link. Curated and
// verified rows are never touched. A modern war whose region excludes the
// row's point is not filled, the same rule reconcileSourceDates clears by,
// and neither is a war whose span excludes the row's year, the rule
// reconcileWarSpans clears by, so the passes never undo each other.
func fillWarFromWikidata(ctx context.Context, db *sql.DB, wars WarNames) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, year, wikidata_conflict, infobox_partof, lat, lng FROM battles
		WHERE war = '' AND source = 'wikidata' AND verified = 0
		AND (wikidata_conflict != '' OR infobox_partof != '')`)
	if err != nil {
		return 0, fmt.Errorf("scan war-less rows: %w", err)
	}
	fills := map[string]string{}
	for rows.Next() {
		var id, conflict, partof string
		var year int
		var lat, lng float64
		if err := rows.Scan(&id, &year, &conflict, &partof, &lat, &lng); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan war-less row: %w", err)
		}
		w := warFromSources(conflict, partof)
		if w == "" || warOutsideRegion(&AuditRow{War: w, Lat: lat, Lng: lng}) || wars.outsideSpan(w, year) {
			continue
		}
		fills[id] = w
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate war-less rows: %w", err)
	}
	if len(fills) == 0 {
		return 0, nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin war fill tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET war = ? WHERE id = ? AND war = ''`)
	if err != nil {
		return 0, fmt.Errorf("prepare war fill: %w", err)
	}
	defer stmt.Close()
	ids := make([]string, 0, len(fills))
	for id := range fills {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if _, err := stmt.ExecContext(ctx, fills[id], id); err != nil {
			return 0, fmt.Errorf("fill war for %s: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit war fill: %w", err)
	}
	return len(fills), nil
}

// applyWarAliases rewrites every unverified wikidata row filed under a war
// alias, in any case, to the canonical war name from wars.json. Text cleanse
// capitalizes a Wikidata label that starts lower case, so an exact match would
// miss filled rows. Curated and verified rows are never touched.
func applyWarAliases(ctx context.Context, db *sql.DB, aliases map[string]string) (int, error) {
	if len(aliases) == 0 {
		return 0, nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin war alias tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET war = ? WHERE war = ? COLLATE NOCASE AND war != ?
		AND source != 'curated' AND verified = 0`)
	if err != nil {
		return 0, fmt.Errorf("prepare war alias: %w", err)
	}
	defer stmt.Close()
	from := make([]string, 0, len(aliases))
	for a := range aliases {
		from = append(from, a)
	}
	sort.Strings(from)
	var n int
	for _, a := range from {
		res, err := stmt.ExecContext(ctx, aliases[a], a, aliases[a])
		if err != nil {
			return n, fmt.Errorf("rewrite war alias %q: %w", a, err)
		}
		c, _ := res.RowsAffected()
		n += int(c)
	}
	if err := tx.Commit(); err != nil {
		return n, fmt.Errorf("commit war aliases: %w", err)
	}
	return n, nil
}
