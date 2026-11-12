package server

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// newStaticDir writes a minimal built frontend into a temp dir.
func newStaticDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"index.html":           "<!doctype html>",
		"favicon.svg":          "<svg/>",
		"assets/index-abc1.js": "console.log(1)",
	}
	for name, body := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return dir
}

// staticResult is the part of a static response the tests compare.
type staticResult struct {
	// Status is the HTTP status code.
	Status int
	// CacheControl is the Cache-Control header.
	CacheControl string
	// Body is the response body.
	Body string
}

// TestStaticHandlerCaching verifies hashed assets are immutable and the page
// itself is revalidated on every load.
func TestStaticHandlerCaching(t *testing.T) {
	t.Parallel()
	h := staticHandler(newStaticDir(t))
	tests := []struct {
		WantResult staticResult
		Path       string
	}{{ // Test 0: A hashed asset is cached for a year.
		Path:       "/assets/index-abc1.js",
		WantResult: staticResult{Status: http.StatusOK, CacheControl: immutableCache, Body: "console.log(1)"},
	}, { // Test 1: The root serves index.html with no-cache.
		Path:       "/",
		WantResult: staticResult{Status: http.StatusOK, CacheControl: "no-cache", Body: "<!doctype html>"},
	}, { // Test 2: A client route falls back to index.html with no-cache.
		Path:       "/battle/waterloo",
		WantResult: staticResult{Status: http.StatusOK, CacheControl: "no-cache", Body: "<!doctype html>"},
	}, { // Test 3: A missing asset falls back to index.html, never immutable.
		Path:       "/assets/gone-zzz9.js",
		WantResult: staticResult{Status: http.StatusOK, CacheControl: "no-cache", Body: "<!doctype html>"},
	}, { // Test 4: An unhashed root file gets no long cache.
		Path:       "/favicon.svg",
		WantResult: staticResult{Status: http.StatusOK, CacheControl: "", Body: "<svg/>"},
	}, { // Test 5: Unmatched API routes 404 with no cache header.
		Path:       "/api/nope",
		WantResult: staticResult{Status: http.StatusNotFound, CacheControl: "", Body: "404 page not found\n"},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, test.Path, nil))
			got := staticResult{Status: rec.Code, CacheControl: rec.Header().Get("Cache-Control"), Body: rec.Body.String()}
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// gzipResult is the part of a gzip-wrapped response the tests compare.
type gzipResult struct {
	// Status is the HTTP status code.
	Status int
	// Encoding is the Content-Encoding header.
	Encoding string
	// Body is the decoded response body.
	Body string
}

// TestWithGzip verifies bodies are compressed and bodiless statuses carry no
// gzip stream or Content-Encoding.
func TestWithGzip(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult gzipResult
		Status     int
	}{{ // Test 0: A 200 body is gzipped.
		Status: http.StatusOK, WantResult: gzipResult{Status: http.StatusOK, Encoding: "gzip", Body: "hello"},
	}, { // Test 1: A 304 has no encoding and no body.
		Status: http.StatusNotModified, WantResult: gzipResult{Status: http.StatusNotModified},
	}, { // Test 2: A 204 has no encoding and no body.
		Status: http.StatusNoContent, WantResult: gzipResult{Status: http.StatusNoContent},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.Status)
				if test.Status == http.StatusOK {
					w.Write([]byte("hello")) //nolint:errcheck // Irrelevant for this test.
				}
			})
			srv := httptest.NewServer(withGzip(withCORS(inner)))
			t.Cleanup(srv.Close)
			req, err := http.NewRequest(http.MethodGet, srv.URL, nil)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			// Setting the header by hand turns off the transport's own decoding.
			req.Header.Set("Accept-Encoding", "gzip")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("do: %v", err)
			}
			defer resp.Body.Close()
			raw, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if diff := cmp.Diff([]string{"Accept-Encoding", "Origin"}, resp.Header.Values("Vary")); diff != "" {
				t.Errorf("vary mismatch (-want +got):\n%s", diff)
			}
			got := gzipResult{Status: resp.StatusCode, Encoding: resp.Header.Get("Content-Encoding"), Body: string(raw)}
			if got.Encoding == "gzip" {
				zr, err := gzip.NewReader(bytes.NewReader(raw))
				if err != nil {
					t.Fatalf("gzip reader: %v", err)
				}
				plain, err := io.ReadAll(zr)
				if err != nil {
					t.Fatalf("gunzip: %v", err)
				}
				got.Body = string(plain)
			}
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
