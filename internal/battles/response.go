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

// StatsResponse holds aggregate counts for populating filter UI.
type StatsResponse struct {
	// TotalBattles is the count of all battles in the database.
	TotalBattles int `json:"totalBattles"`
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
	// Count is how many battles belong to this war.
	Count int `json:"count"`
	// MinYear is the earliest battle year in this war.
	MinYear int `json:"minYear"`
	// Casualties is the estimated total casualties across all battles.
	Casualties int `json:"casualties"`
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
	// Limit is the maximum number of results (0 = default 1000).
	Limit int
	// Offset is the pagination offset.
	Offset int
}
