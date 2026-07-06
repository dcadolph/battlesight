// Package quality computes per-battle completeness scores and aggregate
// coverage reports. The score is a deterministic function of which fields
// are present; it does not judge factual accuracy, only completeness.
package quality

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"
)

// Score is the completeness rating for a single battle on a 0-100 scale.
// Composed of the following slots: coords (20), date (15), >=2 sides (15),
// any casualties (10), any commander (10), summary >=300 chars (10),
// significance >=80 chars (10), victor (5), >=1 reference (5).
type Score struct {
	ID    string
	Name  string
	Era   string
	War   string
	Year  int
	Lat   float64
	Lng   float64
	Total int
}

// Bracket classifies a score into a quality tier. The brackets are chosen
// so a battle in the "excellent" tier has every load-bearing field filled
// (coords, sides, dates, prose) and only minor gaps; "stub" battles are
// not safe to surface in the UI as anything but a name and a year.
func Bracket(total int) string {
	switch {
	case total >= 85:
		return "excellent"
	case total >= 60:
		return "good"
	case total >= 30:
		return "thin"
	default:
		return "stub"
	}
}

// Report is the aggregate completeness picture across the whole catalog.
type Report struct {
	Total        int
	Average      float64
	Distribution map[string]int // bracket → count
	ByEra        []EraStats
	ByRegion     []RegionStats
	ByWar        []WarStats // top 30 wars by battle count
	WorstByID    []Score    // bottom 20 with verified=1 (need repair)
	StarsByID    []Score    // top 20 by score, useful as anchors
}

// EraStats is one row of the per-era coverage breakdown.
type EraStats struct {
	Era        string
	Count      int
	Avg        float64
	PctOver85  float64
	PctUnder30 float64
}

// RegionStats is one row of the rough continental breakdown computed from
// latitude/longitude buckets.
type RegionStats struct {
	Region string
	Count  int
	Avg    float64
}

// WarStats is one row of the per-war coverage breakdown.
type WarStats struct {
	War        string
	Count      int
	Avg        float64
	NamedStars int // count of excellent-bracket battles
}

// Compute walks every battle in the database, scores each one, and rolls
// the results into a Report. Side tables (sides, references) are loaded
// once into memory so scoring stays a single pass.
func Compute(ctx context.Context, db *sql.DB) (*Report, error) {
	sides, err := loadSides(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("load sides: %w", err)
	}
	refs, err := loadRefCounts(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("load refs: %w", err)
	}

	rows, err := db.QueryContext(ctx,
		`SELECT id, name, era, war, year, lat, lng, date,
		        summary, significance, victor, verified
		 FROM battles`)
	if err != nil {
		return nil, fmt.Errorf("query battles: %w", err)
	}
	defer rows.Close()

	var (
		scores      []Score
		eraAgg      = map[string]*eraAccum{}
		regionAgg   = map[string]*regionAccum{}
		warAgg      = map[string]*warAccum{}
		dist        = map[string]int{"excellent": 0, "good": 0, "thin": 0, "stub": 0}
		runningSum  float64
		verifiedRow = map[string]bool{}
	)

	for rows.Next() {
		var (
			id, name, era, war, dateStr, summary, sig, victor string
			year, verified                                    int
			lat, lng                                          float64
		)
		if err := rows.Scan(&id, &name, &era, &war, &year, &lat, &lng, &dateStr, &summary, &sig, &victor, &verified); err != nil {
			return nil, fmt.Errorf("scan battle: %w", err)
		}
		s := scoreBattle(scoreInputs{
			lat:          lat,
			lng:          lng,
			date:         dateStr,
			sideCount:    sides[id].count,
			hasCasualty:  sides[id].anyCasualty,
			hasCommander: sides[id].anyCommander,
			summaryLen:   len(summary),
			sigLen:       len(sig),
			victor:       victor,
			refCount:     refs[id],
		})
		sc := Score{
			ID:    id,
			Name:  name,
			Era:   era,
			War:   war,
			Year:  year,
			Lat:   lat,
			Lng:   lng,
			Total: s,
		}
		scores = append(scores, sc)
		verifiedRow[id] = verified == 1

		dist[Bracket(s)]++
		runningSum += float64(s)

		e := eraAgg[era]
		if e == nil {
			e = &eraAccum{}
			eraAgg[era] = e
		}
		e.add(s)

		r := regionFromCoords(lat, lng)
		ra := regionAgg[r]
		if ra == nil {
			ra = &regionAccum{}
			regionAgg[r] = ra
		}
		ra.add(s)

		wa := warAgg[war]
		if wa == nil {
			wa = &warAccum{}
			warAgg[war] = wa
		}
		wa.add(s)
	}

	rep := &Report{
		Total:        len(scores),
		Average:      0,
		Distribution: dist,
	}
	if rep.Total > 0 {
		rep.Average = runningSum / float64(rep.Total)
	}

	for era, a := range eraAgg {
		rep.ByEra = append(rep.ByEra, EraStats{
			Era:        era,
			Count:      a.n,
			Avg:        a.avg(),
			PctOver85:  a.pctAtLeast(85),
			PctUnder30: a.pctBelow(30),
		})
	}
	for region, a := range regionAgg {
		rep.ByRegion = append(rep.ByRegion, RegionStats{
			Region: region,
			Count:  a.n,
			Avg:    a.avg(),
		})
	}
	for war, a := range warAgg {
		if war == "" {
			continue
		}
		rep.ByWar = append(rep.ByWar, WarStats{
			War:        war,
			Count:      a.n,
			Avg:        a.avg(),
			NamedStars: a.stars,
		})
	}

	// Worst verified battles: things the user has explicitly trusted but
	// have low scores. Surface the bottom 20 so curators can repair.
	var worst []Score
	for _, s := range scores {
		if verifiedRow[s.ID] {
			worst = append(worst, s)
		}
	}
	sortAscBy(worst, func(s Score) int { return s.Total })
	if len(worst) > 20 {
		worst = worst[:20]
	}
	rep.WorstByID = worst

	// Stars: top 20 by score overall. Useful as reference quality.
	stars := append([]Score(nil), scores...)
	sortDescBy(stars, func(s Score) int { return s.Total })
	if len(stars) > 20 {
		stars = stars[:20]
	}
	rep.StarsByID = stars

	return rep, nil
}

// scoreInputs bundles the per-battle ingredients of a quality score so
// scoreBattle stays a pure function of inputs (testable, no DB).
type scoreInputs struct {
	lat, lng                  float64
	date                      string
	sideCount                 int
	hasCasualty, hasCommander bool
	summaryLen, sigLen        int
	victor                    string
	refCount                  int
}

func scoreBattle(in scoreInputs) int {
	s := 0
	// Coordinates: must not be the (0,0) sentinel and must not be either
	// pole-padded zero. Reject lat between -0.5 and 0.5 plus lng between
	// -0.5 and 0.5 as a "(0,0) wrapped" placeholder.
	if !nearZero(in.lat) && !nearZero(in.lng) {
		s += 20
	}
	if in.date != "" {
		s += 15
	}
	if in.sideCount >= 2 {
		s += 15
	}
	if in.hasCasualty {
		s += 10
	}
	if in.hasCommander {
		s += 10
	}
	if in.summaryLen >= 300 {
		s += 10
	} else if in.summaryLen >= 100 {
		s += 5
	}
	if in.sigLen >= 80 {
		s += 10
	}
	if in.victor != "" {
		s += 5
	}
	if in.refCount >= 1 {
		s += 5
	}
	if s > 100 {
		s = 100
	}
	return s
}

func nearZero(v float64) bool {
	return math.Abs(v) < 0.5
}

// regionFromCoords buckets a (lat, lng) into a continental region. Very
// rough: the goal is grouping for coverage stats, not precise geography.
// Battles with missing coordinates are grouped under "Unknown" so they
// stay visible in the coverage table rather than disappearing.
func regionFromCoords(lat, lng float64) string {
	if nearZero(lat) && nearZero(lng) {
		return "Unknown (no coords)"
	}
	switch {
	case lat > 35 && lng > -25 && lng < 60:
		return "Europe"
	case lat > 12 && lat < 35 && lng > -25 && lng < 60:
		return "Mediterranean / Middle East / North Africa"
	case lat < 12 && lng > -25 && lng < 55:
		return "Sub-Saharan Africa"
	case lat > 35 && lng >= 60 && lng < 160:
		return "Central / North Asia"
	case lat <= 35 && lat > -10 && lng >= 60 && lng < 160:
		return "South / Southeast Asia"
	case lat > 35 && lng >= -180 && lng < -50:
		return "North America"
	case lat <= 35 && lat > 5 && lng >= -180 && lng < -50:
		return "Central America / Caribbean"
	case lat <= 5 && lng >= -90 && lng < -30:
		return "South America"
	case lng >= 110 && lat <= -10:
		return "Oceania"
	case lng >= 160 || lng < -150:
		return "Pacific"
	default:
		return "Other"
	}
}

type eraAccum struct {
	n, sum, over85, under30 int
	stars                   int
}

func (a *eraAccum) add(s int) {
	a.n++
	a.sum += s
	if s >= 85 {
		a.over85++
		a.stars++
	}
	if s < 30 {
		a.under30++
	}
}
func (a *eraAccum) avg() float64 {
	if a.n == 0 {
		return 0
	}
	return float64(a.sum) / float64(a.n)
}
func (a *eraAccum) pctAtLeast(_ int) float64 {
	if a.n == 0 {
		return 0
	}
	return float64(a.over85) / float64(a.n) * 100
}
func (a *eraAccum) pctBelow(_ int) float64 {
	if a.n == 0 {
		return 0
	}
	return float64(a.under30) / float64(a.n) * 100
}

type regionAccum struct{ n, sum int }

func (a *regionAccum) add(s int) {
	a.n++
	a.sum += s
}
func (a *regionAccum) avg() float64 {
	if a.n == 0 {
		return 0
	}
	return float64(a.sum) / float64(a.n)
}

type warAccum struct{ n, sum, stars int }

func (a *warAccum) add(s int) {
	a.n++
	a.sum += s
	if s >= 85 {
		a.stars++
	}
}
func (a *warAccum) avg() float64 {
	if a.n == 0 {
		return 0
	}
	return float64(a.sum) / float64(a.n)
}

// sortAscBy / sortDescBy are tiny generic sort helpers. The standard
// library's sort.Slice works here but a typed helper keeps the call sites
// short and removes the chance of an inverted comparator.
func sortAscBy[T any](xs []T, key func(T) int) {
	for i := 1; i < len(xs); i++ {
		for j := i; j > 0 && key(xs[j]) < key(xs[j-1]); j-- {
			xs[j], xs[j-1] = xs[j-1], xs[j]
		}
	}
}
func sortDescBy[T any](xs []T, key func(T) int) {
	for i := 1; i < len(xs); i++ {
		for j := i; j > 0 && key(xs[j]) > key(xs[j-1]); j-- {
			xs[j], xs[j-1] = xs[j-1], xs[j]
		}
	}
}

type sideAgg struct {
	count        int
	anyCasualty  bool
	anyCommander bool
}

func loadSides(ctx context.Context, db *sql.DB) (map[string]sideAgg, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT battle_id, COALESCE(commander, ''), COALESCE(casualties, '') FROM battle_sides`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]sideAgg{}
	for rows.Next() {
		var bid, commander, casualties string
		if err := rows.Scan(&bid, &commander, &casualties); err != nil {
			return nil, err
		}
		s := out[bid]
		s.count++
		if strings.TrimSpace(commander) != "" {
			s.anyCommander = true
		}
		if strings.TrimSpace(casualties) != "" {
			s.anyCasualty = true
		}
		out[bid] = s
	}
	return out, rows.Err()
}

func loadRefCounts(ctx context.Context, db *sql.DB) (map[string]int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT battle_id, COUNT(*) FROM battle_references GROUP BY battle_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var bid string
		var n int
		if err := rows.Scan(&bid, &n); err != nil {
			return nil, err
		}
		out[bid] = n
	}
	return out, rows.Err()
}
