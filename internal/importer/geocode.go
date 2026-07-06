package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// geocodeUserAgent identifies the backfill tool per Wikimedia API etiquette.
const geocodeUserAgent = "battlesight-importer/1.0 (personal project)"

// geocodeBatchSize is the MediaWiki title cap per query for unauthenticated clients.
const geocodeBatchSize = 50

// geocodeBatchPause spaces sequential batches so the API is never hammered.
const geocodeBatchPause = 200 * time.Millisecond

// geocodeRetryPause is the floor wait before the single retry after a 429 or
// maxlag answer; a larger Retry-After header extends it.
const geocodeRetryPause = 2 * time.Second

// geocodeRetryMaxPause caps the honored Retry-After so one response cannot
// stall the run indefinitely.
const geocodeRetryMaxPause = 2 * time.Minute

// geocodeRenameHops caps normalized/redirect chain walking to break cycles.
const geocodeRenameHops = 5

// GeocodeSummary tallies the outcome of one geocode backfill run.
type GeocodeSummary struct {
	// Attempted counts battles whose title was sent to the API.
	Attempted int
	// Resolved counts battles that received acceptable coordinates.
	Resolved int
	// SkippedNoTitle counts battles with neither a wikipedia_title nor a name to try.
	SkippedNoTitle int
	// APIMiss counts battles queried but left without an acceptable coordinate.
	APIMiss int
}

// geocodeRename is one from/to entry in the normalized or redirects response arrays.
type geocodeRename struct {
	// From is the title as requested (normalized) or the redirect source.
	From string `json:"from"`
	// To is the title the entry resolves to.
	To string `json:"to"`
}

// geocodeCoordinate is one coordinate attached to a page, with its GeoData type.
type geocodeCoordinate struct {
	// Lat is the latitude in decimal degrees.
	Lat float64 `json:"lat"`
	// Lon is the longitude in decimal degrees.
	Lon float64 `json:"lon"`
	// Type is the GeoData kind, e.g. event, city, landmark, country.
	Type string `json:"type"`
}

// geocodePage is one page entry in the coordinates query response.
type geocodePage struct {
	// Title is the canonical page title after normalization and redirects.
	Title string `json:"title"`
	// Coordinates holds the primary coordinate when the page has one.
	Coordinates []geocodeCoordinate `json:"coordinates"`
}

// geocodeQuery holds the page results plus the title translation arrays.
type geocodeQuery struct {
	// Normalized maps requested titles to their normalized forms.
	Normalized []geocodeRename `json:"normalized"`
	// Redirects maps redirect sources to their targets.
	Redirects []geocodeRename `json:"redirects"`
	// Pages is keyed by page ID; negative keys mark missing titles.
	Pages map[string]geocodePage `json:"pages"`
}

// geocodeAPIError is the error object the API returns inside a 200 response.
type geocodeAPIError struct {
	// Code is the machine-readable error code, e.g. maxlag.
	Code string `json:"code"`
	// Info is the human-readable explanation.
	Info string `json:"info"`
}

// geocodeResponse mirrors the action=query&prop=coordinates response shape.
type geocodeResponse struct {
	// Error carries the API-level error, e.g. a maxlag rejection.
	Error *geocodeAPIError `json:"error"`
	// Query holds the page results for the requested titles.
	Query geocodeQuery `json:"query"`
}

// geocodeUpdate is one pending lat/lng write for a battle row.
type geocodeUpdate struct {
	// ID is the battle primary key.
	ID string
	// Lat is the resolved latitude.
	Lat float64
	// Lng is the resolved longitude.
	Lng float64
}

// GeocodeMissing backfills coordinates for battles stuck at lat=0 lng=0 by
// querying the Wikipedia coordinates API in batches of geocodeBatchSize
// titles. Each battle's wikipedia_title is tried first; battles without one
// fall back to their name. When dryRun is true every step runs except the
// UPDATE, so the summary shows exactly what a live run would write.
func GeocodeMissing(ctx context.Context, db *sql.DB, dryRun bool) (GeocodeSummary, error) {
	var sum GeocodeSummary

	rows, err := db.QueryContext(ctx,
		`SELECT id, name, wikipedia_title FROM battles WHERE lat = 0 AND lng = 0`)
	if err != nil {
		return sum, fmt.Errorf("select battles missing coordinates: %w", err)
	}

	// idsByTitle groups battle IDs under the title queried for them so a
	// duplicated title costs one API slot and every row still updates.
	idsByTitle := make(map[string][]string)
	var titles []string
	for rows.Next() {
		var id, name, wikiTitle string
		if err := rows.Scan(&id, &name, &wikiTitle); err != nil {
			rows.Close()
			return sum, fmt.Errorf("scan battle row: %w", err)
		}
		title := strings.TrimSpace(wikiTitle)
		if title == "" {
			title = strings.TrimSpace(name)
		}
		if title == "" || strings.Contains(title, "|") {
			sum.SkippedNoTitle++
			continue
		}
		if _, seen := idsByTitle[title]; !seen {
			titles = append(titles, title)
		}
		idsByTitle[title] = append(idsByTitle[title], id)
		sum.Attempted++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return sum, fmt.Errorf("iterate battle rows: %w", err)
	}

	mode := "live"
	if dryRun {
		mode = "dry-run"
	}
	if len(titles) == 0 {
		log.Printf("geocode %s: nothing to query (skipped-no-title=%d)", mode, sum.SkippedNoTitle)
		return sum, nil
	}
	log.Printf("geocode %s: %d battles across %d unique titles", mode, sum.Attempted, len(titles))

	for start := 0; start < len(titles); start += geocodeBatchSize {
		if start > 0 {
			select {
			case <-ctx.Done():
				return sum, ctx.Err()
			case <-time.After(geocodeBatchPause):
			}
		}
		end := min(start+geocodeBatchSize, len(titles))
		batch := titles[start:end]

		resp, err := fetchGeocodeBatch(ctx, batch)
		if err != nil {
			return sum, fmt.Errorf("geocode batch %d-%d: %w", start, end, err)
		}
		hits := resolveGeocodeTitles(batch, resp)

		var updates []geocodeUpdate
		for _, title := range batch {
			c, ok := hits[title]
			if !ok || !geocodeAcceptable(c) {
				continue
			}
			for _, id := range idsByTitle[title] {
				updates = append(updates, geocodeUpdate{ID: id, Lat: c.Lat, Lng: c.Lon})
			}
		}
		if !dryRun && len(updates) > 0 {
			if err := applyGeocodeUpdates(ctx, db, updates); err != nil {
				return sum, fmt.Errorf("geocode batch %d-%d: %w", start, end, err)
			}
		}
		sum.Resolved += len(updates)
		log.Printf("geocode %s batch %d-%d: resolved %d of %d titles (running total %d)",
			mode, start, end, len(updates), len(batch), sum.Resolved)
	}

	sum.APIMiss = sum.Attempted - sum.Resolved
	log.Printf("geocode %s summary: attempted=%d resolved=%d skipped-no-title=%d api-miss=%d",
		mode, sum.Attempted, sum.Resolved, sum.SkippedNoTitle, sum.APIMiss)
	return sum, nil
}

// applyGeocodeUpdates writes one batch of coordinate fixes in a single short
// transaction so a concurrently running server is never blocked for long. The
// lat=0/lng=0 guard keeps the write from clobbering a row fixed by other means
// between the SELECT and this commit.
func applyGeocodeUpdates(ctx context.Context, db *sql.DB, updates []geocodeUpdate) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin geocode transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx,
		`UPDATE battles SET lat = ?, lng = ? WHERE id = ? AND lat = 0 AND lng = 0`)
	if err != nil {
		return fmt.Errorf("prepare geocode update: %w", err)
	}
	defer stmt.Close()

	for _, u := range updates {
		if _, err := stmt.ExecContext(ctx, u.Lat, u.Lng, u.ID); err != nil {
			return fmt.Errorf("update battle %s: %w", u.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit geocode transaction: %w", err)
	}
	return nil
}

// fetchGeocodeBatch queries the coordinates API for one batch of titles,
// retrying once when the server answers 429 or maxlag. The retry waits the
// server's Retry-After when given, with geocodeRetryPause as the floor.
func fetchGeocodeBatch(ctx context.Context, titles []string) (*geocodeResponse, error) {
	resp, wait, err := doGeocodeRequest(ctx, titles)
	if err != nil || wait <= 0 {
		return resp, err
	}
	log.Printf("geocode: server busy (429/maxlag), retrying once in %s", wait)
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(wait):
	}
	resp, wait, err = doGeocodeRequest(ctx, titles)
	if err != nil {
		return nil, err
	}
	if wait > 0 {
		return nil, fmt.Errorf("geocode api still busy after retry")
	}
	return resp, nil
}

// doGeocodeRequest performs one coordinates API call. A positive wait reports
// that the server asked for a pause (429 or maxlag) and the caller may retry
// once after waiting that long.
func doGeocodeRequest(ctx context.Context, titles []string) (*geocodeResponse, time.Duration, error) {
	params := url.Values{
		"action":    {"query"},
		"prop":      {"coordinates"},
		"coprop":    {"type"},
		"colimit":   {"max"},
		"titles":    {strings.Join(titles, "|")},
		"redirects": {"1"},
		"format":    {"json"},
		"maxlag":    {"5"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wikipediaAPI+"?"+params.Encode(), nil)
	if err != nil {
		return nil, 0, fmt.Errorf("build geocode request: %w", err)
	}
	req.Header.Set("User-Agent", geocodeUserAgent)

	resp, err := wikiHTTPDo(req)
	if err != nil {
		return nil, 0, fmt.Errorf("geocode request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, retryAfterDelay(resp.Header.Get("Retry-After")), nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("geocode api returned %d", resp.StatusCode)
	}

	var out geocodeResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, 0, fmt.Errorf("decode geocode response: %w", err)
	}
	if out.Error != nil {
		if out.Error.Code == "maxlag" {
			return nil, retryAfterDelay(resp.Header.Get("Retry-After")), nil
		}
		return nil, 0, fmt.Errorf("geocode api error: %s: %s", out.Error.Code, out.Error.Info)
	}
	return &out, 0, nil
}

// retryAfterDelay converts a Retry-After header given in seconds to a wait
// duration. The result never drops below geocodeRetryPause, covering absent
// or unparseable headers, and never exceeds geocodeRetryMaxPause.
func retryAfterDelay(header string) time.Duration {
	delay := geocodeRetryPause
	if secs, err := strconv.Atoi(strings.TrimSpace(header)); err == nil && secs > 0 {
		if d := time.Duration(secs) * time.Second; d > delay {
			delay = d
		}
	}
	return min(delay, geocodeRetryMaxPause)
}

// resolveGeocodeTitles maps each requested title to its page coordinate by
// following the normalized and redirects chains in the response. Titles whose
// page is missing or carries no coordinates are absent from the result.
func resolveGeocodeTitles(requested []string, resp *geocodeResponse) map[string]geocodeCoordinate {
	rename := make(map[string]string, len(resp.Query.Normalized)+len(resp.Query.Redirects))
	for _, n := range resp.Query.Normalized {
		rename[n.From] = n.To
	}
	for _, r := range resp.Query.Redirects {
		rename[r.From] = r.To
	}

	byTitle := make(map[string]geocodeCoordinate, len(resp.Query.Pages))
	for _, p := range resp.Query.Pages {
		if len(p.Coordinates) == 0 {
			continue
		}
		byTitle[p.Title] = p.Coordinates[0]
	}

	out := make(map[string]geocodeCoordinate)
	for _, req := range requested {
		final := req
		for range geocodeRenameHops {
			next, ok := rename[final]
			if !ok {
				break
			}
			final = next
		}
		if c, ok := byTitle[final]; ok {
			out[req] = c
		}
	}
	return out
}

// geocodeAcceptable gates one coordinate hit: it must sit inside valid ranges,
// not be the 0,0 placeholder, and not be a country-level centroid, which is
// too coarse to place a battle.
func geocodeAcceptable(c geocodeCoordinate) bool {
	if c.Type == "country" {
		return false
	}
	return isValidCoord(c.Lat, c.Lon)
}
