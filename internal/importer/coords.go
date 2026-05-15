package importer

import (
	"context"
	"database/sql"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var coordTemplateRe = regexp.MustCompile(`\{\{coord\|([^}]+)\}\}`)

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
	batchSize := 15

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

		pages, err := fetchWikitext(ctx, titles)
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}

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
			if !ok {
				continue
			}

			lat, lng := parseCoordTemplate(wikitext)
			if lat == 0 && lng == 0 {
				continue
			}

			stmt.ExecContext(ctx, lat, lng, r.id)
			enriched++
		}

		if (i/batchSize)%20 == 0 {
			log.Printf("enriched coordinates: %d/%d", enriched, len(pending))
		}
		time.Sleep(300 * time.Millisecond)
	}

	return enriched, nil
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
