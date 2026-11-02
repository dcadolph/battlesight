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
)

// WarNames is the wars.json view Cleanse files rows by.
type WarNames struct {
	// Keys holds every canonical war name.
	Keys map[string]bool
	// Aliases maps each alias to its canonical war name.
	Aliases map[string]string
}

// warFromSources returns the war a source states for a row: the first labeled
// entry of the Wikidata conflict facts, else the first link of the infobox
// partof value. List articles are never a war.
func warFromSources(conflict, partof string) string {
	for _, l := range strings.Split(conflict, "|") {
		l = strings.TrimSpace(l)
		if l != "" && !bareQIDRe.MatchString(l) && !strings.HasPrefix(l, "List of") {
			return l
		}
	}
	if m := partofLinkRe.FindStringSubmatch(partof); m != nil {
		t := strings.TrimSpace(strings.ReplaceAll(m[1], "_", " "))
		if t != "" && !strings.HasPrefix(t, "List of") {
			return t
		}
	}
	return ""
}

// fillWarFromWikidata sets the war of each war-less, unverified wikidata row
// from its Wikidata conflict facts or its infobox partof link. Curated and
// verified rows are never touched. A modern war whose region excludes the
// row's point is not filled, the same rule reconcileSourceDates clears by,
// so the two passes never undo each other.
func fillWarFromWikidata(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, wikidata_conflict, infobox_partof, lat, lng FROM battles
		WHERE war = '' AND source = 'wikidata' AND verified = 0
		AND (wikidata_conflict != '' OR infobox_partof != '')`)
	if err != nil {
		return 0, fmt.Errorf("scan war-less rows: %w", err)
	}
	fills := map[string]string{}
	for rows.Next() {
		var id, conflict, partof string
		var lat, lng float64
		if err := rows.Scan(&id, &conflict, &partof, &lat, &lng); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan war-less row: %w", err)
		}
		w := warFromSources(conflict, partof)
		if w == "" || warOutsideRegion(&AuditRow{War: w, Lat: lat, Lng: lng}) {
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

// applyWarAliases rewrites every row filed under a war alias to the canonical
// war name from wars.json.
func applyWarAliases(ctx context.Context, db *sql.DB, aliases map[string]string) (int, error) {
	if len(aliases) == 0 {
		return 0, nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin war alias tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET war = ? WHERE war = ?`)
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
		res, err := stmt.ExecContext(ctx, aliases[a], a)
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
