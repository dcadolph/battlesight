// atlas-arrows — geometry for documentary-style "axis of advance"
// arrows. Returns a closed polygon of [lng, lat] points shaped like
// the heavy filled arrows in WW2 military atlases (Beevor, Ambrose):
// a tapered or constant-width shaft that widens into a barbed
// arrowhead at the destination. Rendered by deck.gl's PolygonLayer
// with a solid faction-colored fill + dark outline.
//
// Coordinate math is flat-earth (equirectangular cosine correction).
// At tactical zooms (single battlefield, <500km extent) the error is
// well under a pixel. For amphibious campaigns spanning oceans the
// arrow still reads cleanly because the midpoint correction is small.
//
// Geometry (7-point polygon):
//
//      shaft-left  o─────────────o head-back-left
//                  │              \
//      from o──────┤               o  tip
//                  │              /
//      shaft-right o─────────────o head-back-right
//
// All offsets are computed in meters along an axis-aligned frame then
// rotated into lng/lat. This avoids the "thin arrow rotates funny near
// the poles" artifact that pure-degree math produces.

import type { MovementKind } from '../../types/replay';

const MPER_LAT_DEG = 111_320;

// metersPerLngDeg returns the local meters-per-degree-longitude at a
// given latitude. cos(0) at the equator = 1, cos(85) at the pole ≈ 0.09.
function metersPerLngDeg(latDeg: number): number {
  return MPER_LAT_DEG * Math.cos(latDeg * Math.PI / 180);
}

// movementGeom is the shape profile for one movement kind. Numbers are
// expressed in fractions of the arrow length so a 1km advance and a
// 100km amphibious landing both read with the right silhouette.
interface MovementGeom {
  // baseWidth: arrow shaft half-width, in meters at the smallest scale.
  // Caller can scale this. Tactical-zoom default ~600m gives a chunky
  // shaft that reads at a glance.
  baseWidth: number;
  // headLenFrac: arrowhead length as a fraction of total path length.
  // 0.30 means the head is 30% of the arrow. Charges have stubby heads
  // (high impact), amphibious landings have generous heads (drama).
  headLenFrac: number;
  // headWidthRatio: how much wider the head base is than the shaft.
  // 1.6 makes the head barb beyond the shaft for a proper arrow look.
  headWidthRatio: number;
  // shaftTaperRatio: shaft width at the tail vs the neck. 1.0 = constant
  // width. < 1.0 = tail narrower than neck (push outward feel). > 1.0 =
  // tail wider than neck (column collapsing inward).
  shaftTaperRatio: number;
}

const DEFAULT_GEOM: MovementGeom = {
  baseWidth: 2400,
  headLenFrac: 0.30,
  headWidthRatio: 1.95,
  shaftTaperRatio: 0.85,
};

const KIND_GEOM: Partial<Record<MovementKind, Partial<MovementGeom>>> = {
  charge:           { headLenFrac: 0.26, headWidthRatio: 2.1,  shaftTaperRatio: 0.75, baseWidth: 3000 },
  'cavalry-charge': { headLenFrac: 0.26, headWidthRatio: 2.1,  shaftTaperRatio: 0.7,  baseWidth: 2800 },
  breakout:         { headLenFrac: 0.28, headWidthRatio: 2.2,  shaftTaperRatio: 0.65, baseWidth: 3200 },
  amphibious:       { headLenFrac: 0.36, headWidthRatio: 2.05, shaftTaperRatio: 1.05, baseWidth: 2600 },
  airdrop:          { headLenFrac: 0.38, headWidthRatio: 1.95, shaftTaperRatio: 1.0,  baseWidth: 2100 },
  'air-strike':     { headLenFrac: 0.34, headWidthRatio: 2.3,  shaftTaperRatio: 0.85, baseWidth: 2000 },
  flank:            { headLenFrac: 0.32, headWidthRatio: 1.95, shaftTaperRatio: 0.85, baseWidth: 2300 },
  envelopment:      { headLenFrac: 0.32, headWidthRatio: 1.95, shaftTaperRatio: 0.85, baseWidth: 2400 },
  pincer:           { headLenFrac: 0.32, headWidthRatio: 2.0,  shaftTaperRatio: 0.8,  baseWidth: 2400 },
  pursuit:          { headLenFrac: 0.30, headWidthRatio: 1.85, shaftTaperRatio: 0.9,  baseWidth: 1800 },
  retreat:          { headLenFrac: 0.26, headWidthRatio: 1.6,  shaftTaperRatio: 1.2,  baseWidth: 2100 },
  withdrawal:       { headLenFrac: 0.26, headWidthRatio: 1.6,  shaftTaperRatio: 1.2,  baseWidth: 2100 },
  rout:             { headLenFrac: 0.24, headWidthRatio: 1.6,  shaftTaperRatio: 1.4,  baseWidth: 2100 },
  siege:            { headLenFrac: 0.28, headWidthRatio: 1.8,  shaftTaperRatio: 1.0,  baseWidth: 2100 },
  reinforcement:    { headLenFrac: 0.30, headWidthRatio: 1.95, shaftTaperRatio: 0.9,  baseWidth: 2100 },
};

function geomFor(kind: MovementKind | undefined): MovementGeom {
  if (!kind) return DEFAULT_GEOM;
  const overrides = KIND_GEOM[kind];
  if (!overrides) return DEFAULT_GEOM;
  return { ...DEFAULT_GEOM, ...overrides };
}

// buildAtlasArrow returns the polygon ring for one movement. Ring is
// closed by deck.gl automatically; we do not duplicate the first point.
// `scale` lets the caller multiply baseWidth (e.g. by phase intensity or
// unit strength).
export function buildAtlasArrow(
  from: [number, number],
  to: [number, number],
  kind: MovementKind | undefined,
  scale = 1,
): [number, number][] {
  const [fLng, fLat] = from;
  const [tLng, tLat] = to;
  const midLat = (fLat + tLat) / 2;
  const mPerLng = metersPerLngDeg(midLat);

  const dxM = (tLng - fLng) * mPerLng;
  const dyM = (tLat - fLat) * MPER_LAT_DEG;
  const lengthM = Math.hypot(dxM, dyM);
  if (lengthM < 1) {
    // Zero-length: return a tiny degenerate triangle to keep the
    // PolygonLayer happy without painting anything visible.
    return [from, from, from];
  }

  const g = geomFor(kind);
  // Cap the arrow width to a fraction of length so a stubby tactical
  // arrow does not balloon wider than it is long. Bumped from 0.085
  // to 0.12 so heavier shafts read at tactical zooms without losing
  // the "axis of advance" silhouette on short trips.
  const halfShaftMax = lengthM * 0.12;
  const halfShaft = Math.min(g.baseWidth * scale, halfShaftMax);
  const halfHead = halfShaft * g.headWidthRatio;
  const headLen = Math.min(g.headLenFrac * lengthM, halfShaft * 4.5);
  const neckPos = lengthM - headLen;

  const tailHalf = halfShaft * g.shaftTaperRatio;
  const neckHalf = halfShaft;

  // Local-frame points (x along axis, y perpendicular)
  // Order: ccw from tail-left around to tail-right closes the ring.
  const local: [number, number][] = [
    [0, -tailHalf],          // tail-left
    [neckPos, -neckHalf],    // neck-left
    [neckPos, -halfHead],    // head-back-left (the barb)
    [lengthM, 0],            // tip
    [neckPos, halfHead],     // head-back-right
    [neckPos, neckHalf],     // neck-right
    [0, tailHalf],           // tail-right
  ];

  // Rotation basis: unit vector along (from -> to) in meters.
  const ux = dxM / lengthM;
  const uy = dyM / lengthM;
  // Perpendicular (rotated +90° ccw in meters frame).
  const px = -uy;
  const py = ux;

  return local.map(([x, y]) => {
    const offX = x * ux + y * px;
    const offY = x * uy + y * py;
    return [
      fLng + offX / mPerLng,
      fLat + offY / MPER_LAT_DEG,
    ] as [number, number];
  });
}

// alphaForKind scales the arrow fill alpha by kind. Advances are
// declarative (high alpha), retreats are spectral (lower), siege/supply
// are quiet supporting motion.
export function alphaForKind(kind: MovementKind | undefined): number {
  if (!kind) return 215;
  if (kind === 'charge' || kind === 'cavalry-charge' || kind === 'breakout' || kind === 'advance') return 240;
  if (kind === 'amphibious' || kind === 'airdrop' || kind === 'air-strike') return 230;
  if (kind === 'rout' || kind === 'retreat' || kind === 'withdrawal') return 165;
  if (kind === 'siege' || kind === 'pursuit' || kind === 'reinforcement') return 195;
  return 215;
}
