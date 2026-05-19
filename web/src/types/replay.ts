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
}

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
  | 'armor';

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
  | 'withdrawal';

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

// factionColorFor resolves a faction's solid display color. Resolution
// order: explicit ColorKey on the replay, then auto-detect from the side
// name, then the legacy aggressor swap (so an aggressor on slot 'b' still
// gets the hostile red palette), then the raw positional FACTION_COLOR.
export function factionColorFor(faction: Faction, ctx?: PaletteContext): string {
  const key = resolveFactionKey(faction, ctx);
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
  const key = resolveFactionKey(faction, ctx);
  if (key) return paletteFor(key).glow;
  const aggressor = ctx?.aggressor;
  if (!aggressor || aggressor === 'a' || faction === 'c') return FACTION_GLOW[faction];
  if (faction === 'a') return FACTION_GLOW.b;
  if (faction === 'b') return FACTION_GLOW.a;
  return FACTION_GLOW[faction];
}
