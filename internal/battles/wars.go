package battles

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// WarSummary is the structured "how it ended" payload for a war. The numeric
// fields are computed from battle data on demand. The narrative fields
// (Outcome, Aftermath, KeyTerms, Notable) come from an optional curated
// wars.json registry. Every war the catalog knows about gets at least the
// computed stats. Major wars get the narrative on top.
type WarSummary struct {
	// Name is the canonical war name, matching battles.war values.
	Name string `json:"name"`
	// BattleCount is the number of battles attributed to this war.
	BattleCount int `json:"battleCount"`
	// YearStart is the year of the earliest battle. Negative for BC.
	YearStart int `json:"yearStart"`
	// YearEnd is the year of the latest battle.
	YearEnd int `json:"yearEnd"`
	// DateStart is the date string from the earliest battle, when present.
	DateStart string `json:"dateStart,omitempty"`
	// DateEnd is the date string from the latest battle, when present.
	DateEnd string `json:"dateEnd,omitempty"`
	// TotalCasualties is the sum of casualty counts across every side of
	// every battle in the war that has parseable casualty data.
	TotalCasualties int `json:"totalCasualties"`
	// VictorTallies counts how many battles each named victor won, sorted
	// descending. Useful for "Allies won 14 of 20 named battles" framing.
	VictorTallies []VictorTally `json:"victorTallies"`
	// FinalVictor is the victor of the chronologically last battle. Often
	// the actor on whose terms the war ended.
	FinalVictor string `json:"finalVictor,omitempty"`
	// EndingBattle is a thin reference to the last battle of the war for UI
	// linking ("the war ended with the Battle of Berlin").
	EndingBattle *WarBattleRef `json:"endingBattle,omitempty"`
	// Outcome is a one-sentence curated summary of how the war ended:
	// "Unconditional surrender of Germany at Reims and Karlshorst."
	Outcome string `json:"outcome,omitempty"`
	// Aftermath is a one-paragraph curated description of consequences.
	Aftermath string `json:"aftermath,omitempty"`
	// KeyTerms names the formal end (treaty, surrender, armistice, capitulation).
	KeyTerms string `json:"keyTerms,omitempty"`
	// Notable is an optional 1-3 item list of notable outcomes beyond the
	// victor field: war crimes trials, partition, redrawn borders, etc.
	Notable []string `json:"notable,omitempty"`
}

// VictorTally is one entry in the per-war victor distribution.
type VictorTally struct {
	// Name is the victor as written on the battle record.
	Name string `json:"name"`
	// Count is the number of battles in the war this victor won.
	Count int `json:"count"`
}

// WarBattleRef is a small slice of a Battle used to link from a WarSummary
// to its ending battle without re-serializing the full record.
type WarBattleRef struct {
	// ID is the battle slug.
	ID string `json:"id"`
	// Name is the battle's display name.
	Name string `json:"name"`
	// Year is the battle's year.
	Year int `json:"year"`
	// Victor is the battle's victor as recorded.
	Victor string `json:"victor,omitempty"`
}

// WarNarrative is the curated narrative slot for a single war. It is the
// shape of each entry in wars.json — battle aggregation does not depend on
// this file, so wars without curated narratives still surface stats.
type WarNarrative struct {
	// Outcome is a one-sentence "how it ended" line.
	Outcome string `json:"outcome,omitempty"`
	// Aftermath is a one-paragraph consequence summary.
	Aftermath string `json:"aftermath,omitempty"`
	// KeyTerms names the formal end (treaty, surrender, capitulation).
	KeyTerms string `json:"keyTerms,omitempty"`
	// Notable is an optional list of notable outcomes.
	Notable []string `json:"notable,omitempty"`
}

// Wars is a thread-safe registry of curated war narratives loaded from a
// JSON file. Behaves like Replays — supports hot-reload via Watch so
// curators can iterate without restarting.
type Wars struct {
	mu       sync.RWMutex
	byName   map[string]WarNarrative
}

// NewWars returns an empty narrative registry.
func NewWars() *Wars {
	return &Wars{byName: map[string]WarNarrative{}}
}

// Load reads curated narrative data from a JSON file keyed by war name.
// Missing file is not an error.
func (w *Wars) Load(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, fmt.Errorf("read wars file: %w", err)
	}
	var raw map[string]WarNarrative
	if err := json.Unmarshal(data, &raw); err != nil {
		return 0, fmt.Errorf("parse wars json: %w", err)
	}
	w.mu.Lock()
	w.byName = raw
	w.mu.Unlock()
	return len(raw), nil
}

// Watch hot-reloads the curated narratives file when it changes. Same poll
// semantics as Replays.Watch — never panics on parse errors.
func (w *Wars) Watch(ctx context.Context, path string, interval time.Duration) {
	if path == "" {
		return
	}
	if interval <= 0 {
		interval = time.Second
	}
	var lastMod time.Time
	if info, err := os.Stat(path); err == nil {
		lastMod = info.ModTime()
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			info, err := os.Stat(path)
			if err != nil {
				continue
			}
			if !info.ModTime().After(lastMod) {
				continue
			}
			lastMod = info.ModTime()
			n, err := w.Load(path)
			if err != nil {
				log.Printf("wars hot-reload failed (%s): %v", path, err)
				continue
			}
			log.Printf("wars hot-reloaded: %d narratives from %s", n, path)
		}
	}
}

// Get returns the curated narrative for a war, or zero value if absent.
func (w *Wars) Get(name string) (WarNarrative, bool) {
	w.mu.RLock()
	defer w.mu.RUnlock()
	n, ok := w.byName[name]
	return n, ok
}

// casualtyPattern matches the largest comma-separated integer in a casualty
// string ("~91,000 killed, ~280,000 wounded" → finds both numbers; the sum
// is used). Cap at 10M per token to ignore unreasonable parses.
var casualtyPattern = regexp.MustCompile(`\d[\d,]*`)

// hasBrokenSide reports whether any of the battle's sides contains residue
// from a half-parsed Wikipedia infobox template, e.g. "| combatant2 =" or
// "| strength1 =". These records are noise in war-summary tallies because
// their victor and casualty fields are unreliable, so we skip them when
// computing victor distribution and total casualties.
func hasBrokenSide(b Battle) bool {
	for _, s := range b.Sides {
		if strings.Contains(s.Name, "| combatant") ||
			strings.Contains(s.Name, "|combatant") ||
			strings.Contains(s.Strength, "| strength") ||
			strings.Contains(s.Strength, "|strength") ||
			strings.Contains(s.Casualties, "| casualties") ||
			strings.Contains(s.Casualties, "|casualties") {
			return true
		}
	}
	return false
}

// parseCasualties returns the summed casualty figure from a free-form
// "X killed, Y wounded" string. Returns 0 when no numbers are found.
func parseCasualties(s string) int {
	if s == "" {
		return 0
	}
	tokens := casualtyPattern.FindAllString(s, -1)
	total := 0
	for _, tok := range tokens {
		raw := ""
		for _, r := range tok {
			if r != ',' {
				raw += string(r)
			}
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 || n > 10_000_000 {
			continue
		}
		total += n
	}
	return total
}

// SummarizeWar builds a WarSummary by aggregating every battle attributed to
// the given war name. The narrative slot (Outcome / Aftermath / KeyTerms /
// Notable) is filled from wars when present; otherwise it's empty and the
// caller falls back to "stats only".
func SummarizeWar(ctx context.Context, store *Store, wars *Wars, name string) (WarSummary, error) {
	if name == "" {
		return WarSummary{}, fmt.Errorf("empty war name")
	}

	results, _, err := store.List(ctx, Filter{War: name, Limit: 10000, IncludeNoCoord: true})
	if err != nil {
		return WarSummary{}, fmt.Errorf("list battles for war: %w", err)
	}

	if len(results) == 0 {
		return WarSummary{Name: name}, nil
	}

	// Sort by year ascending so first/last are obvious. Battles with year=0
	// (missing/unknown year) sort to the front but we exclude them from the
	// yearStart/yearEnd display so a single bad record does not say "the
	// war started in year 0".
	sort.SliceStable(results, func(i, j int) bool {
		return results[i].Year < results[j].Year
	})

	sum := WarSummary{
		Name:        name,
		BattleCount: len(results),
	}
	tallies := map[string]int{}
	var total int
	var endingBattle *Battle
	yearSeen := false
	for i := range results {
		b := &results[i]
		// Skip battles whose sides data is half-parsed infobox residue. These
		// records pollute the victor and casualty tallies (the "Battle of Los
		// Angeles" with "Japanese" as victor is the canonical example, where
		// no battle actually happened and no Japanese aircraft were present).
		// They still count toward BattleCount because they're in the catalog,
		// but they don't drive the war's "how it ended" narrative.
		if hasBrokenSide(*b) {
			continue
		}
		for _, side := range b.Sides {
			total += parseCasualties(side.Casualties)
		}
		if b.Victor != "" {
			tallies[b.Victor]++
		}
		if b.Year == 0 {
			continue
		}
		if !yearSeen || b.Year < sum.YearStart {
			sum.YearStart = b.Year
			sum.DateStart = b.Date
		}
		if !yearSeen || b.Year > sum.YearEnd {
			sum.YearEnd = b.Year
			sum.DateEnd = b.Date
			endingBattle = b
		}
		yearSeen = true
	}
	sum.TotalCasualties = total

	for v, c := range tallies {
		sum.VictorTallies = append(sum.VictorTallies, VictorTally{Name: v, Count: c})
	}
	sort.SliceStable(sum.VictorTallies, func(i, j int) bool {
		return sum.VictorTallies[i].Count > sum.VictorTallies[j].Count
	})

	if endingBattle != nil {
		sum.FinalVictor = endingBattle.Victor
		sum.EndingBattle = &WarBattleRef{
			ID:     endingBattle.ID,
			Name:   endingBattle.Name,
			Year:   endingBattle.Year,
			Victor: endingBattle.Victor,
		}
	}

	if wars != nil {
		if n, ok := wars.Get(name); ok {
			sum.Outcome = n.Outcome
			sum.Aftermath = n.Aftermath
			sum.KeyTerms = n.KeyTerms
			sum.Notable = n.Notable
		}
	}
	return sum, nil
}
