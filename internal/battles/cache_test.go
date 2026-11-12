package battles

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/dcadolph/battlesight/internal/db"
)

// openCacheStore seeds a temp db with three verified battles in two eras.
func openCacheStore(t *testing.T) *Store {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "cache.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	for i, era := range []string{"modern", "modern", "ancient"} {
		_, err := conn.ExecContext(context.Background(), `INSERT INTO battles (id, name, year, date, lat, lng,
			era, war, battle_type, victor, summary, significance, verified) VALUES (?, ?, ?, '', 1, 1, ?, '',
			'land', '', '', '', 1)`, fmt.Sprintf("b%d", i), fmt.Sprintf("Battle %d", i), 1000+i, era)
		if err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}
	return NewStore(conn)
}

// cacheResult is the part of a response the cache tests compare.
type cacheResult struct {
	// Status is the HTTP status code.
	Status int
	// CacheControl is the Cache-Control header.
	CacheControl string
	// HasETag reports whether an ETag header was sent.
	HasETag bool
	// EmptyBody reports whether the body was empty.
	EmptyBody bool
}

// getCached sends a GET for target with an optional If-None-Match header and
// returns the comparable result, the ETag, and the decoded body.
func getCached(t *testing.T, mux *http.ServeMux, target, ifNoneMatch string) (cacheResult, string, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	etag := rec.Header().Get("ETag")
	res := cacheResult{
		Status:       rec.Code,
		CacheControl: rec.Header().Get("Cache-Control"),
		HasETag:      etag != "",
		EmptyBody:    rec.Body.Len() == 0,
	}
	var body map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode %s: %v", target, err)
		}
	}
	return res, etag, body
}

// TestServeCached verifies that stats and the lean list answer a matching
// If-None-Match with 304, and that a replay reload invalidates both.
func TestServeCached(t *testing.T) {
	t.Parallel()
	store := openCacheStore(t)
	replays := NewReplays()
	h := NewHandler(store, replays, NewWars())
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	ok := cacheResult{Status: http.StatusOK, CacheControl: "no-cache", HasETag: true}
	notModified := cacheResult{Status: http.StatusNotModified, CacheControl: "no-cache", HasETag: true, EmptyBody: true}

	for _, target := range []string{"/api/battles/stats", "/api/battles?lean=1"} {
		// Test 0: A first request gets the body with a validator.
		got, etag, _ := getCached(t, mux, target, "")
		if diff := cmp.Diff(ok, got); diff != "" {
			t.Errorf("%s first request mismatch (-want +got):\n%s", target, diff)
		}
		// Test 1: The same validator gets a 304 with no body.
		got, again, _ := getCached(t, mux, target, etag)
		if diff := cmp.Diff(notModified, got); diff != "" {
			t.Errorf("%s revalidation mismatch (-want +got):\n%s", target, diff)
		}
		if again != etag {
			t.Errorf("%s etag changed with no data change: %s then %s", target, etag, again)
		}
		// Test 2: A stale validator gets the full body.
		got, _, _ = getCached(t, mux, target, `W/"stale"`)
		if diff := cmp.Diff(ok, got); diff != "" {
			t.Errorf("%s stale validator mismatch (-want +got):\n%s", target, diff)
		}
	}

	// Test 3: A filtered lean list is cached under its own key.
	_, all, body := getCached(t, mux, "/api/battles?lean=1", "")
	_, ancient, ancientBody := getCached(t, mux, "/api/battles?era=ancient&lean=1", "")
	if all == ancient {
		t.Errorf("filtered and unfiltered lists share etag %s", all)
	}
	if diff := cmp.Diff([]any{float64(3), float64(1)}, []any{body["total"], ancientBody["total"]}); diff != "" {
		t.Errorf("list totals mismatch (-want +got):\n%s", diff)
	}

	// Test 4: A replay reload changes stats and the list, so old validators miss.
	_, statsTag, statsBody := getCached(t, mux, "/api/battles/stats", "")
	if statsBody["replayCount"] != float64(0) {
		t.Fatalf("replayCount before reload: want 0, got %v", statsBody["replayCount"])
	}
	phases := filepath.Join(t.TempDir(), "phases.json")
	if err := os.WriteFile(phases, []byte(`{"b0":{}}`), 0o600); err != nil {
		t.Fatalf("write phases: %v", err)
	}
	if _, err := replays.Load(phases); err != nil {
		t.Fatalf("load phases: %v", err)
	}
	got, _, statsBody := getCached(t, mux, "/api/battles/stats", statsTag)
	if diff := cmp.Diff(ok, got); diff != "" {
		t.Errorf("stats after reload mismatch (-want +got):\n%s", diff)
	}
	if statsBody["replayCount"] != float64(1) {
		t.Errorf("replayCount after reload: want 1, got %v", statsBody["replayCount"])
	}
	got, _, _ = getCached(t, mux, "/api/battles?lean=1", all)
	if diff := cmp.Diff(ok, got); diff != "" {
		t.Errorf("list after reload mismatch (-want +got):\n%s", diff)
	}
}

// TestEtagMatches verifies weak comparison against If-None-Match lists.
func TestEtagMatches(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Header     string
		WantResult bool
	}{{ // Test 0: No header never matches.
		Header: "", WantResult: false,
	}, { // Test 1: The same weak tag matches.
		Header: `W/"abc"`, WantResult: true,
	}, { // Test 2: A strong tag with the same value matches weakly.
		Header: `"abc"`, WantResult: true,
	}, { // Test 3: A list matches when any entry does.
		Header: `"x", W/"abc"`, WantResult: true,
	}, { // Test 4: A wildcard matches.
		Header: "*", WantResult: true,
	}, { // Test 5: A different tag does not match.
		Header: `W/"abd"`, WantResult: false,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if got := etagMatches(test.Header, `W/"abc"`); got != test.WantResult {
				t.Errorf("etagMatches(%q): want %v, got %v", test.Header, test.WantResult, got)
			}
		})
	}
}

// TestResponseCacheBound verifies the cache starts over once it is full.
func TestResponseCacheBound(t *testing.T) {
	t.Parallel()
	var c responseCache
	for i := range maxCachedBodies + 1 {
		c.put(fmt.Sprintf("k%d", i), cachedBody{})
	}
	if n := len(c.entries); n != 1 {
		t.Errorf("entries after overflow: want 1, got %d", n)
	}
	if _, ok := c.get(fmt.Sprintf("k%d", maxCachedBodies), dataVersion{}); !ok {
		t.Errorf("newest entry missing after overflow")
	}
}
