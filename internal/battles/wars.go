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
	// HumanDeaths is the curated point-estimate of total deaths including
	// civilians, famine, genocide, and disease. It is an estimate, never a
	// count. Zero when no curated override exists; UI then falls back to
	// TotalCasualties (the battle-roll-up sum).
	HumanDeaths int64 `json:"humanDeaths,omitempty"`
	// DeathsLow is the low end of the published range of death estimates.
	// Zero when no range is curated.
	DeathsLow int64 `json:"deathsLow,omitempty"`
	// DeathsHigh is the high end of the published range of death estimates.
	// Zero when no range is curated.
	DeathsHigh int64 `json:"deathsHigh,omitempty"`
	// DeathsNote states what the death figure includes (combatants,
	// civilians, famine, disease, genocide), since definitions vary by
	// source and are the main reason two figures for the same war disagree.
	DeathsNote string `json:"deathsNote,omitempty"`
	// DeathsSource attributes the death figure itself, separate from the
	// per-battle Source field, so provenance travels with the number.
	DeathsSource string `json:"deathsSource,omitempty"`
	// DeathsBasis names the provenance class of the displayed figure:
	// "curated" when HumanDeaths came from the wars registry, "battle-sum"
	// when the only figure available is TotalCasualties summed from
	// battle records. Set by SummarizeWar, never stored in wars.json.
	DeathsBasis string `json:"deathsBasis,omitempty"`
	// CuratedStartYear is the curated calendar year the war begins, when
	// it differs from the catalog's earliest battle year. Lets WW2 start
	// with the 1931 Mukden Incident rather than the Invasion of Poland.
	CuratedStartYear int `json:"curatedStartYear,omitempty"`
	// CuratedEndYear is the curated calendar year the war ends.
	CuratedEndYear int `json:"curatedEndYear,omitempty"`
	// Parent names the war this summary rolls up under. Empty for top-level
	// wars.
	Parent string `json:"parent,omitempty"`
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
// shape of each entry in wars.json. Battle aggregation does not depend on
// this file, so wars without curated narratives still surface stats. The
// numeric fields (HumanDeaths, StartYear, EndYear) and the Parent pointer
// let curators override aggregations the database cannot derive from
// battle records alone: total deaths including civilians, famine, and
// genocide; the canonical start year before the first recorded battle;
// and the parent war this entry rolls up under (theaters, campaigns,
// preludes).
type WarNarrative struct {
	// Outcome is a one-sentence "how it ended" line.
	Outcome string `json:"outcome,omitempty"`
	// Aftermath is a one-paragraph consequence summary.
	Aftermath string `json:"aftermath,omitempty"`
	// KeyTerms names the formal end (treaty, surrender, capitulation).
	KeyTerms string `json:"keyTerms,omitempty"`
	// Notable is an optional list of notable outcomes.
	Notable []string `json:"notable,omitempty"`
	// HumanDeaths is the curated point-estimate of total deaths including
	// civilians, famine, and genocide. Zero means no curated override; the
	// battle roll-up stands. Use this when the battle sum is grossly low
	// because the war killed many more people off the battlefield (WW2
	// holocaust + famine, Mongol massacres, Taiping famine, etc.).
	HumanDeaths int64 `json:"humanDeaths,omitempty"`
	// DeathsLow is the low end of the published range of death estimates
	// for the war. Optional; zero means no curated range.
	DeathsLow int64 `json:"deathsLow,omitempty"`
	// DeathsHigh is the high end of the published range of death estimates.
	// Optional; zero means no curated range.
	DeathsHigh int64 `json:"deathsHigh,omitempty"`
	// DeathsNote states what the curated death figure includes. Sources
	// disagree mostly because they count different things, so the note is
	// the honest companion to any number.
	DeathsNote string `json:"deathsNote,omitempty"`
	// DeathsSource attributes the death figure itself so the reader can
	// see where the estimate comes from.
	DeathsSource string `json:"deathsSource,omitempty"`
	// StartYear is the curated calendar year the war begins. Lets a
	// curator define WW2 as starting with the Mukden Incident in 1931
	// rather than the date of the earliest battle in the catalog.
	StartYear int `json:"startYear,omitempty"`
	// EndYear is the curated calendar year the war ends.
	EndYear int `json:"endYear,omitempty"`
	// Parent names the war this entry is a theater, campaign, or prelude
	// of. The frontend uses this to roll children up under their parent
	// in the war list. Empty string means top-level.
	Parent string `json:"parent,omitempty"`
	// Aliases lists the other spellings of this war's name. A battle or a
	// territory snapshot keyed by an alias resolves to this entry.
	Aliases []string `json:"aliases,omitempty"`
	// Sources names the article revisions the narrative was written from.
	// Required for a war that is still open or began in 2022 or later.
	Sources []WarSource `json:"sources,omitempty"`
}

// WarSource is one Wikipedia article revision a war narrative was written from.
type WarSource struct {
	// Title is the English Wikipedia article title.
	Title string `json:"title"`
	// Revision is the article revision id read.
	Revision int64 `json:"revision"`
	// Fetched is the day the revision was read, as YYYY-MM-DD.
	Fetched string `json:"fetched"`
}

// Wars is a thread-safe registry of curated war narratives loaded from a
// JSON file. Behaves like Replays — supports hot-reload via Watch so
// curators can iterate without restarting.
type Wars struct {
	// mu guards byName and aliasOf.
	mu sync.RWMutex
	// byName maps a canonical war name to its narrative.
	byName map[string]WarNarrative
	// aliasOf maps each alias to its canonical war name.
	aliasOf map[string]string
}

// NewWars returns an empty narrative registry.
func NewWars() *Wars {
	return &Wars{byName: map[string]WarNarrative{}, aliasOf: map[string]string{}}
}

// WarAliases returns the alias to canonical name map for a wars registry,
// refusing an alias listed twice, an alias that is also a war key, and an
// entry that names itself as an alias.
func WarAliases(wars map[string]WarNarrative) (map[string]string, error) {
	out := map[string]string{}
	for _, name := range sortedNames(wars) {
		for _, a := range wars[name].Aliases {
			switch prev, dup := out[a]; {
			case a == name:
				return nil, fmt.Errorf("%w: %q lists itself", ErrWarAlias, name)
			case dup:
				return nil, fmt.Errorf("%w: %q is an alias of both %q and %q", ErrWarAlias, a, prev, name)
			}
			if _, isKey := wars[a]; isKey {
				return nil, fmt.Errorf("%w: %q is a war key and an alias of %q", ErrWarAlias, a, name)
			}
			out[a] = name
		}
	}
	return out, nil
}

// sortedNames returns the registry keys in order so errors are deterministic.
func sortedNames(wars map[string]WarNarrative) []string {
	out := make([]string, 0, len(wars))
	for k := range wars {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
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
	aliases, err := WarAliases(raw)
	if err != nil {
		return 0, fmt.Errorf("wars json: %w", err)
	}
	w.mu.Lock()
	w.byName = raw
	w.aliasOf = aliases
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

// Get returns the curated narrative for a war or one of its aliases, or the
// zero value if absent.
func (w *Wars) Get(name string) (WarNarrative, bool) {
	w.mu.RLock()
	defer w.mu.RUnlock()
	if c, ok := w.aliasOf[name]; ok {
		name = c
	}
	n, ok := w.byName[name]
	return n, ok
}

// Names returns the set of canonical war names.
func (w *Wars) Names() map[string]bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	out := make(map[string]bool, len(w.byName))
	for n := range w.byName {
		out[n] = true
	}
	return out
}

// Aliases returns a copy of the alias to canonical war name map.
func (w *Wars) Aliases() map[string]string {
	w.mu.RLock()
	defer w.mu.RUnlock()
	out := make(map[string]string, len(w.aliasOf))
	for a, c := range w.aliasOf {
		out[a] = c
	}
	return out
}

// Canonical returns the canonical war name for name, which is name itself
// unless it is an alias.
func (w *Wars) Canonical(name string) string {
	w.mu.RLock()
	defer w.mu.RUnlock()
	if c, ok := w.aliasOf[name]; ok {
		return c
	}
	return name
}

// casualtyPattern matches every integer token in a casualty string
// ("~91,000 killed, ~280,000 wounded" → finds both numbers; parseCasualties
// sums them). Tokens above 10M are ignored as unreasonable parses.
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
		raw := strings.ReplaceAll(tok, ",", "")
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
			applyNarrative(&sum, n)
		}
	}
	sum.DeathsBasis = summaryDeathsBasis(sum)
	return sum, nil
}

// applyNarrative copies the curated narrative slot into a computed summary.
// Numeric overrides (HumanDeaths and its range, curated years, parent) ride
// along with the prose so the summary carries the estimate's provenance.
func applyNarrative(sum *WarSummary, n WarNarrative) {
	sum.Outcome = n.Outcome
	sum.Aftermath = n.Aftermath
	sum.KeyTerms = n.KeyTerms
	sum.Notable = n.Notable
	sum.HumanDeaths = n.HumanDeaths
	sum.DeathsLow = n.DeathsLow
	sum.DeathsHigh = n.DeathsHigh
	sum.DeathsNote = n.DeathsNote
	sum.DeathsSource = n.DeathsSource
	sum.CuratedStartYear = n.StartYear
	sum.CuratedEndYear = n.EndYear
	sum.Parent = n.Parent
}

// summaryDeathsBasis classifies the provenance of the death figure a
// summary will display: "curated" when a curated estimate exists,
// "battle-sum" when only the battle-record roll-up is available, and empty
// when there is no figure at all.
func summaryDeathsBasis(sum WarSummary) string {
	switch {
	case sum.HumanDeaths > 0 || sum.DeathsLow > 0 || sum.DeathsHigh > 0:
		return "curated"
	case sum.TotalCasualties > 0:
		return "battle-sum"
	default:
		return ""
	}
}
