package importer

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// wikiCacheRoot is the on-disk root for Wikipedia/Wikidata response caching.
// Cached under data/ so the directory lives next to the SQLite DB and gets
// purged together when the data directory is wiped for a clean rebuild.
// Gitignored.
const wikiCacheRoot = "data/.wikicache"

// wikiCachePath returns the on-disk path for a given Wikipedia page title
// and namespace tag (e.g. "wikitext", "extract", "coords", "war-wikitext").
// Uses a two-level sha1-based fanout so any one directory stays well under
// the OS practical limit for entry count.
func wikiCachePath(namespace, title string) string {
	h := sha1.Sum([]byte(title))
	hex := hex.EncodeToString(h[:])
	return filepath.Join(wikiCacheRoot, namespace, hex[:2], hex[2:4], hex+".txt")
}

// wikiCacheGet returns the cached bytes for a (namespace, title) pair. Returns
// ("", false) when the entry is missing or unreadable; callers should treat
// any miss as a fetch-required signal rather than an error.
func wikiCacheGet(namespace, title string) (string, bool) {
	data, err := os.ReadFile(wikiCachePath(namespace, title))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", false
		}
		return "", false
	}
	return string(data), true
}

// wikiCacheSet writes the value to disk, creating the namespace and fanout
// directories on demand. Errors are swallowed because caching is best-effort:
// a cache write failure must not abort the enrichment run.
func wikiCacheSet(namespace, title, value string) {
	path := wikiCachePath(namespace, title)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(path, []byte(value), 0o644)
}
