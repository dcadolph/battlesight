package battles

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sort"
	"sync"
	"time"
)

// Replays is a thread-safe registry of battle replays loaded from a JSON file.
// Reads use RLock so multiple HTTP handlers can serve concurrently. Writes
// (Load, hot-reload) take a write lock. The file may be re-read at runtime
// via Watch — curators editing phases.json need not restart the server.
type Replays struct {
	// mu guards byID and ids during reload.
	mu sync.RWMutex
	// byID maps battle ID to its full Replay.
	byID map[string]Replay
	// ids is the sorted list of battle IDs that have replays.
	ids []string
}

// NewReplays returns an empty replay registry.
func NewReplays() *Replays {
	return &Replays{byID: map[string]Replay{}}
}

// Load reads phase data from a JSON file. The file format is a map keyed by
// battle ID. Returns the number of replays loaded. Missing file is not an
// error. Replaces any previously-loaded data atomically under the write lock.
func (r *Replays) Load(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, fmt.Errorf("read phases file: %w", err)
	}

	var raw map[string]Replay
	if err := json.Unmarshal(data, &raw); err != nil {
		return 0, fmt.Errorf("parse phases json: %w", err)
	}

	byID := make(map[string]Replay, len(raw))
	ids := make([]string, 0, len(raw))
	for id, rep := range raw {
		rep.BattleID = id
		for i := range rep.Phases {
			rep.Phases[i].Index = i
		}
		byID[id] = rep
		ids = append(ids, id)
	}
	sort.Strings(ids)

	r.mu.Lock()
	r.byID = byID
	r.ids = ids
	r.mu.Unlock()
	return len(ids), nil
}

// Watch polls the phases file every interval and reloads when its mtime
// changes. Editing phases.json no longer requires a server restart — the
// next HTTP request sees the new data within `interval`. Returns when ctx
// is cancelled. Logs reload outcomes but never panics on parse errors so a
// bad save does not take the server down.
func (r *Replays) Watch(ctx context.Context, path string, interval time.Duration) {
	if path == "" {
		return
	}
	if interval <= 0 {
		interval = time.Second
	}
	var lastMod time.Time
	if info, err := os.Stat(path); err == nil {
		lastMod = info.ModTime()
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			info, err := os.Stat(path)
			if err != nil {
				continue
			}
			if !info.ModTime().After(lastMod) {
				continue
			}
			lastMod = info.ModTime()
			n, err := r.Load(path)
			if err != nil {
				log.Printf("phases hot-reload failed (%s): %v", path, err)
				continue
			}
			log.Printf("phases hot-reloaded: %d replays from %s", n, path)
		}
	}
}

// Get returns the replay for a battle, or false if none exists.
func (r *Replays) Get(id string) (Replay, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rep, ok := r.byID[id]
	return rep, ok
}

// Has reports whether the registry contains a replay for the battle.
func (r *Replays) Has(id string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.byID[id]
	return ok
}

// IDs returns the sorted list of battle IDs that have replays.
func (r *Replays) IDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, len(r.ids))
	copy(out, r.ids)
	return out
}

// Count returns the number of loaded replays.
func (r *Replays) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.ids)
}
