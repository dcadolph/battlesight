package importer

import (
	"context"
	"fmt"
	"math"
	"path/filepath"
	"slices"
	"sort"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

	"github.com/dcadolph/battlesight/internal/db"
)

func TestDecideCoord(t *testing.T) { //nolint:funlen // Test function.
	t.Parallel()
	land := testLandMask(t)
	wd := func(lat, lng float64) coordPoint { return coordPoint{Lat: lat, Lng: lng, Source: "wikidata"} }
	en := func(lat, lng float64) coordPoint { return coordPoint{Lat: lat, Lng: lng, Source: "enwiki"} }
	fr := func(lat, lng float64) coordPoint { return coordPoint{Lat: lat, Lng: lng, Source: "frwiki"} }
	tests := []struct {
		Lat        float64
		Lng        float64
		Cands      []coordPoint
		Land       bool
		WantAction coordAction
		WantPoint  coordPoint
		WantAgree  int
	}{{ // Test 0: No source keeps the point unsourced.
		Lat: 50, Lng: 10, WantAction: coordKeep,
	}, { // Test 1: Stored point within 50 km of Wikidata is sourced.
		Lat: 50, Lng: 10, Cands: []coordPoint{wd(50.3, 10.2)}, WantAction: coordKeep, WantPoint: wd(50.3, 10.2),
	}, { // Test 2: Wikidata lost its sign but the article agrees with the stored point.
		Lat: 35.18, Lng: -85.17, Cands: []coordPoint{wd(35.045, 85.354), en(35.045, -85.354)},
		WantAction: coordKeep, WantPoint: en(35.045, -85.354),
	}, { // Test 3: Lone Wikidata point far from a stored point on land moves it.
		Lat: 32.4434, Lng: -99.7163, Cands: []coordPoint{wd(45.755, -90.893)},
		WantAction: coordMove, WantPoint: wd(45.755, -90.893), WantAgree: 1,
	}, { // Test 4: Stored point lost its sign and two sources agree.
		Lat: 54.954, Lng: 7.690, Cands: []coordPoint{wd(54.954, -7.690), en(54.95, -7.69)},
		WantAction: coordMove, WantPoint: wd(54.954, -7.690), WantAgree: 2,
	}, { // Test 5: Lone mirrored source moves a stored point in the sea onto land.
		Lat: 54.954, Lng: 7.690, Cands: []coordPoint{wd(54.954, -7.690)}, Land: true,
		WantAction: coordMove, WantPoint: wd(54.954, -7.690), WantAgree: 1,
	}, { // Test 6: Lone mirrored source without a land mask is disputed.
		Lat: 54.954, Lng: 7.690, Cands: []coordPoint{wd(54.954, -7.690)}, WantAction: coordDisputed,
	}, { // Test 7: Lone mirrored source with the stored point on land is disputed.
		Lat: 35.18, Lng: -85.17, Cands: []coordPoint{wd(35.045, 85.354)}, Land: true, WantAction: coordDisputed,
	}, { // Test 8: Swapped axes count as a mirror.
		Lat: 14.568, Lng: 49.769, Cands: []coordPoint{wd(49.769, 14.568)}, Land: true,
		WantAction: coordMove, WantPoint: wd(49.769, 14.568), WantAgree: 1,
	}, { // Test 9: A zero row takes the lone source.
		Cands: []coordPoint{fr(59.7575, 31.0617)}, WantAction: coordMove, WantPoint: fr(59.7575, 31.0617), WantAgree: 1,
	}, { // Test 10: A zero row with two disagreeing sources is disputed.
		Cands: []coordPoint{wd(10, 10), en(40, 40)}, WantAction: coordDisputed,
	}, { // Test 11: The two sources that agree outvote a wrong Wikidata point.
		Cands:      []coordPoint{wd(10, 10), en(50, 10), fr(50.1, 10.1)},
		WantAction: coordMove, WantPoint: en(50, 10), WantAgree: 2,
	}, { // Test 12: A stored point agreeing with a later source is sourced by it.
		Lat: 50.1, Lng: 10.1, Cands: []coordPoint{wd(10, 10), fr(50.1, 10.1)},
		WantAction: coordKeep, WantPoint: fr(50.1, 10.1),
	}, { // Test 13: Just outside 50 km is a disagreement.
		Lat: 50, Lng: 10, Cands: []coordPoint{wd(50.46, 10)}, WantAction: coordMove, WantPoint: wd(50.46, 10),
		WantAgree: 1,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			var m *LandMask
			if test.Land {
				m = land
			}
			got := decideCoord(test.Lat, test.Lng, test.Cands, m)
			if diff := cmp.Diff(test.WantAction, got.Action); diff != "" {
				t.Errorf("action mismatch (-want +got):\n%s\nreason: %s", diff, got.Reason)
			}
			if diff := cmp.Diff(test.WantPoint, got.Point); diff != "" {
				t.Errorf("point mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantAgree, got.Agree); diff != "" {
				t.Errorf("agree mismatch (-want +got):\n%s", diff)
			}
			if (got.Action == coordDisputed) != (got.Reason != "") {
				t.Errorf("reason %q does not match action %d", got.Reason, got.Action)
			}
		})
	}
}

func TestWikipediaLang(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		WantResult string
		WantOK     bool
	}{{ // Test 0: French Wikipedia.
		In: "https://fr.wikipedia.org/", WantResult: "fr", WantOK: true,
	}, { // Test 1: Hyphenated language code.
		In: "https://zh-yue.wikipedia.org/", WantResult: "zh-yue", WantOK: true,
	}, { // Test 2: Commons is not a Wikipedia.
		In: "https://commons.wikimedia.org/", WantResult: "", WantOK: false,
	}, { // Test 3: Wikisource is not a Wikipedia.
		In: "https://en.wikisource.org/", WantResult: "", WantOK: false,
	}, { // Test 4: Simple English counts.
		In: "https://simple.wikipedia.org/", WantResult: "simple", WantOK: true,
	}, { // Test 5: Bare host has no language.
		In: "https://wikipedia.org/", WantResult: "", WantOK: false,
	}, { // Test 6: Plain http is not a sitelink base.
		In: "http://fr.wikipedia.org/", WantResult: "", WantOK: false,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got, ok := wikipediaLang(test.In)
			if diff := cmp.Diff(test.WantOK, ok); diff != "" {
				t.Errorf("ok mismatch (-want +got):\n%s", diff)
			}
			if ok {
				if diff := cmp.Diff(test.WantResult, got); diff != "" {
					t.Errorf("mismatch (-want +got):\n%s", diff)
				}
			}
		})
	}
}

func TestCoordFactsFromRows(t *testing.T) {
	t.Parallel()
	const (
		earth     = "http://www.wikidata.org/entity/Q2"
		moon      = "http://www.wikidata.org/entity/Q405"
		normal    = "http://wikiba.se/ontology#NormalRank"
		preferred = "http://wikiba.se/ontology#PreferredRank"
	)
	point := func(item, lat, lng, globe, rank string) coordSPARQLRow {
		return coordSPARQLRow{Item: sparqlValue{item}, Lat: sparqlValue{lat}, Lng: sparqlValue{lng},
			Globe: sparqlValue{globe}, Rank: sparqlValue{rank}}
	}
	link := func(item, site, title string) coordSPARQLRow {
		return coordSPARQLRow{Item: sparqlValue{item}, Site: sparqlValue{site}, Title: sparqlValue{title}}
	}
	const a, b, c = "http://www.wikidata.org/entity/Q1", "http://www.wikidata.org/entity/Q2", "Q3"
	rows := []coordSPARQLRow{
		point(a, "1", "2", earth, normal),
		point(a, "3", "4", earth, preferred),
		point(a, "7", "8", moon, normal),
		point(a, "91", "0", earth, normal),
		point(a, "x", "0", earth, normal),
		point(a, "5", "6", "", normal),
		link(a, "https://en.wikipedia.org/", "Battle of A"),
		link(a, "https://fr.wikipedia.org/", "Bataille de A"),
		link(a, "https://commons.wikimedia.org/", "Category:A"),
		link(b, "https://de.wikipedia.org/", "Schlacht bei B"),
		point(c, "1", "1", earth, normal),
	}
	want := map[string]wikidataCoordFacts{
		"Q1": {
			P625:      [][2]float64{{3, 4}, {1, 2}, {5, 6}},
			Sitelinks: map[string]string{"en": "Battle of A", "fr": "Bataille de A"},
		},
		"Q2": {Sitelinks: map[string]string{"de": "Schlacht bei B"}},
	}
	if diff := cmp.Diff(want, coordFactsFromRows(rows)); diff != "" {
		t.Errorf("mismatch (-want +got):\n%s", diff)
	}
}

func TestIsNavalClass(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		WantResult bool
	}{{ // Test 0: Naval battle beside battle.
		In: "battle|naval battle", WantResult: true,
	}, { // Test 1: Plain battle.
		In: "battle", WantResult: false,
	}, { // Test 2: A longer label containing the words is not the class.
		In: "naval battle of the Spanish Armada campaign", WantResult: false,
	}, { // Test 3: Empty.
		In: "", WantResult: false,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, isNavalClass(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// testCoordLookup serves fixed sources and records what was asked.
type testCoordLookup struct {
	// Facts holds the Wikidata answer per Q-id.
	Facts map[string]wikidataCoordFacts
	// Articles holds the article coordinate per language and title.
	Articles map[string]map[string]coordPoint
	// AskedQIDs records every Q-id requested.
	AskedQIDs []string
	// AskedTitles records every lang:title requested.
	AskedTitles []string
}

// wikidataCoords returns the fixed facts for the requested Q-ids.
func (l *testCoordLookup) wikidataCoords(_ context.Context, qids []string) (map[string]wikidataCoordFacts, error) {
	l.AskedQIDs = append(l.AskedQIDs, qids...)
	out := map[string]wikidataCoordFacts{}
	for _, q := range qids {
		if f, ok := l.Facts[q]; ok {
			out[q] = f
		}
	}
	return out, nil
}

// articleCoords returns the fixed article points for the requested titles.
func (l *testCoordLookup) articleCoords(_ context.Context, lang string, titles []string) (map[string]coordPoint,
	error) {
	out := map[string]coordPoint{}
	for _, t := range titles {
		l.AskedTitles = append(l.AskedTitles, lang+":"+t)
		if p, ok := l.Articles[lang][t]; ok {
			out[t] = p
		}
	}
	return out, nil
}

// TestCoordsFromSource runs the stage on a temp db. Hand-placed, verified and
// curated rows are never read or written.
func TestCoordsFromSource(t *testing.T) { //nolint:funlen // Test function.
	t.Parallel()
	ctx := context.Background()
	conn, err := db.Open(filepath.Join(t.TempDir(), "coords.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer conn.Close()
	insert := `INSERT INTO battles (id, name, year, date, date_start, date_end, lat, lng, era, war, battle_type,
		victor, summary, significance, source, source_id, verified, wikipedia_title, wikidata_instance_of)
		VALUES (?, ?, 1800, '1800', '1800-01-01', '1800-12-31', ?, ?, 'napoleonic', '', ?, '', '', '', ?, ?, ?, ?, ?)`
	rows := [][]any{
		{"courland-pocket", "Courland Pocket", 10.0, 10.0, "land", "wikidata", "Q1", 0, "Courland Pocket", "battle"},
		{"verified", "Battle of Verified", 10.0, 10.0, "land", "wikidata", "Q2", 1, "Battle of Verified", "battle"},
		{"curated", "Battle of Curated", 10.0, 10.0, "land", "curated", "", 0, "Battle of Curated", "battle"},
		{"zero", "Battle of Zero", 0.0, 0.0, "land", "wikidata", "Q4", 0, "Battle of Zero", "battle"},
		{"browns", "Battle of Browns", 35.18, -85.17, "land", "wikidata", "Q5", 0, "Battle of Browns", "battle"},
		{"cameron", "Battle of Cameron", 32.4434, -99.7163, "land", "wikidata", "Q6", 0, "Battle of Cameron", "battle"},
		{"agrees", "Battle of Agrees", 50.0, 10.0, "land", "wikidata", "Q7", 0, "Battle of Agrees", "battle"},
		{"none", "Battle of None", 0.0, 0.0, "land", "wikidata", "Q8", 0, "", "battle"},
		{"naval", "Battle of Naval", 50.0, 10.0, "land", "wikidata", "Q9", 0, "", "battle|naval battle"},
		{"siege", "Siege of Naval", 50.0, 10.0, "siege", "wikidata", "Q10", 0, "", "siege|naval battle"},
		{"lang", "Battle of Lang", 0.0, 0.0, "land", "wikidata", "Q11", 0, "", "battle"},
	}
	for _, r := range rows {
		if _, err := conn.ExecContext(ctx, insert, r...); err != nil {
			t.Fatalf("insert %v: %v", r[0], err)
		}
	}
	far := wikidataCoordFacts{P625: [][2]float64{{-40, -40}}}
	lookup := &testCoordLookup{
		Facts: map[string]wikidataCoordFacts{
			"Q1": far, "Q2": far, "Q4": {P625: [][2]float64{{48.3, 38.05}}},
			"Q5":  {P625: [][2]float64{{35.045, 85.354}}},
			"Q6":  {P625: [][2]float64{{45.755, -90.893}}},
			"Q7":  {P625: [][2]float64{{50.01, 10.01}}},
			"Q9":  {P625: [][2]float64{{50, 10}}},
			"Q10": {P625: [][2]float64{{50, 10}}},
			"Q11": {Sitelinks: map[string]string{"fr": "Bataille de Lang", "de": "Schlacht bei Lang"}},
		},
		Articles: map[string]map[string]coordPoint{
			"en": {"Battle of Browns": {Lat: 35.045, Lng: -85.354, Source: "enwiki"}},
			"fr": {"Bataille de Lang": {Lat: 59.7575, Lng: 31.0617, Source: "frwiki"}},
		},
	}
	rep, err := coordsFromSource(ctx, conn, lookup, testLandMask(t))
	if err != nil {
		t.Fatalf("stage: %v", err)
	}

	type got struct {
		Lat, Lng           float64
		Type, Src, Checked string
	}
	want := map[string]got{
		"courland-pocket": {10, 10, "land", "", ""},
		"verified":        {10, 10, "land", "", ""},
		"curated":         {10, 10, "land", "", ""},
		"zero":            {48.3, 38.05, "land", "wikidata", "x"},
		"browns":          {35.18, -85.17, "land", "enwiki", "x"},
		"cameron":         {45.755, -90.893, "land", "wikidata", "x"},
		"agrees":          {50, 10, "land", "wikidata", "x"},
		"none":            {0, 0, "land", "", "x"},
		"naval":           {50, 10, "naval", "wikidata", "x"},
		"siege":           {50, 10, "siege", "wikidata", "x"},
		"lang":            {59.7575, 31.0617, "land", "frwiki", "x"},
	}
	res, err := conn.QueryContext(ctx, `SELECT id, lat, lng, battle_type, coord_source, coord_checked FROM battles`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer res.Close()
	gotRows := map[string]got{}
	for res.Next() {
		var id string
		var g got
		if err := res.Scan(&id, &g.Lat, &g.Lng, &g.Type, &g.Src, &g.Checked); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if g.Checked != "" {
			g.Checked = "x"
		}
		gotRows[id] = g
	}
	if diff := cmp.Diff(want, gotRows); diff != "" {
		t.Errorf("rows mismatch (-want +got):\n%s", diff)
	}

	if slices.Contains(lookup.AskedQIDs, "Q1") || slices.Contains(lookup.AskedQIDs, "Q2") {
		t.Errorf("hand-placed or verified Q-id was looked up: %v", lookup.AskedQIDs)
	}
	sort.Strings(lookup.AskedTitles)
	wantTitles := []string{"de:Schlacht bei Lang", "en:Battle of Browns", "en:Battle of Cameron",
		"en:Battle of Zero", "fr:Bataille de Lang"}
	if diff := cmp.Diff(wantTitles, lookup.AskedTitles); diff != "" {
		t.Errorf("article lookups mismatch (-want +got):\n%s", diff)
	}

	var moved []string
	for _, m := range rep.Moves {
		moved = append(moved, m.ID)
	}
	if diff := cmp.Diff([]string{"cameron", "lang", "zero"}, moved, cmpopts.EquateEmpty()); diff != "" {
		t.Errorf("moves mismatch (-want +got):\n%s", diff)
	}
	if rep.Moves[0].KM < 1000 || rep.Moves[1].KM != 0 || math.IsNaN(rep.Moves[0].KM) {
		t.Errorf("move distances wrong: %+v", rep.Moves)
	}
	wantRep := CoordReport{Rows: 8, Sourced: 4, Unsourced: 1, ZeroUnsourced: 1, Naval: 1}
	rep.Moves = nil
	if diff := cmp.Diff(wantRep, rep, cmpopts.EquateEmpty()); diff != "" {
		t.Errorf("report mismatch (-want +got):\n%s", diff)
	}

	again, err := coordsFromSource(ctx, conn, &testCoordLookup{Facts: lookup.Facts, Articles: lookup.Articles},
		testLandMask(t))
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if len(again.Moves) != 0 || again.Naval != 0 {
		t.Errorf("second run is not a no-op: %d moves, %d naval", len(again.Moves), again.Naval)
	}
}
