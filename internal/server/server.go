package server

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/dcadolph/battletrace/internal/battles"
	"github.com/dcadolph/battletrace/internal/db"
	"github.com/dcadolph/battletrace/internal/importer"
)

// Config holds server configuration.
type Config struct {
	// Port is the TCP port to listen on.
	Port int
	// DBPath is the path to the SQLite database file.
	DBPath string
	// SeedPath is an optional path to a JSON file to seed the database on startup.
	SeedPath string
}

// Run starts the HTTP server and blocks until it exits.
func Run(cfg Config) error {
	database, err := db.Open(cfg.DBPath)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer database.Close()

	if cfg.SeedPath != "" {
		count, err := importer.ImportJSON(context.Background(), database, cfg.SeedPath)
		if err != nil {
			return fmt.Errorf("seed database: %w", err)
		}
		if count > 0 {
			log.Printf("seeded %d battles from %s", count, cfg.SeedPath)
		}
	}

	store := battles.NewStore(database)

	stats, err := store.Stats(context.Background())
	if err != nil {
		return fmt.Errorf("load stats: %w", err)
	}
	log.Printf("database has %d battles", stats.TotalBattles)

	mux := http.NewServeMux()

	bh := battles.NewHandler(store)
	bh.RegisterRoutes(mux)

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("listening on %s", addr)

	return http.ListenAndServe(addr, mux)
}
