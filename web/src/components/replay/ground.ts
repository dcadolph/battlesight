// Ground for a field replay: the landmarks its phases name, joined across the whole replay
// and drawn in every phase, so the ground never changes under the viewer. Pure: field
// space in, shapes and name anchors out. Field space is 0 to 100 on both axes, y down,
// stretched by the replay's aspect on the map, so shapes are built in aspect space (x
// times the aspect) where a circle stays round, then mapped back.

import type { Replay, Terrain, TerrainKind } from '../../types/replay';

// FieldPoint is a point in field space, x then y.
export type FieldPoint = [number, number];

// GroundRole names what a drawn shape is, which picks its color, opacity, and width.
export type GroundRole =
  | 'sea'
  | 'shore'
  | 'marsh'
  | 'relief-shadow'
  | 'relief-light'
  | 'hachure'
  | 'wood'
  | 'wood-edge'
  | 'river-casing'
  | 'river'
  | 'road'
  | 'town'
  | 'fort'
  | 'fort-line'
  | 'border';

// GroundShape is one drawn shape: a closed fill or an open line.
export interface GroundShape {
  // role is what the shape is.
  role: GroundRole;
  // fill is true for a closed polygon, false for a line.
  fill: boolean;
  // points are the shape's points in field space.
  points: FieldPoint[];
  // key is the landmark the shape belongs to, empty for the sheet border.
  key: string;
}

// Landmark is one named place of a replay's ground.
export interface Landmark {
  // key is the place's identity: its name without notes, lower case, or the kind and
  // points for an unnamed feature.
  key: string;
  // name is the place's name as shown, with any note in parentheses dropped.
  name: string;
  // kind is the kind of feature.
  kind: TerrainKind;
  // points is the first geometry the replay gives the place.
  points: number[];
  // mentions is how many phases name the place in their narration.
  mentions: number;
  // named is true when the place carries its name on the plate.
  named: boolean;
}

// Ground is a replay's whole ground.
export interface Ground {
  // landmarks are the replay's places, in the order the replay first lists them.
  landmarks: Landmark[];
  // aspect is the field's width over its height on the ground.
  aspect: number;
}

// MAX_NAMES is the most places a replay names on the plate.
export const MAX_NAMES = 14;

// KIND_RANK orders kinds for naming when mentions tie, most telling first.
const KIND_RANK: Record<TerrainKind, number> = {
  town: 0,
  hill: 1,
  ridge: 2,
  river: 3,
  wood: 4,
  fort: 5,
  road: 6,
  marsh: 7,
  coast: 8,
};

// LINE_KINDS are the kinds drawn as a line through their points.
const LINE_KINDS = new Set<TerrainKind>(['river', 'road', 'coast']);

// isLineKind reports whether a kind is drawn as a line rather than a box.
export function isLineKind(kind: TerrainKind): boolean {
  return LINE_KINDS.has(kind);
}

// isFieldReplay reports whether a replay is laid out in field space, with no unit placed
// by latitude and longitude. Field replays get the plate; the others keep true ground.
// PAPER_READY holds the battles whose ground is drawn well enough for the paper plate. Every
// other battle keeps the real map. A battle joins only once its ground has been seen on paper.
export const PAPER_READY: ReadonlySet<string> = new Set<string>(['gettysburg-1863']);

export function isFieldReplay(replay: Replay): boolean {
  for (const ph of replay.phases) {
    for (const u of ph.units ?? []) {
      if (typeof u.lat === 'number' && typeof u.lng === 'number' && (u.lat !== 0 || u.lng !== 0)) return false;
    }
  }
  return true;
}

// placeName returns a terrain label without its notes in parentheses.
export function placeName(label: string | undefined): string {
  return (label ?? '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

// landmarkKey returns the identity a terrain feature joins its landmark by.
export function landmarkKey(t: Terrain): string {
  const name = placeName(t.label).toLowerCase();
  return name || `${t.kind}:${t.points.join(',')}`;
}

// buildGround joins the terrain of every phase into one ground. A place listed in many
// phases is one landmark, and its first geometry wins.
export function buildGround(replay: Replay, aspect: number): Ground {
  const byKey = new Map<string, Landmark>();
  for (const ph of replay.phases) {
    for (const t of ph.terrain ?? []) {
      if (!t.points || t.points.length < 4) continue;
      const key = landmarkKey(t);
      if (byKey.has(key)) continue;
      byKey.set(key, { key, name: placeName(t.label), kind: t.kind, points: t.points, mentions: 0, named: false });
    }
  }
  const landmarks = [...byKey.values()];
  const narration = replay.phases.map((ph) => (ph.narration ?? '').toLowerCase());
  for (const l of landmarks) {
    if (!l.name) continue;
    const needle = l.name.toLowerCase();
    l.mentions = narration.filter((n) => n.includes(needle)).length;
  }
  const order = landmarks
    .map((l, i) => ({ l, i }))
    .filter((x) => x.l.name)
    .sort((a, b) => b.l.mentions - a.l.mentions || KIND_RANK[a.l.kind] - KIND_RANK[b.l.kind] || a.i - b.i);
  for (const x of order.slice(0, MAX_NAMES)) x.l.named = true;
  return { landmarks, aspect };
}

// drawList returns the landmarks drawn in a phase: every one, in every phase.
export function drawList(ground: Ground, phaseIdx: number): Landmark[] {
  void phaseIdx;
  return ground.landmarks;
}

// seeded returns a small deterministic random source keyed by a string, so the same
// replay always draws the same ground.
function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box is an axis-aligned box in aspect space.
interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// boxOf returns a box feature's box in aspect space, corners in order.
function boxOf(points: number[], aspect: number): Box {
  const [ax, ay, bx, by] = points;
  return {
    x1: Math.min(ax, bx) * aspect,
    y1: Math.min(ay, by),
    x2: Math.max(ax, bx) * aspect,
    y2: Math.max(ay, by),
  };
}

// pathOf returns a line feature's points in aspect space.
function pathOf(points: number[], aspect: number): FieldPoint[] {
  const out: FieldPoint[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push([points[i] * aspect, points[i + 1]]);
  return out;
}

// toField maps aspect-space points back to field space.
function toField(pts: FieldPoint[], aspect: number): FieldPoint[] {
  return pts.map(([x, y]) => [x / aspect, y]);
}

// ellipse returns n points around an ellipse, starting due east and turning clockwise on
// screen (y down).
function ellipse(cx: number, cy: number, rx: number, ry: number, n: number): FieldPoint[] {
  const out: FieldPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

// smooth returns a Catmull-Rom curve through the points, steps samples a segment.
function smooth(pts: FieldPoint[], steps: number): FieldPoint[] {
  if (pts.length < 3) return pts;
  const out: FieldPoint[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// dashes cuts a path into dashes of the given length and gap, all in aspect space.
function dashes(path: FieldPoint[], dash: number, gap: number): FieldPoint[][] {
  const out: FieldPoint[][] = [];
  let on = true;
  let left = dash;
  let cur: FieldPoint[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    let [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    let seg = Math.hypot(bx - ax, by - ay);
    while (seg > 1e-9) {
      const step = Math.min(left, seg);
      const t = step / seg;
      const nx = ax + (bx - ax) * t;
      const ny = ay + (by - ay) * t;
      if (on) cur.push([nx, ny]);
      seg -= step;
      left -= step;
      ax = nx;
      ay = ny;
      if (left <= 1e-9) {
        if (on && cur.length > 1) out.push(cur);
        on = !on;
        left = on ? dash : gap;
        cur = [[ax, ay]];
      }
    }
  }
  if (on && cur.length > 1) out.push(cur);
  return out;
}

// FIELD is the field's box in field space.
const FIELD_MIN = 0;
const FIELD_MAX = 100;

// clipPolygon clips a polygon to the field (Sutherland-Hodgman, the field is convex).
export function clipPolygon(poly: FieldPoint[]): FieldPoint[] {
  type Edge = { inside: (p: FieldPoint) => boolean; cut: (a: FieldPoint, b: FieldPoint) => FieldPoint };
  const lerpX = (a: FieldPoint, b: FieldPoint, x: number): FieldPoint => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const lerpY = (a: FieldPoint, b: FieldPoint, y: number): FieldPoint => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  const edges: Edge[] = [
    { inside: (p) => p[0] >= FIELD_MIN, cut: (a, b) => lerpX(a, b, FIELD_MIN) },
    { inside: (p) => p[0] <= FIELD_MAX, cut: (a, b) => lerpX(a, b, FIELD_MAX) },
    { inside: (p) => p[1] >= FIELD_MIN, cut: (a, b) => lerpY(a, b, FIELD_MIN) },
    { inside: (p) => p[1] <= FIELD_MAX, cut: (a, b) => lerpY(a, b, FIELD_MAX) },
  ];
  let out = poly;
  for (const e of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const ci = e.inside(cur);
      const pi = e.inside(prev);
      if (ci) {
        if (!pi) out.push(e.cut(prev, cur));
        out.push(cur);
      } else if (pi) {
        out.push(e.cut(prev, cur));
      }
    }
  }
  return out;
}

// clipPath clips an open path to the field and returns the pieces inside it.
export function clipPath(path: FieldPoint[]): FieldPoint[][] {
  const out: FieldPoint[][] = [];
  let cur: FieldPoint[] = [];
  for (let i = 1; i < path.length; i++) {
    const seg = clipSegment(path[i - 1], path[i]);
    if (!seg) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    const [a, b] = seg;
    const last = cur[cur.length - 1];
    if (!last || last[0] !== a[0] || last[1] !== a[1]) {
      if (cur.length > 1) out.push(cur);
      cur = [a];
    }
    cur.push(b);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// clipSegment clips one segment to the field (Liang-Barsky), null when it is outside.
function clipSegment(a: FieldPoint, b: FieldPoint): [FieldPoint, FieldPoint] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const tests: Array<[number, number]> = [
    [-dx, a[0] - FIELD_MIN],
    [dx, FIELD_MAX - a[0]],
    [-dy, a[1] - FIELD_MIN],
    [dy, FIELD_MAX - a[1]],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

// groundShapes draws a ground. heart is the middle of the action in field space, which
// decides the land side of a coast. Shapes come back in drawing order, back to front.
export function groundShapes(ground: Ground, heart: FieldPoint): GroundShape[] {
  const { aspect } = ground;
  const layers: GroundShape[][] = [[], [], [], [], [], [], [], []];
  const [SEA, MARSH, RELIEF, WOOD, WATER, ROAD, BUILT, TOP] = [0, 1, 2, 3, 4, 5, 6, 7];
  const addFill = (at: number, role: GroundRole, key: string, pts: FieldPoint[]) => {
    const clipped = clipPolygon(toField(pts, aspect));
    if (clipped.length >= 3) layers[at].push({ role, fill: true, points: clipped, key });
  };
  const addLine = (at: number, role: GroundRole, key: string, pts: FieldPoint[]) => {
    for (const piece of clipPath(toField(pts, aspect))) layers[at].push({ role, fill: false, points: piece, key });
  };
  const heartA: FieldPoint = [heart[0] * aspect, heart[1]];

  for (const l of ground.landmarks) {
    const rand = seeded(l.key);
    switch (l.kind) {
      case 'coast': {
        const path = smooth(pathOf(l.points, aspect), 6);
        if (path.length < 2) break;
        const a = path[0];
        const b = path[path.length - 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const d: FieldPoint = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        let n: FieldPoint = [-d[1], d[0]];
        const mid = path[Math.floor(path.length / 2)];
        if ((mid[0] - heartA[0]) * n[0] + (mid[1] - heartA[1]) * n[1] < 0) n = [-n[0], -n[1]];
        const far = 400;
        const a0: FieldPoint = [a[0] - d[0] * far, a[1] - d[1] * far];
        const b0: FieldPoint = [b[0] + d[0] * far, b[1] + d[1] * far];
        addFill(SEA, 'sea', l.key, [
          a0,
          ...path,
          b0,
          [b0[0] + n[0] * far, b0[1] + n[1] * far],
          [a0[0] + n[0] * far, a0[1] + n[1] * far],
        ]);
        addLine(WATER, 'shore', l.key, path);
        break;
      }
      case 'marsh': {
        const b = boxOf(l.points, aspect);
        const rowGap = Math.max(0.6, Math.min(1.4, (b.y2 - b.y1) / 5));
        for (let y = b.y1 + rowGap / 2; y < b.y2; y += rowGap) {
          let x = b.x1 + rand() * 0.6;
          while (x < b.x2) {
            const w = 0.6 + rand() * 0.5;
            addLine(MARSH, 'marsh', l.key, [
              [x, y],
              [Math.min(b.x2, x + w), y],
            ]);
            x += w + 0.4 + rand() * 0.5;
          }
        }
        break;
      }
      case 'hill':
      case 'ridge': {
        const b = boxOf(l.points, aspect);
        const cx = (b.x1 + b.x2) / 2;
        const cy = (b.y1 + b.y2) / 2;
        const rx = Math.max(0.4, (b.x2 - b.x1) / 2);
        const ry = Math.max(0.4, (b.y2 - b.y1) / 2);
        const n = 72;
        addFill(RELIEF, 'relief-shadow', l.key, ellipse(cx, cy, rx, ry, n));
        // The lit form sits up and to the left, so the shadow shows as a crisp crescent
        // down and to the right: light from the northwest.
        addFill(RELIEF, 'relief-light', l.key, ellipse(cx - rx * 0.09, cy - ry * 0.09, rx * 0.94, ry * 0.94, n));
        // Hachures: short ticks running down the slope, longer on the shaded side.
        const perim = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
        const ticks = Math.max(16, Math.min(160, Math.round(perim / 0.55)));
        const tick = Math.max(0.35, Math.min(1.4, Math.min(rx, ry) * 0.22));
        for (let i = 0; i < ticks; i++) {
          const ang = (i / ticks) * Math.PI * 2;
          const ex = Math.cos(ang);
          const ey = Math.sin(ang);
          // shade runs from 0 on the lit northwest side to 1 on the southeast side.
          const shade = (ex + ey) / (2 * Math.SQRT1_2) * 0.5 + 0.5;
          const len = tick * (0.45 + 0.75 * shade);
          const px = cx + rx * ex;
          const py = cy + ry * ey;
          const nx = ex / rx;
          const ny = ey / ry;
          const nl = Math.hypot(nx, ny) || 1;
          addLine(RELIEF, 'hachure', l.key, [
            [px, py],
            [px + (nx / nl) * len, py + (ny / nl) * len],
          ]);
        }
        break;
      }
      case 'wood': {
        const b = boxOf(l.points, aspect);
        const cx = (b.x1 + b.x2) / 2;
        const cy = (b.y1 + b.y2) / 2;
        const rx = Math.max(0.4, (b.x2 - b.x1) / 2);
        const ry = Math.max(0.4, (b.y2 - b.y1) / 2);
        const n = 56;
        const phase = rand() * Math.PI * 2;
        const blob: FieldPoint[] = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const c = Math.cos(a);
          const s = Math.sin(a);
          // A squarish blob (superellipse) with a soft wavy edge.
          const k = 1 + 0.07 * Math.sin(5 * a + phase) + 0.05 * (rand() - 0.5);
          blob.push([cx + rx * k * Math.sign(c) * Math.pow(Math.abs(c), 0.6), cy + ry * k * Math.sign(s) * Math.pow(Math.abs(s), 0.6)]);
        }
        addFill(WOOD, 'wood', l.key, blob);
        for (const d of dashes([...blob, blob[0]], 0.9, 0.45)) addLine(WOOD, 'wood-edge', l.key, d);
        break;
      }
      case 'river': {
        const path = smooth(pathOf(l.points, aspect), 8);
        addLine(WATER, 'river-casing', l.key, path);
        addLine(WATER, 'river', l.key, path);
        break;
      }
      case 'road': {
        const path = pathOf(l.points, aspect);
        if (path.length < 2) break;
        for (const d of dashes(path, 1.3, 0.8)) addLine(ROAD, 'road', l.key, d);
        break;
      }
      case 'town': {
        const b = boxOf(l.points, aspect);
        const w = b.x2 - b.x1;
        const h = b.y2 - b.y1;
        const unit = Math.max(0.4, Math.min(1.6, Math.sqrt(w * h) / 9));
        const count = Math.max(5, Math.min(70, Math.round((w * h) / (unit * unit * 4))));
        const placed: Box[] = [];
        for (let tries = 0; placed.length < count && tries < count * 12; tries++) {
          const bw = unit * (0.7 + rand() * 0.8);
          const bh = unit * (0.6 + rand() * 0.6);
          // Blocks gather toward the middle of the town, as a market town does.
          const gx = (rand() + rand()) / 2;
          const gy = (rand() + rand()) / 2;
          const x = b.x1 + gx * Math.max(0, w - bw);
          const y = b.y1 + gy * Math.max(0, h - bh);
          const box = { x1: x, y1: y, x2: x + bw, y2: y + bh };
          const gap = unit * 0.25;
          if (placed.some((p) => box.x1 < p.x2 + gap && p.x1 < box.x2 + gap && box.y1 < p.y2 + gap && p.y1 < box.y2 + gap)) continue;
          placed.push(box);
          const ang = (rand() - 0.5) * 0.5;
          const mx = (box.x1 + box.x2) / 2;
          const my = (box.y1 + box.y2) / 2;
          const corners: FieldPoint[] = [
            [-bw / 2, -bh / 2],
            [bw / 2, -bh / 2],
            [bw / 2, bh / 2],
            [-bw / 2, bh / 2],
          ].map(([dx, dy]) => [mx + dx * Math.cos(ang) - dy * Math.sin(ang), my + dx * Math.sin(ang) + dy * Math.cos(ang)]);
          addFill(BUILT, 'town', l.key, corners);
        }
        break;
      }
      case 'fort': {
        const b = boxOf(l.points, aspect);
        const cx = (b.x1 + b.x2) / 2;
        const cy = (b.y1 + b.y2) / 2;
        const s = Math.max(0.5, Math.min(b.x2 - b.x1, b.y2 - b.y1) / 2);
        // A four-bastion trace: each corner a bastion tip with its two flanks, the
        // curtain walls joining the flanks.
        const trace: FieldPoint[] = [];
        for (let k = 0; k < 4; k++) {
          const t = Math.PI / 4 + (k * Math.PI) / 2;
          const f = (18 * Math.PI) / 180;
          trace.push([cx + 0.62 * s * Math.cos(t - f), cy + 0.62 * s * Math.sin(t - f)]);
          trace.push([cx + s * Math.cos(t), cy + s * Math.sin(t)]);
          trace.push([cx + 0.62 * s * Math.cos(t + f), cy + 0.62 * s * Math.sin(t + f)]);
        }
        addFill(BUILT, 'fort', l.key, trace);
        addLine(BUILT, 'fort-line', l.key, [...trace, trace[0]]);
        break;
      }
    }
  }
  layers[TOP].push({
    role: 'border',
    fill: false,
    key: '',
    points: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ],
  });
  return layers.flat();
}

// NameSpot is one place a name may sit: an anchor on the ground, how the text hangs off
// it, and its turn.
export interface NameSpot {
  // at is the anchor in field space.
  at: FieldPoint;
  // anchor is the text's horizontal anchor.
  anchor: 'start' | 'middle' | 'end';
  // baseline is the text's vertical anchor.
  baseline: 'top' | 'center' | 'bottom';
  // offset is the pixel offset from the anchor, x then y, y down.
  offset: [number, number];
  // angle is the text's turn in degrees, counterclockwise on screen.
  angle: number;
}

// GroundName is a named landmark with the spots its name may take, best first.
export interface GroundName {
  // key is the landmark.
  key: string;
  // text is the name as drawn.
  text: string;
  // kind is the landmark's kind, which picks the type.
  kind: TerrainKind;
  // sizePx is the type size in pixels.
  sizePx: number;
  // spots are the places the name may sit, best first.
  spots: NameSpot[];
}

// NAME_GAP_PX is the gap between a feature and its name.
const NAME_GAP_PX = 5;

// groundNames returns the names a ground draws and where each may sit.
export function groundNames(ground: Ground): GroundName[] {
  const { aspect } = ground;
  const out: GroundName[] = [];
  for (const l of ground.landmarks) {
    if (!l.named) continue;
    const town = l.kind === 'town' || l.kind === 'fort';
    const text = town ? l.name.toUpperCase() : l.name;
    const sizePx = town ? 12 : 15;
    const spots: NameSpot[] = [];
    if (isLineKind(l.kind)) {
      const path = pathOf(l.points, aspect);
      if (path.length < 2) continue;
      for (const frac of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
        const [p, dir] = alongPath(path, frac);
        let angle = (-Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle <= -90) angle += 180;
        // Only gentle turns: steep names read badly, so they sit level beside the line.
        if (Math.abs(angle) > 50) angle = 0;
        const at: FieldPoint = [p[0] / aspect, p[1]];
        const rad = (angle * Math.PI) / 180;
        const up: [number, number] = [-Math.sin(rad) * NAME_GAP_PX, -Math.cos(rad) * NAME_GAP_PX];
        spots.push({ at, anchor: 'middle', baseline: 'bottom', offset: up, angle });
        spots.push({ at, anchor: 'middle', baseline: 'top', offset: [-up[0], -up[1]], angle });
      }
    } else {
      const b = boxOf(l.points, aspect);
      const cx = (b.x1 + b.x2) / 2 / aspect;
      const cy = (b.y1 + b.y2) / 2;
      const north: NameSpot = { at: [cx, b.y1], anchor: 'middle', baseline: 'bottom', offset: [0, -NAME_GAP_PX], angle: 0 };
      const south: NameSpot = { at: [cx, b.y2], anchor: 'middle', baseline: 'top', offset: [0, NAME_GAP_PX], angle: 0 };
      const east: NameSpot = { at: [b.x2 / aspect, cy], anchor: 'start', baseline: 'center', offset: [NAME_GAP_PX, 0], angle: 0 };
      const west: NameSpot = { at: [b.x1 / aspect, cy], anchor: 'end', baseline: 'center', offset: [-NAME_GAP_PX, 0], angle: 0 };
      const tall = b.y2 - b.y1 > 2.2 * (b.x2 - b.x1);
      if ((l.kind === 'hill' || l.kind === 'ridge') && tall) {
        // A long north-south ridge carries its name along its western foot, read
        // bottom to top, then along its eastern foot.
        spots.push({ at: [b.x1 / aspect, cy], anchor: 'middle', baseline: 'bottom', offset: [-NAME_GAP_PX, 0], angle: 90 });
        spots.push({ at: [b.x2 / aspect, cy], anchor: 'middle', baseline: 'top', offset: [NAME_GAP_PX, 0], angle: 90 });
      }
      if (town) spots.push(north, south, east, west);
      else if (l.kind === 'hill' || l.kind === 'ridge') spots.push(east, west, north, south);
      else spots.push(south, north, east, west);
    }
    out.push({ key: l.key, text, kind: l.kind, sizePx, spots });
  }
  return out;
}

// alongPath returns the point a fraction of the way along a path and the direction of
// the path there.
function alongPath(path: FieldPoint[], frac: number): [FieldPoint, FieldPoint] {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  let want = total * frac;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (want <= seg || i === path.length - 1) {
      const t = seg > 0 ? Math.min(1, want / seg) : 0;
      return [
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        [b[0] - a[0], b[1] - a[1]],
      ];
    }
    want -= seg;
  }
  return [path[0], [1, 0]];
}

// ScreenBox is an axis-aligned box on screen, in pixels.
export interface ScreenBox {
  // x1 is the left edge.
  x1: number;
  // y1 is the top edge.
  y1: number;
  // x2 is the right edge.
  x2: number;
  // y2 is the bottom edge.
  y2: number;
}

// PlacedName is a name with the spot it took and its box on screen.
export interface PlacedName {
  // key is the landmark.
  key: string;
  // text is the name as drawn.
  text: string;
  // kind is the landmark's kind.
  kind: TerrainKind;
  // sizePx is the type size in pixels.
  sizePx: number;
  // spot is where the name sits.
  spot: NameSpot;
  // box is the name's box on screen.
  box: ScreenBox;
}

// nameBox returns the screen box a name takes at a spot, given the anchor's screen point.
export function nameBox(name: GroundName, spot: NameSpot, anchor: [number, number]): ScreenBox {
  const upper = name.text === name.text.toUpperCase();
  const w = name.text.length * name.sizePx * (upper ? 0.68 : 0.5) + 4;
  const h = name.sizePx * 1.25;
  const x = spot.anchor === 'start' ? 0 : spot.anchor === 'middle' ? -w / 2 : -w;
  const y = spot.baseline === 'top' ? 0 : spot.baseline === 'center' ? -h / 2 : -h;
  // The text's own box, then turned about the anchor.
  const corners: Array<[number, number]> = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const rad = (-spot.angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const px = anchor[0] + spot.offset[0];
  const py = anchor[1] + spot.offset[1];
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const [cx, cy] of corners) {
    const rx = px + cx * c - cy * s;
    const ry = py + cx * s + cy * c;
    x1 = Math.min(x1, rx);
    y1 = Math.min(y1, ry);
    x2 = Math.max(x2, rx);
    y2 = Math.max(y2, ry);
  }
  return { x1, y1, x2, y2 };
}

// boxesMeet reports whether two screen boxes overlap.
export function boxesMeet(a: ScreenBox, b: ScreenBox): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

// placeNames gives each name the first spot that is on screen and meets no blocked box
// and no name already placed. A name with no free spot is left off for that view.
// toScreen maps a field point to the screen.
export function placeNames(
  names: GroundName[],
  toScreen: (p: FieldPoint) => [number, number],
  blocked: ScreenBox[],
  width: number,
  height: number,
): PlacedName[] {
  const placed: PlacedName[] = [];
  for (const name of names) {
    for (const spot of name.spots) {
      const box = nameBox(name, spot, toScreen(spot.at));
      if (box.x1 < 0 || box.y1 < 0 || box.x2 > width || box.y2 > height) continue;
      if (blocked.some((b) => boxesMeet(b, box))) continue;
      if (placed.some((p) => boxesMeet(p.box, box))) continue;
      placed.push({ key: name.key, text: name.text, kind: name.kind, sizePx: name.sizePx, spot, box });
      break;
    }
  }
  return placed;
}

// fieldToLngLat maps a field point to the map, the same way stage.resolvePoint lays out a
// unit placed in field space.
export function fieldToLngLat(
  p: FieldPoint,
  centerLat: number,
  centerLng: number,
  extentLatDeg: number,
  extentLngDeg: number,
): [number, number] {
  const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
  const lngHalf = extentLngDeg / 2 / cosLat;
  const latHalf = extentLatDeg / 2;
  return [centerLng + ((p[0] - 50) / 50) * lngHalf, centerLat + ((50 - p[1]) / 50) * latHalf];
}
