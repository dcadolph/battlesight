// Command quality scores every battle in the catalog and writes a
// per-era / per-region / per-war completeness report. The score is a
// deterministic function of which fields are populated, not of factual
// accuracy: a perfectly true entry that lacks coordinates still ranks low,
// and a fully populated stub of a battle that did not happen ranks high.
// Use the report to direct curation effort; do not treat it as truth.
//
// With -mismatch it instead opens the database read-only and prints one line
// per correctness class (dates, wars, coordinates, duplicates, sides) with its
// row count. -mismatch-ids prints the row ids of one class.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/dcadolph/battlesight/internal/battles"
	"github.com/dcadolph/battlesight/internal/db"
	"github.com/dcadolph/battlesight/internal/importer"
	"github.com/dcadolph/battlesight/internal/quality"
)

func main() {
	dbPath := flag.String("db", "data/battlesight.db", "path to SQLite database")
	out := flag.String("out", "", "output markdown path. Defaults to ~/Downloads/battlesight-quality-YYYYMMDD.md")
	mismatch := flag.Bool("mismatch", false, "print the correctness mismatch report and exit")
	mismatchIDs := flag.String("mismatch-ids", "", "print the row ids of one mismatch class and exit")
	land := flag.String("land", "data/land-50m.json", "world-atlas land TopoJSON for the land-in-ocean class")
	enrichDir := flag.String("year-enrich", "data/.wikicache/year-enrich", "retired year-enrich cache directory")
	phasesPath := flag.String("phases", "data/phases.json", "replay file checked for orphan keys by -mismatch")
	refsPath := flag.String("references", "data/references.json", "references file checked for orphan keys by -mismatch")
	warsPath := flag.String("wars", "data/wars.json",
		"war registry whose spans the war-outside-span class checks")
	flag.Parse()

	if *mismatch || *mismatchIDs != "" {
		err := runMismatch(*dbPath, *land, *enrichDir, *phasesPath, *refsPath, *warsPath, *mismatchIDs)
		if err != nil {
			log.Fatalf("mismatch report: %v", err)
		}
		return
	}

	if *out == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatalf("locate home dir: %v", err)
		}
		stamp := time.Now().Format("20060102")
		*out = filepath.Join(home, "Downloads", "battlesight-quality-"+stamp+".md")
	}

	database, err := db.OpenReadOnly(*dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()

	ctx := context.Background()
	rep, err := quality.Compute(ctx, database)
	if err != nil {
		log.Fatalf("compute quality: %v", err)
	}

	f, err := os.Create(*out)
	if err != nil {
		log.Fatalf("create %s: %v", *out, err)
	}
	defer f.Close()
	if err := quality.WriteMarkdown(f, rep); err != nil {
		log.Fatalf("write markdown: %v", err)
	}

	fmt.Printf("scored %d battles; avg %.1f / 100\n", rep.Total, rep.Average)
	fmt.Printf("excellent: %d | good: %d | thin: %d | stub: %d\n",
		rep.Distribution["excellent"], rep.Distribution["good"],
		rep.Distribution["thin"], rep.Distribution["stub"])
	fmt.Printf("report written to %s\n", *out)
}

// runMismatch prints the mismatch report, or the ids of one class when class is set.
func runMismatch(dbPath, landPath, enrichDir, phasesPath, refsPath, warsPath, class string) error {
	database, err := db.OpenReadOnly(dbPath)
	if err != nil {
		return err
	}
	defer database.Close()

	in, err := importer.LoadAuditInput(context.Background(), database, battles.DocumentedCondition(), enrichDir)
	if err != nil {
		return err
	}
	if landPath != "" {
		mask, err := importer.LoadLandMask(landPath)
		if err != nil {
			return err
		}
		in.Land = mask
	}
	if warsPath != "" {
		wars := battles.NewWars()
		if _, err := wars.Load(warsPath); err != nil {
			return err
		}
		in.WarSpans = importer.WarSpans(wars.All())
	}
	if in.ReplayIDs, err = importer.LoadJSONKeys(phasesPath); err != nil {
		return err
	}
	if in.ReferenceIDs, err = importer.LoadJSONKeys(refsPath); err != nil {
		return err
	}

	classes := importer.Mismatches(in)
	if class != "" {
		for _, c := range classes {
			if c.Key != class {
				continue
			}
			if c.NA != "" {
				return fmt.Errorf("class %s not computed: %s", class, c.NA)
			}
			for _, id := range c.IDs {
				fmt.Println(id)
			}
			return nil
		}
		return fmt.Errorf("unknown class %q", class)
	}
	fmt.Printf("mismatch report: %d battles, %d side rows\n", len(in.Rows), len(in.Sides))
	for _, c := range classes {
		if c.NA != "" {
			fmt.Printf("%-26s %6s  %s (%s)\n", c.Key, "n/a", c.Desc, c.NA)
			continue
		}
		fmt.Printf("%-26s %6d  %s\n", c.Key, len(c.IDs), c.Desc)
	}
	return nil
}
