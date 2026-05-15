package battles

// Side represents one belligerent in a battle.
type Side struct {
	// Name is the nation, faction, or alliance.
	Name string `json:"name"`
	// Commander is the primary military leader.
	Commander string `json:"commander"`
	// Strength is the approximate force size.
	Strength string `json:"strength"`
	// Casualties is the approximate losses.
	Casualties string `json:"casualties"`
}

// Battle represents a single historical battle with its location and metadata.
type Battle struct {
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
	// Sides lists the belligerents.
	Sides []Side `json:"sides"`
	// Victor is the winning side's name.
	Victor string `json:"victor"`
	// Summary is a brief description of the battle.
	Summary string `json:"summary"`
	// Significance explains why this battle mattered.
	Significance string `json:"significance"`
}
