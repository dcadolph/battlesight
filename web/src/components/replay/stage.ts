// Stage rules for the Map view of a replay: where the camera sits for a phase,
// how much room the frame leaves around the action, and when the camera holds
// still between phases. Pure arithmetic on Web Mercator with no browser, map,
// or React imports, so the same functions drive the page and the Node checks.

// LngLat is a [longitude, latitude] pair in degrees.
export type LngLat = [number, number];

// StageBox is [minLng, minLat, maxLng, maxLat] in degrees.
export type StageBox = [number, number, number, number];

// StagePadding is the screen space in pixels kept clear on each side of the frame.
export interface StagePadding {
  // top is the space kept for the phase title slate.
  top: number;
  // bottom is the space kept for the playback controls.
  bottom: number;
  // left is the space kept on the left edge.
  left: number;
  // right is the space kept on the right edge.
  right: number;
}

// StageFrame is a north-up, flat camera: the map center and the zoom level.
export interface StageFrame {
  // center is the map center the camera looks at.
  center: LngLat;
  // zoom is the MapLibre zoom level, 512 pixels of world at zoom 0.
  zoom: number;
}

// STAGE_MARGIN is the share of the action's span added on each side of the frame.
export const STAGE_MARGIN = 0.22;

// STAGE_FLOOR_DEG is the least margin in degrees, so a single point still gets ground around it.
export const STAGE_FLOOR_DEG = 0.014;

// STAGE_MIN_ZOOM is the widest zoom the fallback framing uses.
export const STAGE_MIN_ZOOM = 5.5;

// STAGE_MAX_ZOOM is the closest the camera ever goes.
export const STAGE_MAX_ZOOM = 15.5;

// STAGE_HOLD_FILL is the least share of the held frame the new phase must fill to keep it.
export const STAGE_HOLD_FILL = 0.35;

// STAGE_MOVE_MS is the duration of the eased camera move between phases of one battle.
export const STAGE_MOVE_MS = 1400;

const TILE = 512;
const MAX_LAT = 85.051129;

// resolvePoint converts a unit or movement position to [lng, lat], preferring
// explicit geographic coordinates. Field positions on the 0 to 100 grid are laid
// over the replay's extent around the battle center. Returns null for the x=50,
// y=50 placeholder so units with no real position never stack on the center.
export function resolvePoint(
  x: number,
  y: number,
  lat: number | undefined,
  lng: number | undefined,
  centerLat: number,
  centerLng: number,
  extentLatDeg: number,
  extentLngDeg: number,
): LngLat | null {
  if (typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0)) {
    return [lng, lat];
  }
  if (x === 50 && y === 50) return null;
  const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
  const lngHalf = extentLngDeg / 2 / cosLat;
  const latHalf = extentLatDeg / 2;
  return [centerLng + ((x - 50) / 50) * lngHalf, centerLat + ((50 - y) / 50) * latHalf];
}

// stagePadding returns the clear space around the frame, scaled down on small screens
// so a phone keeps a usable middle. The bottom keeps room for the captions.
export function stagePadding(width: number, height: number): StagePadding {
  const side = Math.min(104, width * 0.08);
  return {
    top: Math.min(150, height * 0.16),
    bottom: Math.min(170, height * 0.2),
    left: side,
    right: side,
  };
}

// mercX converts a longitude to a Web Mercator x in world units of 0 to 1.
export function mercX(lng: number): number {
  return lng / 360 + 0.5;
}

// mercY converts a latitude to a Web Mercator y in world units of 0 to 1, north at 0.
export function mercY(lat: number): number {
  const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360)) / (2 * Math.PI);
}

// unmercX converts a Web Mercator x back to a longitude.
function unmercX(x: number): number {
  return (x - 0.5) * 360;
}

// unmercY converts a Web Mercator y back to a latitude.
function unmercY(y: number): number {
  return (Math.atan(Math.sinh((0.5 - y) * 2 * Math.PI)) * 180) / Math.PI;
}

// phaseBox returns the box around every point, or null when fewer than two points
// give the phase a shape.
export function phaseBox(points: LngLat[]): StageBox | null {
  if (points.length < 2) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

// worldSize returns the pixels of world width at a zoom level.
function worldSize(zoom: number): number {
  return TILE * Math.pow(2, zoom);
}

// usableCenterOffset returns how far below the screen center, in pixels, the middle
// of the padded area sits.
function usableCenterOffset(pad: StagePadding): [number, number] {
  return [(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2];
}

// frameForBox returns the north-up, flat camera that fits the box, grown by the stage
// margin on each side, into the padded middle of a width by height screen.
export function frameForBox(box: StageBox, width: number, height: number): StageFrame {
  const pad = stagePadding(width, height);
  const dLng = Math.max((box[2] - box[0]) * STAGE_MARGIN, STAGE_FLOOR_DEG);
  const dLat = Math.max((box[3] - box[1]) * STAGE_MARGIN, STAGE_FLOOR_DEG);
  const x0 = mercX(box[0] - dLng);
  const x1 = mercX(box[2] + dLng);
  const y0 = mercY(box[3] + dLat);
  const y1 = mercY(box[1] - dLat);
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const fit = Math.min(innerW / Math.max(x1 - x0, 1e-12), innerH / Math.max(y1 - y0, 1e-12));
  const zoom = Math.min(STAGE_MAX_ZOOM, Math.log2(fit / TILE));
  const scale = worldSize(zoom);
  const [ox, oy] = usableCenterOffset(pad);
  const cx = (x0 + x1) / 2 - ox / scale;
  const cy = (y0 + y1) / 2 - oy / scale;
  return { center: [unmercX(cx), unmercY(cy)], zoom };
}

// battlefieldZoom returns the zoom that frames a battle's whole extent in a width by
// height screen.
export function battlefieldZoom(
  extentLngDeg: number,
  extentLatDeg: number,
  centerLat: number,
  width: number,
  height: number,
): number {
  const cos = Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
  const zx = Math.log2((360 * width) / (TILE * Math.max(extentLngDeg, 1e-4)));
  const zy = Math.log2((360 * height * cos) / (TILE * Math.max(extentLatDeg, 1e-4)));
  return Math.min(zx, zy);
}

// fallbackFrame returns the camera for a phase with fewer than two points: the given
// center with the battle's whole extent in view.
export function fallbackFrame(
  center: LngLat,
  extentLngDeg: number,
  extentLatDeg: number,
  width: number,
  height: number,
): StageFrame {
  const zoom = battlefieldZoom(extentLngDeg * 1.35, extentLatDeg * 1.35, center[1], width, height);
  return { center, zoom: Math.max(STAGE_MIN_ZOOM, Math.min(STAGE_MAX_ZOOM, zoom)) };
}

// projectToScreen returns the screen pixel of a point under a north-up, flat camera.
export function projectToScreen(p: LngLat, frame: StageFrame, width: number, height: number): [number, number] {
  const scale = worldSize(frame.zoom);
  return [
    (mercX(p[0]) - mercX(frame.center[0])) * scale + width / 2,
    (mercY(p[1]) - mercY(frame.center[1])) * scale + height / 2,
  ];
}

// unprojectFromScreen returns the point under a screen pixel for a north-up, flat camera.
export function unprojectFromScreen(px: [number, number], frame: StageFrame, width: number, height: number): LngLat {
  const scale = worldSize(frame.zoom);
  return [
    unmercX(mercX(frame.center[0]) + (px[0] - width / 2) / scale),
    unmercY(mercY(frame.center[1]) + (px[1] - height / 2) / scale),
  ];
}

// SYMBOL_BASE_PX is the symbol size of a unit at the default strength of 3.
export const SYMBOL_BASE_PX = 38;

// SPREAD_MIN_GAP is the least distance between symbol centers, in symbol widths.
export const SPREAD_MIN_GAP = 0.9;

// SPREAD_MAX_SHIFT is the farthest a symbol moves from its true spot, in symbol widths.
export const SPREAD_MAX_SHIFT = 1.25;

// symbolSize returns a unit's symbol size in pixels: the base at strength 3, two pixels a
// strength step, strength clamped to 1 through 6 so the size stays 34 to 44.
export function symbolSize(strength: number | undefined): number {
  const s = Math.max(1, Math.min(6, strength ?? 3));
  return SYMBOL_BASE_PX + (s - 3) * 2;
}

// spreadSymbols nudges symbols apart on screen until their centers are the minimum gap
// apart, never moving one farther than the maximum shift from where it started. The
// relaxation visits pairs in a fixed order and breaks exact ties by index, so the same
// input always gives the same output.
export function spreadSymbols(px: Array<[number, number]>, sizes: number[]): Array<[number, number]> {
  const n = px.length;
  const cur = px.map((p) => [p[0], p[1]] as [number, number]);
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const need = (SPREAD_MIN_GAP * (sizes[i] + sizes[j])) / 2;
        let dx = cur[j][0] - cur[i][0];
        let dy = cur[j][1] - cur[i][1];
        let d = Math.hypot(dx, dy);
        if (d >= need - 0.01) continue;
        if (d < 1e-6) {
          const ang = 2.399963 * (i * 31 + j);
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (need - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        cur[i][0] -= ux * push;
        cur[i][1] -= uy * push;
        cur[j][0] += ux * push;
        cur[j][1] += uy * push;
        moved = true;
      }
    }
    for (let i = 0; i < n; i++) {
      const lim = SPREAD_MAX_SHIFT * sizes[i];
      const dx = cur[i][0] - px[i][0];
      const dy = cur[i][1] - px[i][1];
      const d = Math.hypot(dx, dy);
      if (d > lim) {
        cur[i][0] = px[i][0] + (dx / d) * lim;
        cur[i][1] = px[i][1] + (dy / d) * lim;
      }
    }
    if (!moved) break;
  }
  return cur;
}

// spreadPoints spreads unit symbols at a frame and returns the spread spots as map
// coordinates, so they hold while the camera moves to or away from that frame.
export function spreadPoints(
  points: LngLat[],
  sizes: number[],
  frame: StageFrame,
  width: number,
  height: number,
): LngLat[] {
  const px = points.map((p) => projectToScreen(p, frame, width, height));
  return spreadSymbols(px, sizes).map((q) => unprojectFromScreen(q, frame, width, height));
}

// boxFill returns the share of the padded middle a box covers on its larger axis
// under a frame.
export function boxFill(box: StageBox, frame: StageFrame, width: number, height: number): number {
  const pad = stagePadding(width, height);
  const scale = worldSize(frame.zoom);
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const bw = (mercX(box[2]) - mercX(box[0])) * scale;
  const bh = (mercY(box[1]) - mercY(box[3])) * scale;
  return Math.max(bw / innerW, bh / innerH);
}

// holdFrame reports whether the camera can stay on the current frame for a phase whose
// action fills the box: the box sits inside the padded middle and fills at least the
// hold share of it. The caller never holds on a first phase, across a battle change,
// or after the viewer moved the map.
export function holdFrame(current: StageFrame, box: StageBox, width: number, height: number): boolean {
  const pad = stagePadding(width, height);
  const [sx0, sy0] = projectToScreen([box[0], box[3]], current, width, height);
  const [sx1, sy1] = projectToScreen([box[2], box[1]], current, width, height);
  const inside = sx0 >= pad.left && sx1 <= width - pad.right && sy0 >= pad.top && sy1 <= height - pad.bottom;
  return inside && boxFill(box, current, width, height) >= STAGE_HOLD_FILL;
}

// STAGE_HOME_CAP is how much wider than the home frame a phase frame may be.
export const STAGE_HOME_CAP = 1.15;

// STAGE_OUTLIER_SPANS is how many median phase spans from the median center a point
// may sit and still count toward the home frame.
export const STAGE_OUTLIER_SPANS = 2.5;

// STAGE_NEAR_SCALE is the scale change under which a new frame is close enough to hold.
export const STAGE_NEAR_SCALE = 0.08;

// STAGE_NEAR_SHIFT is the share of the screen width a center may move and still hold.
export const STAGE_NEAR_SHIFT = 0.1;

// median returns the middle value of a non-empty list.
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// homeBox returns the box of the whole fight: every phase's points, less the ones
// farther than the outlier limit from the median phase center. Null when no phase
// has a shape or fewer than two points remain.
export function homeBox(phases: LngLat[][]): StageBox | null {
  const boxes = phases.map(phaseBox).filter((b): b is StageBox => b !== null);
  if (boxes.length === 0) return null;
  const span = Math.max(
    median(boxes.map((b) => Math.max(b[2] - b[0], b[3] - b[1]))),
    STAGE_FLOOR_DEG,
  );
  const cLng = median(boxes.map((b) => (b[0] + b[2]) / 2));
  const cLat = median(boxes.map((b) => (b[1] + b[3]) / 2));
  const limit = span * STAGE_OUTLIER_SPANS;
  const kept: LngLat[] = [];
  for (const pts of phases) {
    for (const p of pts) {
      if (Math.abs(p[0] - cLng) <= limit && Math.abs(p[1] - cLat) <= limit) kept.push(p);
    }
  }
  return phaseBox(kept);
}

// capFrame returns the frame no wider than the home frame times the cap, keeping
// its center.
export function capFrame(frame: StageFrame, home: StageFrame): StageFrame {
  const widest = home.zoom - Math.log2(STAGE_HOME_CAP);
  return frame.zoom < widest ? { center: frame.center, zoom: widest } : frame;
}

// nearFrame reports whether two frames differ so little in scale and center that a
// move between them would read as a twitch.
export function nearFrame(a: StageFrame, b: StageFrame, width: number): boolean {
  if (Math.abs(a.zoom - b.zoom) >= Math.log2(1 + STAGE_NEAR_SCALE)) return false;
  const scale = worldSize(a.zoom);
  const dx = (mercX(b.center[0]) - mercX(a.center[0])) * scale;
  const dy = (mercY(b.center[1]) - mercY(a.center[1])) * scale;
  return Math.hypot(dx, dy) < width * STAGE_NEAR_SHIFT;
}

// StageChoice is the camera picked for a phase and whether it is the one before.
export interface StageChoice {
  // frame is the camera for the phase.
  frame: StageFrame;
  // hold is true when the frame is the prior frame, kept without a move.
  hold: boolean;
}

// STAGE_LONE_SPREAD is how many times wider than the rest of a phase one lone point may
// make the frame before it is left to an edge pin.
export const STAGE_LONE_SPREAD = 3;

// boxSpan returns the larger side of a box in degrees, or 0 for no box.
function boxSpan(b: StageBox | null): number {
  return b ? Math.max(b[2] - b[0], b[3] - b[1]) : 0;
}

// LoneDrop is a phase's points less the lone far point, if one was dropped.
export interface LoneDrop {
  // kept is the points the frame takes.
  kept: LngLat[];
  // dropped is the index of the point left to an edge pin, or -1.
  dropped: number;
}

// dropLonePoint returns the points less the first one whose removal leaves a box under
// a third of the span of them all, so one far or misplaced point cannot set the frame.
export function dropLonePoint(points: LngLat[]): LoneDrop {
  const full = boxSpan(phaseBox(points));
  for (let i = 0; i < points.length; i++) {
    const rest = points.filter((_, j) => j !== i);
    if (boxSpan(phaseBox(rest)) * STAGE_LONE_SPREAD < full) return { kept: rest, dropped: i };
  }
  return { kept: points, dropped: -1 };
}

// countOnScreen returns how many points fall inside a width by height screen under a frame.
export function countOnScreen(points: LngLat[], frame: StageFrame, width: number, height: number): number {
  return points.filter((p) => !offScreen(projectToScreen(p, frame, width, height), width, height)).length;
}

// chooseFrame picks the camera for a phase. Prior is the frame before when the
// camera may hold on it, else null. Home is the frame of the whole fight, or null
// when the replay has no shape. Fallback is used only when both are missing. The
// frame is kept within the home cap unless that would leave fewer than half the
// phase's units on screen. Then it takes the whole phase, its units and arrow ends,
// less one lone far point, which gets an edge pin.
export function chooseFrame(
  prior: StageFrame | null,
  box: StageBox | null,
  home: StageFrame | null,
  fallback: () => StageFrame,
  width: number,
  height: number,
  units: LngLat[] = [],
  points: LngLat[] = [],
): StageChoice {
  if (!box) {
    if (prior) return { frame: prior, hold: true };
    return { frame: home ?? fallback(), hold: false };
  }
  const fit = frameForBox(box, width, height);
  let frame = home ? capFrame(fit, home) : fit;
  if (frame !== fit && units.length > 0 && countOnScreen(units, frame, width, height) * 2 < units.length) {
    const wide = phaseBox(dropLonePoint(points.length > 0 ? points : units).kept);
    if (wide) frame = frameForBox(wide, width, height);
  }
  if (prior && (holdFrame(prior, box, width, height) || nearFrame(prior, frame, width))) {
    return { frame: prior, hold: true };
  }
  return { frame, hold: false };
}

// EDGE_PIN_INSET is how far in from the left, right, and top of the screen an edge pin sits.
export const EDGE_PIN_INSET = 18;

// EdgePinBox is the screen area edge pins sit on: the screen less the inset at the
// sides, the room under the title slate, and the caption band at the bottom.
export interface EdgePinBox {
  // x0 is the left edge in pixels.
  x0: number;
  // y0 is the top edge in pixels.
  y0: number;
  // x1 is the right edge in pixels.
  x1: number;
  // y1 is the bottom edge in pixels.
  y1: number;
}

// edgePinBox returns the area edge pins sit on for a width by height screen.
export function edgePinBox(width: number, height: number): EdgePinBox {
  const pad = stagePadding(width, height);
  return {
    x0: EDGE_PIN_INSET,
    y0: Math.max(EDGE_PIN_INSET, pad.top * 0.75),
    x1: width - EDGE_PIN_INSET,
    y1: height - pad.bottom,
  };
}

// EdgeSide is the edge of the pin box a pin sits on.
export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

// EdgePin is a mark on the pin box edge for something past the screen edge.
export interface EdgePin {
  // x is the pin's screen x in pixels.
  x: number;
  // y is the pin's screen y in pixels.
  y: number;
  // angle points from the pin to the thing it stands for, in radians, screen y down.
  angle: number;
  // side is the pin box edge the pin sits on.
  side: EdgeSide;
}

// offScreen reports whether a screen point lies outside a width by height screen.
export function offScreen(p: [number, number], width: number, height: number): boolean {
  return p[0] < 0 || p[1] < 0 || p[0] > width || p[1] > height;
}

// edgePin returns where a point past the screen edge is pinned: the spot where the
// line from the start toward the point leaves the pin box. The start is used when it
// lies inside the pin box, else the box center. Null when the point is on screen.
export function edgePin(
  target: [number, number],
  start: [number, number] | null,
  width: number,
  height: number,
): EdgePin | null {
  if (!offScreen(target, width, height)) return null;
  const b = edgePinBox(width, height);
  const inside = (p: [number, number]) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;
  const s: [number, number] = start && inside(start) ? start : [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const dx = target[0] - s[0];
  const dy = target[1] - s[1];
  // The smallest positive step along the line that meets an edge.
  let t = Infinity;
  let side: EdgeSide = 'right';
  const tryEdge = (tt: number, sd: EdgeSide) => {
    if (tt > 0 && tt < t) {
      t = tt;
      side = sd;
    }
  };
  if (dx < 0) tryEdge((b.x0 - s[0]) / dx, 'left');
  if (dx > 0) tryEdge((b.x1 - s[0]) / dx, 'right');
  if (dy < 0) tryEdge((b.y0 - s[1]) / dy, 'top');
  if (dy > 0) tryEdge((b.y1 - s[1]) / dy, 'bottom');
  if (!Number.isFinite(t)) return null;
  const x = Math.min(b.x1, Math.max(b.x0, s[0] + dx * t));
  const y = Math.min(b.y1, Math.max(b.y0, s[1] + dy * t));
  return { x, y, angle: Math.atan2(target[1] - y, target[0] - x), side };
}

// slidePin moves a pin along its edge by a number of pixels, kept inside the pin box,
// and points it at the target again.
export function slidePin(pin: EdgePin, by: number, target: [number, number], width: number, height: number): EdgePin {
  const b = edgePinBox(width, height);
  const vertical = pin.side === 'left' || pin.side === 'right';
  const x = vertical ? pin.x : Math.min(b.x1, Math.max(b.x0, pin.x + by));
  const y = vertical ? Math.min(b.y1, Math.max(b.y0, pin.y + by)) : pin.y;
  return { x, y, angle: Math.atan2(target[1] - y, target[0] - x), side: pin.side };
}
