package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const wikidataSPARQL = "https://query.wikidata.org/sparql"

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
func ImportWikidata(ctx context.Context, db *sql.DB) (int, error) {
	bindings, err := fetchSPARQL(ctx)
	if err != nil {
		return 0, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx,
		`INSERT OR IGNORE INTO battles (id, name, year, date, lat, lng, era, war, battle_type, victor, summary, significance, source, source_id, verified, wikipedia_title)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'land', '', '', '', 'wikidata', ?, 0, ?)`)
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

		if lat == 0 && lng == 0 {
			continue
		}

		slug := slugify(name)
		if slug == "" {
			continue
		}

		era := yearToEra(year)
		war := b.Conflict.Value
		wikiTitle := wikipediaTitle(b.Article.Value)

		result, err := stmt.ExecContext(ctx, slug, name, year, date, lat, lng, era, war, id, wikiTitle)
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

// fetchSPARQL queries Wikidata and returns the result bindings.
func fetchSPARQL(ctx context.Context) ([]sparqlBinding, error) {
	params := url.Values{"query": {wikidataQuery}}
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

// wikipediaTitle extracts the article title from a Wikipedia URL.
func wikipediaTitle(articleURL string) string {
	if articleURL == "" {
		return ""
	}
	prefix := "https://en.wikipedia.org/wiki/"
	if strings.HasPrefix(articleURL, prefix) {
		return strings.ReplaceAll(articleURL[len(prefix):], "_", " ")
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
