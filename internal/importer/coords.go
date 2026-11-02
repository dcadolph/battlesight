package importer

import (
	"regexp"
	"strconv"
	"strings"
)

// coordTemplateRe matches {{coord|...}} and {{Coord|...}} (Wikipedia uses
// both capitalizations interchangeably). The regex is case-insensitive so
// articles using either spelling are picked up.
var coordTemplateRe = regexp.MustCompile(`(?i)\{\{coord\|([^}]+)\}\}`)

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

	// Hemisphere letters mean DMS (or decimal-with-hemisphere) form. The
	// check must come before the decimal attempt: {{coord|34|15|20.4|N|...}}
	// would otherwise parse as lat=34, lng=15, silently corrupting the
	// coordinate with the latitude's own minutes value.
	for _, p := range parts {
		switch strings.TrimSpace(p) {
		case "N", "S", "E", "W":
			return parseDMS(parts)
		}
	}

	// Decimal format: {{coord|51.5|-0.12|...}}
	lat, errLat := strconv.ParseFloat(parts[0], 64)
	lng, errLng := strconv.ParseFloat(parts[1], 64)
	if errLat == nil && errLng == nil && isValidCoord(lat, lng) {
		return lat, lng
	}
	return 0, 0
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
