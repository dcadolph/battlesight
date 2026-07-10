package main

import (
	"flag"
	"log"

	"github.com/dcadolph/battlesight/internal/server"
)

func main() {
	port := flag.Int("port", 8080, "server port")
	dbPath := flag.String("db", "data/battlesight.db", "path to SQLite database")
	seed := flag.String("seed", "data/battles.json", "path to JSON file to seed on startup (empty to skip)")
	phases := flag.String("phases", "data/phases.json", "path to JSON file of battle replays (empty to skip)")
	wars := flag.String("wars", "data/wars.json", "path to JSON file of curated war narratives (empty to skip)")
	static := flag.String("static", "web/dist", "path to built frontend to serve on non-API routes (empty to skip)")
	flag.Parse()

	cfg := server.Config{
		Port:       *port,
		DBPath:     *dbPath,
		SeedPath:   *seed,
		PhasesPath: *phases,
		WarsPath:   *wars,
		StaticDir:  *static,
	}

	if err := server.Run(cfg); err != nil {
		log.Fatal(err)
	}
}
