package battles

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
)

// maxCachedBodies bounds the response cache. Filtered list requests vary
// with the year slider, so the cache starts over rather than grow without
// limit once this many distinct requests have been seen.
const maxCachedBodies = 64

// dataVersion identifies the data a cached body was built from. The database
// is written only at startup, so the hot-reloaded replay and war registries
// are the only runtime sources of change.
type dataVersion struct {
	// replays is the replay registry generation.
	replays uint64
	// wars is the war registry generation.
	wars uint64
}

// cachedBody is one encoded JSON response.
type cachedBody struct {
	// version is the data the body was built from.
	version dataVersion
	// body is the encoded JSON, newline-terminated like json.Encoder output.
	body []byte
	// etag is the weak validator sent with the body.
	etag string
}

// responseCache holds encoded JSON bodies for the heaviest read endpoints.
// The zero value is ready to use.
type responseCache struct {
	// mu guards entries.
	mu sync.Mutex
	// entries maps a request key to its cached body.
	entries map[string]cachedBody
}

// get returns the body cached under key if it was built from version.
func (c *responseCache) get(key string, version dataVersion) (cachedBody, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || e.version != version {
		return cachedBody{}, false
	}
	return e, true
}

// put stores body under key, starting over when the cache is full.
func (c *responseCache) put(key string, e cachedBody) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil || len(c.entries) >= maxCachedBodies {
		c.entries = make(map[string]cachedBody)
	}
	c.entries[key] = e
}

// version returns the current data version of the handler's registries.
func (h *Handler) version() dataVersion {
	return dataVersion{replays: h.replays.Generation(), wars: h.wars.Generation()}
}

// serveCached writes the JSON body cached under key, building it with build
// when the cache holds nothing current. The response carries a weak ETag and
// asks the browser to revalidate, so a repeat visit costs a 304 and no body.
// A build error is logged and answered with failMsg.
func (h *Handler) serveCached(w http.ResponseWriter, r *http.Request, key, failMsg string, build func() (any, error)) {
	version := h.version()
	e, ok := h.cache.get(key, version)
	if !ok {
		v, err := build()
		if err != nil {
			log.Printf("%s: %v", failMsg, err)
			writeError(w, http.StatusInternalServerError, failMsg)
			return
		}
		body, err := json.Marshal(v)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to encode response")
			return
		}
		body = append(body, '\n')
		sum := sha256.Sum256(body)
		e = cachedBody{version: version, body: body, etag: `W/"` + hex.EncodeToString(sum[:8]) + `"`}
		h.cache.put(key, e)
	}
	w.Header().Set("ETag", e.etag)
	w.Header().Set("Cache-Control", "no-cache")
	if etagMatches(r.Header.Get("If-None-Match"), e.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(e.body) //nolint:errcheck // Client disconnects are not actionable.
}

// etagMatches reports whether an If-None-Match header names etag, using the
// weak comparison RFC 9110 requires for If-None-Match.
func etagMatches(header, etag string) bool {
	if header == "" {
		return false
	}
	want := strings.TrimPrefix(etag, "W/")
	for _, tag := range strings.Split(header, ",") {
		tag = strings.TrimSpace(tag)
		if tag == "*" || strings.TrimPrefix(tag, "W/") == want {
			return true
		}
	}
	return false
}
