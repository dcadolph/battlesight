package importer

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

	"github.com/dcadolph/battlesight/internal/battles"
	"github.com/dcadolph/battlesight/internal/db"
)

// testAuditRow returns a row that passes every mismatch class.
func testAuditRow(id string) AuditRow {
	return AuditRow{
		ID: id, Name: "Battle of " + id, Year: 1863, Date: "1–3 July 1863",
		DateStart: "1863-07-01", DateEnd: "1863-07-03", Lat: 39.81, Lng: -77.23,
		Era: yearToEra(1863), War: "American Civil War", BattleType: "land", Victor: "Union victory",
		Summary: "A battle.", Source: "wikidata", WikipediaTitle: "Battle of " + id, Documented: true,
	}
}

// testAuditSide returns one clean side for the battle id.
func testAuditSide(id string) AuditSide {
	return AuditSide{BattleID: id, Name: "United States", Commander: "George Meade"}
}

// TestMismatchesClean pins that a clean row lands in no class and that the
// classes needing later columns report n/a.
func TestMismatchesClean(t *testing.T) {
	t.Parallel()
	in := AuditInput{Rows: []AuditRow{testAuditRow("a")}, Sides: []AuditSide{testAuditSide("a")},
		Land: testLandMask(t), ReplayIDs: []string{"a"}, ReferenceIDs: []string{"a"}}
	var gotNA []string
	for _, c := range Mismatches(in) {
		if c.NA != "" {
			gotNA = append(gotNA, c.Key)
			continue
		}
		if len(c.IDs) != 0 {
			t.Errorf("class %s flagged a clean row: %v", c.Key, c.IDs)
		}
	}
	if diff := cmp.Diff([]string{"year-vs-wikidata", "non-battle"}, gotNA); diff != "" {
		t.Errorf("n/a mismatch (-want +got):\n%s", diff)
	}
}

// TestMismatches pins each class against a row built to trip it.
func TestMismatches(t *testing.T) { //nolint:funlen // Test function.
	t.Parallel()
	land := testLandMask(t)
	tests := []struct {
		Name     string
		Key      string
		Mutate   func(r *AuditRow)
		In       func(in *AuditInput)
		WantIDs  []string
		WantNA   bool
		WithLand bool
	}{{ // Test 0: En-dash ISO day form.
		Name: "endash day", Key: "endash-iso-date",
		Mutate: func(r *AuditRow) { r.Date = "1863 – 07 – 01" }, WantIDs: []string{"x"},
	}, { // Test 1: En-dash ISO month form.
		Name: "endash month", Key: "endash-iso-month",
		Mutate: func(r *AuditRow) { r.Date = "1863 – 07" }, WantIDs: []string{"x"},
	}, { // Test 2: A prose range with en dashes is not an ISO mangling.
		Name: "prose range", Key: "endash-iso-date",
		Mutate: func(r *AuditRow) { r.Date = "1863 – 1865" }, WantIDs: nil,
	}, { // Test 3: Year disagrees with date_start.
		Name: "year date start", Key: "year-date-start",
		Mutate: func(r *AuditRow) { r.Year = 1864; r.Era = yearToEra(1864) }, WantIDs: []string{"x"},
	}, { // Test 4: BC date_start agrees with a negative year.
		Name: "bc agrees", Key: "year-date-start",
		Mutate: func(r *AuditRow) {
			r.Year, r.DateStart, r.DateEnd, r.Era = -490, "-0490-09-12", "-0490-09-12", yearToEra(-490)
		}, WantIDs: nil,
	}, { // Test 5: Non-ISO date_start.
		Name: "bad iso", Key: "bad-iso-date",
		Mutate: func(r *AuditRow) { r.DateStart = "1863-7-1" }, WantIDs: []string{"x"},
	}, { // Test 6: End before start.
		Name: "inversion", Key: "date-inversion",
		Mutate: func(r *AuditRow) { r.DateEnd = "1863-06-30" }, WantIDs: []string{"x"},
	}, { // Test 7: BC end after start is not an inversion.
		Name: "bc no inversion", Key: "date-inversion",
		Mutate: func(r *AuditRow) { r.DateStart, r.DateEnd = "-0491-01-01", "-0490-01-01" }, WantIDs: nil,
	}, { // Test 8: Placeholder date.
		Name: "date zero", Key: "date-zero", Mutate: func(r *AuditRow) { r.Date = "0" }, WantIDs: []string{"x"},
	}, { // Test 9: Empty date.
		Name: "date empty", Key: "date-empty", Mutate: func(r *AuditRow) { r.Date = "" }, WantIDs: []string{"x"},
	}, { // Test 10: Year zero.
		Name: "year zero", Key: "year-zero",
		Mutate: func(r *AuditRow) { r.Year, r.DateStart, r.DateEnd = 0, "", "" }, WantIDs: []string{"x"},
	}, { // Test 11: Era outside the taxonomy.
		Name: "era invalid", Key: "era-invalid", Mutate: func(r *AuditRow) { r.Era = "victorian" }, WantIDs: []string{"x"},
	}, { // Test 12: Era disagrees with year.
		Name: "era year", Key: "era-year", Mutate: func(r *AuditRow) { r.Era = "medieval" }, WantIDs: []string{"x"},
	}, { // Test 13: Year disagrees with the Wikidata date.
		Name: "year vs wikidata", Key: "year-vs-wikidata",
		Mutate: func(r *AuditRow) { r.WikidataDate = "1937-06-04" },
		In:     func(in *AuditInput) { in.HasWikidataDate = true }, WantIDs: []string{"x"},
	}, { // Test 14: A verified row is exempt from the Wikidata check.
		Name: "verified exempt", Key: "year-vs-wikidata",
		Mutate: func(r *AuditRow) { r.WikidataDate = "1937-06-04"; r.Verified = true },
		In:     func(in *AuditInput) { in.HasWikidataDate = true }, WantIDs: nil,
	}, { // Test 15: A date string naming the stored year passes the Wikidata check.
		Name: "range names year", Key: "year-vs-wikidata",
		Mutate: func(r *AuditRow) { r.WikidataDate = "1862-12-01"; r.Date = "December 1862 – July 1863" },
		In:     func(in *AuditInput) { in.HasWikidataDate = true }, WantIDs: nil,
	}, { // Test 16: Without the column the class is n/a.
		Name: "wikidata na", Key: "year-vs-wikidata", WantNA: true,
	}, { // Test 17: Year-enrich title with no Wikidata date.
		Name: "year enrich", Key: "year-enrich-unreconciled",
		In: func(in *AuditInput) { in.YearEnrichTitles = []string{"battle of x"} }, WantIDs: []string{"x"},
	}, { // Test 18: Year-enrich title that agrees with Wikidata is reconciled.
		Name: "year enrich reconciled", Key: "year-enrich-unreconciled",
		Mutate: func(r *AuditRow) { r.WikidataDate = "1863-07-01" },
		In: func(in *AuditInput) {
			in.YearEnrichTitles, in.HasWikidataDate = []string{"Battle of x"}, true
		}, WantIDs: nil,
	}, { // Test 19: Zero coordinates.
		Name: "coords zero", Key: "coords-zero", Mutate: func(r *AuditRow) { r.Lat, r.Lng = 0, 0 }, WantIDs: []string{"x"},
	}, { // Test 20: Out-of-range coordinates.
		Name: "coords range", Key: "coords-range", Mutate: func(r *AuditRow) { r.Lng = 181 }, WantIDs: []string{"x"},
	}, { // Test 21: Land battle in the Atlantic.
		Name: "land in ocean", Key: "land-in-ocean", WithLand: true,
		Mutate: func(r *AuditRow) { r.Lat, r.Lng = 0, -30 }, WantIDs: []string{"x"},
	}, { // Test 22: Naval battle in the Atlantic is fine.
		Name: "naval at sea", Key: "land-in-ocean", WithLand: true,
		Mutate: func(r *AuditRow) { r.Lat, r.Lng, r.BattleType = 0, -30, "naval" }, WantIDs: nil,
	}, { // Test 23: Water word in the name skips the land check.
		Name: "water name", Key: "land-in-ocean", WithLand: true,
		Mutate: func(r *AuditRow) { r.Lat, r.Lng, r.Name = 0, -30, "Battle of the Atlantic Convoy" }, WantIDs: nil,
	}, { // Test 24: Lapland battle north of 65 N is on land.
		Name: "lapland", Key: "land-in-ocean", WithLand: true,
		Mutate: func(r *AuditRow) { r.Lat, r.Lng = 66.5, 25.73 }, WantIDs: nil,
	}, { // Test 25: Without a mask the class is n/a.
		Name: "land na", Key: "land-in-ocean", WantNA: true,
	}, { // Test 26: Ukraine war row in the Korean peninsula.
		Name: "war outside region", Key: "war-outside-region",
		Mutate: func(r *AuditRow) { r.War, r.Lat, r.Lng = "Russo-Ukrainian War", 41.0, 127.0 }, WantIDs: []string{"x"},
	}, { // Test 27: Ukraine war row in Donetsk.
		Name: "war inside region", Key: "war-outside-region",
		Mutate: func(r *AuditRow) { r.War, r.Lat, r.Lng = "Russo-Ukrainian War", 48.0, 37.8 }, WantIDs: nil,
	}, { // Test 28: Empty war.
		Name: "war empty", Key: "war-empty", Mutate: func(r *AuditRow) { r.War = "" }, WantIDs: []string{"x"},
	}, { // Test 29: Non-canonical family spelling.
		Name: "war family", Key: "war-family-variant",
		Mutate: func(r *AuditRow) { r.War = "Russia-Ukraine War" }, WantIDs: []string{"x"},
	}, { // Test 30: Allowed child war in the family.
		Name: "war family child", Key: "war-family-variant",
		Mutate: func(r *AuditRow) { r.War = "Russian invasion of Ukraine" }, WantIDs: nil,
	}, { // Test 31: Minority spelling of a canonWarKey group.
		Name: "war spelling", Key: "war-spelling-variant",
		Mutate: func(r *AuditRow) { r.War = "Pacific Theatre of the Second World War" },
		In: func(in *AuditInput) {
			for _, id := range []string{"y", "z"} {
				r := testAuditRow(id)
				r.War = "Pacific Theater of World War II"
				in.Rows = append(in.Rows, r)
				in.Sides = append(in.Sides, testAuditSide(id))
			}
		}, WantIDs: []string{"x"},
	}, { // Test 32: Wiki markup in the victor.
		Name: "garbage", Key: "garbage-text", Mutate: func(r *AuditRow) { r.Victor = "Union [[victory" }, WantIDs: []string{"x"},
	}, { // Test 33: Replacement glyph in the summary.
		Name: "bad unicode", Key: "bad-unicode", Mutate: func(r *AuditRow) { r.Summary = "A b�ttle." },
		WantIDs: []string{"x"},
	}, { // Test 34: Empty victor.
		Name: "victor empty", Key: "victor-empty", Mutate: func(r *AuditRow) { r.Victor = "" }, WantIDs: []string{"x"},
	}, { // Test 35: No sides.
		Name: "no sides", Key: "no-sides", In: func(in *AuditInput) { in.Sides = nil }, WantIDs: []string{"x"},
	}, { // Test 36: Blank side name.
		Name: "side bad name", Key: "side-bad-name",
		In:      func(in *AuditInput) { in.Sides = append(in.Sides, AuditSide{BattleID: "x", Name: " "}) },
		WantIDs: []string{"x"},
	}, { // Test 37: Side row with no battle.
		Name: "side orphan", Key: "side-orphan",
		In: func(in *AuditInput) {
			in.Sides = append(in.Sides, testAuditSide("ghost"), testAuditSide("ghost"))
		}, WantIDs: []string{"ghost"},
	}, { // Test 38: Two rows share a Wikipedia title.
		Name: "dup title", Key: "dup-wikipedia-title",
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.WikipediaTitle, r.Lat, r.Lng = "Battle of x", 10, 10
			in.Rows = append(in.Rows, r)
		}, WantIDs: []string{"x", "y"},
	}, { // Test 39: Same year, 1 km apart, same significant name, one row with no article.
		Name: "near duplicate", Key: "near-duplicate",
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Name, r.Lat, r.WikipediaTitle = "Siege of x", r.Lat+0.009, ""
			in.Rows = append(in.Rows, r)
		}, WantIDs: []string{"x", "y"},
	}, { // Test 40: Same place and name in another year is not a duplicate.
		Name: "near duplicate other year", Key: "near-duplicate",
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Name, r.Year, r.DateStart, r.DateEnd, r.Era = "Siege of x", 1864, "1864-07-01", "1864-07-03",
				yearToEra(1864)
			in.Rows = append(in.Rows, r)
		}, WantIDs: nil,
	}, { // Test 41: Mythological P31.
		Name: "non battle", Key: "non-battle",
		Mutate: func(r *AuditRow) { r.InstanceOf = "theomachy|mythological battle" },
		In:     func(in *AuditInput) { in.HasInstanceOf = true }, WantIDs: []string{"x"},
	}, { // Test 42: Battle P31.
		Name: "battle class", Key: "non-battle",
		Mutate: func(r *AuditRow) { r.InstanceOf = "battle" },
		In:     func(in *AuditInput) { in.HasInstanceOf = true }, WantIDs: nil,
	}, { // Test 43: Without the column the class is n/a.
		Name: "non battle na", Key: "non-battle", WantNA: true,
	}, { // Test 44: Indexed tier.
		Name: "indexed", Key: "indexed-tier", Mutate: func(r *AuditRow) { r.Documented = false }, WantIDs: []string{"x"},
	}, { // Test 45: Year and date both rewritten from a maintenance template still disagree with Wikidata.
		Name: "template poisoned", Key: "year-vs-wikidata",
		Mutate: func(r *AuditRow) {
			r.Year, r.Date, r.DateStart, r.DateEnd, r.Era = 2026, "March 2026", "2026-03-01", "2026-03-31",
				yearToEra(2026)
			r.WikidataDate = "1937-06-04"
		},
		In: func(in *AuditInput) { in.HasWikidataDate = true }, WantIDs: []string{"x"},
	}, { // Test 46: Year missing from an unambiguous prose date.
		Name: "year date prose", Key: "year-date-prose",
		Mutate: func(r *AuditRow) { r.Date = "1–3 July 1864" }, WantIDs: []string{"x"},
	}, { // Test 47: Year inside a prose range passes.
		Name: "year inside range", Key: "year-date-prose",
		Mutate: func(r *AuditRow) { r.Date = "1861–1865" }, WantIDs: nil,
	}, { // Test 48: Ambiguous prose is left alone.
		Name: "ambiguous prose", Key: "year-date-prose",
		Mutate: func(r *AuditRow) { r.Date = "1862 or 1864" }, WantIDs: nil,
	}, { // Test 49: BC prose agrees with a negative year.
		Name: "bc prose", Key: "year-date-prose",
		Mutate:  func(r *AuditRow) { r.Year, r.Date, r.DateStart, r.DateEnd = -490, "12 September 490 BC", "", "" },
		WantIDs: nil,
	}, { // Test 50: Empty era.
		Name: "era empty", Key: "era-empty", Mutate: func(r *AuditRow) { r.Era = "" }, WantIDs: []string{"x"},
	}, { // Test 51: Battle type outside the validator's set.
		Name: "battle type", Key: "battle-type-invalid",
		Mutate: func(r *AuditRow) { r.BattleType = "aerial" }, WantIDs: []string{"x"},
	}, { // Test 52: Replacement glyph in a side's casualties.
		Name: "side bad unicode", Key: "side-bad-name",
		In: func(in *AuditInput) {
			s := testAuditSide("x")
			s.Casualties = "3,�00 killed"
			in.Sides = append(in.Sides, s)
		}, WantIDs: []string{"x"},
	}, { // Test 53: Replay keyed by a missing battle.
		Name: "replay orphan", Key: "replay-orphan",
		In: func(in *AuditInput) { in.ReplayIDs = []string{"x", "gone"} }, WantIDs: []string{"gone"},
	}, { // Test 54: No phases file means n/a.
		Name: "replay na", Key: "replay-orphan", WantNA: true,
	}, { // Test 55: Reference keyed by a missing battle.
		Name: "reference orphan", Key: "reference-orphan",
		In: func(in *AuditInput) { in.ReferenceIDs = []string{"gone"} }, WantIDs: []string{"gone"},
	}, { // Test 56: An empty references file is computed, not n/a.
		Name: "reference empty", Key: "reference-orphan",
		In: func(in *AuditInput) { in.ReferenceIDs = []string{} }, WantIDs: nil,
	}, { // Test 57: Decade precision names no year and passes the Wikidata check.
		Name: "wikidata decade", Key: "year-vs-wikidata",
		Mutate: func(r *AuditRow) { r.WikidataDate, r.WikidataPrecision = "1890-01-01", 8 },
		In:     func(in *AuditInput) { in.HasWikidataDate = true }, WantIDs: nil,
	}, { // Test 58: Year precision is checked.
		Name: "wikidata year precision", Key: "year-vs-wikidata",
		Mutate: func(r *AuditRow) { r.WikidataDate, r.WikidataPrecision = "1937-01-01", 9 },
		In:     func(in *AuditInput) { in.HasWikidataDate = true }, WantIDs: []string{"x"},
	}, { // Test 59: An infobox naming the row's year is a dispute, not a mismatch.
		Name: "dispute not mismatch", Key: "year-vs-wikidata",
		Mutate: func(r *AuditRow) {
			r.WikidataDate, r.WikidataPrecision, r.InfoboxChecked, r.InfoboxDate = "1862-01-01", 9, true, "1863"
		},
		In: func(in *AuditInput) { in.HasWikidataDate = true }, WantIDs: nil,
	}, { // Test 60: The same row is counted as a dispute.
		Name: "dispute", Key: "year-wikidata-dispute",
		Mutate: func(r *AuditRow) {
			r.WikidataDate, r.WikidataPrecision, r.InfoboxChecked, r.InfoboxDate = "1862-01-01", 9, true, "1863"
		},
		In: func(in *AuditInput) { in.HasWikidataDate = true }, WantIDs: []string{"x"},
	}, { // Test 61: Same day and month in another year is a Wikidata typo.
		Name: "typo", Key: "wikidata-year-typo",
		Mutate: func(r *AuditRow) {
			r.DateEnd, r.Date, r.WikidataDate, r.WikidataPrecision = "1863-07-01", "1 July 1863", "2000-07-01", 11
		},
		In: func(in *AuditInput) { in.HasWikidataDate = true }, WantIDs: []string{"x"},
	}, { // Test 62: A typo row is not a year mismatch.
		Name: "typo not mismatch", Key: "year-vs-wikidata",
		Mutate: func(r *AuditRow) {
			r.DateEnd, r.Date, r.WikidataDate, r.WikidataPrecision = "1863-07-01", "1 July 1863", "2000-07-01", 11
		},
		In: func(in *AuditInput) { in.HasWikidataDate = true }, WantIDs: nil,
	}, { // Test 63: A year-enrich row whose infobox names its year is reconciled.
		Name: "year enrich infobox", Key: "year-enrich-unreconciled",
		Mutate: func(r *AuditRow) { r.InfoboxChecked, r.InfoboxDate = true, "{{Start date|1863|7|1}}" },
		In:     func(in *AuditInput) { in.YearEnrichTitles = []string{"battle of x"} }, WantIDs: nil,
	}, { // Test 64: Two titles that redirect to one article are not duplicates.
		Name: "redirect not dup", Key: "dup-wikipedia-title",
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Lat, r.Lng = 10, 10
			in.Rows = append(in.Rows, r)
			in.CanonicalTitles = map[string]string{"Battle of y": "Battle of x"}
		}, WantIDs: nil,
	}, { // Test 65: A title with no article.
		Name: "title missing", Key: "title-missing",
		In:      func(in *AuditInput) { in.CanonicalTitles = map[string]string{"Battle of x": ""} },
		WantIDs: []string{"x"},
	}, { // Test 66: A title never resolved is not missing.
		Name: "title unresolved", Key: "title-missing", WantIDs: nil,
	}, { // Test 67: Two missing titles are not one article.
		Name: "missing not dup", Key: "dup-wikipedia-title",
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			in.Rows = append(in.Rows, r)
			in.CanonicalTitles = map[string]string{"Battle of x": "", "Battle of y": ""}
		}, WantIDs: nil,
	}, { // Test 68: First and Second of one place are not duplicates.
		Name: "ordinals differ", Key: "near-duplicate",
		Mutate: func(r *AuditRow) { r.Name, r.WikipediaTitle = "First Battle of Gaza", "" },
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Name, r.WikipediaTitle = "Second Battle of Gaza", ""
			in.Rows = append(in.Rows, r)
		}, WantIDs: nil,
	}, { // Test 69: Two Wikidata items are two events.
		Name: "distinct items", Key: "near-duplicate",
		Mutate: func(r *AuditRow) { r.WikipediaTitle, r.SourceID = "", "Q1" },
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Name, r.WikipediaTitle, r.SourceID = "Siege of x", "", "Q2"
			in.Rows = append(in.Rows, r)
		}, WantIDs: nil,
	}, { // Test 70: Two articles are two events.
		Name: "distinct articles", Key: "near-duplicate",
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Name = "Siege of x"
			in.Rows = append(in.Rows, r)
		}, WantIDs: nil,
	}, { // Test 71: A curated row and a wikidata row whose curated title is missing.
		Name: "curated twin", Key: "near-duplicate",
		Mutate: func(r *AuditRow) { r.Source, r.Verified, r.SourceID = "curated", true, "" },
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Name, r.SourceID = "Siege of x", "Q2"
			in.Rows = append(in.Rows, r)
			in.CanonicalTitles = map[string]string{"Battle of x": ""}
		}, WantIDs: []string{"x", "y"},
	}, { // Test 72: A verified row is never a non-battle.
		Name: "verified legend", Key: "non-battle",
		Mutate: func(r *AuditRow) { r.InstanceOf, r.Verified = "legendary battle", true },
		In:     func(in *AuditInput) { in.HasInstanceOf = true }, WantIDs: nil,
	}, { // Test 73: A title that redirects to another article.
		Name: "title redirect", Key: "title-redirect",
		In:      func(in *AuditInput) { in.CanonicalTitles = map[string]string{"Battle of x": "Battle of z"} },
		WantIDs: []string{"x"},
	}, { // Test 74: A title that resolves to itself is not a redirect.
		Name: "title canonical", Key: "title-redirect",
		In:      func(in *AuditInput) { in.CanonicalTitles = map[string]string{"Battle of x": "Battle of x"} },
		WantIDs: nil,
	}, { // Test 75: A missing title is not a redirect.
		Name: "missing not redirect", Key: "title-redirect",
		In:      func(in *AuditInput) { in.CanonicalTitles = map[string]string{"Battle of x": ""} },
		WantIDs: nil,
	}, { // Test 76: A year inside a multi-year span agrees with it.
		Name: "year inside span", Key: "year-date-start",
		Mutate: func(r *AuditRow) {
			r.Year, r.DateStart, r.DateEnd, r.Era = 1326, "1317-01-01", "1326-04-06", yearToEra(1326)
		}, WantIDs: nil,
	}, { // Test 77: A year after the span's end disagrees with it.
		Name: "year after span", Key: "year-date-start",
		Mutate: func(r *AuditRow) {
			r.Year, r.DateStart, r.DateEnd, r.Era = 1327, "1317-01-01", "1326-04-06", yearToEra(1327)
		}, WantIDs: []string{"x"},
	}, { // Test 78: A year before the span's start disagrees with it.
		Name: "year before span", Key: "year-date-start",
		Mutate: func(r *AuditRow) {
			r.Year, r.DateStart, r.DateEnd, r.Era = 1316, "1317-01-01", "1326-04-06", yearToEra(1316)
		}, WantIDs: []string{"x"},
	}, { // Test 79: Island battle a source places off the 1:50m coast is fine.
		Name: "sourced at sea", Key: "land-in-ocean", WithLand: true,
		Mutate: func(r *AuditRow) { r.Lat, r.Lng, r.CoordSource = 0, -30, "wikidata" }, WantIDs: nil,
	}, { // Test 80: A redirect twin far from its anchor is a near duplicate.
		Name: "redirect twin", Key: "near-duplicate",
		Mutate: func(r *AuditRow) { r.Name, r.WikipediaTitle = "Battle of Bembezi", "Battle of Bembezi" },
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Name, r.WikipediaTitle, r.Lat = "Battle of Bembesi", "Battle of Bembesi", 0
			in.Rows = append(in.Rows, r)
			in.CanonicalTitles = map[string]string{"Battle of Bembezi": "Battle of Bembezi",
				"Battle of Bembesi": "Battle of Bembezi"}
		}, WantIDs: []string{"x", "y"},
	}, { // Test 81: An allowlist pair still on two rows is a near duplicate.
		Name: "unapplied allowlist", Key: "near-duplicate",
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Lat = 0
			in.Rows = append(in.Rows, r)
			in.Duplicates = []DuplicatePair{{Keep: "x", Merge: "y"}, {Keep: "x", Merge: "gone"}}
		}, WantIDs: []string{"x", "y"},
	}, { // Test 82: A curated row's twin lands in curated-twin.
		Name: "curated redirect twin", Key: "curated-twin",
		Mutate: func(r *AuditRow) {
			r.Name, r.WikipediaTitle, r.Source, r.SourceID = "Battle of El Geneina", "Battle of El Geneina", "curated", ""
		},
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Name, r.WikipediaTitle = "Battle of Geneina", "Battle of Geneina"
			in.Rows = append(in.Rows, r)
			in.CanonicalTitles = map[string]string{"Battle of El Geneina": "Battle of Geneina",
				"Battle of Geneina": "Battle of Geneina"}
		}, WantIDs: []string{"x", "y"},
	}, { // Test 83: A curated twin is not counted as a near duplicate.
		Name: "curated twin not near", Key: "near-duplicate",
		Mutate: func(r *AuditRow) {
			r.Name, r.WikipediaTitle, r.Source, r.SourceID = "Battle of El Geneina", "Battle of El Geneina", "curated", ""
		},
		In: func(in *AuditInput) {
			r := testAuditRow("y")
			r.Name, r.WikipediaTitle, r.Lat = "Battle of Geneina", "Battle of Geneina", 0
			in.Rows = append(in.Rows, r)
			in.CanonicalTitles = map[string]string{"Battle of El Geneina": "Battle of Geneina",
				"Battle of Geneina": "Battle of Geneina"}
		}, WantIDs: nil,
	}, { // Test 84: An image caption leaked into the significance.
		Name: "prose markup caption", Key: "prose-markup",
		Mutate:  func(r *AuditRow) { r.Significance = "thumb|upright|alt=A painting|The surrender." },
		WantIDs: []string{"x"},
	}, { // Test 85: A section heading leaked into the summary.
		Name: "prose markup heading", Key: "prose-markup",
		Mutate: func(r *AuditRow) { r.Summary = "===Reconcentration=== The army fell back." }, WantIDs: []string{"x"},
	}, { // Test 86: Clean prose with an en dash and a quote is fine.
		Name: "prose markup clean", Key: "prose-markup",
		Mutate: func(r *AuditRow) {
			r.Significance = "The 1863–1864 \"Overland\" campaign followed, one man hurt in the thumb, carts upright."
		},
		WantIDs: nil,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			r := testAuditRow("x")
			if test.Mutate != nil {
				test.Mutate(&r)
			}
			in := AuditInput{Rows: []AuditRow{r}, Sides: []AuditSide{testAuditSide("x")}}
			if test.WithLand {
				in.Land = land
			}
			if test.In != nil {
				test.In(&in)
			}
			var got *MismatchClass
			classes := Mismatches(in)
			for i := range classes {
				if classes[i].Key == test.Key {
					got = &classes[i]
				}
			}
			if got == nil {
				t.Fatalf("class %s missing from report", test.Key)
			}
			if diff := cmp.Diff(test.WantNA, got.NA != ""); diff != "" {
				t.Errorf("n/a mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantIDs, got.IDs, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("ids mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestLoadAuditInput pins the db read path, the documented-tier flag, the
// optional columns, and the year-enrich title list.
func TestLoadAuditInput(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	dir := t.TempDir()
	conn, err := db.Open(filepath.Join(dir, "audit.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	insert := `INSERT INTO battles (id, name, year, date, lat, lng, era, war, battle_type, victor, summary,
		significance, date_start, date_end, source, wikipedia_title) VALUES
		('a', 'Battle of A', 1863, '1 July 1863', 39.8, -77.2, 'industrial', 'American Civil War', 'land',
			'Union victory', 's', 'g', '1863-07-01', '1863-07-03', 'wikidata', 'Battle of A'),
		('b', 'Battle of B', 1937, '0', 41.0, 127.0, 'interwar', '', 'land', '', 's', 'g', '', '',
			'wikidata', 'Battle of Pochonbo')`
	if _, err := conn.ExecContext(ctx, insert); err != nil {
		t.Fatalf("insert battles: %v", err)
	}
	if _, err := conn.ExecContext(ctx, `INSERT INTO battle_sides (battle_id, side_index, name, commander,
		strength, casualties) VALUES ('a', 0, 'United States', 'George Meade', '', '')`); err != nil {
		t.Fatalf("insert side: %v", err)
	}
	enrich := filepath.Join(dir, "year-enrich")
	if err := os.Mkdir(enrich, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	for _, name := range []string{"wikitext_Battle_of_Pochonbo.json", "summary_Ignored.json", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(enrich, name), []byte("{}"), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	in, err := LoadAuditInput(ctx, conn, battles.DocumentedCondition(), enrich)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	type summary struct {
		IDs             []string
		Documented      []bool
		Sides           int
		Titles          []string
		HasWikidataDate bool
	}
	got := summary{Sides: len(in.Sides), Titles: in.YearEnrichTitles, HasWikidataDate: in.HasWikidataDate}
	for _, r := range in.Rows {
		got.IDs = append(got.IDs, r.ID)
		got.Documented = append(got.Documented, r.Documented)
	}
	want := summary{IDs: []string{"a", "b"}, Documented: []bool{true, false}, Sides: 1,
		Titles: []string{"Battle of Pochonbo"}, HasWikidataDate: true}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("mismatch (-want +got):\n%s", diff)
	}

	if _, err := conn.ExecContext(ctx, `UPDATE battles SET wikidata_date = '1937-06-04',
		wikidata_instance_of = 'battle' WHERE id = 'b'`); err != nil {
		t.Fatalf("set wikidata facts: %v", err)
	}
	in, err = LoadAuditInput(ctx, conn, battles.DocumentedCondition(), filepath.Join(dir, "missing"))
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !in.HasWikidataDate || !in.HasInstanceOf || len(in.YearEnrichTitles) != 0 {
		t.Errorf("columns: wikidata_date %v instance_of %v titles %v", in.HasWikidataDate, in.HasInstanceOf,
			in.YearEnrichTitles)
	}
	if diff := cmp.Diff("1937-06-04", in.Rows[1].WikidataDate); diff != "" {
		t.Errorf("wikidata date mismatch (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff("battle", in.Rows[1].InstanceOf); diff != "" {
		t.Errorf("instance of mismatch (-want +got):\n%s", diff)
	}

	// A database from before the wikidata_* columns, as a read-only open sees it.
	for _, col := range []string{"wikidata_date", "wikidata_instance_of"} {
		if _, err := conn.ExecContext(ctx, `ALTER TABLE battles DROP COLUMN `+col); err != nil {
			t.Fatalf("drop %s: %v", col, err)
		}
	}
	in, err = LoadAuditInput(ctx, conn, battles.DocumentedCondition(), "")
	if err != nil {
		t.Fatalf("reload old schema: %v", err)
	}
	if in.HasWikidataDate || in.HasInstanceOf || in.Rows[1].WikidataDate != "" {
		t.Errorf("old schema: wikidata_date %v instance_of %v value %q", in.HasWikidataDate, in.HasInstanceOf,
			in.Rows[1].WikidataDate)
	}
}

// TestLoadJSONKeys pins the curated-file key reader.
func TestLoadJSONKeys(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	write := func(name, body string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
		return p
	}
	tests := []struct {
		Name     string
		Path     string
		WantKeys []string
		WantErr  bool
	}{{ // Test 0: Keys come back sorted.
		Name: "object", Path: write("p.json", `{"b": {}, "a": {"phases": []}}`), WantKeys: []string{"a", "b"},
	}, { // Test 1: An empty object yields an empty, non-nil list.
		Name: "empty", Path: write("e.json", `{}`), WantKeys: []string{},
	}, { // Test 2: A missing file yields nil.
		Name: "missing", Path: filepath.Join(dir, "none.json"), WantKeys: nil,
	}, { // Test 3: An array is not an object.
		Name: "array", Path: write("a.json", `[]`), WantErr: true,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			got, err := LoadJSONKeys(test.Path)
			if diff := cmp.Diff(test.WantErr, err != nil); diff != "" {
				t.Errorf("error mismatch (-want +got):\n%s\nerr: %v", diff, err)
			}
			if diff := cmp.Diff(test.WantKeys, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
			if test.WantKeys != nil && got == nil {
				t.Errorf("want non-nil keys")
			}
		})
	}
}
