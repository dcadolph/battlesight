package battles

import (
	"net/http"
	"sort"
)

// CurrentWars is the set of wars the sourced status in wars.json marks as
// ongoing, served to the landing globe's current-conflicts view.
type CurrentWars struct {
	// Current holds every war key and alias whose war is ongoing, sorted.
	Current []string `json:"current"`
	// Missing holds the war keys with neither a start nor an end year on
	// their whole parent chain, sorted. They are missing data, not ongoing.
	Missing []string `json:"missing"`
}

// warStatus is the sourced status of one war.
type warStatus int

const (
	// statusMissing means nothing on the war's parent chain dates it.
	statusMissing warStatus = iota
	// statusEnded means the deciding entry has an end year.
	statusEnded
	// statusOngoing means the deciding entry has a start year and no end year.
	statusOngoing
)

// resolveStatus walks from name up its parent chain to the first entry that
// carries a start or end year, which decides the war's status. A child with
// no years of its own inherits its parent's status. A cycle or a parent that
// is not a key ends the walk as missing.
func resolveStatus(wars map[string]WarNarrative, name string) warStatus {
	seen := map[string]bool{}
	for {
		w, ok := wars[name]
		if !ok || seen[name] {
			return statusMissing
		}
		seen[name] = true
		switch {
		case w.StartYear != 0 && w.EndYear == 0:
			return statusOngoing
		case w.StartYear != 0 || w.EndYear != 0:
			return statusEnded
		case w.Parent == "":
			return statusMissing
		}
		name = w.Parent
	}
}

// ClassifyCurrent returns the ongoing war names, each key with its aliases,
// and the keys that no year on their chain dates.
func ClassifyCurrent(wars map[string]WarNarrative) CurrentWars {
	out := CurrentWars{Current: []string{}, Missing: []string{}}
	for name, w := range wars {
		switch resolveStatus(wars, name) {
		case statusOngoing:
			out.Current = append(out.Current, name)
			out.Current = append(out.Current, w.Aliases...)
		case statusMissing:
			out.Missing = append(out.Missing, name)
		}
	}
	sort.Strings(out.Current)
	sort.Strings(out.Missing)
	return out
}

// Current returns the ongoing and undated wars of the loaded registry.
func (w *Wars) Current() CurrentWars {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return ClassifyCurrent(w.byName)
}

// currentWars serves the ongoing war names so the client can mark a battle
// current by its war label without shipping wars.json.
func (h *Handler) currentWars(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, h.wars.Current())
}
