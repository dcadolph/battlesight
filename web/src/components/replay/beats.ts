// Beats rules for the Map view of a replay: where each unit starts and ends a phase,
// when it travels, and when each arrow grows, dims, and flashes. Pure arithmetic with
// no browser, map, or React imports, so the same functions drive the page and the
// Node checks.
//
// Times are on the phase clock in milliseconds. The clock reads 0 when the camera has
// come to rest and runs at the playback speed, so the phase dwell is the same number of
// clock milliseconds at every speed while the camera move, which runs in wall time,
// takes more of the clock at higher speeds.

import { mercX, mercY } from './stage';
import type { LngLat } from './stage';

// BeatUnit is one unit of a phase with its position resolved.
export interface BeatUnit {
  // gid is the unit's identity across phases.
  gid: string;
  // side is the faction the unit fights for.
  side: string;
  // listed is the spot the phase lists for the unit, before any ride or spread.
  listed: LngLat;
  // status is the unit's state in this phase, e.g. broken or routed.
  status?: string;
}

// BeatArrow is one movement of a phase with its ends resolved.
export interface BeatArrow {
  // side is the faction that makes the move.
  side: string;
  // kind is the movement kind, e.g. charge or withdrawal.
  kind?: string;
  // from is the arrow's tail.
  from: LngLat;
  // to is the arrow's tip.
  to: LngLat;
}

// Ride is the outcome of the ride rule for one phase.
export interface Ride {
  // end is each unit's end spot before the spread, in unit order.
  end: LngLat[];
  // carrier is the arrow that carries each unit, in unit order, or -1.
  carrier: number[];
  // rider is the unit each arrow carries, in arrow order, or -1.
  rider: number[];
}

// PriorSpot is where a unit stood when the phase before ended.
export interface PriorSpot {
  // drawn is the spot the unit was drawn on, after the spread.
  drawn: LngLat;
  // end is the unit's end spot before the spread.
  end: LngLat;
  // status is the unit's state in the phase before.
  status?: string;
}

// TimelineInput is everything the timeline of one phase depends on.
export interface TimelineInput {
  // units are the phase's units in data order.
  units: BeatUnit[];
  // arrows are the phase's movements in data order.
  arrows: BeatArrow[];
  // ride is rideRule's result for these units and arrows.
  ride: Ride;
  // drawnEnd is each unit's end spot after the spread, in unit order.
  drawnEnd: LngLat[];
  // prior holds where each unit of the phase before ended, by gid. On the first phase it
  // holds the phase's own listed spots, so every unit stands from the start.
  prior: Map<string, PriorSpot>;
  // firstPhase is true when prior holds the phase's own spots, so nothing fades in.
  firstPhase: boolean;
  // dwellMs is the phase dwell on the phase clock.
  dwellMs: number;
  // entryMs is the camera move into the phase in wall time, 0 when the camera holds.
  entryMs: number;
  // speed is the playback speed.
  speed: number;
}

// UnitTrack is one unit's path through a phase.
export interface UnitTrack {
  // gid is the unit's identity across phases.
  gid: string;
  // unit is the unit's index in the phase, or -1 for a unit that left the field.
  unit: number;
  // start is where the unit stands until it travels.
  start: LngLat;
  // end is where the unit stands once it has traveled.
  end: LngLat;
  // travel is the clock window of the move from start to end, or null when it stays.
  travel: [number, number] | null;
  // eased is true for a glide with ease in and out, false for a ride with an arrowhead.
  eased: boolean;
  // trail is true when the move leaves a dashed trail behind it.
  trail: boolean;
  // fadeIn is the clock window over which a new unit appears, or null.
  fadeIn: [number, number] | null;
  // fadeOut is the clock window over which a unit that left the field disappears, or null.
  fadeOut: [number, number] | null;
  // stampAt is when the unit's status stamp lands, -Infinity when it was already shown.
  stampAt: number;
}

// ArrowTrack is one arrow's growth through a phase.
export interface ArrowTrack {
  // beat is the index of the beat the arrow belongs to.
  beat: number;
  // grow is the clock window over which the arrow grows from tail to tip.
  grow: [number, number];
  // flash is true when the tip flashes on arrival.
  flash: boolean;
}

// Beat is a group of arrows of one side that grow together.
export interface Beat {
  // side is the faction that moves in the beat.
  side: string;
  // arrows are the indexes of the beat's arrows.
  arrows: number[];
  // window is the clock window from the first arrow's start to the last arrow's end.
  window: [number, number];
}

// FitStep names how far the fit rule went to place the beats inside the budget.
export type FitStep = 'full' | 'shortened' | 'merged' | 'over';

// Timeline is the whole choreography of one phase.
export interface Timeline {
  // entry is the camera move on the phase clock. The clock starts at minus entry.
  entry: number;
  // dwell is the phase dwell on the phase clock.
  dwell: number;
  // units are the tracks of the phase's units in order, then of units that left.
  units: UnitTrack[];
  // arrows are the tracks of the phase's arrows in order.
  arrows: ArrowTrack[];
  // beats are the beats in the order they play.
  beats: Beat[];
  // fit names how far the fit rule went.
  fit: FitStep;
  // settleAt is the clock time after which nothing changes.
  settleAt: number;
}

// DrawnUnit is one unit as drawn at a moment.
export interface DrawnUnit {
  // track is the index of the unit's track in the timeline.
  track: number;
  // position is where the unit is drawn.
  position: LngLat;
  // alpha is the unit's opacity multiplier, 0 to 1.
  alpha: number;
  // stamped is true when the status stamp shows.
  stamped: boolean;
  // trailFrom is where a dashed trail starts, or null.
  trailFrom: LngLat | null;
}

// DrawnArrow is one arrow as drawn at a moment.
export interface DrawnArrow {
  // arrow is the arrow's index in the phase.
  arrow: number;
  // progress is how far the arrow has grown, 0 to 1.
  progress: number;
  // dim is the opacity multiplier, 1 while its beat plays and BEAT_DIM after.
  dim: number;
  // flash is the progress of the tip flash, 0 to 1, or -1 when there is none.
  flash: number;
}

// DrawnState is what the Map view draws at one moment of a phase.
export interface DrawnState {
  // units are the units on the field.
  units: DrawnUnit[];
  // arrows are the arrows that have started to grow.
  arrows: DrawnArrow[];
}

// RIDE_TIE is how near an arrow's line a unit must stand to ride it, as a share of the
// diagonal of the phase's box.
export const RIDE_TIE = 0.1;

// RIDE_REACH is how far along an arrow a unit may stand and still be taken to its tip.
export const RIDE_REACH = 0.6;

// OPEN_START is when the opening move begins.
export const OPEN_START = 200;

// OPEN_END is when the opening move ends.
export const OPEN_END = 1100;

// FADE_IN_MS is how long a new unit takes to appear.
export const FADE_IN_MS = 500;

// FADE_OUT_MS is how long a unit that left takes to disappear when the camera holds.
export const FADE_OUT_MS = 500;

// RIDER_FADE_MS is how long a new unit carried by an arrow takes to appear at the tail.
export const RIDER_FADE_MS = 400;

// BEAT_GAP is the pause between two beats.
export const BEAT_GAP = 350;

// BEAT_MIN is the shortest a beat may be shortened to.
export const BEAT_MIN = 1200;

// BEAT_MAX_ARROWS is the most arrows a beat holds before the fit rule merges by side.
export const BEAT_MAX_ARROWS = 3;

// END_HOLD is the still time kept at the end of every phase.
export const END_HOLD = 1000;

// BEAT_DIM is the opacity an arrow keeps once its beat has ended.
export const BEAT_DIM = 0.35;

// FLASH_MS is how long the tip flash lasts.
export const FLASH_MS = 1500;

// STAMP_LONE_MS is when the status stamp lands for a unit no arrow carries.
export const STAMP_LONE_MS = 500;

// FLASH_KINDS are the movement kinds whose tip flashes on arrival.
export const FLASH_KINDS: ReadonlySet<string> = new Set([
  'charge',
  'cavalry-charge',
  'breakout',
  'air-strike',
  'airdrop',
  'amphibious',
]);

const SAME_EPS = 1e-12;

// phaseDwellMs returns how long a phase holds the screen at speed 1. Curator-set
// durations win. The fallback has swung both ways: 5500 and 3200 read as glacial solo,
// 3000 and 2000 read as unfollowable inside a war cinematic. Schematics have only three
// phases, so their taller floor still finishes a battle in about sixteen seconds.
export function phaseDwellMs(durationMs: number | undefined, schematic: boolean): number {
  return durationMs ?? (schematic ? 5400 : 4200);
}

// arrowDuration returns how long an arrow of a kind takes to grow at full length.
// Charges punch fastest, retreats drift, and moves that cover distance run longest.
export function arrowDuration(kind: string | undefined): number {
  if (kind === 'charge' || kind === 'cavalry-charge') return 2100;
  if (kind === 'flank' || kind === 'envelopment' || kind === 'pincer') return 2600;
  if (kind === 'amphibious' || kind === 'airdrop' || kind === 'air-strike') return 3600;
  if (kind === 'rout' || kind === 'retreat' || kind === 'withdrawal') return 3400;
  if (kind === 'siege' || kind === 'breakout') return 3100;
  return 3000;
}

// samePoint reports whether two spots are the same to within rounding.
function samePoint(a: LngLat, b: LngLat): boolean {
  return Math.abs(a[0] - b[0]) <= SAME_EPS && Math.abs(a[1] - b[1]) <= SAME_EPS;
}

// rideRule assigns each arrow the same-side unit nearest its line, one unit an arrow and
// one arrow a unit, in data order. A unit within the tie distance of the line rides it.
// When the unit stands on the first part of the arrow it ends the phase at the tip,
// otherwise on its listed spot. Distances are measured in Web Mercator.
export function rideRule(units: BeatUnit[], arrows: BeatArrow[]): Ride {
  const end = units.map((u) => u.listed);
  const carrier = units.map(() => -1);
  const rider = arrows.map(() => -1);
  const um = units.map((u) => [mercX(u.listed[0]), mercY(u.listed[1])] as [number, number]);
  const am = arrows.map((a) => [mercX(a.from[0]), mercY(a.from[1]), mercX(a.to[0]), mercY(a.to[1])]);
  const every: Array<[number, number]> = [...um];
  for (const a of am) every.push([a[0], a[1]], [a[2], a[3]]);
  if (every.length < 2 || arrows.length === 0) return { end, carrier, rider };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of every) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const tie = RIDE_TIE * (Math.hypot(maxX - minX, maxY - minY) || 1e-9);
  arrows.forEach((arrow, k) => {
    const [ax, ay, bx, by] = am[k];
    const vx = bx - ax;
    const vy = by - ay;
    const vv = vx * vx + vy * vy;
    if (vv < 1e-18) return;
    let best = -1;
    let bestDist = Infinity;
    let bestT = 0;
    units.forEach((u, i) => {
      if (u.side !== arrow.side || carrier[i] !== -1) return;
      const [qx, qy] = um[i];
      const t = Math.max(0, Math.min(1, ((qx - ax) * vx + (qy - ay) * vy) / vv));
      const dist = Math.hypot(qx - (ax + t * vx), qy - (ay + t * vy));
      if (dist <= tie && dist < bestDist) {
        best = i;
        bestDist = dist;
        bestT = t;
      }
    });
    if (best < 0) return;
    carrier[best] = k;
    rider[k] = best;
    if (bestT <= RIDE_REACH) end[best] = arrow.to;
  });
  return { end, carrier, rider };
}

// groupBeats puts neighboring arrows of one side into beats of at most BEAT_MAX_ARROWS.
function groupBeats(arrows: BeatArrow[]): number[][] {
  const out: number[][] = [];
  arrows.forEach((a, k) => {
    const last = out[out.length - 1];
    if (last && last.length < BEAT_MAX_ARROWS && arrows[last[0]].side === a.side) last.push(k);
    else out.push([k]);
  });
  return out;
}

// mergeBySide puts every arrow of a side into one beat, sides in the order they first
// move in the data.
function mergeBySide(arrows: BeatArrow[]): number[][] {
  const bySide = new Map<string, number[]>();
  arrows.forEach((a, k) => {
    const list = bySide.get(a.side);
    if (list) list.push(k);
    else bySide.set(a.side, [k]);
  });
  return [...bySide.values()];
}

// beatsNeed returns the clock time the beats take from the lead to the last arrow's end
// when every arrow is scaled by k and no beat is shorter than BEAT_MIN.
function beatsNeed(groups: number[][], full: number[], k: number): number {
  let total = 0;
  for (const g of groups) total += Math.max(BEAT_MIN, Math.max(...g.map((i) => full[i])) * k);
  return total + BEAT_GAP * Math.max(0, groups.length - 1);
}

// fitScale returns the largest scale up to 1 that fits the beats into room, or -1 when
// even the shortest beats do not fit.
function fitScale(groups: number[][], full: number[], room: number): number {
  if (beatsNeed(groups, full, 1) <= room) return 1;
  if (beatsNeed(groups, full, 0) > room) return -1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (beatsNeed(groups, full, mid) <= room) lo = mid;
    else hi = mid;
  }
  return lo;
}

// phaseTimeline returns the choreography of one phase: each unit's start and end spot
// and travel window, each arrow's beat and growth window, the dimming, the stamps, and
// the flashes.
export function phaseTimeline(input: TimelineInput): Timeline {
  const { units, arrows, ride, drawnEnd, prior, firstPhase, dwellMs, speed } = input;
  const entry = input.entryMs * Math.max(0.1, speed);
  const room = dwellMs - entry - END_HOLD;

  // An opening move is needed when a unit that carries over from the phase before is
  // listed somewhere new and no arrow takes it from there.
  const opening = units.some((u, i) => {
    const p = prior.get(u.gid);
    return p !== undefined && ride.carrier[i] < 0 && !samePoint(p.end, ride.end[i]);
  });
  const lead = opening ? OPEN_END : 0;

  const full = arrows.map((a) => arrowDuration(a.kind));
  let groups = groupBeats(arrows);
  let fit: FitStep = 'full';
  let k = fitScale(groups, full, room - lead);
  if (k < 1) fit = 'shortened';
  if (k < 0) {
    const merged = mergeBySide(arrows);
    fit = 'merged';
    k = fitScale(merged, full, room - lead);
    groups = merged;
    if (k < 0) {
      fit = 'over';
      k = 0;
    }
  }

  const arrowTracks: ArrowTrack[] = arrows.map(() => ({ beat: -1, grow: [0, 0], flash: false }));
  const beats: Beat[] = [];
  let cursor = lead;
  groups.forEach((g, b) => {
    let longest = 0;
    for (const i of g) {
      const dur = Math.max(Math.min(full[i], BEAT_MIN), full[i] * k);
      arrowTracks[i] = { beat: b, grow: [cursor, cursor + dur], flash: FLASH_KINDS.has(arrows[i].kind ?? '') };
      longest = Math.max(longest, dur);
    }
    const len = Math.max(BEAT_MIN, longest);
    beats.push({ side: arrows[g[0]].side, arrows: g, window: [cursor, cursor + len] });
    cursor += len + BEAT_GAP;
  });

  const tracks: UnitTrack[] = units.map((u, i) => {
    const p = prior.get(u.gid);
    const k2 = ride.carrier[i];
    const end = drawnEnd[i];
    const changed = !p || p.status !== u.status;
    if (k2 >= 0) {
      const arrow = arrowTracks[k2];
      const start = p ? p.drawn : arrows[k2].from;
      const moves = !samePoint(start, end);
      return {
        gid: u.gid,
        unit: i,
        start,
        end,
        travel: moves ? arrow.grow : null,
        eased: false,
        trail: false,
        fadeIn: p || firstPhase ? null : [arrow.grow[0], arrow.grow[0] + RIDER_FADE_MS],
        fadeOut: null,
        stampAt: changed ? beats[arrow.beat].window[1] : -Infinity,
      };
    }
    if (!p) {
      return {
        gid: u.gid,
        unit: i,
        start: end,
        end,
        travel: null,
        eased: true,
        trail: false,
        fadeIn: firstPhase ? null : [0, FADE_IN_MS],
        fadeOut: null,
        stampAt: STAMP_LONE_MS,
      };
    }
    const moves = !samePoint(p.drawn, end);
    return {
      gid: u.gid,
      unit: i,
      start: p.drawn,
      end,
      travel: moves ? [OPEN_START, OPEN_END] : null,
      eased: true,
      trail: moves && !samePoint(p.end, ride.end[i]),
      fadeIn: null,
      fadeOut: null,
      stampAt: changed ? STAMP_LONE_MS : -Infinity,
    };
  });

  // Units that left the field fade out while the camera moves, or in the first half
  // second when it holds.
  const present = new Set(units.map((u) => u.gid));
  const fadeOut: [number, number] = entry > 0 ? [-entry, 0] : [0, FADE_OUT_MS];
  for (const [gid, p] of prior) {
    if (present.has(gid)) continue;
    tracks.push({
      gid,
      unit: -1,
      start: p.drawn,
      end: p.drawn,
      travel: null,
      eased: true,
      trail: false,
      fadeIn: null,
      fadeOut,
      stampAt: -Infinity,
    });
  }

  let settleAt = 0;
  for (const t of tracks) {
    if (t.travel) settleAt = Math.max(settleAt, t.travel[1]);
    if (t.fadeIn) settleAt = Math.max(settleAt, t.fadeIn[1]);
    if (t.fadeOut) settleAt = Math.max(settleAt, t.fadeOut[1]);
    if (Number.isFinite(t.stampAt)) settleAt = Math.max(settleAt, t.stampAt);
  }
  for (const b of beats) settleAt = Math.max(settleAt, b.window[1]);
  for (const a of arrowTracks) if (a.flash) settleAt = Math.max(settleAt, a.grow[1] + FLASH_MS);

  return { entry, dwell: dwellMs, units: tracks, arrows: arrowTracks, beats, fit, settleAt };
}

// easeInOutCubic is the easing of a glide.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// windowShare returns how far t is through a window, 0 before it and 1 after it.
function windowShare(w: [number, number], t: number): number {
  if (t <= w[0]) return 0;
  if (t >= w[1]) return 1;
  return (t - w[0]) / Math.max(1e-9, w[1] - w[0]);
}

// unitPosition returns where a unit's track puts it at clock time t.
export function unitPosition(track: UnitTrack, t: number): LngLat {
  if (!track.travel) return track.end;
  const raw = windowShare(track.travel, t);
  if (raw <= 0) return track.start;
  if (raw >= 1) return track.end;
  const s = track.eased ? easeInOutCubic(raw) : raw;
  return [
    track.start[0] + (track.end[0] - track.start[0]) * s,
    track.start[1] + (track.end[1] - track.start[1]) * s,
  ];
}

// stateAt returns what the Map view draws at clock time t. Past the end of the phase it
// is the end state, which is also what reduced motion and the ended replay draw.
export function stateAt(tl: Timeline, t: number): DrawnState {
  const units: DrawnUnit[] = [];
  tl.units.forEach((track, i) => {
    let alpha = 1;
    if (track.fadeIn) alpha = Math.min(alpha, windowShare(track.fadeIn, t));
    if (track.fadeOut) alpha = Math.min(alpha, 1 - windowShare(track.fadeOut, t));
    if (alpha <= 0) return;
    const trailFrom = track.trail && track.travel && t > track.travel[0] ? track.start : null;
    units.push({ track: i, position: unitPosition(track, t), alpha, stamped: t >= track.stampAt, trailFrom });
  });
  const arrows: DrawnArrow[] = [];
  tl.arrows.forEach((a, i) => {
    if (t < a.grow[0] || a.beat < 0) return;
    const since = t - a.grow[1];
    arrows.push({
      arrow: i,
      progress: windowShare(a.grow, t),
      dim: t >= tl.beats[a.beat].window[1] ? BEAT_DIM : 1,
      flash: a.flash && since >= 0 && since < FLASH_MS ? since / FLASH_MS : -1,
    });
  });
  return { units, arrows };
}

// ARROW_LABEL_TAIL_MS is how long an arrow's label stays after its beat ends.
export const ARROW_LABEL_TAIL_MS = 1500;

// LabelRole says why a unit gets a label in a phase. The order is the order labels claim
// room: units that travel, then new ones, then status changes, then the first phase's.
export type LabelRole = 'travel' | 'new' | 'status' | 'first';

// LABEL_RANK orders the roles for room on screen, lowest first.
export const LABEL_RANK: Record<LabelRole, number> = { travel: 0, new: 1, status: 2, first: 3 };

// labelRoles returns each track's label role, or null for a unit that gets no label: a
// unit that left the field, or one that stands unchanged after the first phase. A glide
// with no trail only makes room for a neighbor and does not count as travel.
export function labelRoles(tl: Timeline, firstPhase: boolean): Array<LabelRole | null> {
  return tl.units.map((t) => {
    if (t.unit < 0) return null;
    if (t.travel && (!t.eased || t.trail)) return 'travel';
    if (firstPhase) return 'first';
    if (t.fadeIn) return 'new';
    if (Number.isFinite(t.stampAt)) return 'status';
    return null;
  });
}

// arrowLabelShown reports whether an arrow's label shows at clock time t: from the start
// of its beat until ARROW_LABEL_TAIL_MS after the beat ends.
export function arrowLabelShown(tl: Timeline, arrow: number, t: number): boolean {
  const a = tl.arrows[arrow];
  if (!a || a.beat < 0) return false;
  const w = tl.beats[a.beat].window;
  return t >= w[0] && t <= w[1] + ARROW_LABEL_TAIL_MS;
}
