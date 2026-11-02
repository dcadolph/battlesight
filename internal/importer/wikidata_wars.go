package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"slices"
	"strings"
)

const (
	// wikidataWarsNamespace caches the P607 and P361 targets per battle Q-id.
	wikidataWarsNamespace = "wikidata-wars"
	// wikidataWarTargetsNamespace caches the English label and class labels per target Q-id.
	wikidataWarTargetsNamespace = "wikidata-war-targets"
	// wikidataWarsBatch is the number of Q-ids per SPARQL VALUES query.
	wikidataWarsBatch = 200
)

var (
	// warClassRe matches a P31 class label that makes a P361 target a war.
	warClassRe = regexp.MustCompile(`(?i)\b(wars?|conflict|campaign|conquest|invasion|revolt|rebellion|uprising|` +
		`insurgency|revolution|offensive|operation|expedition|raid|crisis|intervention|front)\b`)
	// notWarClassRe matches a P31 class label that rules a P361 target out.
	notWarClassRe = regexp.MustCompile(`(?i)\b(battle|siege|list|region)\b`)
)

// wikidataWarLinks is what Wikidata says a battle is part of, as cached on disk.
type wikidataWarLinks struct {
	// Conflicts holds the P607 Q-ids.
	Conflicts []string `json:"p607,omitempty"`
	// PartOf holds the P361 Q-ids.
	PartOf []string `json:"p361,omitempty"`
}

// wikidataWarTarget is one P607 or P361 target, as cached on disk.
type wikidataWarTarget struct {
	// Label is the English label.
	Label string `json:"label,omitempty"`
	// Classes holds the English labels of the target's P31 classes.
	Classes []string `json:"classes,omitempty"`
}

// warLinksRow is one result row of the links query.
type warLinksRow struct {
	// Item is the battle entity URI.
	Item sparqlValue `json:"item"`
	// P607 is a conflict entity URI.
	P607 sparqlValue `json:"p607"`
	// P361 is a part-of entity URI.
	P361 sparqlValue `json:"p361"`
}

// warTargetRow is one result row of the target query.
type warTargetRow struct {
	// Target is the target entity URI.
	Target sparqlValue `json:"t"`
	// Label is the English label.
	Label sparqlValue `json:"tLabel"`
	// Class is the English label of one P31 class.
	Class sparqlValue `json:"cLabel"`
}

// WikidataWarsReport summarizes one -wikidata-wars run.
type WikidataWarsReport struct {
	// Rows is the number of war-less rows checked.
	Rows int
	// FromConflict is the number of rows given a P607 conflict.
	FromConflict int
	// FromPartOf is the number of rows given a war-class P361 target.
	FromPartOf int
	// None is the number of rows Wikidata names no war for.
	None int
}

// WikidataWars stores, for every war-less unverified wikidata row, the war
// Wikidata names for it in wikidata_conflict: the P607 conflicts, else the P361
// targets whose class is a war, campaign or similar. Cleanse then files the
// row under that war. Responses are cached per Q-id, so a stopped run resumes.
func WikidataWars(ctx context.Context, db *sql.DB) (WikidataWarsReport, error) {
	var rep WikidataWarsReport
	byQID, qids, err := warLessRows(ctx, db)
	if err != nil {
		return rep, err
	}
	log.Printf("wikidata-wars: %d Q-ids to check", len(qids))
	for start := 0; start < len(qids); start += wikidataWarsBatch {
		batch := qids[start:min(start+wikidataWarsBatch, len(qids))]
		links, err := warLinksFor(ctx, batch)
		if err != nil {
			return rep, fmt.Errorf("links batch at %d: %w", start, err)
		}
		var targets []string
		for _, q := range batch {
			targets = append(targets, links[q].Conflicts...)
			targets = append(targets, links[q].PartOf...)
		}
		meta, err := warTargetsFor(ctx, targets)
		if err != nil {
			return rep, fmt.Errorf("targets batch at %d: %w", start, err)
		}
		if err := writeWarLinks(ctx, db, batch, byQID, links, meta, &rep); err != nil {
			return rep, err
		}
		log.Printf("wikidata-wars: %d/%d Q-ids", min(start+wikidataWarsBatch, len(qids)), len(qids))
	}
	return rep, nil
}

// warLessRows returns the war-less unverified wikidata rows by Q-id.
func warLessRows(ctx context.Context, db *sql.DB) (map[string][]string, []string, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, source_id FROM battles WHERE war = '' AND source = 'wikidata'
		AND verified = 0 AND source_id LIKE 'Q%' ORDER BY id`)
	if err != nil {
		return nil, nil, fmt.Errorf("query war-less rows: %w", err)
	}
	defer rows.Close()
	byQID := map[string][]string{}
	var qids []string
	for rows.Next() {
		var id, q string
		if err := rows.Scan(&id, &q); err != nil {
			return nil, nil, fmt.Errorf("scan war-less row: %w", err)
		}
		if _, ok := byQID[q]; !ok {
			qids = append(qids, q)
		}
		byQID[q] = append(byQID[q], id)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate war-less rows: %w", err)
	}
	return byQID, qids, nil
}

// chooseWar returns the labels of the war targets for one battle: every P607
// conflict, else the P361 targets with a war class and no ruled-out class.
func chooseWar(l wikidataWarLinks, meta map[string]wikidataWarTarget) ([]string, bool) {
	var out []string
	for _, q := range l.Conflicts {
		if lab := meta[q].Label; lab != "" {
			out = append(out, lab)
		}
	}
	if len(out) > 0 {
		return out, true
	}
	for _, q := range l.PartOf {
		t := meta[q]
		if t.Label == "" || !isWarClass(t.Classes) {
			continue
		}
		out = append(out, t.Label)
	}
	return out, false
}

// isWarClass reports whether the class labels make a target a war.
func isWarClass(classes []string) bool {
	var war bool
	for _, c := range classes {
		if notWarClassRe.MatchString(c) {
			return false
		}
		if warClassRe.MatchString(c) {
			war = true
		}
	}
	return war
}

// writeWarLinks stores one batch of chosen wars in one transaction.
func writeWarLinks(ctx context.Context, db *sql.DB, batch []string, byQID map[string][]string,
	links map[string]wikidataWarLinks, meta map[string]wikidataWarTarget, rep *WikidataWarsReport) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin war links tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE battles SET wikidata_conflict = ? WHERE id = ? AND war = ''`)
	if err != nil {
		return fmt.Errorf("prepare war links update: %w", err)
	}
	defer stmt.Close()
	for _, q := range batch {
		wars, fromConflict := chooseWar(links[q], meta)
		for _, id := range byQID[q] {
			rep.Rows++
			switch {
			case len(wars) == 0:
				rep.None++
				continue
			case fromConflict:
				rep.FromConflict++
			default:
				rep.FromPartOf++
			}
			if _, err := stmt.ExecContext(ctx, strings.Join(wars, "|"), id); err != nil {
				return fmt.Errorf("update war links for %s: %w", id, err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit war links: %w", err)
	}
	return nil
}

// warLinksFor returns the P607 and P361 targets per Q-id, from the cache when present.
func warLinksFor(ctx context.Context, qids []string) (map[string]wikidataWarLinks, error) {
	out := map[string]wikidataWarLinks{}
	var need []string
	for _, q := range qids {
		if s, ok := wikiCacheGet(wikidataWarsNamespace, q); ok {
			var l wikidataWarLinks
			if err := json.Unmarshal([]byte(s), &l); err == nil {
				out[q] = l
				continue
			}
		}
		need = append(need, q)
	}
	if len(need) == 0 {
		return out, nil
	}
	query := fmt.Sprintf(`SELECT ?item ?p607 ?p361 WHERE { VALUES ?item { %s }
		OPTIONAL { ?item wdt:P607 ?p607 } OPTIONAL { ?item wdt:P361 ?p361 } }`, entityValues(need))
	rows, err := patientSPARQL[warLinksRow](ctx, "wikidata-wars", query)
	if err != nil {
		return nil, err
	}
	fresh := map[string]wikidataWarLinks{}
	for _, r := range rows {
		q := entityID(r.Item.Value)
		l := fresh[q]
		if p := entityID(r.P607.Value); p != "" && !slices.Contains(l.Conflicts, p) {
			l.Conflicts = append(l.Conflicts, p)
		}
		if p := entityID(r.P361.Value); p != "" && !slices.Contains(l.PartOf, p) {
			l.PartOf = append(l.PartOf, p)
		}
		fresh[q] = l
	}
	for _, q := range need {
		l := fresh[q]
		out[q] = l
		b, _ := json.Marshal(l)
		wikiCacheSet(wikidataWarsNamespace, q, string(b))
	}
	return out, nil
}

// warTargetsFor returns the label and class labels per target Q-id, from the cache when present.
func warTargetsFor(ctx context.Context, qids []string) (map[string]wikidataWarTarget, error) {
	out := map[string]wikidataWarTarget{}
	var need []string
	for _, q := range qids {
		if _, done := out[q]; done || slices.Contains(need, q) {
			continue
		}
		if s, ok := wikiCacheGet(wikidataWarTargetsNamespace, q); ok {
			var t wikidataWarTarget
			if err := json.Unmarshal([]byte(s), &t); err == nil {
				out[q] = t
				continue
			}
		}
		need = append(need, q)
	}
	for start := 0; start < len(need); start += wikidataWarsBatch {
		batch := need[start:min(start+wikidataWarsBatch, len(need))]
		query := fmt.Sprintf(`SELECT ?t ?tLabel ?cLabel WHERE { VALUES ?t { %s }
			OPTIONAL { ?t rdfs:label ?tLabel FILTER(LANG(?tLabel) = "en") }
			OPTIONAL { ?t wdt:P31 ?c . ?c rdfs:label ?cLabel FILTER(LANG(?cLabel) = "en") } }`, entityValues(batch))
		rows, err := patientSPARQL[warTargetRow](ctx, "wikidata-wars", query)
		if err != nil {
			return nil, err
		}
		fresh := map[string]wikidataWarTarget{}
		for _, r := range rows {
			q := entityID(r.Target.Value)
			t := fresh[q]
			if t.Label == "" {
				t.Label = r.Label.Value
			}
			if c := r.Class.Value; c != "" && !slices.Contains(t.Classes, c) {
				t.Classes = append(t.Classes, c)
			}
			fresh[q] = t
		}
		for _, q := range batch {
			t := fresh[q]
			out[q] = t
			b, _ := json.Marshal(t)
			wikiCacheSet(wikidataWarTargetsNamespace, q, string(b))
		}
	}
	return out, nil
}

// patientSPARQL runs a query and retries a busy query service once after a
// pause. stage names the caller in the log line.
func patientSPARQL[T any](ctx context.Context, stage, query string) ([]T, error) {
	rows, err := fetchSPARQL[T](ctx, query)
	if !errors.Is(err, ErrSPARQLBusy) {
		return rows, err
	}
	log.Printf("%s: query service busy, waiting %s for one retry", stage, sparqlBusyPause)
	if err := sleepCtx(ctx, sparqlBusyPause); err != nil {
		return nil, err
	}
	return fetchSPARQL[T](ctx, query)
}

// entityValues renders Q-ids as a SPARQL VALUES list.
func entityValues(qids []string) string {
	vals := make([]string, len(qids))
	for i, q := range qids {
		vals[i] = "wd:" + q
	}
	return strings.Join(vals, " ")
}

// entityID returns the Q-id of a Wikidata entity URI, or "".
func entityID(uri string) string {
	q, ok := strings.CutPrefix(uri, wikidataEntityPrefix)
	if !ok || !strings.HasPrefix(q, "Q") {
		return ""
	}
	return q
}
