package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/dcadolph/battletrace/internal/battles"
	"github.com/dcadolph/battletrace/internal/db"
	"github.com/dcadolph/battletrace/internal/importer"
)

func main() {
	dbPath := flag.String("db", "data/battletrace.db", "path to SQLite database")
	jsonPath := flag.String("json", "", "path to curated battles JSON file")
	wikidata := flag.Bool("wikidata", false, "import battles from Wikidata SPARQL")
	enrich := flag.Bool("enrich", false, "fetch Wikipedia summaries for battles missing them")
	infobox := flag.Bool("infobox", false, "fetch Wikipedia infobox data (sides, commanders, casualties)")
	all := flag.Bool("all", false, "run all import and enrichment steps")
	validate := flag.Bool("validate", false, "validate curated JSON + curated/ dir without writing to the DB; exits non-zero on any error")
	flag.Parse()

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
		*enrich = true
		*infobox = true
		if *jsonPath == "" {
			*jsonPath = "data/battles.json"
		}
	}

	if *jsonPath == "" && !*wikidata && !*enrich && !*infobox {
		log.Fatal("at least one action required: -json, -wikidata, -enrich, -infobox, -validate, or -all")
	}

	database, err := db.Open(*dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()

	ctx := context.Background()

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
		log.Println("enriching with Wikipedia infobox data (sides, commanders, casualties, dates)...")
		count, err := importer.EnrichInfoboxes(ctx, database)
		if err != nil {
			log.Fatalf("infobox enrichment failed: %v", err)
		}
		log.Printf("enriched %d battles with infobox data", count)

		log.Println("enriching coordinates from Wikipedia for battles missing them...")
		coordCount, err := importer.EnrichCoordinates(ctx, database)
		if err != nil {
			log.Printf("coordinate enrichment failed: %v (continuing)", err)
		} else {
			log.Printf("enriched %d battles with coordinates", coordCount)
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
	if rep.HasErrors() {
		return fmt.Errorf("%d blocking issue(s) found", len(rep.Errors))
	}
	return nil
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
