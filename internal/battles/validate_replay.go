package battles

import (
	"fmt"
	"math"
	"strings"
)

// Replay validation bounds. Durations follow the cinematic guide window;
// the coordinate radius is generous enough for naval theaters where task
// forces operate hundreds of kilometers apart.
const (
	replayMinPhases      = 3
	replayMaxPhases      = 12
	replayMinDurationMs  = 5000
	replayMaxDurationMs  = 11000
	replayMaxOffsetDeg   = 6.0
	replayCameraOffsetOK = 6.0
)

// ValidateReplay checks a replay draft for structural and geographic
// sanity before it is merged into the served phase data. battleLat and
// battleLng anchor the geographic checks. Returns an error describing
// every violation found, or nil when the draft is clean.
func ValidateReplay(id string, r Replay, battleLat, battleLng float64) error {
	var problems []string
	add := func(format string, args ...any) {
		problems = append(problems, fmt.Sprintf(format, args...))
	}

	if strings.TrimSpace(id) == "" {
		add("empty replay id")
	}
	if strings.TrimSpace(r.Title) == "" {
		add("empty title")
	}
	if strings.TrimSpace(r.Intro) == "" {
		add("empty intro")
	}
	if strings.TrimSpace(r.FactionA) == "" || strings.TrimSpace(r.FactionB) == "" {
		add("factionA and factionB are required")
	}
	if len(r.Phases) < replayMinPhases || len(r.Phases) > replayMaxPhases {
		add("phase count %d outside %d..%d", len(r.Phases), replayMinPhases, replayMaxPhases)
	}

	for i, p := range r.Phases {
		if p.Index != i {
			add("phase %d: index %d does not match position", i, p.Index)
		}
		if strings.TrimSpace(p.Title) == "" {
			add("phase %d: empty title", i)
		}
		if strings.TrimSpace(p.Narration) == "" {
			add("phase %d: empty narration", i)
		}
		if p.DurationMs < replayMinDurationMs || p.DurationMs > replayMaxDurationMs {
			add("phase %d: durationMs %d outside %d..%d", i, p.DurationMs, replayMinDurationMs, replayMaxDurationMs)
		}
		if len(p.Units) == 0 {
			add("phase %d: no units", i)
		}
		seenIDs := map[string]bool{}
		for j, u := range p.Units {
			if !validFaction(u.Faction) {
				add("phase %d unit %d: faction %q not a, b, or c", i, j, u.Faction)
			}
			if u.ID != "" {
				if seenIDs[u.ID] {
					add("phase %d unit %d: duplicate id %q", i, j, u.ID)
				}
				seenIDs[u.ID] = true
			}
			if err := validPoint(u.X, u.Y, u.Lat, u.Lng, battleLat, battleLng); err != nil {
				add("phase %d unit %d (%s): %v", i, j, u.Label, err)
			}
		}
		for j, m := range p.Movements {
			if !validFaction(m.Faction) {
				add("phase %d movement %d: faction %q not a, b, or c", i, j, m.Faction)
			}
			if err := validPoint(m.FromX, m.FromY, m.FromLat, m.FromLng, battleLat, battleLng); err != nil {
				add("phase %d movement %d from: %v", i, j, err)
			}
			if err := validPoint(m.ToX, m.ToY, m.ToLat, m.ToLng, battleLat, battleLng); err != nil {
				add("phase %d movement %d to: %v", i, j, err)
			}
		}
		if p.CameraLat != 0 || p.CameraLng != 0 {
			if offsetDeg(p.CameraLat, p.CameraLng, battleLat, battleLng) > replayCameraOffsetOK {
				add("phase %d: camera %.3f,%.3f too far from battle %.3f,%.3f",
					i, p.CameraLat, p.CameraLng, battleLat, battleLng)
			}
		}
	}

	if len(problems) > 0 {
		return fmt.Errorf("replay %s: %s", id, strings.Join(problems, "; "))
	}
	return nil
}

// validFaction reports whether f is one of the three palette slots.
func validFaction(f string) bool {
	return f == "a" || f == "b" || f == "c"
}

// validPoint checks one coordinate pair in either geographic or
// normalized form. Geographic coordinates must sit within
// replayMaxOffsetDeg of the battle anchor; normalized x/y must be in
// 0..100 and not the 50,50 placeholder sentinel.
func validPoint(x, y, lat, lng, battleLat, battleLng float64) error {
	if lat != 0 || lng != 0 {
		if math.Abs(lat) > 90 || math.Abs(lng) > 180 {
			return fmt.Errorf("lat/lng %.4f,%.4f out of range", lat, lng)
		}
		if offsetDeg(lat, lng, battleLat, battleLng) > replayMaxOffsetDeg {
			return fmt.Errorf("lat/lng %.4f,%.4f more than %.0f degrees from battle", lat, lng, replayMaxOffsetDeg)
		}
		return nil
	}
	if x < 0 || x > 100 || y < 0 || y > 100 {
		return fmt.Errorf("x/y %.1f,%.1f outside 0..100", x, y)
	}
	if x == 50 && y == 50 {
		return fmt.Errorf("x/y is the 50,50 placeholder sentinel")
	}
	return nil
}

// offsetDeg returns the larger of the latitude and cosine-corrected
// longitude offsets between two points, in degrees.
func offsetDeg(lat1, lng1, lat2, lng2 float64) float64 {
	dLat := math.Abs(lat1 - lat2)
	cos := math.Cos(lat2 * math.Pi / 180)
	if cos < 0.1 {
		cos = 0.1
	}
	dLng := math.Abs(lng1-lng2) * cos
	return math.Max(dLat, dLng)
}
