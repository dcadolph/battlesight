package battles

import (
	"encoding/json"
	"math/rand/v2"
	"net/http"
	"strconv"
)

// Handler serves the battle API endpoints.
type Handler struct {
	// store is the battle data store.
	store *Store
	// replays is the in-memory phase registry.
	replays *Replays
}

// NewHandler creates a handler backed by the given store and replay registry.
// A nil replay registry is treated as empty.
func NewHandler(store *Store, replays *Replays) *Handler {
	if store == nil {
		panic("battles.NewHandler: store required")
	}
	if replays == nil {
		replays = NewReplays()
	}
	return &Handler{store: store, replays: replays}
}

// RegisterRoutes mounts battle endpoints on the given mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/battles/search", h.searchBattles)
	mux.HandleFunc("GET /api/battles/stats", h.stats)
	mux.HandleFunc("GET /api/battles/featured", h.featured)
	mux.HandleFunc("GET /api/battles/replays", h.replayList)
	mux.HandleFunc("GET /api/battles/{id}/replay", h.getReplay)
	mux.HandleFunc("GET /api/battles/{id}", h.getBattle)
	mux.HandleFunc("GET /api/battles", h.listBattles)
}

// listBattles returns battles matching optional filter parameters.
func (h *Handler) listBattles(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := Filter{
		Era:            q.Get("era"),
		War:            q.Get("war"),
		BattleType:     q.Get("battleType"),
		YearMin:        queryInt(q, "yearMin"),
		YearMax:        queryInt(q, "yearMax"),
		Limit:          queryInt(q, "limit"),
		Offset:         queryInt(q, "offset"),
		IncludeNoCoord: q.Get("includeNoCoord") == "1",
		Quality:        q.Get("quality"),
	}

	results, total, err := h.store.List(r.Context(), f)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list battles")
		return
	}
	if results == nil {
		results = []Battle{}
	}
	h.markHasReplay(results)

	limit := f.Limit
	if limit <= 0 {
		limit = 10000
	}

	writeJSON(w, http.StatusOK, ListResponse{
		Battles: results,
		Total:   total,
		Limit:   limit,
		Offset:  f.Offset,
	})
}

// searchBattles performs full-text search.
func (h *Handler) searchBattles(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeError(w, http.StatusBadRequest, "query parameter 'q' required")
		return
	}

	limit := queryInt(r.URL.Query(), "limit")
	if limit <= 0 {
		limit = 50
	}
	offset := queryInt(r.URL.Query(), "offset")

	results, total, err := h.store.Search(r.Context(), q, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	if results == nil {
		results = []Battle{}
	}
	h.markHasReplay(results)

	writeJSON(w, http.StatusOK, ListResponse{
		Battles: results,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
	})
}

// stats returns aggregate counts for the filter UI.
func (h *Handler) stats(w http.ResponseWriter, r *http.Request) {
	s, err := h.store.Stats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load stats")
		return
	}
	s.ReplayCount = h.replays.Count()
	writeJSON(w, http.StatusOK, s)
}

// getBattle returns a single battle by ID.
func (h *Handler) getBattle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	battle, ok, err := h.store.ByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load battle")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "battle not found")
		return
	}
	battle.HasReplay = h.replays.Has(battle.ID)

	writeJSON(w, http.StatusOK, battle)
}

// getReplay returns the phase data for a battle, if any exists.
func (h *Handler) getReplay(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rep, ok := h.replays.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "no replay for this battle")
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

// replayList returns the list of battle IDs that have a phased replay.
func (h *Handler) replayList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ids":   h.replays.IDs(),
		"count": h.replays.Count(),
	})
}

// featured returns a single curated battle to show on first load. Prefers
// battles with a hand-crafted replay so cold visitors immediately see the
// product's killer feature. Falls back to any verified battle.
func (h *Handler) featured(w http.ResponseWriter, r *http.Request) {
	ids := h.replays.IDs()
	if len(ids) > 0 {
		// Pick a deterministic-by-day battle so the same visitor sees the
		// same featured item all day, but it cycles each day.
		idx := dailyIndex(len(ids))
		battle, ok, err := h.store.ByID(r.Context(), ids[idx])
		if err == nil && ok {
			battle.HasReplay = true
			writeJSON(w, http.StatusOK, battle)
			return
		}
	}

	// Fallback: any verified battle.
	battle, ok, err := h.store.RandomVerified(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load featured")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "no featured battle available")
		return
	}
	battle.HasReplay = h.replays.Has(battle.ID)
	writeJSON(w, http.StatusOK, battle)
}

// markHasReplay sets HasReplay on each battle in the slice based on the registry.
func (h *Handler) markHasReplay(battles []Battle) {
	for i := range battles {
		battles[i].HasReplay = h.replays.Has(battles[i].ID)
	}
}

// dailyIndex picks a stable index that rotates once per day.
func dailyIndex(n int) int {
	if n <= 0 {
		return 0
	}
	return rand.IntN(n)
}

// writeJSON encodes v as JSON and writes it to the response.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// queryInt reads an integer query parameter, returning 0 if absent or invalid.
func queryInt(q interface{ Get(string) string }, key string) int {
	v := q.Get(key)
	if v == "" {
		return 0
	}
	n, _ := strconv.Atoi(v)
	return n
}
