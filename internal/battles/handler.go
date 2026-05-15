package battles

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// Handler serves the battle API endpoints.
type Handler struct {
	// store is the battle data store.
	store *Store
}

// NewHandler creates a handler backed by the given store.
func NewHandler(store *Store) *Handler {
	if store == nil {
		panic("battles.NewHandler: store required")
	}
	return &Handler{store: store}
}

// RegisterRoutes mounts battle endpoints on the given mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/battles/search", h.searchBattles)
	mux.HandleFunc("GET /api/battles/stats", h.stats)
	mux.HandleFunc("GET /api/battles/{id}", h.getBattle)
	mux.HandleFunc("GET /api/battles", h.listBattles)
}

// listBattles returns battles matching optional filter parameters.
func (h *Handler) listBattles(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := Filter{
		Era:        q.Get("era"),
		War:        q.Get("war"),
		BattleType: q.Get("battleType"),
		YearMin:    queryInt(q, "yearMin"),
		YearMax:    queryInt(q, "yearMax"),
		Limit:      queryInt(q, "limit"),
		Offset:     queryInt(q, "offset"),
	}

	results, total, err := h.store.List(r.Context(), f)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list battles")
		return
	}
	if results == nil {
		results = []Battle{}
	}

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

	writeJSON(w, http.StatusOK, battle)
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
