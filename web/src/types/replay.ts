// ============================================================================
// REPLAY SCHEMA v2 — the contract every battle declares to the renderer.
// ============================================================================
// Design principle: every battle is DATA in this schema. The renderer is one
// engine that composes primitives (camera, sound, atmosphere, beats, units,
// movements, casualties) from this contract. Improvements to any primitive
// land for every battle simultaneously. Adding a new battle = JSON, no code.
//
// Every field added below is OPTIONAL — the 143 existing curated replays
// continue to render. New fields unlock new primitives:
//
//   phase.atmosphere       → backdrop tint + weather particles + fog
//   phase.beats            → multi-event sequencing within a phase
//   phase.audio            → era-correct stings at specific times
//   phase.casualties       → live tally rising during the phase
//   phase.cameraMotion     → fly / track-action / orbit (vs current snap)
//   phase.focalUnitIndex   → camera locks onto a specific unit/movement
//   replay.score           → era-keyed score key + intensity curve
//   replay.narrationStyle  → documentary | editorial | urgent voice template
//
// Authoring tiers, on top of the schema:
//   S (~150): hand-crafted JSON, every field populated
//   A (~500): assisted authoring tool ingests Wikipedia + Wikidata → JSON,
//             human reviews; ~30 min per battle
//   B (rest): stub auto-generated from Wikidata metadata; dossier only
// ============================================================================

export interface Replay {
  battleId: string;
  title: string;
  intro: string;
  battlefieldDesc?: string;
  aspectRatio?: number;
  // extentLngDeg / extentLatDeg let a replay override the default geographic
  // extent on the globe view (in degrees per 100 units of normalized 0-100
  // space). Useful when a battle's scale differs from the default. A fleet
  // engagement needs a much wider view than a town siege.
  extentLngDeg?: number;
  extentLatDeg?: number;
  factionA: string;
  factionB: string;
  factionC?: string;
  // aggressor optionally identifies which side opened hostilities. When set,
  // and no explicit factionAColorKey / factionBColorKey is provided, the
  // renderer guarantees that side gets the hostile red palette and the
  // defender gets the cool blue palette. This is the legacy fallback for
  // pre-palette replays.
  aggressor?: Faction;
  // factionAColorKey / factionBColorKey / factionCColorKey assign an iconic
  // ColorKey from the faction palette to a specific side of this replay.
  // When set, they override the auto-detect from factionA / factionB names
  // and the positional aggressor swap. Use for wars where the historical
  // color identity is fixed: Wehrmacht is nazi-black, Red Army is soviet-red,
  // Wehrmacht vs Red Army should not look like two red blobs.
  factionAColorKey?: ColorKey;
  factionBColorKey?: ColorKey;
  factionCColorKey?: ColorKey;
  schematic?: boolean;
  phases: Phase[];

  // --------- v2 EXTENSIONS — optional, drive the new primitives ---------

  // score is the audio bed under the whole replay. The sound engine maps
  // ScoreKey to a low-frequency cinematic loop (era-appropriate strings,
  // war drums, ambient pad). Intensity per phase is taken from
  // phase.atmosphere.scoreIntensity (0-1).
  score?: ScoreKey;
  // ambientBed is the atmospheric layer that holds across phases when no
  // per-phase atmosphere is declared. Lets a curator set the mood once and
  // only override on phases that need a different beat.
  ambientBed?: PhaseAtmosphere;
  // narrationStyle is the voice template the assisted authoring tool uses
  // when generating phase narration from raw source text. Doesn't affect
  // rendering — drives the Claude API prompt at authoring time.
  narrationStyle?: 'documentary' | 'editorial' | 'urgent';
  // schemaVersion is the contract version this replay was authored against.
  // Lets the renderer fall back to legacy behavior for v1 entries.
  schemaVersion?: 1 | 2;
}

export interface FocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Phase {
  index: number;
  title: string;
  narration: string;
  timeMarker?: string;
  durationMs?: number;
  units: Unit[];
  movements?: Movement[];
  terrain?: Terrain[];
  annotations?: Annotation[];
  focus?: FocusRect;
  // Camera choreography for the globe replay. When set, the camera tweens
  // toward (cameraLat, cameraLng) at cameraAltitude over cameraTweenMs as the
  // phase begins. Setup phases pull back wide (alt 0.5+); climax phases push
  // in tight (alt 0.08-0.15). All fields optional. Unset phases inherit the
  // battle's default framing.
  cameraLat?: number;
  cameraLng?: number;
  cameraAltitude?: number;
  cameraTweenMs?: number;
  // controlRegions paints territorial state under the arrows. Each region is
  // a closed polygon (lat/lng pairs) tinted by the controlling faction. The
  // engine tweens the fill color when the same region's controller changes
  // between phases. That's the "front moves" effect.
  controlRegions?: ControlRegion[];

  // --------- v2 EXTENSIONS — optional, drive the new primitives ---------

  // atmosphere drives the backdrop renderer (time-of-day tint, weather
  // particles, fog layer, sound-engine intensity). Each field independently
  // optional. Falls back to replay.ambientBed, then to neutral defaults.
  atmosphere?: PhaseAtmosphere;
  // cameraMotion controls how the camera arrives at this phase's target.
  // 'snap' = instant cut, 'fly' = smooth eased tween (current default),
  // 'track-action' = camera follows the focal unit or movement across the
  // phase, 'orbit' = slow orbit around the action centroid.
  cameraMotion?: 'snap' | 'fly' | 'track-action' | 'orbit';
  // focalUnitIndex / focalMovementIndex tell the camera what to track. When
  // cameraMotion is 'track-action', the camera follows the focal item across
  // the phase. Indexes the units or movements array of THIS phase.
  focalUnitIndex?: number;
  focalMovementIndex?: number;
  // beats are the timeline of mid-phase events. Each beat fires at time_ms
  // (relative to phase start) and triggers a visual + audio event. Lets a
  // single phase be "barrage at 0ms → infantry advance at 1500ms → impact
  // at 3500ms → counterattack at 6000ms" instead of one wave of arrows.
  beats?: Beat[];
  // audio is the explicit sting list. Each sting fires at time_ms with a
  // StingKind the sound engine maps to a specific sample.
  audio?: AudioSting[];
  // casualties is the per-side change at the END of this phase. The casualty
  // ticker renders a live tally that climbs over the phase duration toward
  // these numbers. Allows the viewer to feel the cost rising.
  casualties?: { aDelta?: number; bDelta?: number; cDelta?: number };
  // fortifications are static defensive positions (Atlantic Wall, Maginot
  // bunker, beach battery, castle wall) rendered as heavy-rimmed NATO
  // squares with X. Distinct from Units so the renderer can layer them
  // permanently under the action and never animate them in/out.
  fortifications?: Fortification[];
}

// PhaseAtmosphere bundles every "mood" knob the renderer reads per phase.
// Each field optional; missing fields inherit from replay.ambientBed.
export interface PhaseAtmosphere {
  // timeOfDay drives the backdrop tint and shadow direction. Dawn lifts
  // the eastern horizon in orange; midday flattens shadows; dusk warms
  // the west; night drops the globe to deep blue with bright pin glows.
  timeOfDay?: 'dawn' | 'midday' | 'dusk' | 'night';
  // weather drives the particle layer. Snow falls during Stalingrad winter
  // phases; rain mutes the colors during Verdun mud; fog drops visibility.
  weather?: 'clear' | 'overcast' | 'rain' | 'snow' | 'fog' | 'storm';
  // smokeIntensity 0-1 layers a smoke particle field across the action.
  // 0 = clear, 1 = full battlefield haze (Verdun late phases).
  smokeIntensity?: number;
  // scoreIntensity 0-1 tells the sound engine how loud / driving the base
  // score should be during this phase. Build phases sit at 0.2-0.4; climax
  // beats push to 0.8-1.0; aftermath drops back to 0.1.
  scoreIntensity?: number;
}

export type BeatKind =
  | 'barrage'        // artillery / naval bombardment — bursts at multiple points
  | 'impact'         // single dramatic hit — flash + scorch
  | 'advance'        // infantry / armor pushes forward
  | 'hold'           // line holds — pulse on defenders
  | 'rally'          // reinforcements arrive — token pop-in
  | 'surrender'      // unit white-flag fades
  | 'breakthrough'   // a line breaks — explosive outward burst
  | 'encirclement';  // ring closes around a pocket — collapsing ring

export interface Beat {
  // Time offset from phase start in ms.
  timeMs: number;
  kind: BeatKind;
  // Position the beat fires at (lat/lng preferred, x/y normalized fallback).
  // Optional — if omitted, the renderer uses the centroid of relevant units
  // or movements for that beat kind.
  lat?: number;
  lng?: number;
  x?: number;
  y?: number;
  // faction the beat belongs to (lets the renderer color the visual).
  faction?: Faction;
  // optional human-readable label for accessibility / debug overlay.
  label?: string;
}

export type StingKind =
  | 'cannon'         // artillery boom
  | 'charge'         // bugle / war cry
  | 'volley'         // arrow / musket volley
  | 'surrender'      // muted horn
  | 'bell'           // chapel / town bell
  | 'war-cry'        // human roar
  | 'alarm'          // klaxon / siren
  | 'cheer'          // victory cheer
  | 'engine'         // tank / plane / ship engine wash
  | 'page-turn';     // phase advance transition

export interface AudioSting {
  // Time offset from phase start in ms.
  timeMs: number;
  sting: StingKind;
  // Optional stereo placement: 0 = full left, 1 = full right, 0.5 = center.
  pan?: number;
  // Optional volume scaler 0-1; lets a curator de-emphasize a sting that
  // would otherwise compete with narration.
  gain?: number;
}

export type FortificationKind =
  | 'bunker'         // concrete pillbox
  | 'battery'        // shore / coastal gun emplacement
  | 'wall'           // segmented defensive wall (Atlantic Wall, Hadrian's)
  | 'castle'         // medieval fortified site
  | 'trench-line'    // continuous earthworks
  | 'minefield'      // mined ground
  | 'tank-trap'      // dragon's teeth / hedgehogs
  | 'observation';   // OP / watch tower

export interface Fortification {
  kind: FortificationKind;
  faction: Faction;
  // Position (lat/lng preferred; x/y normalized fallback).
  lat?: number;
  lng?: number;
  x?: number;
  y?: number;
  // For wall / trench-line: the polyline of segments. Each [lat, lng].
  segments?: Array<[number, number]>;
  label?: string;
}

// ScoreKey maps to one of a curated set of era / mood loops the sound
// engine ships. Each loop sits behind the phase narration at the
// intensity declared in phase.atmosphere.scoreIntensity.
export type ScoreKey =
  | 'ancient-strings'    // lyres / horns — Marathon, Cannae, Gaugamela
  | 'medieval-choir'     // plainsong — Hastings, Agincourt, Crusades
  | 'napoleonic-march'   // martial drums — Austerlitz, Waterloo
  | 'industrial-brass'   // brass + low strings — Civil War, Franco-Prussian
  | 'great-war-dirge'    // mournful low strings — WW1 trenches
  | 'wwii-anthem'        // sweeping cinematic strings — D-Day, Stalingrad
  | 'cold-war-tension'   // ostinato + electronic — Korea, Vietnam
  | 'modern-pulse'       // synthetic pulse — Iraq, Ukraine
  | 'silence';           // no base bed; only stings + narration

export interface ControlRegion {
  // Stable id so the engine can match regions across phases for color tween.
  id: string;
  // Polygon ring as [lng, lat] pairs (GeoJSON order). The first point is not
  // duplicated at the end. The renderer closes it.
  ring: Array<[number, number]>;
  controller: Faction;
  // Optional label (e.g. "3rd Reich", "Soviet sector"). Renderer may hide
  // when zoomed out too far.
  label?: string;
}

export type Faction = 'a' | 'b' | 'c';

export type UnitType =
  | 'infantry'
  | 'cavalry'
  | 'archers'
  | 'artillery'
  | 'ships'
  | 'command'
  | 'aircraft'
  | 'armor'
  // v2 unit types — extend the symbol library:
  | 'paratroop'      // air-dropped infantry
  | 'mechanized'     // motorized / IFV
  | 'naval-fleet'    // multi-ship task force (heavier than single 'ships')
  | 'submarine'
  | 'air-squadron'   // multi-aircraft formation
  | 'supply'         // logistics column
  | 'engineer'       // sappers / bridge builders
  | 'recon'          // scout / cavalry-light
  | 'partisan'       // irregular / guerrilla
  | 'medic'          // field hospital / aid station
  | 'fortification'; // back-compat alias for Fortification (legacy curated)

export type UnitStatus =
  | 'concealed'
  | 'bait'
  | 'pressed'
  | 'pressing'
  | 'broken'
  | 'routed'
  | 'destroyed'
  | 'encircled'
  | 'exposed'
  | 'holding'
  | 'pursuing'
  | 'thinning'
  | 'gap'
  | 'isolated'
  | 'leaving'
  | 'squares';

export interface Unit {
  label: string;
  faction: Faction;
  unitType?: UnitType;
  // x/y are normalized 0-100 phase-local coordinates (legacy/auto-generated
  // replays use these). When lat/lng are present the geographic mode wins,
  // the renderer uses real coordinates and ignores x/y.
  x: number;
  y: number;
  lat?: number;
  lng?: number;
  w?: number;
  h?: number;
  strength?: number;
  status?: UnitStatus;
}

export type MovementKind =
  | 'advance'
  | 'retreat'
  | 'flank'
  | 'rout'
  | 'charge'
  | 'withdrawal'
  // v2 movement kinds — the engine reads kind to pick token shape,
  // trace style, sound sting, and beat sequencing:
  | 'amphibious'     // landing craft / fleet → beach (D-Day fleet, Inchon)
  | 'airdrop'        // paratroop deployment (82nd, 101st, Crete)
  | 'air-strike'     // bomber wing approach run
  | 'cavalry-charge' // headlong horse charge (Marathon, Waterloo cuirassiers)
  | 'siege'          // slow advance to invest a position
  | 'breakout'       // explosive thrust out of a pocket
  | 'pincer'         // converging from two sides
  | 'envelopment'    // wrap-around to encircle
  | 'pursuit'        // chasing a routed enemy
  | 'reinforcement'; // fresh units arriving on the field

export interface Movement {
  label?: string;
  faction: Faction;
  // Normalized 0-100 phase-local coordinates. Used when no lat/lng pair is
  // provided. Hand-curated geographic phases will set fromLat/Lng + toLat/Lng
  // directly and leave the x/y fields at their nominal defaults.
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromLat?: number;
  fromLng?: number;
  toLat?: number;
  toLng?: number;
  kind?: MovementKind;
}

export type TerrainKind =
  | 'river'
  | 'coast'
  | 'hill'
  | 'wood'
  | 'fort'
  | 'town'
  | 'road'
  | 'marsh'
  | 'ridge';

export interface Terrain {
  kind: TerrainKind;
  label?: string;
  points: number[];
}

export interface Annotation {
  text: string;
  x: number;
  y: number;
}

import type { ColorKey } from '../data/faction-palette';
import { detectColorKey, paletteFor } from '../data/faction-palette';

export const FACTION_COLOR: Record<Faction, string> = {
  a: '#f43f5e',
  b: '#3b82f6',
  c: '#a855f7',
};

export const FACTION_GLOW: Record<Faction, string> = {
  a: 'rgba(244, 63, 94, 0.35)',
  b: 'rgba(59, 130, 246, 0.35)',
  c: 'rgba(168, 85, 247, 0.35)',
};

// PaletteContext is the minimum a renderer needs to resolve a faction's
// color: explicit ColorKey overrides (if the replay declared them), the
// side display names (so we can auto-detect a key from the string), and
// the optional aggressor field (legacy fallback). Replay itself satisfies
// this interface structurally, so most callers can pass the whole Replay.
export interface PaletteContext {
  aggressor?: Faction;
  factionA?: string;
  factionB?: string;
  factionC?: string;
  factionAColorKey?: ColorKey;
  factionBColorKey?: ColorKey;
  factionCColorKey?: ColorKey;
}

// resolveFactionKey returns the ColorKey we should use for a faction slot
// given the replay's palette context, or null when no key resolves. Order:
// explicit ColorKey override, then name auto-detect.
function resolveFactionKey(faction: Faction, ctx?: PaletteContext): ColorKey | null {
  const explicit: ColorKey | undefined =
    faction === 'a' ? ctx?.factionAColorKey :
    faction === 'b' ? ctx?.factionBColorKey :
    ctx?.factionCColorKey;
  if (explicit) return explicit;
  const name: string | undefined =
    faction === 'a' ? ctx?.factionA :
    faction === 'b' ? ctx?.factionB :
    ctx?.factionC;
  if (name) {
    const detected = detectColorKey(name);
    if (detected) return detected;
  }
  return null;
}

// colorFamily buckets a ColorKey into a broad hue family. Used by the
// collision-detection logic so two sides that would land in the same
// family (e.g. US-blue vs UK-navy, or Soviet-red vs Imperial-Japan
// blood crimson) can pivot one to a contrasting fallback.
type ColorFamily = 'red' | 'blue' | 'green' | 'purple' | 'amber' | 'gray' | 'black' | 'cream';
function colorFamily(key: ColorKey): ColorFamily {
  switch (key) {
    case 'soviet-red':
    case 'imperial-japan':
    case 'north-korea-red':
    case 'north-vietnam-red':
    case 'communist-china':
    case 'russia-modern-red':
    case 'redcoat-red':
    case 'roman-crimson':
    case 'aggressor-red':
    case 'ottoman-burgundy':
      return 'red';
    case 'us-blue':
    case 'royal-navy':
    case 'free-french':
    case 'napoleonic-blue':
    case 'continental-blue':
    case 'prussian-blue':
    case 'union-blue':
    case 'south-korea-blue':
    case 'south-vietnam-blue':
    case 'nationalist-china':
    case 'ukraine-blue':
    case 'defender-blue':
      return 'blue';
    case 'fascist-italy':
    case 'saracen-green':
    case 'russian-green':
      return 'green';
    case 'persian-purple':
    case 'carthage-purple':
      return 'purple';
    case 'mongol-amber':
    case 'spanish-gold':
    case 'neutral-amber':
      return 'amber';
    case 'greek-slate':
    case 'confederate-gray':
      return 'gray';
    case 'nazi-black':
    case 'isis-black':
      return 'black';
    case 'habsburg-white':
    case 'crusader-cream':
      return 'cream';
  }
}

// Fallback ColorKey when two sides would land in the same family. Picked
// to maximise contrast against the family that's keeping its primary key.
// Family A→B mapping is fixed so the pivot is stable across renders.
const PIVOT_AWAY: Record<ColorFamily, ColorKey> = {
  red: 'spanish-gold',       // gold against red — high contrast, no royal connotation clash
  blue: 'confederate-gray',  // gray-slate against blue
  green: 'mongol-amber',     // amber against green
  purple: 'spanish-gold',    // gold against purple
  amber: 'union-blue',       // deep blue against amber
  gray: 'us-blue',
  black: 'spanish-gold',
  cream: 'roman-crimson',
};

// resolvePaletteWithPivot returns the ColorKey for each faction after
// running collision detection. If both A and B resolve to the same
// family, A keeps its key and B switches to a contrasting fallback.
// Faction C stays as resolved (third belligerent is rare and the user
// rarely conflates it visually). Replays with explicit ColorKey overrides
// on a side respect that override — pivot only fires when the conflict
// is the result of auto-detection.
function resolvePaletteWithPivot(ctx?: PaletteContext): { a: ColorKey | null; b: ColorKey | null; c: ColorKey | null } {
  const aKey = resolveFactionKey('a', ctx);
  let bKey = resolveFactionKey('b', ctx);
  const cKey = resolveFactionKey('c', ctx);
  if (aKey && bKey) {
    const aFam = colorFamily(aKey);
    const bFam = colorFamily(bKey);
    if (aFam === bFam) {
      // Only auto-pivot when faction B was auto-detected, not explicitly set.
      const bExplicit = ctx?.factionBColorKey;
      if (!bExplicit) {
        bKey = PIVOT_AWAY[aFam];
      }
    }
  }
  return { a: aKey, b: bKey, c: cKey };
}

// factionColorFor resolves a faction's solid display color. Resolution
// order: explicit ColorKey on the replay, then auto-detect from the side
// name, then collision-pivot (so the two sides never read as the same
// hue family), then the legacy aggressor swap, then positional default.
export function factionColorFor(faction: Faction, ctx?: PaletteContext): string {
  const resolved = resolvePaletteWithPivot(ctx);
  const key = faction === 'a' ? resolved.a : faction === 'b' ? resolved.b : resolved.c;
  if (key) return paletteFor(key).primary;
  const aggressor = ctx?.aggressor;
  if (!aggressor || aggressor === 'a' || faction === 'c') return FACTION_COLOR[faction];
  if (faction === 'a') return FACTION_COLOR.b;
  if (faction === 'b') return FACTION_COLOR.a;
  return FACTION_COLOR[faction];
}

// factionGlowFor mirrors factionColorFor for the soft halo palette used by
// unit chips, side tags, and arrow stops.
export function factionGlowFor(faction: Faction, ctx?: PaletteContext): string {
  const resolved = resolvePaletteWithPivot(ctx);
  const key = faction === 'a' ? resolved.a : faction === 'b' ? resolved.b : resolved.c;
  if (key) return paletteFor(key).glow;
  const aggressor = ctx?.aggressor;
  if (!aggressor || aggressor === 'a' || faction === 'c') return FACTION_GLOW[faction];
  if (faction === 'a') return FACTION_GLOW.b;
  if (faction === 'b') return FACTION_GLOW.a;
  return FACTION_GLOW[faction];
}
