// Look tokens for the paper plate a replay is drawn on. One look for the whole product:
// a pale stone sheet, quiet ground in two hues (water and woods), relief in warm ink, and
// names dark enough to read across a room. Each era shifts the sheet a little, warm for
// the ancient world and cooler for the world wars and today.

import type { GroundRole } from './ground';

// PlateLook is one era's set of plate colors, as hex, with the alpha of each ground role.
export interface PlateLook {
  // land is the sheet.
  land: string;
  // water fills sea and draws rivers.
  water: string;
  // waterEdge is the darker casing of a river and the shore line.
  waterEdge: string;
  // relief is the shaded side of a hill or ridge.
  relief: string;
  // hachure draws the short slope ticks around a hill or ridge.
  hachure: string;
  // wood fills woodland.
  wood: string;
  // woodEdge draws the broken edge of woodland.
  woodEdge: string;
  // road draws a road.
  road: string;
  // town fills the blocks of a town.
  town: string;
  // fort draws a fort's bastion trace.
  fort: string;
  // border draws the thin sheet border at the field edge.
  border: string;
  // name is the ink of a place name on land.
  name: string;
  // waterName is the ink of a water name.
  waterName: string;
  // reliefName is the ink of a hill or ridge name.
  reliefName: string;
  // townName is the ink of a town name.
  townName: string;
  // halo is the light outline around a place name.
  halo: string;
  // labelInk is the ink of a unit or arrow label on the plate.
  labelInk: string;
  // grainAlpha is the opacity of the paper grain, 0 to 100.
  grainAlpha: number;
}

// WARM is the sheet for the ancient and medieval world.
const WARM: PlateLook = {
  land: '#ded7c6',
  water: '#a5b7c0',
  waterEdge: '#6e8794',
  relief: '#a8957a',
  hachure: '#7a674e',
  wood: '#b9bd9e',
  woodEdge: '#87906c',
  road: '#857761',
  town: '#857a6a',
  fort: '#5c5245',
  border: '#8c826f',
  name: '#3a3329',
  waterName: '#2b4253',
  reliefName: '#4a3a27',
  townName: '#33302b',
  halo: '#ded7c6',
  labelInk: '#1d1a16',
  grainAlpha: 35,
};

// LINE is the sheet for the gunpowder and line eras, the note's starting stone.
const LINE: PlateLook = {
  ...WARM,
  land: '#ddd8cb',
  wood: '#b6bd9f',
  halo: '#ddd8cb',
};

// WORLD_WAR is the cooler gray-green sheet for the world wars.
const WORLD_WAR: PlateLook = {
  ...LINE,
  land: '#d9dad0',
  water: '#a3b6c1',
  relief: '#a0998a',
  hachure: '#6f6a5c',
  wood: '#b2bba0',
  woodEdge: '#818d6c',
  road: '#7c776a',
  border: '#86857a',
  halo: '#d9dad0',
};

// TODAY is the slate sheet for the cold war and today.
const TODAY: PlateLook = {
  ...WORLD_WAR,
  land: '#d7d9d7',
  water: '#a2b4c2',
  relief: '#9c9a93',
  hachure: '#69675f',
  wood: '#b0b9a3',
  border: '#838581',
  halo: '#d7d9d7',
};

// LOOK_BY_ERA maps an era key from theme/era.ts to its plate.
const LOOK_BY_ERA: Record<string, PlateLook> = {
  ancient: WARM,
  medieval: WARM,
  'early-modern': LINE,
  napoleonic: LINE,
  industrial: LINE,
  'world-war-1': WORLD_WAR,
  interwar: WORLD_WAR,
  'world-war-2': WORLD_WAR,
  'cold-war': TODAY,
  contemporary: TODAY,
};

// PLATE_LOOKS lists every distinct plate, for the checks.
export const PLATE_LOOKS: Record<string, PlateLook> = { warm: WARM, line: LINE, 'world-war': WORLD_WAR, today: TODAY };

// plateLook returns the plate for an era key, the line era's when the key is unknown.
export function plateLook(era: string | undefined): PlateLook {
  return (era && LOOK_BY_ERA[era]) || LINE;
}

// RoleStyle is how one ground role is drawn: its color, its opacity, and for lines the
// width in pixels.
export interface RoleStyle {
  // color is the hex color.
  color: string;
  // alpha is the opacity, 0 to 255.
  alpha: number;
  // widthPx is the line width in pixels, 0 for a fill.
  widthPx: number;
}

// roleStyle returns how a ground role is drawn on a plate.
export function roleStyle(look: PlateLook, role: GroundRole): RoleStyle {
  switch (role) {
    case 'sea':
      return { color: look.water, alpha: 255, widthPx: 0 };
    case 'shore':
      return { color: look.waterEdge, alpha: 200, widthPx: 1 };
    case 'marsh':
      return { color: look.waterEdge, alpha: 150, widthPx: 1 };
    case 'relief-shadow':
      return { color: look.relief, alpha: 120, widthPx: 0 };
    case 'relief-light':
      return { color: look.land, alpha: 255, widthPx: 0 };
    case 'hachure':
      return { color: look.hachure, alpha: 170, widthPx: 1 };
    case 'wood':
      return { color: look.wood, alpha: 210, widthPx: 0 };
    case 'wood-edge':
      return { color: look.woodEdge, alpha: 200, widthPx: 1.2 };
    case 'river-casing':
      return { color: look.waterEdge, alpha: 230, widthPx: 4.5 };
    case 'river':
      return { color: look.water, alpha: 255, widthPx: 2.5 };
    case 'road':
      return { color: look.road, alpha: 200, widthPx: 1.2 };
    case 'town':
      return { color: look.town, alpha: 200, widthPx: 0 };
    case 'fort':
      return { color: look.fort, alpha: 40, widthPx: 0 };
    case 'fort-line':
      return { color: look.fort, alpha: 220, widthPx: 1.5 };
    case 'border':
      return { color: look.border, alpha: 200, widthPx: 1 };
  }
}

// nameInk returns the ink of a place name by the kind of its feature.
export function nameInk(look: PlateLook, kind: string): string {
  switch (kind) {
    case 'river':
    case 'coast':
    case 'marsh':
      return look.waterName;
    case 'hill':
    case 'ridge':
      return look.reliefName;
    case 'town':
    case 'fort':
      return look.townName;
    default:
      return look.name;
  }
}

// luminance returns the relative luminance of a hex color, as WCAG defines it.
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

// contrast returns the WCAG contrast ratio of two hex colors.
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
