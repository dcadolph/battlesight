package battles

// ListResponse wraps a paginated list of battles.
type ListResponse struct {
	// Battles is the result set.
	Battles []Battle `json:"battles"`
	// Total is the total count matching the filter (before pagination).
	Total int `json:"total"`
	// Limit is the page size used.
	Limit int `json:"limit"`
	// Offset is the starting position.
	Offset int `json:"offset"`
}

// LeanBattle is the minimum projection of a Battle needed to render the
// globe view: identity, location, era, war, victor, and the per-record
// tier / replay flags the UI uses to color and gate dot interactions.
// Heavy prose fields (Sides, Summary, Significance, References, Aliases,
// WikipediaTitle) are dropped. Cuts the list payload from ~17 MB to ~3 MB
// for the full 13k-battle dataset. The full record is fetched on demand
// via GET /api/battles/{id} when the user opens a dossier.
type LeanBattle struct {
	// ID is a unique slug for the battle.
	ID string `json:"id"`
	// Name is the common name of the battle.
	Name string `json:"name"`
	// Year is the primary year (negative for BC).
	Year int `json:"year"`
	// Date is a human-readable date string.
	Date string `json:"date"`
	// Lat is the latitude of the battle location.
	Lat float64 `json:"lat"`
	// Lng is the longitude of the battle location.
	Lng float64 `json:"lng"`
	// Era groups the battle into a historical period.
	Era string `json:"era"`
	// War is the larger conflict this battle belongs to.
	War string `json:"war"`
	// BattleType is the kind of engagement: land, naval, siege, aerial.
	BattleType string `json:"battleType"`
	// Victor is the winning side's name.
	Victor string `json:"victor"`
	// Verified is true for hand-curated battles, false for auto-imported.
	Verified bool `json:"verified"`
	// HasReplay is true when a hand-crafted phased replay exists.
	HasReplay bool `json:"hasReplay"`
	// HasSchematic is true when an auto-generated replay can be produced.
	HasSchematic bool `json:"hasSchematic"`
	// Tier is the data-quality tier.
	Tier string `json:"tier"`
}

// LeanListResponse mirrors ListResponse but carries the LeanBattle slice
// so the wire format on lean=true is self-describing.
type LeanListResponse struct {
	// Battles is the slice of lean-projected battles.
	Battles []LeanBattle `json:"battles"`
	// Total is the unfiltered total count.
	Total int `json:"total"`
	// Limit is the cap applied to the response.
	Limit int `json:"limit"`
	// Offset is the starting offset.
	Offset int `json:"offset"`
}

// LeanFromBattle projects a full Battle into the lean shape used by the
// list endpoint when lean=true. The fields kept are everything the globe
// view, dot tooltip, and filter UI rely on; the rest is on-demand via
// the per-battle endpoint.
func LeanFromBattle(b Battle) LeanBattle {
	return LeanBattle{
		ID:           b.ID,
		Name:         b.Name,
		Year:         b.Year,
		Date:         b.Date,
		Lat:          b.Lat,
		Lng:          b.Lng,
		Era:          b.Era,
		War:          b.War,
		BattleType:   b.BattleType,
		Victor:       b.Victor,
		Verified:     b.Verified,
		HasReplay:    b.HasReplay,
		HasSchematic: b.HasSchematic,
		Tier:         b.Tier,
	}
}

// CommanderBattle wraps a battle with the role inferred for the queried
// commander (led: top-billed on at least one side; participated: listed
// but not first). Used by the people-search panel.
type CommanderBattle struct {
	// Battle is the engagement record.
	Battle Battle `json:"battle"`
	// Role is "led" when the queried commander appears first in any side's
	// commander field, otherwise "participated".
	Role string `json:"role"`
}

// CommanderResponse wraps a paginated list of battles attributed to a
// named commander.
type CommanderResponse struct {
	// Name is the queried commander string.
	Name string `json:"name"`
	// Battles is the chronological result set.
	Battles []CommanderBattle `json:"battles"`
	// Total is the total count matching this commander.
	Total int `json:"total"`
	// Limit is the page size used.
	Limit int `json:"limit"`
	// Offset is the starting position.
	Offset int `json:"offset"`
}

// StatsResponse holds aggregate counts for populating filter UI.
type StatsResponse struct {
	// TotalBattles is the count of all battles in the database.
	TotalBattles int `json:"totalBattles"`
	// VerifiedBattles is the count of hand-curated battles.
	VerifiedBattles int `json:"verifiedBattles"`
	// ReplayCount is the number of battles with a hand-crafted replay.
	ReplayCount int `json:"replayCount"`
	// YearRange is the min and max year across all battles.
	YearRange [2]int `json:"yearRange"`
	// Eras lists each era with its battle count.
	Eras []NameCount `json:"eras"`
	// Wars lists each war with its battle count and earliest year.
	Wars []WarCount `json:"wars"`
	// BattleTypes lists each battle type with its count.
	BattleTypes []NameCount `json:"battleTypes"`
}

// NameCount pairs a label with an occurrence count.
type NameCount struct {
	// Name is the label.
	Name string `json:"name"`
	// Count is how many battles have this label.
	Count int `json:"count"`
}

// WarCount pairs a war name with its battle count, earliest year, and estimated casualties.
type WarCount struct {
	// Name is the war name.
	Name string `json:"name"`
	// Count is how many battles belong to this war (own battles only — does not
	// include nested children counts).
	Count int `json:"count"`
	// MinYear is the earliest battle year in this war. When a curated
	// CuratedStartYear exists it overrides this for display so World War II
	// can read 1931 (Mukden Incident) rather than the catalog's earliest
	// battle record.
	MinYear int `json:"minYear"`
	// Casualties is the battle-roll-up total across all battles in this war
	// (own battles only). The UI prefers HumanDeaths when present and tags
	// this number as battle-only with an asterisk.
	Casualties int `json:"casualties"`
	// HumanDeaths is the curated total deaths including civilians, famine,
	// genocide, and disease, sourced from wars.json. Zero means no curated
	// override; UI falls back to Casualties for the displayed total.
	HumanDeaths int64 `json:"humanDeaths,omitempty"`
	// Parent is the canonical name of the parent war when this row is a
	// theater or campaign of a larger conflict. Empty for top-level wars.
	Parent string `json:"parent,omitempty"`
	// RolledCount sums own count plus the count of every nested descendant.
	// For leaf rows this equals Count.
	RolledCount int `json:"rolledCount"`
	// RolledCasualties sums casualties across own row and all descendants.
	RolledCasualties int `json:"rolledCasualties"`
	// RolledHumanDeaths sums curated HumanDeaths across own row and all
	// descendants. Falls back to Casualties for any descendant lacking a
	// curated number so the rolled total is never less than the rolled
	// battle sum.
	RolledHumanDeaths int64 `json:"rolledHumanDeaths,omitempty"`
	// Countries lists the top present-day countries that fought in this war,
	// inferred from the sides on each battle and ranked by frequency. Used by
	// the war-list UI to group wars by belligerent.
	Countries []string `json:"countries,omitempty"`
}

// Filter holds query parameters for listing battles.
type Filter struct {
	// Era filters to a specific historical era.
	Era string
	// War filters to a specific war or conflict.
	War string
	// BattleType filters to land, naval, siege, or aerial.
	BattleType string
	// YearMin is the earliest year to include.
	YearMin int
	// YearMax is the latest year to include.
	YearMax int
	// Limit is the maximum number of results (0 = default 10000).
	Limit int
	// Offset is the pagination offset.
	Offset int
	// IncludeNoCoord forces inclusion of records where lat=0 and lng=0; by
	// default these are filtered because they cannot appear on the globe.
	IncludeNoCoord bool
	// Quality picks a data-quality tier. Values:
	//   "reconstructed" - only battles with a hand-crafted phase replay.
	//   "documented"    - curated battles plus non-curated with clean war field.
	//   "indexed"       - sparse Wikidata-harvested entries only.
	//   "all"           - everything (no quality gate).
	// Empty string defaults to "documented".
	Quality string
	// IDs restricts results to this set. Combines with all other filters via AND.
	// Empty slice means no restriction.
	IDs []string
}
