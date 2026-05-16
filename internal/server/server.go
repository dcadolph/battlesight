package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

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
	// PhasesPath is the path to the battle replay JSON file.
	PhasesPath string
	// WarsPath is an optional path to a JSON file of curated war narratives
	// (Outcome, Aftermath, KeyTerms). Wars without an entry still get
	// computed stats; this file only adds curated prose on top.
	WarsPath string
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

	replays := battles.NewReplays()
	if cfg.PhasesPath != "" {
		n, err := replays.Load(cfg.PhasesPath)
		if err != nil {
			log.Printf("warning: failed to load phases from %s: %v", cfg.PhasesPath, err)
		} else if n > 0 {
			log.Printf("loaded %d battle replays from %s", n, cfg.PhasesPath)
		}
		// Hot-reload phases.json on edit. Lets curators iterate on battle
		// content without restarting the server, save the file, reload the
		// browser, see the change. The poll interval is 1s.
		go replays.Watch(context.Background(), cfg.PhasesPath, time.Second)
	}

	wars := battles.NewWars()
	if cfg.WarsPath != "" {
		n, err := wars.Load(cfg.WarsPath)
		if err != nil {
			log.Printf("warning: failed to load wars narratives from %s: %v", cfg.WarsPath, err)
		} else if n > 0 {
			log.Printf("loaded %d war narratives from %s", n, cfg.WarsPath)
		}
		go wars.Watch(context.Background(), cfg.WarsPath, time.Second)
	}

	store := battles.NewStore(database)

	stats, err := store.Stats(context.Background())
	if err != nil {
		return fmt.Errorf("load stats: %w", err)
	}
	log.Printf("database has %d battles (%d verified, %d with replays)",
		stats.TotalBattles, stats.VerifiedBattles, replays.Count())

	mux := http.NewServeMux()

	bh := battles.NewHandler(store, replays, wars)
	bh.RegisterRoutes(mux)

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("listening on %s", addr)

	srv := &http.Server{
		Addr:              addr,
		Handler:           withCORS(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	return srv.ListenAndServe()
}

// withCORS adds permissive CORS headers for local development.
// In production the API is same-origin via the Vite proxy or static asset
// pipeline; CORS here is a safety net for ad hoc clients and integrations.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
