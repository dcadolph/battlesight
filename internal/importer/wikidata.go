package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const wikidataSPARQL = "https://query.wikidata.org/sparql"

// Primary query: battles with point-in-time date (P585).
const wikidataQuery = `
SELECT ?battle ?battleLabel ?date ?coords ?conflictLabel ?article
WHERE {
  ?battle wdt:P31/wdt:P279* wd:Q178561.
  ?battle wdt:P625 ?coords.
  ?battle wdt:P585 ?date.
  OPTIONAL { ?battle wdt:P607 ?conflict. }
  OPTIONAL { ?article schema:about ?battle; schema:isPartOf <https://en.wikipedia.org/>. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?date`

// Secondary query: battles with start date (P580) but no point-in-time.
const wikidataQueryStartDate = `
SELECT ?battle ?battleLabel ?date ?coords ?conflictLabel ?article
WHERE {
  ?battle wdt:P31/wdt:P279* wd:Q178561.
  ?battle wdt:P625 ?coords.
  ?battle wdt:P580 ?date.
  FILTER NOT EXISTS { ?battle wdt:P585 ?pointDate. }
  OPTIONAL { ?battle wdt:P607 ?conflict. }
  OPTIONAL { ?article schema:about ?battle; schema:isPartOf <https://en.wikipedia.org/>. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?date`

// Tertiary query: battles with coords but no date properties.
const wikidataQueryNoDate = `
SELECT ?battle ?battleLabel ?coords ?conflictLabel ?article
WHERE {
  ?battle wdt:P31/wdt:P279* wd:Q178561.
  ?battle wdt:P625 ?coords.
  FILTER NOT EXISTS { ?battle wdt:P585 ?date. }
  FILTER NOT EXISTS { ?battle wdt:P580 ?startDate. }
  OPTIONAL { ?battle wdt:P607 ?conflict. }
  OPTIONAL { ?article schema:about ?battle; schema:isPartOf <https://en.wikipedia.org/>. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`

// Fourth query: battles WITHOUT coordinates but WITH Wikipedia articles.
// We'll extract coordinates from the Wikipedia infobox later.
const wikidataQueryNoCoordsWithDate = `
SELECT ?battle ?battleLabel ?date ?conflictLabel ?article
WHERE {
  ?battle wdt:P31/wdt:P279* wd:Q178561.
  FILTER NOT EXISTS { ?battle wdt:P625 ?coords. }
  ?article schema:about ?battle; schema:isPartOf <https://en.wikipedia.org/>.
  OPTIONAL { ?battle wdt:P585 ?date. }
  OPTIONAL { ?battle wdt:P580 ?date. }
  OPTIONAL { ?battle wdt:P607 ?conflict. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`

var pointRegex = regexp.MustCompile(`Point\(([0-9.\-]+)\s+([0-9.\-]+)\)`)

type sparqlResponse struct {
	Results struct {
		Bindings []sparqlBinding `json:"bindings"`
	} `json:"results"`
}

type sparqlBinding struct {
	Battle   sparqlValue `json:"battle"`
	Label    sparqlValue `json:"battleLabel"`
	Date     sparqlValue `json:"date"`
	Coords   sparqlValue `json:"coords"`
	Conflict sparqlValue `json:"conflictLabel"`
	Article  sparqlValue `json:"article"`
}

type sparqlValue struct {
	Value string `json:"value"`
}

// ImportWikidata fetches battles from Wikidata SPARQL and inserts them into the database.
// Runs three queries: point-in-time dates, start dates, and no-date battles.
func ImportWikidata(ctx context.Context, db *sql.DB) (int, error) {
	log.Println("query 1/3: battles with point-in-time dates")
	bindings1, err := fetchSPARQLQuery(ctx, wikidataQuery)
	if err != nil {
		return 0, fmt.Errorf("primary query: %w", err)
	}
	log.Printf("  got %d results", len(bindings1))

	log.Println("query 2/3: battles with start dates only")
	bindings2, err := fetchSPARQLQuery(ctx, wikidataQueryStartDate)
	if err != nil {
		log.Printf("  secondary query failed: %v (continuing)", err)
	} else {
		log.Printf("  got %d results", len(bindings2))
	}

	log.Println("query 3/4: battles with coords but no dates")
	bindings3, err := fetchSPARQLQuery(ctx, wikidataQueryNoDate)
	if err != nil {
		log.Printf("  query 3 failed: %v (continuing)", err)
	} else {
		log.Printf("  got %d results", len(bindings3))
	}

	log.Println("query 4/4: battles without coords (have Wikipedia articles)")
	bindings4, err := fetchSPARQLQuery(ctx, wikidataQueryNoCoordsWithDate)
	if err != nil {
		log.Printf("  query 4 failed: %v (continuing)", err)
	} else {
		log.Printf("  got %d results", len(bindings4))
	}

	bindings := append(bindings1, bindings2...)
	bindings = append(bindings, bindings3...)
	bindings = append(bindings, bindings4...)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx,
		`INSERT OR IGNORE INTO battles (id, name, year, date, date_start, date_end, lat, lng, era, war, battle_type, victor, summary, significance, source, source_id, verified, wikipedia_title)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'land', '', '', '', 'wikidata', ?, 0, ?)`)
	if err != nil {
		return 0, fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	// Load existing battle names to avoid duplicates with curated data.
	existingNames := make(map[string]bool)
	nameRows, err := tx.QueryContext(ctx, "SELECT LOWER(name) FROM battles")
	if err == nil {
		for nameRows.Next() {
			var n string
			nameRows.Scan(&n)
			existingNames[n] = true
		}
		nameRows.Close()
	}

	seen := make(map[string]bool)
	var count int

	for _, b := range bindings {
		id := wikidataID(b.Battle.Value)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true

		name := b.Label.Value
		if name == "" || name == id {
			continue
		}

		if existingNames[strings.ToLower(name)] {
			continue
		}

		year := parseWikidataYear(b.Date.Value)
		date := formatWikidataDate(b.Date.Value, year)
		lat, lng := parsePoint(b.Coords.Value)

		slug := slugify(name)
		if slug == "" {
			continue
		}

		era := yearToEra(year)
		war := b.Conflict.Value
		wikiTitle := wikipediaTitle(b.Article.Value)

		dr := ParseDateRange(date, year)

		result, err := stmt.ExecContext(ctx, slug, name, year, date, dr.Start, dr.End, lat, lng, era, war, id, wikiTitle)
		if err != nil {
			continue
		}
		if affected, _ := result.RowsAffected(); affected > 0 {
			count++
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit: %w", err)
	}

	return count, nil
}

// fetchSPARQLQuery queries Wikidata with the given SPARQL and returns the result bindings.
func fetchSPARQLQuery(ctx context.Context, query string) ([]sparqlBinding, error) {
	params := url.Values{"query": {query}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wikidataSPARQL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "BattleTrace/1.0 (https://github.com/dcadolph/battletrace)")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sparql request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sparql returned %d", resp.StatusCode)
	}

	var result sparqlResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode sparql response: %w", err)
	}

	return result.Results.Bindings, nil
}

// wikidataID extracts the Q-number from a Wikidata entity URI.
func wikidataID(uri string) string {
	if idx := strings.LastIndex(uri, "/"); idx >= 0 {
		return uri[idx+1:]
	}
	return ""
}

// parsePoint extracts lat/lng from a WKT Point string like "Point(lng lat)".
func parsePoint(wkt string) (float64, float64) {
	m := pointRegex.FindStringSubmatch(wkt)
	if len(m) != 3 {
		return 0, 0
	}
	lng, _ := strconv.ParseFloat(m[1], 64)
	lat, _ := strconv.ParseFloat(m[2], 64)
	return lat, lng
}

// parseWikidataYear extracts the year from an ISO date string.
func parseWikidataYear(date string) int {
	if date == "" {
		return 0
	}
	negative := false
	s := date
	if s[0] == '-' {
		negative = true
		s = s[1:]
	}
	parts := strings.SplitN(s, "-", 2)
	y, _ := strconv.Atoi(parts[0])
	if negative {
		y = -y
	}
	return y
}

// formatWikidataDate creates a human-readable date from a Wikidata date and year.
func formatWikidataDate(raw string, year int) string {
	if year < 0 {
		return fmt.Sprintf("%d BC", int(math.Abs(float64(year))))
	}
	if len(raw) >= 10 {
		return raw[:10]
	}
	return fmt.Sprintf("%d", year)
}

// yearToEra maps a year to a historical era string.
func yearToEra(year int) string {
	switch {
	case year < 500:
		return "ancient"
	case year < 1500:
		return "medieval"
	case year < 1700:
		return "early-modern"
	case year < 1820:
		return "napoleonic"
	case year < 1914:
		return "industrial"
	case year < 1919:
		return "world-war-1"
	case year < 1939:
		return "interwar"
	case year < 1946:
		return "world-war-2"
	default:
		return "modern"
	}
}

// wikipediaTitle extracts the article title from a Wikipedia URL, decoding percent-encoded characters.
func wikipediaTitle(articleURL string) string {
	if articleURL == "" {
		return ""
	}
	prefix := "https://en.wikipedia.org/wiki/"
	if strings.HasPrefix(articleURL, prefix) {
		encoded := articleURL[len(prefix):]
		decoded, err := url.PathUnescape(encoded)
		if err != nil {
			decoded = encoded
		}
		return strings.ReplaceAll(decoded, "_", " ")
	}
	return ""
}

// slugify creates a URL-safe slug from a battle name.
func slugify(name string) string {
	s := strings.ToLower(name)
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		if r == ' ' || r == '-' {
			return '-'
		}
		return -1
	}, s)
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	s = strings.Trim(s, "-")
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}
