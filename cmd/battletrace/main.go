package main

import (
	"flag"
	"log"

	"github.com/dcadolph/battletrace/internal/server"
)

func main() {
	port := flag.Int("port", 8080, "server port")
	dbPath := flag.String("db", "data/battletrace.db", "path to SQLite database")
	seed := flag.String("seed", "data/battles.json", "path to JSON file to seed on startup (empty to skip)")
	phases := flag.String("phases", "data/phases.json", "path to JSON file of battle replays (empty to skip)")
	flag.Parse()

	cfg := server.Config{
		Port:       *port,
		DBPath:     *dbPath,
		SeedPath:   *seed,
		PhasesPath: *phases,
	}

	if err := server.Run(cfg); err != nil {
		log.Fatal(err)
	}
}
