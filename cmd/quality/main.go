// Command quality scores every battle in the catalog and writes a
// per-era / per-region / per-war completeness report. The score is a
// deterministic function of which fields are populated, not of factual
// accuracy: a perfectly true entry that lacks coordinates still ranks low,
// and a fully populated stub of a battle that did not happen ranks high.
// Use the report to direct curation effort; do not treat it as truth.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/dcadolph/battlesight/internal/db"
	"github.com/dcadolph/battlesight/internal/quality"
)

func main() {
	dbPath := flag.String("db", "data/battlesight.db", "path to SQLite database")
	out := flag.String("out", "", "output markdown path. Defaults to ~/Downloads/battlesight-quality-YYYYMMDD.md")
	flag.Parse()

	if *out == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatalf("locate home dir: %v", err)
		}
		stamp := time.Now().Format("20060102")
		*out = filepath.Join(home, "Downloads", "battlesight-quality-"+stamp+".md")
	}

	database, err := db.Open(*dbPath)
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
