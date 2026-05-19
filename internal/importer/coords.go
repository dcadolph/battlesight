package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// coordTemplateRe matches {{coord|...}} and {{Coord|...}} (Wikipedia uses
// both capitalizations interchangeably). The regex is case-insensitive so
// articles using either spelling are picked up.
var coordTemplateRe = regexp.MustCompile(`(?i)\{\{coord\|([^}]+)\}\}`)

// wikiCoordResponse mirrors the action=query&prop=coordinates response shape.
// The coordinates array is populated for articles that have any GeoData
// coordinates set; the primary one has primary=="" (an empty string flag).
type wikiCoordResponse struct {
	Query struct {
		Pages map[string]struct {
			Title       string `json:"title"`
			Coordinates []struct {
				Lat     float64 `json:"lat"`
				Lon     float64 `json:"lon"`
				Primary string  `json:"primary"`
			} `json:"coordinates"`
		} `json:"pages"`
	} `json:"query"`
}

// wikidataPointRe extracts (lng, lat) from a WKT-encoded "Point(lng lat)"
// literal as returned by Wikidata SPARQL for P625 (coordinate location).
var wikidataPointRe = regexp.MustCompile(`Point\(([\-0-9.]+)\s+([\-0-9.]+)\)`)

// wikidataSPARQLResponse mirrors the SELECT ?article ?coords result shape.
type wikidataSPARQLResponse struct {
	Results struct {
		Bindings []struct {
			Article struct {
				Value string `json:"value"`
			} `json:"article"`
			Coords struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			} `json:"coords"`
		} `json:"bindings"`
	} `json:"results"`
}

// EnrichCoordinates fetches Wikipedia articles for battles with no coordinates
// (lat=0, lng=0) and extracts coordinates from the {{coord}} template.
func EnrichCoordinates(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, wikipedia_title FROM battles WHERE lat = 0 AND lng = 0 AND wikipedia_title != '' LIMIT 20000`)
	if err != nil {
		return 0, err
	}

	type ref struct {
		id    string
		title string
	}
	var pending []ref
	for rows.Next() {
		var r ref
		rows.Scan(&r.id, &r.title)
		pending = append(pending, r)
	}
	rows.Close()

	if len(pending) == 0 {
		return 0, nil
	}

	log.Printf("enriching coordinates for %d battles", len(pending))

	stmt, err := db.PrepareContext(ctx,
		`UPDATE battles SET lat = ?, lng = ? WHERE id = ? AND lat = 0 AND lng = 0`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	var enriched int
	batchSize := 30

	for i := 0; i < len(pending); i += batchSize {
		end := i + batchSize
		if end > len(pending) {
			end = len(pending)
		}
		batch := pending[i:end]

		titles := make([]string, len(batch))
		titleMap := make(map[string]ref)
		for j, r := range batch {
			titles[j] = strings.ReplaceAll(r.title, " ", "_")
			titleMap[r.title] = r
		}

		// Primary path: ask Wikipedia for the article's primary coordinates
		// directly via the GeoData extension. This is far more reliable than
		// parsing wikitext templates and works for articles whose coords are
		// set on a sub-template the regex would miss.
		geoCoords, err := fetchCoordinates(ctx, titles)
		if err != nil {
			log.Printf("coordinates API batch %d-%d failed: %v", i, end, err)
			geoCoords = nil
		}

		// Fallback path: any titles GeoData did not resolve get re-tried via
		// the wikitext {{coord}} regex. Cheap and worth keeping for outliers
		// that have coord templates not registered with GeoData.
		var fallbackTitles []string
		resolved := make(map[string]bool, len(batch))
		for _, r := range batch {
			if c, ok := geoCoords[r.title]; ok && isValidCoord(c.lat, c.lng) {
				stmt.ExecContext(ctx, c.lat, c.lng, r.id)
				enriched++
				resolved[r.title] = true
			} else {
				fallbackTitles = append(fallbackTitles, strings.ReplaceAll(r.title, " ", "_"))
			}
		}

		// Secondary path: query Wikidata SPARQL for the same titles. Many
		// battles whose Wikipedia article omits a coord template still have
		// P625 set on their Wikidata entity (often via the place-of-battle
		// P276 link). One SPARQL query covers both cases.
		var sparqlTitles []string
		titleForArticle := make(map[string]string, len(batch))
		for _, r := range batch {
			if resolved[r.title] {
				continue
			}
			underscore := strings.ReplaceAll(r.title, " ", "_")
			sparqlTitles = append(sparqlTitles, underscore)
			titleForArticle["https://en.wikipedia.org/wiki/"+underscore] = r.title
		}
		if len(sparqlTitles) > 0 {
			wd, err := fetchWikidataCoords(ctx, sparqlTitles)
			if err != nil {
				log.Printf("wikidata SPARQL batch %d-%d failed: %v", i, end, err)
			}
			for articleURL, c := range wd {
				origTitle, ok := titleForArticle[articleURL]
				if !ok || resolved[origTitle] {
					continue
				}
				r, ok := titleMap[origTitle]
				if !ok || !isValidCoord(c.lat, c.lng) {
					continue
				}
				stmt.ExecContext(ctx, c.lat, c.lng, r.id)
				enriched++
				resolved[origTitle] = true
			}
		}

		// Tertiary path: any titles still unresolved get re-tried via the
		// wikitext {{coord}} regex. Cheap and worth keeping for outliers
		// that have coord templates not registered with GeoData.
		var wikitextTitles []string
		for _, r := range batch {
			if resolved[r.title] {
				continue
			}
			wikitextTitles = append(wikitextTitles, strings.ReplaceAll(r.title, " ", "_"))
		}
		if len(wikitextTitles) > 0 {
			pages, err := fetchWikitext(ctx, wikitextTitles)
			if err == nil {
				for pageTitle, wikitext := range pages {
					normalTitle := strings.ReplaceAll(pageTitle, "_", " ")
					r, ok := titleMap[normalTitle]
					if !ok {
						for t, rr := range titleMap {
							if strings.EqualFold(t, normalTitle) {
								r = rr
								ok = true
								break
							}
						}
					}
					if !ok || resolved[r.title] {
						continue
					}
					lat, lng := parseCoordTemplate(wikitext)
					if lat == 0 && lng == 0 {
						continue
					}
					stmt.ExecContext(ctx, lat, lng, r.id)
					enriched++
				}
			}
		}

		if (i/batchSize)%10 == 0 {
			log.Printf("enriched coordinates: %d/%d", enriched, len(pending))
		}
		time.Sleep(300 * time.Millisecond)
	}

	return enriched, nil
}

// fetchWikidataCoords queries the Wikidata SPARQL endpoint for the coordinate
// location (P625) of each Wikipedia article. Falls back to the place-of-battle
// (P276) entity's P625 when the battle entity itself has no direct coords.
// Returns a map keyed by article URL.
func fetchWikidataCoords(ctx context.Context, underscoreTitles []string) (map[string]coordPair, error) {
	if len(underscoreTitles) == 0 {
		return nil, nil
	}

	var values strings.Builder
	for _, t := range underscoreTitles {
		// Inline-escape only the rare characters that would break the IRI:
		// angle brackets and whitespace. Wikipedia titles do not contain
		// double quotes or backslashes in practice.
		safe := strings.ReplaceAll(t, ">", "%3E")
		safe = strings.ReplaceAll(safe, "<", "%3C")
		safe = strings.ReplaceAll(safe, " ", "_")
		values.WriteString("<https://en.wikipedia.org/wiki/")
		values.WriteString(safe)
		values.WriteString("> ")
	}

	query := "SELECT ?article ?coords WHERE { " +
		"VALUES ?article { " + values.String() + "} " +
		"?article schema:about ?item . " +
		"OPTIONAL { ?item wdt:P625 ?coords . } " +
		"OPTIONAL { ?item wdt:P276 ?place . ?place wdt:P625 ?coords . } }"

	params := url.Values{"query": {query}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, wikidataSPARQL,
		strings.NewReader(params.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/sparql-results+json")
	req.Header.Set("User-Agent", "BattleSight/1.0 (https://github.com/dcadolph/battlesight)")

	resp, err := wikiHTTPDo(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wikidata SPARQL returned %d", resp.StatusCode)
	}

	var result wikidataSPARQLResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	out := make(map[string]coordPair)
	for _, b := range result.Results.Bindings {
		if b.Coords.Type != "literal" {
			// Anonymous-node placeholders from un-matched OPTIONAL.
			continue
		}
		m := wikidataPointRe.FindStringSubmatch(b.Coords.Value)
		if len(m) != 3 {
			continue
		}
		lng, err1 := strconv.ParseFloat(m[1], 64)
		lat, err2 := strconv.ParseFloat(m[2], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		if !isValidCoord(lat, lng) {
			continue
		}
		// Prefer the first hit per article (direct P625 beats P276→P625).
		if _, exists := out[b.Article.Value]; exists {
			continue
		}
		out[b.Article.Value] = coordPair{lat: lat, lng: lng}
	}
	return out, nil
}

// coordPair holds a single (lat, lng) result from the coordinates API.
type coordPair struct {
	lat float64
	lng float64
}

// fetchCoordinates calls the Wikipedia action API for the primary coordinates
// of each title in one batched request. Returns a map keyed by display title
// (spaces, not underscores) so callers can match results back to inputs.
func fetchCoordinates(ctx context.Context, titles []string) (map[string]coordPair, error) {
	if len(titles) == 0 {
		return nil, nil
	}
	params := url.Values{
		"action":  {"query"},
		"prop":    {"coordinates"},
		"coprop":  {"type|name|globe"},
		"coprimary": {"primary"},
		"titles":  {strings.Join(titles, "|")},
		"format":  {"json"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wikipediaAPI+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "BattleSight/1.0 (https://github.com/dcadolph/battlesight)")

	resp, err := wikiHTTPDo(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("coordinates API returned %d", resp.StatusCode)
	}

	var result wikiCoordResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	out := make(map[string]coordPair, len(result.Query.Pages))
	for _, page := range result.Query.Pages {
		if len(page.Coordinates) == 0 {
			continue
		}
		// Prefer the primary coord; fall back to the first one.
		picked := page.Coordinates[0]
		for _, c := range page.Coordinates {
			if c.Primary != "" {
				picked = c
				break
			}
		}
		out[page.Title] = coordPair{lat: picked.Lat, lng: picked.Lon}
	}
	return out, nil
}

// parseCoordTemplate extracts lat/lng from a Wikipedia {{coord}} template.
// Handles formats like:
//
//	{{coord|34|15|20.4|N|88|44|13.2|W|...}}
//	{{coord|51.5074|-0.1278|...}}
func parseCoordTemplate(wikitext string) (float64, float64) {
	m := coordTemplateRe.FindStringSubmatch(wikitext)
	if len(m) < 2 {
		return 0, 0
	}

	parts := strings.Split(m[1], "|")
	if len(parts) < 2 {
		return 0, 0
	}

	// Try decimal format first: {{coord|51.5|-0.12|...}}
	lat, errLat := strconv.ParseFloat(parts[0], 64)
	lng, errLng := strconv.ParseFloat(parts[1], 64)
	if errLat == nil && errLng == nil && isValidCoord(lat, lng) {
		return lat, lng
	}

	// DMS format: {{coord|D|M|S|N|D|M|S|W|...}}
	return parseDMS(parts)
}

// parseDMS parses degrees/minutes/seconds from coord template parts.
func parseDMS(parts []string) (float64, float64) {
	// Find N/S and E/W markers to determine format.
	var latParts, lngParts []string
	var latSign, lngSign float64 = 1, 1

	for i, p := range parts {
		p = strings.TrimSpace(p)
		switch p {
		case "N":
			latParts = parts[:i]
			latSign = 1
		case "S":
			latParts = parts[:i]
			latSign = -1
		case "E":
			lngParts = parts[len(latParts)+1 : i]
			lngSign = 1
		case "W":
			lngParts = parts[len(latParts)+1 : i]
			lngSign = -1
		}
	}

	if len(latParts) == 0 || len(lngParts) == 0 {
		return 0, 0
	}

	lat := dmsToDecimal(latParts) * latSign
	lng := dmsToDecimal(lngParts) * lngSign

	if isValidCoord(lat, lng) {
		return lat, lng
	}
	return 0, 0
}

// dmsToDecimal converts degree/minute/second parts to decimal degrees.
func dmsToDecimal(parts []string) float64 {
	var d, m, s float64
	if len(parts) >= 1 {
		d, _ = strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	}
	if len(parts) >= 2 {
		m, _ = strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	}
	if len(parts) >= 3 {
		s, _ = strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
	}
	return d + m/60 + s/3600
}

// isValidCoord checks if coordinates are within valid ranges.
func isValidCoord(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat != 0 || lng != 0)
}
