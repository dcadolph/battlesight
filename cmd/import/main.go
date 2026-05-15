package main

import (
	"context"
	"flag"
	"log"

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
	flag.Parse()

	if *all {
		*wikidata = true
		*enrich = true
		*infobox = true
		if *jsonPath == "" {
			*jsonPath = "data/battles.json"
		}
	}

	if *jsonPath == "" && !*wikidata && !*enrich && !*infobox {
		log.Fatal("at least one action required: -json, -wikidata, -enrich, -infobox, or -all")
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
		log.Println("enriching with Wikipedia infobox data (sides, commanders, casualties)...")
		count, err := importer.EnrichInfoboxes(ctx, database)
		if err != nil {
			log.Fatalf("infobox enrichment failed: %v", err)
		}
		log.Printf("enriched %d battles with infobox data", count)
	}
}
