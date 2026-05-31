package server

import (
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/dcadolph/battlesight/internal/battles"
	"github.com/dcadolph/battlesight/internal/db"
	"github.com/dcadolph/battlesight/internal/importer"
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

	// Re-parse date_start / date_end for every row using the current
	// ParseDateRange. Idempotent; rewrites only rows that disagree. This is
	// where chronological order comes from for both curated and
	// Wikidata-imported battles, so any fix to the parser propagates the
	// next time the server starts without needing a full data re-import.
	if updated, err := importer.MigrateDates(context.Background(), database); err != nil {
		return fmt.Errorf("migrate dates: %w", err)
	} else if updated > 0 {
		log.Printf("repaired date_start/date_end for %d battles", updated)
	}

	// Cleanse: strip wiki/HTML markup leftovers, back-fill missing date
	// strings, align off-by-one BC years to the prose date, recompute era,
	// canonicalise war-name spelling variants, and drop duplicate Wikipedia
	// rows. Idempotent. Drives the audit error count toward zero on every
	// start.
	if rep, err := importer.Cleanse(context.Background(), database); err != nil {
		return fmt.Errorf("cleanse data: %w", err)
	} else if rep.Total() > 0 {
		log.Printf("cleansed data: %d battle text, %d sides, %d missing-date backfilled, %d years aligned, %d years derived, %d eras recomputed, %d blank sides dropped, %d war-name variants merged, %d duplicates removed",
			rep.BattleTextFixed, rep.SideTextFixed, rep.MissingDatesBackfilled,
			rep.YearsAligned, rep.YearsDerived, rep.ErasRecomputed,
			rep.BlankSidesDropped, rep.WarNamesCanonicalised,
			rep.DuplicatesRemoved)
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

	stats, err := store.Stats(context.Background(), wars)
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
		Handler:           withGzip(withCORS(mux)),
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

// gzipResponseWriter wraps an http.ResponseWriter and transparently gzips
// every byte written. WriteHeader is overridden to strip any Content-Length
// the inner handler may have set, since the compressed length will differ.
type gzipResponseWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
}

// Write delegates to the underlying gzip writer.
func (g *gzipResponseWriter) Write(p []byte) (int, error) {
	return g.gz.Write(p)
}

// WriteHeader strips any Content-Length the inner handler set since the
// compressed length will differ from the raw byte count.
func (g *gzipResponseWriter) WriteHeader(status int) {
	g.Header().Del("Content-Length")
	g.ResponseWriter.WriteHeader(status)
}

// withGzip compresses response bodies when the client advertises gzip in
// Accept-Encoding. JSON payloads from the list endpoints compress 8-10x,
// which is the difference between a 17 MB initial fetch and a 2 MB one.
// OPTIONS preflight requests bypass the wrapper since they have no body.
func withGzip(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")

		gz := gzip.NewWriter(w)
		defer func() {
			if err := gz.Close(); err != nil {
				log.Printf("gzip writer close: %v", err)
			}
		}()
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, gz: gz}, r)
	})
}

// Compile-time guarantee that gzip's Writer satisfies io.WriteCloser so
// callers can rely on Close to flush the trailer.
var _ io.WriteCloser = (*gzip.Writer)(nil)
