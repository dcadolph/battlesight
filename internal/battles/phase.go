package battles

// Replay is the full phased reenactment for a single battle.
type Replay struct {
	// BattleID is the slug of the battle this replay belongs to.
	BattleID string `json:"battleId"`
	// Title is the display title for the replay.
	Title string `json:"title"`
	// Intro is one or two sentences setting the strategic context.
	Intro string `json:"intro"`
	// BattlefieldDesc names the actual terrain (e.g. "Aufidus river plain").
	BattlefieldDesc string `json:"battlefieldDesc,omitempty"`
	// AspectRatio is width-over-height of the tactical viewport (default 1.6).
	AspectRatio float64 `json:"aspectRatio,omitempty"`
	// FactionA is the label for the first faction (color a).
	FactionA string `json:"factionA"`
	// FactionB is the label for the second faction (color b).
	FactionB string `json:"factionB"`
	// FactionC is an optional label for a third faction (color c).
	FactionC string `json:"factionC,omitempty"`
	// Phases is the ordered sequence of phases.
	Phases []Phase `json:"phases"`
}

// Phase is one beat of a battle: a tactical snapshot with narration.
type Phase struct {
	// Index is the zero-based position of this phase.
	Index int `json:"index"`
	// Title is the short title of the phase, like "The Trap Closes".
	Title string `json:"title"`
	// Narration explains what is happening in this phase.
	Narration string `json:"narration"`
	// TimeMarker is a time hint, like "Day 2, ~14:00" or "Morning".
	TimeMarker string `json:"timeMarker,omitempty"`
	// DurationMs is how long this phase should play in milliseconds.
	DurationMs int `json:"durationMs,omitempty"`
	// Units is the list of military units present in this phase.
	Units []Unit `json:"units"`
	// Movements is the list of arrows showing motion during this phase.
	Movements []Movement `json:"movements,omitempty"`
	// Terrain is the list of terrain features for this phase.
	Terrain []Terrain `json:"terrain,omitempty"`
	// Annotations are free-form text labels overlaid on the field.
	Annotations []Annotation `json:"annotations,omitempty"`
}

// Unit is a force unit positioned on the tactical map.
type Unit struct {
	// Label is the unit name, like "Roman center" or "Pickett's division".
	Label string `json:"label"`
	// Faction identifies the side: "a", "b", or "c".
	Faction string `json:"faction"`
	// UnitType is one of: infantry, cavalry, archers, artillery, ships, command, aircraft, armor.
	UnitType string `json:"unitType,omitempty"`
	// X is the horizontal position in normalized 0-100 space.
	X float64 `json:"x"`
	// Y is the vertical position in normalized 0-100 space.
	Y float64 `json:"y"`
	// W is the optional width of the unit block in normalized units.
	W float64 `json:"w,omitempty"`
	// H is the optional height of the unit block in normalized units.
	H float64 `json:"h,omitempty"`
	// Strength is a relative magnitude used to scale the unit glyph.
	Strength int `json:"strength,omitempty"`
	// Status is an optional adornment, like "broken" or "encircled".
	Status string `json:"status,omitempty"`
}

// Movement is an animated arrow showing a force moving across the field.
type Movement struct {
	// Label is the optional name of the movement.
	Label string `json:"label,omitempty"`
	// Faction identifies who is moving: "a", "b", or "c".
	Faction string `json:"faction"`
	// FromX is the starting horizontal position in normalized 0-100 space.
	FromX float64 `json:"fromX"`
	// FromY is the starting vertical position in normalized 0-100 space.
	FromY float64 `json:"fromY"`
	// ToX is the ending horizontal position.
	ToX float64 `json:"toX"`
	// ToY is the ending vertical position.
	ToY float64 `json:"toY"`
	// Kind is one of: advance, retreat, flank, rout, charge, withdrawal.
	Kind string `json:"kind,omitempty"`
}

// Terrain is a geographic feature on the tactical map.
type Terrain struct {
	// Kind is one of: river, coast, hill, wood, fort, town, road, marsh, ridge.
	Kind string `json:"kind"`
	// Label is the name of the feature, like "Aufidus River".
	Label string `json:"label,omitempty"`
	// Points is a flat list of x,y coordinates: [x1,y1,x2,y2,...].
	Points []float64 `json:"points"`
}

// Annotation is a text label placed on the tactical map.
type Annotation struct {
	// Text is the annotation content.
	Text string `json:"text"`
	// X is the horizontal position in normalized 0-100 space.
	X float64 `json:"x"`
	// Y is the vertical position.
	Y float64 `json:"y"`
}
