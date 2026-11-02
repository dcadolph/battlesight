package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/dcadolph/battlesight/internal/battles"
	"github.com/dcadolph/battlesight/internal/db"
	"github.com/dcadolph/battlesight/internal/importer"
)

func main() {
	dbPath := flag.String("db", "data/battlesight.db", "path to SQLite database")
	jsonPath := flag.String("json", "", "path to curated battles JSON file")
	wikidata := flag.Bool("wikidata", false, "import battles from Wikidata SPARQL")
	wikidataDates := flag.Bool("wikidata-dates", false,
		"fill the wikidata_* and infobox_* columns from Wikidata and the article for rows not yet checked")
	rawDumpPath := flag.String("wikidata-dump", "data/wikidata_battles_raw.json",
		"SPARQL dump that -wikidata-dates compares live years against")
	wikidataWars := flag.Bool("wikidata-wars", false,
		"name the war of each war-less wikidata row from Wikidata P607, else a war-class P361 target")
	coordsFromSource := flag.Bool("coords-from-source", false,
		"check coordinates against Wikidata P625 and the Wikipedia articles, fill 0,0 rows and move points no source backs")
	landPath := flag.String("land", "data/land-50m.json", "world-atlas land TopoJSON that -coords-from-source reads")
	resolveTitles := flag.Bool("resolve-titles", false,
		"resolve every Wikipedia title through redirects and report missing and redirected titles")
	enrich := flag.Bool("enrich", false, "fetch Wikipedia summaries for battles missing them")
	infobox := flag.Bool("infobox", false,
		"fill missing sides, victor and infobox partof on unverified wikidata rows from the article infobox")
	significance := flag.Bool("significance", false, "fetch Wikipedia aftermath/legacy sections for battles missing significance")
	references := flag.Bool("references", false, "extract citation URLs from Wikipedia articles into battle_references")
	geocodeMissing := flag.Bool("geocode-missing", false, "backfill coordinates from the Wikipedia coordinates API for battles at lat=0 lng=0")
	geocodeDryRun := flag.Bool("geocode-dry-run", false, "run the -geocode-missing flow without writing to the DB; prints the would-be summary")
	infoboxBackfill := flag.Bool("infobox-backfill", false, "backfill coordinates and dates from Wikipedia infobox text for battles missing them")
	infoboxDryRun := flag.Bool("infobox-dry-run", false, "run the -infobox-backfill flow without writing to the DB; prints the would-be summary")
	warsEnrich := flag.Bool("wars", false, "enrich data/wars.json from Wikipedia for every war with at least 3 battles in the catalog")
	warsPath := flag.String("wars-file", "data/wars.json", "path to wars.json output for -wars enrichment")
	mergeReplays := flag.String("merge-replays", "", "validate a replay-draft JSON file (object keyed by battle id) and merge it into -phases-file")
	phasesPath := flag.String("phases-file", "data/phases.json", "path to the served replay phases file for -merge-replays")
	all := flag.Bool("all", false, "run all import and enrichment steps")
	validate := flag.Bool("validate", false, "validate curated JSON + curated/ dir without writing to the DB; exits non-zero on any error")
	// network defaults to true. When set false, every Wikipedia/Wikidata
	// fetcher in the importer package short-circuits with ErrNetworkDisabled
	// and only cached responses serve. This is the panic switch for users
	// who want to guarantee no third-party HTTP, e.g. after a paid-API scare.
	network := flag.Bool("network", true, "allow Wikipedia/Wikidata HTTP (default true). Set -network=false to refuse all network calls and serve only from the disk cache.")
	flag.Parse()

	importer.SetNetworkAllowed(*network)
	if !*network {
		log.Println("network disabled: all Wikipedia/Wikidata fetchers will serve only from data/.wikicache/")
	}

	// Validate-only path: short-circuit before opening the DB so a curator
	// can sanity-check a file without side effects. Returns a non-zero exit
	// code on any error so this slots straight into a pre-commit check.
	if *validate {
		if *jsonPath == "" {
			*jsonPath = "data/battles.json"
		}
		if err := runValidate(*jsonPath); err != nil {
			log.Fatalf("validation failed: %v", err)
		}
		return
	}

	if *all {
		*wikidata = true
		*wikidataDates = true
		*wikidataWars = true
		*coordsFromSource = true
		*resolveTitles = true
		*enrich = true
		*infobox = true
		*significance = true
		*references = true
		*warsEnrich = true
		if *jsonPath == "" {
			*jsonPath = "data/battles.json"
		}
	}

	if *jsonPath == "" && !*wikidata && !*wikidataDates && !*wikidataWars && !*coordsFromSource && !*resolveTitles && !*enrich && !*infobox && !*significance && !*references &&
		!*warsEnrich && !*geocodeMissing && !*geocodeDryRun && !*infoboxBackfill && !*infoboxDryRun &&
		*mergeReplays == "" {
		log.Fatal("at least one action required: -json, -wikidata, -wikidata-dates, -wikidata-wars, -coords-from-source, -resolve-titles, -enrich, -infobox, -significance, " +
			"-references, -wars, -geocode-missing, -geocode-dry-run, -infobox-backfill, " +
			"-infobox-dry-run, -merge-replays, -validate, or -all")
	}

	database, err := db.Open(*dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()

	ctx := context.Background()

	if *mergeReplays != "" {
		ids, err := importer.MergeReplays(ctx, database, *mergeReplays, *phasesPath)
		if err != nil {
			log.Fatalf("merge replays failed: %v", err)
		}
		log.Printf("merged %d replays into %s: %s", len(ids), *phasesPath, strings.Join(ids, ", "))
	}

	if *jsonPath != "" {
		count, err := importer.ImportJSON(ctx, database, *jsonPath)
		if err != nil {
			log.Fatalf("json import failed: %v", err)
		}
		log.Printf("imported %d battles from json", count)
	}

	if *wikidata {
		log.Println("fetching battles from Wikidata...")
		count, err := importer.ImportWikidata(ctx, database)
		if err != nil {
			log.Fatalf("wikidata import failed: %v", err)
		}
		log.Printf("imported %d battles from wikidata", count)
		*wikidataDates = true
		*wikidataWars = true
	}

	if *wikidataDates {
		log.Println("checking rows against Wikidata dates, conflicts and classes...")
		rep, err := importer.BackfillWikidataDates(ctx, database, *rawDumpPath)
		if err != nil {
			log.Fatalf("wikidata dates failed after %d of %d rows: %v", rep.Checked, rep.Pending, err)
		}
		log.Printf("wikidata dates: checked %d of %d rows, %d with a date, %d missing items, "+
			"dump years differ on %d of %d compared", rep.Checked, rep.Pending, rep.WithDate, rep.Missing,
			rep.DumpDisagree, rep.DumpCompared)
		n, err := importer.BackfillInfoboxDates(ctx, database)
		if err != nil {
			log.Fatalf("infobox dates failed: %v", err)
		}
		log.Printf("infobox dates: read %d rows whose year disagrees with Wikidata", n)
	}

	if *wikidataWars {
		log.Println("naming wars for war-less rows from Wikidata...")
		rep, err := importer.WikidataWars(ctx, database)
		if err != nil {
			log.Fatalf("wikidata wars failed after %d rows: %v", rep.Rows, err)
		}
		log.Printf("wikidata wars: %d rows, %d from P607, %d from a P361 war, %d with none", rep.Rows,
			rep.FromConflict, rep.FromPartOf, rep.None)
	}

	if *coordsFromSource {
		log.Println("checking coordinates against Wikidata and the Wikipedia articles...")
		land, err := importer.LoadLandMask(*landPath)
		if err != nil {
			log.Fatalf("coords from source: %v", err)
		}
		rep, err := importer.CoordsFromSource(ctx, database, land)
		if err != nil {
			log.Fatalf("coords from source failed: %v", err)
		}
		log.Printf("coords from source: %d rows, %d sourced, %d moved, %d disputed, %d with no source "+
			"(%d still at 0,0), %d retyped naval", rep.Rows, rep.Sourced, len(rep.Moves), len(rep.Disputed),
			rep.Unsourced, rep.ZeroUnsourced, rep.Naval)
	}

	if *resolveTitles {
		log.Println("resolving Wikipedia titles through redirects...")
		rep, err := importer.ResolveWikipediaTitles(ctx, database)
		if err != nil {
			log.Fatalf("resolve titles failed: %v", err)
		}
		for _, m := range rep.Missing {
			log.Printf("resolve-titles: no article: %s", m)
		}
		for _, r := range rep.Redirects {
			log.Printf("resolve-titles: redirects: %s", r)
		}
		log.Printf("resolve titles: %d titles, %d fetched, %d missing, %d redirect", rep.Titles, rep.Fetched,
			len(rep.Missing), len(rep.Redirects))
	}

	if *enrich {
		log.Println("enriching with Wikipedia summaries...")
		count, err := importer.EnrichFromWikipedia(ctx, database)
		if err != nil {
			log.Fatalf("wikipedia enrichment failed: %v", err)
		}
		log.Printf("enriched %d battles with summaries", count)
	}

	if *infobox {
		log.Println("filling sides, victors and partof from Wikipedia infoboxes...")
		rep, err := importer.EnrichInfoboxes(ctx, database)
		log.Printf("infobox: %d candidates, %d read, %d no article, %d no infobox, "+
			"%d through a rename redirect, %d redirect to a parent or shared article; "+
			"wrote sides %d, victors %d, partof %d; %d fields dropped for leftover markup",
			rep.Candidates, rep.Read, rep.NoArticle, rep.NoInfobox, rep.RedirectFollowed,
			rep.RedirectSkipped, rep.SidesAdded, rep.VictorsSet, rep.PartofSet, rep.BrokenFields)
		if err != nil {
			log.Fatalf("infobox enrichment failed after writing the rows above: %v", err)
		}
	}

	if *significance {
		log.Println("enriching significance from Wikipedia aftermath/legacy sections...")
		count, err := importer.EnrichSignificance(ctx, database)
		if err != nil {
			log.Printf("significance enrichment failed: %v (continuing)", err)
		} else {
			log.Printf("enriched %d battles with significance", count)
		}
	}

	if *references {
		log.Println("extracting citation URLs into battle_references...")
		count, err := importer.EnrichReferences(ctx, database)
		if err != nil {
			log.Printf("reference enrichment failed: %v (continuing)", err)
		} else {
			log.Printf("added %d references across battles", count)
		}
	}

	if *geocodeMissing || *geocodeDryRun {
		log.Println("backfilling coordinates from the Wikipedia coordinates API...")
		sum, err := importer.GeocodeMissing(ctx, database, *geocodeDryRun)
		if err != nil {
			log.Fatalf("geocode backfill failed: %v", err)
		}
		mode := "live"
		if *geocodeDryRun {
			mode = "dry-run"
		}
		log.Printf("geocode backfill (%s): attempted=%d resolved=%d skipped-no-title=%d api-miss=%d",
			mode, sum.Attempted, sum.Resolved, sum.SkippedNoTitle, sum.APIMiss)
	}

	if *infoboxBackfill || *infoboxDryRun {
		log.Println("backfilling coordinates and dates from Wikipedia infobox text...")
		sum, err := importer.InfoboxBackfill(ctx, database, *infoboxDryRun)
		if err != nil {
			log.Fatalf("infobox backfill failed: %v", err)
		}
		mode := "live"
		if *infoboxDryRun {
			mode = "dry-run"
		}
		log.Printf("infobox backfill (%s): coords written=%d of %d attempted, dates written=%d of %d attempted, nominatim requests=%d",
			mode, sum.Coords.Written, sum.Coords.Attempted,
			sum.Dates.Written, sum.Dates.Attempted, sum.NominatimRequests)
	}

	if *warsEnrich {
		log.Println("enriching wars.json narratives from Wikipedia...")
		count, err := importer.EnrichWars(ctx, database, *warsPath)
		if err != nil {
			log.Printf("war enrichment failed: %v (continuing)", err)
		} else {
			log.Printf("enriched %d war narratives in %s", count, *warsPath)
		}
	}
}

// runValidate loads the curated battles JSON + every file under the
// sibling curated/ directory and runs the validator without writing to the
// DB. Prints a human-readable report and returns an error when any
// blocking issue is found so callers exit non-zero.
func runValidate(jsonPath string) error {
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return fmt.Errorf("read %s: %w", jsonPath, err)
	}
	var raw []battles.Battle
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parse %s: %w", jsonPath, err)
	}

	curatedDir := filepath.Join(filepath.Dir(jsonPath), "curated")
	extra, err := loadValidationCuratedDir(curatedDir)
	if err != nil {
		return err
	}
	raw = append(raw, extra...)

	rep := importer.ValidateBattles(raw)
	if formatted := rep.FormatReport(); formatted != "" {
		fmt.Fprint(os.Stderr, formatted)
	}
	fmt.Fprintf(os.Stdout, "validated %d battle(s): %d error(s), %d warning(s)\n",
		len(raw), len(rep.Errors), len(rep.Warnings))

	dupPath := filepath.Join(filepath.Dir(jsonPath), "duplicates.json")
	pairs, err := importer.LoadDuplicates(dupPath)
	if err != nil {
		return err
	}
	dupRep := importer.ValidateDuplicates(pairs, raw)
	if formatted := dupRep.FormatReport(); formatted != "" {
		fmt.Fprint(os.Stderr, formatted)
	}
	fmt.Fprintf(os.Stdout, "validated %d duplicate pair(s): %d error(s)\n", len(pairs), len(dupRep.Errors))

	phasesPath := filepath.Join(filepath.Dir(jsonPath), "phases.json")
	replays, err := loadValidationReplays(phasesPath)
	if err != nil {
		return err
	}
	replayRep := importer.ValidateReplays(replays)
	if formatted := replayRep.FormatReport(); formatted != "" {
		fmt.Fprint(os.Stderr, formatted)
	}
	fmt.Fprintf(os.Stdout, "validated %d replay(s): %d error(s)\n", len(replays), len(replayRep.Errors))

	warsRep, nWars, nSnaps, err := validateWarKeys(filepath.Dir(jsonPath), raw)
	if err != nil {
		return err
	}
	if formatted := warsRep.FormatReport(); formatted != "" {
		fmt.Fprint(os.Stderr, formatted)
	}
	fmt.Fprintf(os.Stdout, "validated %d war(s) and %d snapshot key(s): %d error(s)\n", nWars, nSnaps,
		len(warsRep.Errors))

	if n := len(rep.Errors) + len(dupRep.Errors) + len(replayRep.Errors) + len(warsRep.Errors); n > 0 {
		return fmt.Errorf("%d blocking issue(s) found", n)
	}
	return nil
}

// validateWarKeys checks the war keys in wars.json next to the curated data,
// the territory snapshot keys in the frontend source, and the curated
// battles' war names. A missing snapshot source is skipped.
func validateWarKeys(dataDir string, curated []battles.Battle) (importer.ValidationReport, int, int, error) {
	var rep importer.ValidationReport
	warsPath := filepath.Join(dataDir, "wars.json")
	data, err := os.ReadFile(warsPath)
	if err != nil {
		return rep, 0, 0, fmt.Errorf("read %s: %w", warsPath, err)
	}
	var wars map[string]battles.WarNarrative
	if err := json.Unmarshal(data, &wars); err != nil {
		return rep, 0, 0, fmt.Errorf("parse %s: %w", warsPath, err)
	}
	var keys []string
	snapPath := filepath.Join(dataDir, "..", "web", "src", "data", "territory-snapshots.ts")
	src, err := os.ReadFile(snapPath)
	switch {
	case errors.Is(err, os.ErrNotExist):
		log.Printf("validate: %s not found, snapshot keys not checked", snapPath)
	case err != nil:
		return rep, 0, 0, fmt.Errorf("read %s: %w", snapPath, err)
	default:
		keys = importer.SnapshotWarKeys(string(src))
	}
	return importer.ValidateWars(wars, keys, curated), len(wars), len(keys), nil
}

// loadValidationReplays reads the served replay file. A missing file is not an error.
func loadValidationReplays(path string) (map[string]battles.Replay, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var out map[string]battles.Replay
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return out, nil
}

// loadValidationCuratedDir duplicates the small directory walk used by
// ImportJSON because validate runs before the DB is open and we want the
// reader to be standalone. Missing directory is not an error.
func loadValidationCuratedDir(dir string) ([]battles.Battle, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read curated dir %s: %w", dir, err)
	}
	var out []battles.Battle
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			continue
		}
		full := filepath.Join(dir, e.Name())
		data, err := os.ReadFile(full)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", full, err)
		}
		var arr []battles.Battle
		if err := json.Unmarshal(data, &arr); err == nil {
			out = append(out, arr...)
			continue
		}
		var one battles.Battle
		if err := json.Unmarshal(data, &one); err != nil {
			return nil, fmt.Errorf("parse %s: %w", full, err)
		}
		out = append(out, one)
	}
	return out, nil
}
