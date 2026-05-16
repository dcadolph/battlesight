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
	// Schematic is true when the replay was generated automatically from
	// the battle's metadata rather than hand-curated.
	Schematic bool `json:"schematic,omitempty"`
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
	// Focus optionally constrains the visible area for this phase. When set,
	// the tactical viewport pans and zooms to this rect, framing the action
	// (e.g. a tight zoom on Bloody Lane, then a wide pull-back for the
	// army's race to the sea). x/y/w/h are normalized 0-100.
	Focus *FocusRect `json:"focus,omitempty"`
	// CameraLat is the latitude the globe camera should fly toward at the
	// start of this phase. Optional; unset phases inherit the battle's
	// default framing.
	CameraLat float64 `json:"cameraLat,omitempty"`
	// CameraLng is the longitude the globe camera should fly toward.
	CameraLng float64 `json:"cameraLng,omitempty"`
	// CameraAltitude is the camera distance from the surface in Earth-radii
	// units. Setup phases ~0.5+; climax phases 0.08-0.15.
	CameraAltitude float64 `json:"cameraAltitude,omitempty"`
	// CameraTweenMs is the duration of the camera fly-in for this phase.
	// Defaults to 900ms when omitted.
	CameraTweenMs int `json:"cameraTweenMs,omitempty"`
	// ControlRegions paints territorial state under the arrows. Each region
	// is a closed lat/lng polygon tinted by its controller. The renderer
	// tweens fill color when the same region's controller changes between
	// phases — that is the "front moves" effect.
	ControlRegions []ControlRegion `json:"controlRegions,omitempty"`
}

// ControlRegion is a territorial polygon tinted by the controlling faction.
type ControlRegion struct {
	// ID is the stable identifier used to match the same region across phases
	// for color tweening.
	ID string `json:"id"`
	// Ring is the polygon boundary as [lng, lat] pairs (GeoJSON order). The
	// first point is not duplicated at the end — the renderer closes it.
	Ring [][2]float64 `json:"ring"`
	// Controller is the faction currently holding this region ("a", "b", "c").
	Controller string `json:"controller"`
	// Label is an optional name shown when zoom permits, like "3rd Reich".
	Label string `json:"label,omitempty"`
}

// FocusRect is the rectangular area of the tactical map that the camera
// frames during a phase. All four values are in the normalized 0-100 space.
type FocusRect struct {
	// X is the left edge.
	X float64 `json:"x"`
	// Y is the top edge.
	Y float64 `json:"y"`
	// W is the width.
	W float64 `json:"w"`
	// H is the height.
	H float64 `json:"h"`
}

// Unit is a force unit positioned on the tactical map.
type Unit struct {
	// Label is the unit name, like "Roman center" or "Pickett's division".
	Label string `json:"label"`
	// Faction identifies the side: "a", "b", or "c".
	Faction string `json:"faction"`
	// UnitType is one of: infantry, cavalry, archers, artillery, ships, command, aircraft, armor.
	UnitType string `json:"unitType,omitempty"`
	// X is the horizontal position in normalized 0-100 space. Used when Lat
	// and Lng are not provided.
	X float64 `json:"x"`
	// Y is the vertical position in normalized 0-100 space.
	Y float64 `json:"y"`
	// Lat is the unit's real geographic latitude. When set together with Lng,
	// the globe renderer prefers these over X/Y.
	Lat float64 `json:"lat,omitempty"`
	// Lng is the unit's real geographic longitude.
	Lng float64 `json:"lng,omitempty"`
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
	// Used when FromLat/FromLng are not provided.
	FromX float64 `json:"fromX"`
	// FromY is the starting vertical position in normalized 0-100 space.
	FromY float64 `json:"fromY"`
	// ToX is the ending horizontal position.
	ToX float64 `json:"toX"`
	// ToY is the ending vertical position.
	ToY float64 `json:"toY"`
	// FromLat is the starting latitude when the movement is anchored to real
	// geography. When set together with FromLng, the globe renderer prefers
	// the geographic coordinates over FromX/FromY.
	FromLat float64 `json:"fromLat,omitempty"`
	// FromLng is the starting longitude.
	FromLng float64 `json:"fromLng,omitempty"`
	// ToLat is the ending latitude.
	ToLat float64 `json:"toLat,omitempty"`
	// ToLng is the ending longitude.
	ToLng float64 `json:"toLng,omitempty"`
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
