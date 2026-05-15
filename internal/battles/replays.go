package battles

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

// Replays is a thread-safe-after-init registry of battle replays loaded
// from a JSON file at startup. Reads are safe without locking because the
// registry is immutable after Load returns.
type Replays struct {
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
// battle ID. Returns the number of replays loaded. Missing file is not an error.
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

	r.byID = make(map[string]Replay, len(raw))
	r.ids = make([]string, 0, len(raw))
	for id, rep := range raw {
		rep.BattleID = id
		for i := range rep.Phases {
			rep.Phases[i].Index = i
		}
		r.byID[id] = rep
		r.ids = append(r.ids, id)
	}
	sort.Strings(r.ids)
	return len(r.ids), nil
}

// Get returns the replay for a battle, or false if none exists.
func (r *Replays) Get(id string) (Replay, bool) {
	rep, ok := r.byID[id]
	return rep, ok
}

// Has reports whether the registry contains a replay for the battle.
func (r *Replays) Has(id string) bool {
	_, ok := r.byID[id]
	return ok
}

// IDs returns the sorted list of battle IDs that have replays.
func (r *Replays) IDs() []string {
	out := make([]string, len(r.ids))
	copy(out, r.ids)
	return out
}

// Count returns the number of loaded replays.
func (r *Replays) Count() int {
	return len(r.ids)
}
