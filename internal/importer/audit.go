package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// AuditRow is the slice of a battle row the mismatch audit reads.
type AuditRow struct {
	// ID is the battle slug.
	ID string
	// Name is the display name.
	Name string
	// Year is the stored year, negative for BC.
	Year int
	// Date is the prose date string.
	Date string
	// DateStart is the ISO start date.
	DateStart string
	// DateEnd is the ISO end date.
	DateEnd string
	// Lat is the latitude.
	Lat float64
	// Lng is the longitude.
	Lng float64
	// Era is the stored era key.
	Era string
	// War is the parent conflict name.
	War string
	// BattleType is land, naval, siege and so on.
	BattleType string
	// Victor is the outcome text.
	Victor string
	// Summary is the dossier summary.
	Summary string
	// Source is curated or wikidata.
	Source string
	// Verified is true for hand-checked rows.
	Verified bool
	// WikipediaTitle is the English Wikipedia article title.
	WikipediaTitle string
	// SourceID is the Wikidata Q-id, empty for curated rows.
	SourceID string
	// WikidataDate is the Wikidata P585 or P580 date, empty when unknown.
	WikidataDate string
	// WikidataPrecision is the Wikidata precision of WikidataDate, 0 when unknown.
	WikidataPrecision int
	// InfoboxDate is the article infobox's raw date parameter.
	InfoboxDate string
	// InfoboxChecked is true once the article's infobox has been read.
	InfoboxChecked bool
	// InstanceOf holds the Wikidata P31 labels, empty when unknown.
	InstanceOf string
	// Documented is true when the row passes the store's documented-tier rule.
	Documented bool
}

// AuditSide is the slice of a battle_sides row the audit reads.
type AuditSide struct {
	// BattleID is the owning battle slug.
	BattleID string
	// Name is the belligerent name.
	Name string
	// Commander is the commander text.
	Commander string
	// Strength is the force size text.
	Strength string
	// Casualties is the losses text.
	Casualties string
}

// AuditInput is everything the mismatch audit inspects.
type AuditInput struct {
	// Rows holds every battle.
	Rows []AuditRow
	// Sides holds every side row.
	Sides []AuditSide
	// Land answers land-in-ocean checks. Nil skips that class.
	Land *LandMask
	// YearEnrichTitles holds the article titles the retired year-enrich pass touched.
	YearEnrichTitles []string
	// HasWikidataDate is true once the wikidata_date column exists.
	HasWikidataDate bool
	// HasInstanceOf is true once the wikidata_instance_of column exists.
	HasInstanceOf bool
	// ReplayIDs holds the phases.json keys. Nil skips the replay-orphan class.
	ReplayIDs []string
	// ReferenceIDs holds the references.json keys. Nil skips the reference-orphan class.
	ReferenceIDs []string
	// CanonicalTitles maps a stored Wikipedia title to the article it resolves
	// to, "" for a missing page. Titles absent from the map are taken as canonical.
	CanonicalTitles map[string]string
}

// MismatchClass is one kind of data defect with the rows that show it.
type MismatchClass struct {
	// Key is the stable class name used by -mismatch-ids.
	Key string
	// Desc says what the class means.
	Desc string
	// IDs lists the offending battle ids, sorted.
	IDs []string
	// NA explains why the class cannot be computed yet. Empty when computed.
	NA string
}

// warRegion bounds where battles of a modern war can plausibly sit.
type warRegion struct {
	// Match finds the war family in a lower-cased war name.
	Match *regexp.Regexp
	// Boxes lists allowed areas as minLat, maxLat, minLng, maxLng.
	Boxes [][4]float64
}

// warRegions is the bounding-box table for modern wars with tight geography.
var warRegions = []warRegion{{
	Match: regexp.MustCompile(`russo-ukrainian|russia-ukraine|russian invasion of ukraine|war in donbas|kursk oblast incursion`),
	Boxes: [][4]float64{{43, 57, 20, 50}, {50, 72, 30, 180}, {41, 47, 27, 42}},
}, {
	Match: regexp.MustCompile(`gaza war|israel.hamas war|israel.hezbollah`),
	Boxes: [][4]float64{{11, 38, 32, 62}},
}, {
	Match: regexp.MustCompile(`yemen`),
	Boxes: [][4]float64{{10, 32, 34, 60}},
}, {
	Match: regexp.MustCompile(`syrian civil war`),
	Boxes: [][4]float64{{29, 38.5, 33, 44}},
}, {
	Match: regexp.MustCompile(`iran.israel|israel.iran`),
	Boxes: [][4]float64{{11, 42, 29, 64}},
}, {
	Match: regexp.MustCompile(`^mali war`),
	Boxes: [][4]float64{{8, 26, -13, 16}},
}, {
	Match: regexp.MustCompile(`myanmar civil war`),
	Boxes: [][4]float64{{9, 29, 92, 102}},
}}

// warFamily lists the variant spellings that should collapse to one canonical war.
type warFamily struct {
	// Match finds the family in a lower-cased war name.
	Match *regexp.Regexp
	// Allowed holds the canonical name and any real child wars.
	Allowed []string
}

// warFamilies drives the variant-key class until wars.json carries aliases.
var warFamilies = []warFamily{{
	Match: regexp.MustCompile(`russo-ukrainian|russia-ukraine|invasion of ukraine|war in donbas`),
	Allowed: []string{"Russo-Ukrainian War", "Russian invasion of Ukraine", "War in Donbas (2014–2022)",
		"Ukrainian Kursk Oblast Incursion"},
}, {
	Match:   regexp.MustCompile(`yemen`),
	Allowed: []string{"Yemeni Civil War"},
}, {
	Match:   regexp.MustCompile(`gaza war|israel.hamas war`),
	Allowed: []string{"Gaza war"},
}, {
	Match:   regexp.MustCompile(`iran.israel|israel.iran`),
	Allowed: []string{"Iran–Israel direct strikes 2024"},
}}

// waterName flags names that describe battles fought on water, which the
// land-in-ocean class skips.
var waterName = regexp.MustCompile(`(?i)\b(naval|sea|seas|bay|strait|straits|gulf|ocean|sinking|sunk|convoy|sound|` +
	`channel|cape|fleet|harbor|harbour|lake|river|island|islands|isle|atoll|reef|boat|ship|ships|maritime|` +
	`torpedo|submarine|cruise|cruiser|frigate|destroyer|blockade|escape|incident|landing|landings|raid|` +
	`capture of the|action of|action off|off )\b`)

var (
	reEnDashISODay   = regexp.MustCompile(`^-?\d{4} – \d{2} – \d{2}`)
	reEnDashISOMonth = regexp.MustCompile(`^-?\d{4} – (0[1-9]|1[0-2])$`)
	reISODate        = regexp.MustCompile(`^-?\d{4}-\d{2}-\d{2}$`)
	reNameToken      = regexp.MustCompile(`[\p{L}\p{N}]+`)
)

// garbageTokens mark raw wiki or infobox text that leaked into a field.
var garbageTokens = []string{"{{", "}}", "[[", "]]", "|combatant", "<ref", "<br", "cite news",
	"cite web", "cite book", "=image:"}

// validEras is the era taxonomy yearToEra produces.
var validEras = map[string]bool{
	"ancient": true, "medieval": true, "early-modern": true, "napoleonic": true, "industrial": true,
	"world-war-1": true, "interwar": true, "world-war-2": true, "cold-war": true, "contemporary": true,
}

// nameStopWords are tokens too common to signal that two names are the same event.
var nameStopWords = map[string]bool{
	"battle": true, "of": true, "the": true, "siege": true, "and": true, "at": true, "in": true,
	"on": true, "de": true, "la": true, "le": true,
	"capture": true, "attack": true, "action": true, "raid": true, "clashes": true, "offensive": true,
}

// landTolKM is how far off the 1:50m coastline a land battle may sit before it
// counts as in the ocean.
const landTolKM = 15

// Mismatches runs every mismatch check and returns one class per check in a fixed order.
func Mismatches(in AuditInput) []MismatchClass {
	var out []MismatchClass
	add := func(key, desc string, pred func(r *AuditRow) bool) {
		c := MismatchClass{Key: key, Desc: desc}
		for i := range in.Rows {
			if pred(&in.Rows[i]) {
				c.IDs = append(c.IDs, in.Rows[i].ID)
			}
		}
		out = append(out, c)
	}
	na := func(key, desc, reason string) {
		out = append(out, MismatchClass{Key: key, Desc: desc, NA: reason})
	}

	add("endash-iso-date", "ISO date mangled into en-dash form, day precision lost", func(r *AuditRow) bool {
		return reEnDashISODay.MatchString(r.Date)
	})
	add("endash-iso-month", "ISO year-month mangled into en-dash form", func(r *AuditRow) bool {
		return reEnDashISOMonth.MatchString(r.Date)
	})
	add("year-date-start", "year disagrees with the year of date_start", func(r *AuditRow) bool {
		y, ok := isoYear(r.DateStart)
		return ok && r.Year != 0 && y != r.Year
	})
	add("bad-iso-date", "date_start or date_end is not an ISO date", func(r *AuditRow) bool {
		return (r.DateStart != "" && !reISODate.MatchString(r.DateStart)) ||
			(r.DateEnd != "" && !reISODate.MatchString(r.DateEnd))
	})
	add("date-inversion", "date_end is before date_start", func(r *AuditRow) bool {
		return r.DateStart != "" && r.DateEnd != "" && isoLess(r.DateEnd, r.DateStart)
	})
	add("date-zero", "date is the placeholder '0'", func(r *AuditRow) bool { return r.Date == "0" })
	add("date-empty", "date is empty", func(r *AuditRow) bool { return r.Date == "" })
	add("year-zero", "year is 0", func(r *AuditRow) bool { return r.Year == 0 })
	add("year-date-prose", "year is not among the years the prose date names", func(r *AuditRow) bool {
		return yearDisagreesWithProse(r.Year, r.Date)
	})
	add("era-empty", "era is empty", func(r *AuditRow) bool { return r.Era == "" })
	add("era-invalid", "era is not in the taxonomy", func(r *AuditRow) bool {
		return r.Era != "" && !validEras[r.Era]
	})
	add("era-year", "era disagrees with the era the year maps to", func(r *AuditRow) bool {
		return r.Year != 0 && validEras[r.Era] && yearToEra(r.Year) != r.Era
	})
	if in.HasWikidataDate {
		add("year-vs-wikidata", "wikidata row year disagrees with the Wikidata date and the article does not "+
			"dispute it", func(r *AuditRow) bool {
			return yearDisagreesWithWikidata(r) && (!r.InfoboxChecked || infoboxBacksWikidata(r.InfoboxDate,
				parseWikidataYear(r.WikidataDate), r.Year))
		})
		add("year-wikidata-dispute", "article infobox names the row's year, or both years, and Wikidata "+
			"another", func(r *AuditRow) bool {
			return yearDisagreesWithWikidata(r) && r.InfoboxChecked && !infoboxBacksWikidata(r.InfoboxDate,
				parseWikidataYear(r.WikidataDate), r.Year)
		})
		add("wikidata-year-typo", "Wikidata has the row's day and month in another year", func(r *AuditRow) bool {
			return r.Source == "wikidata" && !r.Verified && parseWikidataYear(r.WikidataDate) != r.Year &&
				sameDayOtherYear(DateRange{Start: r.DateStart, End: r.DateEnd}, r.WikidataDate, r.WikidataPrecision)
		})
	} else {
		na("year-vs-wikidata", "wikidata row year disagrees with the Wikidata date", "no wikidata_date column yet")
	}
	enrich := make(map[string]bool, len(in.YearEnrichTitles))
	for _, t := range in.YearEnrichTitles {
		enrich[strings.ToLower(t)] = true
	}
	add("year-enrich-unreconciled", "row touched by the retired year-enrich pass whose year neither "+
		"Wikidata nor the article infobox backs", func(r *AuditRow) bool {
		touched := enrich[strings.ToLower(r.WikipediaTitle)] || enrich[strings.ToLower(r.Name)]
		if !touched || r.Verified {
			return false
		}
		if r.WikidataDate != "" && !yearDisagreesWithWikidata(r) {
			return false
		}
		return !slices.Contains(candidateYears(infoboxProse(r.InfoboxDate)), r.Year)
	})
	add("battle-type-invalid", "battle_type is not land, naval, siege, air or amphibious", func(r *AuditRow) bool {
		_, ok := validBattleTypesSet[r.BattleType]
		return !ok
	})
	add("coords-zero", "coordinates are 0,0 and the row is off the globe", func(r *AuditRow) bool {
		return r.Lat == 0 && r.Lng == 0
	})
	add("coords-range", "coordinates are out of range", func(r *AuditRow) bool {
		return r.Lat < -90 || r.Lat > 90 || r.Lng < -180 || r.Lng > 180
	})
	if in.Land != nil {
		add("land-in-ocean", fmt.Sprintf("land battle more than %d km off the coast", landTolKM),
			func(r *AuditRow) bool {
				if r.Lat == 0 && r.Lng == 0 {
					return false
				}
				if r.BattleType == "naval" || r.BattleType == "amphibious" || waterName.MatchString(r.Name) {
					return false
				}
				return !in.Land.OnLand(r.Lat, r.Lng, landTolKM)
			})
	} else {
		na("land-in-ocean", "land battle in the ocean", "no land mask loaded")
	}
	add("war-outside-region", "modern war attribution outside that war's region", func(r *AuditRow) bool {
		return warOutsideRegion(r)
	})
	add("war-empty", "war is empty", func(r *AuditRow) bool { return r.War == "" })
	add("war-family-variant", "war is a non-canonical spelling of a known war", func(r *AuditRow) bool {
		return isWarFamilyVariant(r.War)
	})
	variantRows := warVariantRows(in.Rows)
	add("war-spelling-variant", "war is a minority spelling of a name with a more common variant",
		func(r *AuditRow) bool { return variantRows[r.ID] })
	add("garbage-text", "name, war or victor carries raw wiki markup", func(r *AuditRow) bool {
		return hasGarbage(r.Name) || hasGarbage(r.War) || hasGarbage(r.Victor)
	})
	add("bad-unicode", "a visible field holds the U+FFFD replacement glyph", func(r *AuditRow) bool {
		return strings.ContainsRune(r.Name+r.War+r.Victor+r.Summary, '\uFFFD')
	})
	add("victor-empty", "victor is empty", func(r *AuditRow) bool { return r.Victor == "" })

	sidesBy := make(map[string][]AuditSide)
	for _, s := range in.Sides {
		sidesBy[s.BattleID] = append(sidesBy[s.BattleID], s)
	}
	add("no-sides", "no belligerent sides", func(r *AuditRow) bool { return len(sidesBy[r.ID]) == 0 })
	add("side-bad-name", "a side has a blank name, raw wiki markup or a replacement glyph", func(r *AuditRow) bool {
		for _, s := range sidesBy[r.ID] {
			if strings.TrimSpace(s.Name) == "" || hasGarbage(s.Name) || hasGarbage(s.Commander) ||
				strings.ContainsRune(s.Name+s.Commander+s.Strength+s.Casualties, '\uFFFD') {
				return true
			}
		}
		return false
	})
	ids := make(map[string]bool, len(in.Rows))
	for _, r := range in.Rows {
		ids[r.ID] = true
	}
	orphans := MismatchClass{Key: "side-orphan", Desc: "side row whose battle does not exist"}
	seenOrphan := map[string]bool{}
	for _, s := range in.Sides {
		if !ids[s.BattleID] && !seenOrphan[s.BattleID] {
			seenOrphan[s.BattleID] = true
			orphans.IDs = append(orphans.IDs, s.BattleID)
		}
	}
	out = append(out, orphans)
	out = append(out, keyOrphans("replay-orphan", "phases.json replay whose battle does not exist",
		"no phases file loaded", in.ReplayIDs, ids))
	out = append(out, keyOrphans("reference-orphan", "references.json entry whose battle does not exist",
		"no references file loaded", in.ReferenceIDs, ids))

	dupTitle := duplicateTitleRows(in.Rows)
	add("dup-wikipedia-title", "two rows share one Wikipedia title", func(r *AuditRow) bool {
		return dupTitle[r.ID]
	})
	add("title-redirect", "the stored Wikipedia title redirects to another article", func(r *AuditRow) bool {
		c, ok := in.CanonicalTitles[r.WikipediaTitle]
		return r.WikipediaTitle != "" && ok && c != "" && c != strings.TrimSpace(r.WikipediaTitle)
	})
	add("title-missing", "the stored Wikipedia title names no article", func(r *AuditRow) bool {
		c, ok := in.CanonicalTitles[r.WikipediaTitle]
		return r.WikipediaTitle != "" && ok && c == ""
	})
	near := nearDuplicateRows(in.Rows, in.CanonicalTitles)
	add("near-duplicate", "same year, within 2 km, same name, no source keeps them apart",
		func(r *AuditRow) bool { return near[r.ID] })
	if in.HasInstanceOf {
		add("non-battle", "Wikidata says the item is not a military event", func(r *AuditRow) bool {
			return r.Source == "wikidata" && !r.Verified && IsNonBattle(r.InstanceOf)
		})
	} else {
		na("non-battle", "Wikidata says the item is not a military event", "no wikidata_instance_of column yet")
	}
	add("indexed-tier", "unverified row outside the documented tier", func(r *AuditRow) bool {
		return !r.Documented
	})

	for i := range out {
		sort.Strings(out[i].IDs)
	}
	return out
}

// keyOrphans builds the class of curated-file keys with no battle row. A nil key
// list means the file was not loaded, so the class reports n/a.
func keyOrphans(key, desc, naReason string, keys []string, ids map[string]bool) MismatchClass {
	c := MismatchClass{Key: key, Desc: desc}
	if keys == nil {
		c.NA = naReason
		return c
	}
	for _, k := range keys {
		if !ids[k] {
			c.IDs = append(c.IDs, k)
		}
	}
	return c
}

// yearDisagreesWithProse reports whether year is absent from the years an
// unambiguous prose date names. A year inside the span of a multi-year range
// passes, so "686–690" accepts 688.
func yearDisagreesWithProse(year int, date string) bool {
	if year == 0 || reAmbiguousDate.MatchString(date) {
		return false
	}
	cands := candidateYears(date)
	if len(cands) == 0 {
		return false
	}
	lo, hi := cands[0], cands[0]
	for _, c := range cands {
		if c == year {
			return false
		}
		lo, hi = min(lo, c), max(hi, c)
	}
	return len(cands) < 2 || year < lo || year > hi
}

// LoadJSONKeys returns the top-level keys of a JSON object file such as
// phases.json or references.json. A missing file returns nil keys and no error.
func LoadJSONKeys(path string) ([]string, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys, nil
}

// yearDisagreesWithWikidata reports whether a wikidata row's year contradicts its
// Wikidata date. A date string that names the Wikidata year is a range that starts
// there and passes. A date string that names only the stored year does not, because
// the retired year-enrich pass rewrote year and date together. A precision coarser
// than a year names no single year and passes. An unknown precision is checked.
func yearDisagreesWithWikidata(r *AuditRow) bool {
	if r.Source != "wikidata" || r.Verified || r.WikidataDate == "" {
		return false
	}
	if r.WikidataPrecision > 0 && r.WikidataPrecision < precisionYear {
		return false
	}
	if sameDayOtherYear(DateRange{Start: r.DateStart, End: r.DateEnd}, r.WikidataDate, r.WikidataPrecision) {
		return false
	}
	wy, ok := isoYear(r.WikidataDate)
	if !ok || wy == r.Year {
		return false
	}
	for _, c := range candidateYears(r.Date) {
		if c == wy {
			return false
		}
	}
	return true
}

// warOutsideRegion reports whether a row's modern war sits outside that war's region.
func warOutsideRegion(r *AuditRow) bool {
	if r.War == "" || (r.Lat == 0 && r.Lng == 0) {
		return false
	}
	w := strings.ToLower(r.War)
	for _, reg := range warRegions {
		if !reg.Match.MatchString(w) {
			continue
		}
		for _, b := range reg.Boxes {
			if r.Lat >= b[0] && r.Lat <= b[1] && r.Lng >= b[2] && r.Lng <= b[3] {
				return false
			}
		}
		return true
	}
	return false
}

// isWarFamilyVariant reports whether war belongs to a known family under a name
// that is not one of that family's allowed names.
func isWarFamilyVariant(war string) bool {
	if war == "" {
		return false
	}
	w := strings.ToLower(war)
	for _, f := range warFamilies {
		if !f.Match.MatchString(w) {
			continue
		}
		for _, a := range f.Allowed {
			if a == war {
				return false
			}
		}
		return true
	}
	return false
}

// warVariantRows marks rows whose war is a minority spelling within a canonWarKey group.
func warVariantRows(rows []AuditRow) map[string]bool {
	counts := map[string]map[string]int{}
	for _, r := range rows {
		if r.War == "" {
			continue
		}
		k := canonWarKey(r.War)
		if counts[k] == nil {
			counts[k] = map[string]int{}
		}
		counts[k][r.War]++
	}
	top := map[string]string{}
	for k, vs := range counts {
		if len(vs) < 2 {
			continue
		}
		best, bestN := "", -1
		for v, n := range vs {
			if n > bestN || (n == bestN && v < best) {
				best, bestN = v, n
			}
		}
		top[k] = best
	}
	out := map[string]bool{}
	for _, r := range rows {
		if r.War == "" {
			continue
		}
		if best, ok := top[canonWarKey(r.War)]; ok && r.War != best {
			out[r.ID] = true
		}
	}
	return out
}

// canonicalTitle returns the article a stored title resolves to, "" for none.
func canonicalTitle(title string, canon map[string]string) string {
	t := strings.TrimSpace(title)
	if c, ok := canon[t]; ok {
		return c
	}
	return t
}

// duplicateTitleRows marks rows that share a stored Wikipedia title. Titles that
// redirect to one article are not compared, since a redirect target is often a
// parent article covering several distinct battles.
func duplicateTitleRows(rows []AuditRow) map[string]bool {
	by := map[string][]string{}
	for _, r := range rows {
		if t := strings.TrimSpace(r.WikipediaTitle); t != "" {
			by[t] = append(by[t], r.ID)
		}
	}
	out := map[string]bool{}
	for _, ids := range by {
		if len(ids) > 1 {
			for _, id := range ids {
				out[id] = true
			}
		}
	}
	return out
}

// nearDuplicateRows marks pairs in the same year within 2 km whose names share
// more than 80 percent of their significant tokens, ordinals and numbers
// included, and that no source keeps apart. Two Wikidata items are two events
// by Wikidata's own account, and two rows on two different articles are two
// events by Wikipedia's. Rows on the same stored title belong to dup-wikipedia-title.
func nearDuplicateRows(rows []AuditRow, canon map[string]string) map[string]bool {
	byYear := map[int][]int{}
	for i, r := range rows {
		if r.Year == 0 || (r.Lat == 0 && r.Lng == 0) {
			continue
		}
		byYear[r.Year] = append(byYear[r.Year], i)
	}
	out := map[string]bool{}
	for _, idx := range byYear {
		for a := 0; a < len(idx); a++ {
			ra := &rows[idx[a]]
			for b := a + 1; b < len(idx); b++ {
				rb := &rows[idx[b]]
				if haversineKM(ra.Lat, ra.Lng, rb.Lat, rb.Lng) > 2 {
					continue
				}
				if keptApart(ra, rb, canon) || nameOverlap(ra.Name, rb.Name) <= 0.8 {
					continue
				}
				out[ra.ID] = true
				out[rb.ID] = true
			}
		}
	}
	return out
}

// keptApart reports whether a source separates two rows: distinct Wikidata
// items, or a Wikipedia title that names an article on both. Two different
// titles are two events, and one shared title is the dup-wikipedia-title class.
func keptApart(a, b *AuditRow, canon map[string]string) bool {
	if a.SourceID != "" && b.SourceID != "" && a.SourceID != b.SourceID {
		return true
	}
	ta, tb := canonicalTitle(a.WikipediaTitle, canon), canonicalTitle(b.WikipediaTitle, canon)
	return ta != "" && tb != ""
}

// nameOverlap returns the Jaccard overlap of the significant tokens of two names.
func nameOverlap(a, b string) float64 {
	ta, tb := nameTokens(a), nameTokens(b)
	if len(ta) == 0 || len(tb) == 0 {
		return 0
	}
	inter := 0
	for t := range ta {
		if tb[t] {
			inter++
		}
	}
	union := len(ta) + len(tb) - inter
	return float64(inter) / float64(union)
}

// nameTokens lower-cases a name and drops stop words.
func nameTokens(s string) map[string]bool {
	out := map[string]bool{}
	for _, t := range reNameToken.FindAllString(strings.ToLower(s), -1) {
		if nameStopWords[t] {
			continue
		}
		out[t] = true
	}
	return out
}

// haversineKM returns the great-circle distance between two points.
func haversineKM(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371.0
	p1, p2 := lat1*math.Pi/180, lat2*math.Pi/180
	dp, dl := p2-p1, (lng2-lng1)*math.Pi/180
	h := math.Sin(dp/2)*math.Sin(dp/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * r * math.Asin(math.Min(1, math.Sqrt(h)))
}

// hasGarbage reports whether s carries raw wiki or infobox markup.
func hasGarbage(s string) bool {
	l := strings.ToLower(s)
	for _, g := range garbageTokens {
		if strings.Contains(l, g) {
			return true
		}
	}
	return false
}

// isoYear returns the year of an ISO date such as 2023-10-04 or -0490-09-12.
func isoYear(s string) (int, bool) {
	if !reISODate.MatchString(s) {
		return 0, false
	}
	var y int
	if _, err := fmt.Sscanf(s[:len(s)-6], "%d", &y); err != nil {
		return 0, false
	}
	return y, true
}

// isoLess reports whether ISO date a is strictly before b, handling BC years.
func isoLess(a, b string) bool {
	ya, oka := isoYear(a)
	yb, okb := isoYear(b)
	if !oka || !okb {
		return false
	}
	if ya != yb {
		return ya < yb
	}
	return a[len(a)-5:] < b[len(b)-5:]
}

// LoadAuditInput reads every battle and side row from db. documentedSQL is the
// store's documented-tier condition. yearEnrichDir is the retired year-enrich
// cache directory, and may be missing.
func LoadAuditInput(ctx context.Context, db *sql.DB, documentedSQL, yearEnrichDir string) (AuditInput, error) {
	var in AuditInput
	cols, err := tableColumns(ctx, db, "battles")
	if err != nil {
		return in, err
	}
	in.HasWikidataDate = cols["wikidata_date"]
	in.HasInstanceOf = cols["wikidata_instance_of"]
	wdDate, wdPrec, inst, ibDate, ibChecked := "''", "0", "''", "''", "''"
	if cols["infobox_checked"] {
		ibDate, ibChecked = "infobox_date", "infobox_checked"
	}
	if in.HasWikidataDate {
		wdDate = "wikidata_date"
	}
	if cols["wikidata_precision"] {
		wdPrec = "wikidata_precision"
	}
	if in.HasInstanceOf {
		inst = "wikidata_instance_of"
	}
	q := `SELECT id, name, year, date, date_start, date_end, lat, lng, era, war, battle_type, victor,
		summary, source, verified, wikipedia_title, source_id, ` + wdDate + `, ` + wdPrec + `, ` + inst + `, ` + ibDate +
		`, ` + ibChecked + `,
		CASE WHEN ` + documentedSQL + ` THEN 1 ELSE 0 END FROM battles`
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return in, fmt.Errorf("query audit rows: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var r AuditRow
		var verified, documented int
		var ibCheckedAt string
		if err := rows.Scan(&r.ID, &r.Name, &r.Year, &r.Date, &r.DateStart, &r.DateEnd, &r.Lat, &r.Lng,
			&r.Era, &r.War, &r.BattleType, &r.Victor, &r.Summary, &r.Source, &verified, &r.WikipediaTitle,
			&r.SourceID, &r.WikidataDate, &r.WikidataPrecision, &r.InstanceOf, &r.InfoboxDate, &ibCheckedAt,
			&documented); err != nil {
			return in, fmt.Errorf("scan audit row: %w", err)
		}
		r.Verified = verified == 1
		r.Documented = documented == 1
		r.InfoboxChecked = ibCheckedAt != ""
		in.Rows = append(in.Rows, r)
	}
	if err := rows.Err(); err != nil {
		return in, fmt.Errorf("iterate audit rows: %w", err)
	}

	srows, err := db.QueryContext(ctx, `SELECT battle_id, name, commander, strength, casualties FROM battle_sides`)
	if err != nil {
		return in, fmt.Errorf("query audit sides: %w", err)
	}
	defer srows.Close()
	for srows.Next() {
		var s AuditSide
		if err := srows.Scan(&s.BattleID, &s.Name, &s.Commander, &s.Strength, &s.Casualties); err != nil {
			return in, fmt.Errorf("scan audit side: %w", err)
		}
		in.Sides = append(in.Sides, s)
	}
	if err := srows.Err(); err != nil {
		return in, fmt.Errorf("iterate audit sides: %w", err)
	}

	in.CanonicalTitles = cachedCanonicalTitles(in.Rows)
	in.YearEnrichTitles, err = yearEnrichTitles(yearEnrichDir)
	return in, err
}

// cachedCanonicalTitles reads the -resolve-titles cache for every stored title.
// Titles never resolved are left out and count as canonical.
func cachedCanonicalTitles(rows []AuditRow) map[string]string {
	out := map[string]string{}
	for _, r := range rows {
		if r.WikipediaTitle == "" {
			continue
		}
		if _, done := out[r.WikipediaTitle]; done {
			continue
		}
		if c, ok := wikiCacheGet(titleCanonicalNamespace, r.WikipediaTitle); ok {
			out[r.WikipediaTitle] = c
		}
	}
	return out
}

// yearEnrichTitles lists the article titles cached by the retired year-enrich
// pass, read from wikitext_<Title>.json file names.
func yearEnrichTitles(dir string) ([]string, error) {
	if dir == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read year-enrich dir: %w", err)
	}
	var out []string
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, "wikitext_") || filepath.Ext(name) != ".json" {
			continue
		}
		t := strings.TrimSuffix(strings.TrimPrefix(name, "wikitext_"), ".json")
		out = append(out, strings.ReplaceAll(t, "_", " "))
	}
	return out, nil
}

// tableColumns returns the set of column names on table.
func tableColumns(ctx context.Context, db *sql.DB, table string) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx, `SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return nil, fmt.Errorf("read %s columns: %w", table, err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, fmt.Errorf("scan %s column: %w", table, err)
		}
		out[n] = true
	}
	return out, rows.Err()
}
