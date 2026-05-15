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
	flag.Parse()

	if *jsonPath == "" {
		log.Fatal("at least one import source required: -json")
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
}
