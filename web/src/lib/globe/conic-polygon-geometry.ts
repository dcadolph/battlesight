// Drop-in replacement for the default export of three-conic-polygon-geometry
// (MIT license), which three-globe uses to fill country polygons.
//
// The upstream class triangulates in the longitude and latitude plane, which
// is fast, unless the polygon crosses the antimeridian or holds a pole. Those
// take a spherical path that costs seconds for a large country. This class
// cuts such a polygon into pieces that each fit the plane, builds every piece
// with the upstream class, and merges the results. The triangulation itself
// is still upstream's. vite.config.ts points the bare package name here and
// reaches the upstream build through a second name.
import { BufferGeometry, Float32BufferAttribute } from 'three';
import UpstreamConicPolygonGeometry from 'three-conic-polygon-geometry-upstream';

// Ring is one closed polygon ring of [lng, lat] points in degrees.
export type Ring = number[][];

// PolygonCoords is the coordinates of one GeoJSON polygon: an outer ring
// followed by its holes.
export type PolygonCoords = Ring[];

// Height is a radius, fixed or computed per point.
export type Height = number | ((lng: number, lat: number) => number);

// PlanarSplit describes how one polygon is rebuilt from planar pieces.
export type PlanarSplit = {
  // pieces holds the polygons handed to the upstream class.
  pieces: PolygonCoords[];
  // poleRing is the circle around the pole that the pieces stop at, or null
  // when the polygon holds no pole.
  poleRing: Ring | null;
  // width is the spacing of the cut meridians in degrees, or 0 when the
  // polygon was left whole.
  width: number;
  // seam is the longitude where a polar ring was opened, or null.
  seam: number | null;
};

// Part is the vertex data of one built piece, with its triangle indices
// kept apart per material slot.
export type Part = {
  // position holds x, y, z per vertex.
  position: ArrayLike<number>;
  // normal holds x, y, z per vertex.
  normal: ArrayLike<number>;
  // uv holds u, v per vertex.
  uv: ArrayLike<number>;
  // slots holds the triangle indices of each material slot.
  slots: number[][];
};

// MergedParts is the vertex data of several parts joined into one geometry.
export type MergedParts = {
  // position holds x, y, z per vertex.
  position: Float32Array;
  // normal holds x, y, z per vertex.
  normal: Float32Array;
  // uv holds u, v per vertex.
  uv: Float32Array;
  // index holds every triangle, ordered slot by slot.
  index: number[];
  // counts holds the number of indices in each material slot.
  counts: number[];
};

// Parameters mirrors the upstream parameters object, which three-globe
// compares to decide whether a polygon needs a rebuild.
type Parameters = {
  // polygonGeoJson is the coordinates array as passed in, kept by identity.
  polygonGeoJson: PolygonCoords;
  // bottomHeight is the inner radius.
  bottomHeight?: Height;
  // topHeight is the outer radius.
  topHeight?: Height;
  // closedBottom tells whether the inner cap is built.
  closedBottom?: boolean;
  // closedTop tells whether the outer cap is built.
  closedTop?: boolean;
  // includeSides tells whether the side walls are built.
  includeSides?: boolean;
  // curvatureResolution is the largest triangle edge in degrees.
  curvatureResolution?: number;
};

// POLE_LIMIT is the latitude the pieces of a polar polygon stop at. Upstream
// leaves the plane for anything within one degree of a pole.
const POLE_LIMIT = 88.9;

// POLE_STEP is the spacing in degrees of the points on the pole circle. It
// keeps every edge of the circle clear of the one degree limit.
const POLE_STEP = 10;

// POLE_SECTOR is the width in degrees of the pieces of a polar polygon. A
// narrow piece keeps planar triangles from folding over near the pole.
const POLE_SECTOR = 60;

// LINE_TOLERANCE is how close in degrees a vertex must be to a cut to count
// as standing on it.
const LINE_TOLERANCE = 1e-3;

const DEGREES = 180 / Math.PI;

// unwrapRing returns the ring with longitudes made continuous across the
// antimeridian, and the number of turns the ring makes around the polar axis.
export function unwrapRing(ring: Ring): { ring: Ring; turns: number } {
  let shift = 0;
  const out = ring.map(([lng, lat], i) => {
    if (i > 0) {
      const step = lng - ring[i - 1][0];
      if (step > 180) shift -= 360;
      else if (step < -180) shift += 360;
    }
    return [lng + shift, lat];
  });
  return { ring: out, turns: shift / 360 };
}

// lngExtent returns the lowest and highest longitude of a ring.
function lngExtent(ring: Ring): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [lng] of ring) {
    if (lng < lo) lo = lng;
    if (lng > hi) hi = lng;
  }
  return [lo, hi];
}

// clipSide keeps the part of an open ring on one side of a meridian, by
// Sutherland-Hodgman. A sign of 1 keeps longitudes at or above the line.
function clipSide(points: Ring, line: number, sign: 1 | -1): Ring {
  const out: Ring = [];
  points.forEach((cur, i) => {
    const prev = points[(i + points.length - 1) % points.length];
    const curIn = sign * (cur[0] - line) >= 0;
    const prevIn = sign * (prev[0] - line) >= 0;
    if (curIn !== prevIn) {
      const t = (line - prev[0]) / (cur[0] - prev[0]);
      out.push([line, prev[1] + t * (cur[1] - prev[1])]);
    }
    if (curIn) out.push(cur);
  });
  return out;
}

// closeRing drops repeated neighbors from an open ring and returns it
// closed, or empty when fewer than three points are left.
function closeRing(points: Ring): Ring {
  const out = points.filter((p, i) => {
    const q = points[(i + points.length - 1) % points.length];
    return p[0] !== q[0] || p[1] !== q[1];
  });
  if (out.length < 3) return [];
  out.push([out[0][0], out[0][1]]);
  return out;
}

// clipRing clips a closed planar ring to the band between two meridians and
// returns it closed, or empty when nothing is left.
export function clipRing(ring: Ring, min: number, max: number): Ring {
  return closeRing(clipSide(clipSide(ring.slice(0, -1), min, 1), max, -1));
}

// splitAtMeridians cuts a planar polygon into pieces no wider than width
// degrees. The cuts sit on meridians counted from the antimeridian, and each
// piece is shifted back into the range from -180 to 180.
export function splitAtMeridians(polygon: PolygonCoords, width: number): PolygonCoords[] {
  const [lo, hi] = lngExtent(polygon[0]);
  const first = Math.floor((lo + 180) / width);
  const last = Math.max(first, Math.ceil((hi + 180) / width) - 1);
  const pieces: PolygonCoords[] = [];
  for (let k = first; k <= last; k++) {
    const min = k * width - 180;
    const shift = -360 * Math.floor((k * width) / 360);
    const rings = polygon.map((ring) => clipRing(ring, min, min + width));
    if (rings[0].length === 0) continue;
    pieces.push(
      rings.filter((ring) => ring.length > 0).map((ring) => ring.map(([lng, lat]) => [lng + shift, lat])),
    );
  }
  return pieces;
}

// alignRing shifts a ring by whole turns so it starts within one turn above
// the given longitude.
function alignRing(ring: Ring, lo: number): Ring {
  const turns = Math.ceil((lo - lngExtent(ring)[0]) / 360 - 1e-9);
  return turns === 0 ? ring : ring.map(([lng, lat]) => [lng + 360 * turns, lat]);
}

// poleStrip opens a ring that circles a pole into a planar strip one turn
// wide. The strip starts at the vertex nearest the pole, so the seam to the
// pole cannot cross the ring, and it ends on the pole circle. It returns the
// strip, the pole circle, and the seam longitude.
export function poleStrip(ring: Ring, turns: number): { strip: Ring; poleRing: Ring; seam: number } {
  const open = ring.slice(0, -1);
  if (turns < 0) open.reverse();
  const south = open.reduce((sum, p) => sum + p[1], 0) < 0;
  const sign = south ? -1 : 1;
  let start = 0;
  open.forEach((p, i) => {
    if (sign * p[1] > sign * open[start][1]) start = i;
  });
  const clamp = ([lng, lat]: number[], turn: number): number[] => [
    lng + turn,
    sign * Math.min(sign * lat, POLE_LIMIT),
  ];
  const coast = [
    ...open.slice(start).map((p) => clamp(p, 0)),
    ...open.slice(0, start).map((p) => clamp(p, 360)),
    clamp(open[start], 360),
  ];
  const seam = coast[0][0];
  const poleRing: Ring = [[seam + 360, sign * POLE_LIMIT]];
  const firstStep = Math.floor((seam + 360 - 1e-9) / POLE_STEP) * POLE_STEP;
  for (let lng = firstStep; lng > seam + 1e-9; lng -= POLE_STEP) {
    poleRing.push([lng, sign * POLE_LIMIT]);
  }
  poleRing.push([seam, sign * POLE_LIMIT]);
  return { strip: closeRing([...coast, ...poleRing]), poleRing, seam };
}

// isPoleRing reports whether every point of a ring sits on a pole. Stitched
// world data closes a polar polygon with such a ring.
function isPoleRing(ring: Ring): boolean {
  return ring.every((p) => Math.abs(p[1]) > 89.99);
}

// planarPieces returns the polygon whole when upstream can already take it
// in the plane. A polygon that crosses the antimeridian is cut there, and a
// polygon that circles a pole is opened into a strip and cut into sectors.
// A hole that crosses the polar seam is not handled and is left filled.
export function planarPieces(polygon: PolygonCoords): PlanarSplit {
  const whole: PlanarSplit = { pieces: [polygon], poleRing: null, width: 0, seam: null };
  const rings = polygon.map(unwrapRing);
  if (rings.length === 0) return whole;
  const holes = rings.filter((r, i) => i > 0 && r.turns === 0).map((r) => r.ring);
  const winders = rings.filter((r) => r.turns !== 0 && !isPoleRing(r.ring));

  if (winders.length === 1) {
    const { strip, poleRing, seam } = poleStrip(winders[0].ring, winders[0].turns);
    if (strip.length === 0) return whole;
    const lone = rings[0].turns === 0 ? [rings[0].ring, ...holes] : holes;
    const planar = [strip, ...lone.map((ring) => alignRing(ring, seam))];
    const pieces = splitAtMeridians(planar, POLE_SECTOR);
    return pieces.length > 0 ? { pieces, poleRing, width: POLE_SECTOR, seam } : whole;
  }

  if (winders.length > 1 || rings[0].turns !== 0) return whole;
  const outer = rings[0].ring;
  const [lo, hi] = lngExtent(outer);
  if (lo >= -180 && hi <= 180) return whole;
  const planar = [outer, ...holes.map((ring) => alignRing(ring, lo))];
  const pieces = splitAtMeridians(planar, 360);
  return pieces.length > 0 ? { pieces, poleRing: null, width: 360, seam: null } : whole;
}

// polarToCartesian converts a point to the axes three-globe uses.
function polarToCartesian(lng: number, lat: number, r: number): [number, number, number] {
  const phi = (90 - lat) / DEGREES;
  const theta = (90 - lng) / DEGREES;
  return [r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

// lngLatOf reads a vertex back as [lng, lat], with the longitude between
// -90 and 270.
function lngLatOf(position: ArrayLike<number>, vertex: number): [number, number] {
  const x = position[3 * vertex];
  const y = position[3 * vertex + 1];
  const z = position[3 * vertex + 2];
  return [90 - Math.atan2(z, x) * DEGREES, 90 - Math.acos(y / Math.hypot(x, y, z)) * DEGREES];
}

// cutLineOf returns a key for the cut meridian or seam a longitude stands
// on, or null when it stands on neither.
function cutLineOf(lng: number, split: PlanarSplit): number | null {
  const t = (lng + 180) / split.width;
  const k = Math.round(t);
  if (Math.abs(t - k) * split.width < LINE_TOLERANCE) return (((k * split.width) % 360) + 360) % 360;
  if (split.seam === null) return null;
  const off = lng - split.seam;
  return Math.abs(off - 360 * Math.round(off / 360)) < LINE_TOLERANCE ? -1 : null;
}

// dropCutWalls removes the side walls that stand on a cut, the seam, or the
// pole circle, which are edges the split added. It relies on upstream
// writing each wall as six indices whose first and fifth are the top
// vertices of the two contour points.
export function dropCutWalls(part: Part, split: PlanarSplit): void {
  const side = part.slots[0];
  const kept: number[] = [];
  for (let i = 0; i + 5 < side.length; i += 6) {
    const [lngA, latA] = lngLatOf(part.position, side[i]);
    const [lngB, latB] = lngLatOf(part.position, side[i + 4]);
    const limit = POLE_LIMIT - LINE_TOLERANCE;
    if (split.poleRing && Math.abs(latA) >= limit && Math.abs(latB) >= limit) continue;
    const lineA = cutLineOf(lngA, split);
    if (lineA !== null && lineA === cutLineOf(lngB, split)) continue;
    for (let j = 0; j < 6; j++) kept.push(side[i + j]);
  }
  part.slots[0] = kept;
}

// partOf reads a built geometry into a part with the given number of
// material slots.
function partOf(geometry: BufferGeometry, slotCount: number): Part {
  const index = geometry.getIndex();
  const slots: number[][] = Array.from({ length: slotCount }, () => []);
  if (index) {
    for (const group of geometry.groups) {
      const from = group.start;
      slots[group.materialIndex ?? 0] = Array.from(index.array.subarray(from, from + group.count));
    }
  }
  return {
    position: geometry.getAttribute('position').array,
    normal: geometry.getAttribute('normal').array,
    uv: geometry.getAttribute('uv').array,
    slots,
  };
}

// poleFan builds the disc inside the pole circle as a fan of triangles in
// one material slot. An outward fan faces away from the globe center.
export function poleFan(poleRing: Ring, height: Height, outward: boolean, slotCount: number, slot: number): Part {
  const radius = typeof height === 'function' ? height : () => height;
  const poleLat = poleRing[0][1] < 0 ? -90 : 90;
  const points = [[0, poleLat], ...poleRing];
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  for (const [lng, lat] of points) {
    const r = radius(lng, lat);
    const [x, y, z] = polarToCartesian(lng, lat, r);
    const facing = (outward ? 1 : -1) / (r || 1);
    position.push(x, y, z);
    normal.push(x * facing, y * facing, z * facing);
    uv.push(0.5, 0.5);
  }
  // The pole circle runs with falling longitude. Seen from outside the globe
  // that is clockwise at the north pole and counterclockwise at the south.
  const forward = (poleLat < 0) === outward;
  const slots: number[][] = Array.from({ length: slotCount }, () => []);
  for (let i = 1; i < poleRing.length; i++) {
    if (forward) slots[slot].push(0, i, i + 1);
    else slots[slot].push(0, i + 1, i);
  }
  return { position, normal, uv, slots };
}

// mergeParts joins parts into one set of buffers, with the triangles ordered
// slot by slot so each material slot stays one index range.
export function mergeParts(parts: Part[], slotCount: number): MergedParts {
  const vertexCount = parts.reduce((sum, part) => sum + part.position.length / 3, 0);
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const offsets: number[] = [];
  let offset = 0;
  for (const part of parts) {
    offsets.push(offset);
    position.set(part.position, offset * 3);
    normal.set(part.normal, offset * 3);
    uv.set(part.uv, offset * 2);
    offset += part.position.length / 3;
  }
  const index: number[] = [];
  const counts: number[] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const before = index.length;
    parts.forEach((part, p) => {
      for (const vertex of part.slots[slot]) index.push(vertex + offsets[p]);
    });
    counts.push(index.length - before);
  }
  return { position, normal, uv, index, counts };
}

// ConicPolygonGeometry fills one polygon on a sphere, with the constructor
// and the parameters object of the upstream class.
export default class ConicPolygonGeometry extends BufferGeometry {
  // type names the geometry class, as upstream does.
  override readonly type = 'ConicPolygonGeometry';
  // parameters holds the constructor arguments as passed in.
  parameters: Parameters;

  constructor(
    polygonGeoJson: PolygonCoords,
    bottomHeight?: Height,
    topHeight?: Height,
    closedBottom?: boolean,
    closedTop?: boolean,
    includeSides?: boolean,
    curvatureResolution?: number,
  ) {
    super();
    this.parameters = {
      polygonGeoJson,
      bottomHeight,
      topHeight,
      closedBottom,
      closedTop,
      includeSides,
      curvatureResolution,
    };
    const build = (coords: PolygonCoords): BufferGeometry =>
      new UpstreamConicPolygonGeometry(
        coords,
        bottomHeight,
        topHeight,
        closedBottom,
        closedTop,
        includeSides,
        curvatureResolution,
      );

    const split = planarPieces(polygonGeoJson);
    if (split.width === 0) {
      const built = build(polygonGeoJson);
      this.setIndex(built.getIndex());
      for (const name of ['position', 'normal', 'uv']) this.setAttribute(name, built.getAttribute(name));
      for (const group of built.groups) this.addGroup(group.start, group.count, group.materialIndex);
      return;
    }

    const sides = includeSides ?? true;
    const bottom = closedBottom ?? true;
    const top = closedTop ?? true;
    const slotCount = Number(sides) + Number(bottom) + Number(top);
    const parts = split.pieces.map((piece) => partOf(build(piece), slotCount));
    if (sides) parts.forEach((part) => dropCutWalls(part, split));
    if (split.poleRing && bottom) {
      parts.push(poleFan(split.poleRing, bottomHeight || 0, false, slotCount, Number(sides)));
    }
    if (split.poleRing && top) {
      parts.push(poleFan(split.poleRing, topHeight || 1, true, slotCount, slotCount - 1));
    }

    const merged = mergeParts(parts, slotCount);
    this.setIndex(merged.index);
    this.setAttribute('position', new Float32BufferAttribute(merged.position, 3));
    this.setAttribute('normal', new Float32BufferAttribute(merged.normal, 3));
    this.setAttribute('uv', new Float32BufferAttribute(merged.uv, 2));
    let start = 0;
    merged.counts.forEach((count, slot) => {
      this.addGroup(start, count, slot);
      start += count;
    });
  }
}
