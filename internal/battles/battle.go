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

// Reference is a book, film, documentary, or article about a battle.
type Reference struct {
	// Type is the kind of reference: book, film, documentary, article.
	Type string `json:"type"`
	// Title is the name of the work.
	Title string `json:"title"`
	// Author is the creator (author, director, etc.).
	Author string `json:"author,omitempty"`
	// Year is the publication or release year.
	Year int `json:"year,omitempty"`
	// URL is an optional link.
	URL string `json:"url,omitempty"`
	// Note is a brief description of relevance.
	Note string `json:"note,omitempty"`
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
	// References lists books, films, and other sources about this battle.
	References []Reference `json:"references,omitempty"`
	// Verified is true for hand-curated battles, false for auto-imported.
	Verified bool `json:"verified"`
	// Source identifies where this record came from: curated, wikidata, cdb90.
	Source string `json:"source,omitempty"`
	// HasReplay is true when a hand-crafted phased replay exists for this battle.
	HasReplay bool `json:"hasReplay"`
	// HasSchematic is true when an auto-generated replay can be produced from
	// the battle's metadata (sides present). Always false when HasReplay is true.
	HasSchematic bool `json:"hasSchematic"`
	// WikipediaTitle is the article title on en.wikipedia.org for this battle.
	WikipediaTitle string `json:"wikipediaTitle,omitempty"`
	// Tier is the data-quality tier the battle currently occupies. One of:
	//   "reconstructed" - hand-crafted phase replay exists.
	//   "documented"    - curated entry, or non-curated with clean war and sides.
	//   "indexed"       - sparse Wikidata-harvested entry; trust Wikipedia link.
	Tier string `json:"tier"`
}
