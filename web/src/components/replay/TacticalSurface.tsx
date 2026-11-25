// TacticalSurface — phase-replay renderer on top of MapLibre GL (graded
// satellite imagery + 3D terrain mesh) and deck.gl via MapboxOverlay
// (units, movements, territory). Same Replay/Phase schema as the legacy
// GlobeReplay; richer rendering.
//
// Render loop contract: React renders on phase change only. All
// per-frame animation (arrow growth, impact pulses, unit glide) runs
// through a single RAF that mutates refs and pushes deck.gl layers
// with overlay.setProps directly. HTML labels are repositioned by
// direct DOM writes on MapLibre move events. Nothing per-frame touches
// React state.
//
// No tokens. No signups. All sources CORS-open.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { LayersList } from '@deck.gl/core';
import {
  IconLayer,
  LineLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from '@deck.gl/layers';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Battle } from '../../types/battle';
import type { Replay, Phase, Unit, Movement, ControlRegion } from '../../types/replay';
import { factionColorFor } from '../../types/replay';
import {
  getUnitIconAtlas,
  getStatusOverlayAtlas,
  iconNameFor,
  hasStatusOverlay,
} from './unit-icons';
import { loadWorldCountries } from '../../data/world-countries';
import { COUNTRY_NAME_ALIASES } from '../../lib/globe/aliases';
import { largestPolygonCentroid } from '../../lib/globe/centroid';
import { OWNER_LABELS } from '../../data/territory-snapshots';
import { flagForFaction } from '../../data/faction-flags';
import { themeForEra } from '../../theme/era';
import { buildAtlasArrow, alphaForKind } from './atlas-arrows';
import {
  STAGE_MOVE_MS,
  fallbackFrame,
  frameForBox,
  holdFrame,
  phaseBox,
  resolvePoint,
  spreadPoints,
  symbolSize,
} from './stage';
import type { LngLat, StageFrame } from './stage';
import { LABEL_RANK, arrowLabelShown, labelRoles, phaseDwellMs, phaseTimeline, rideRule, stateAt } from './beats';
import { narratedDwellMs, spokenMs } from '../../audio/pacing';
import type { BeatArrow, BeatUnit, DrawnState, LabelRole, PriorSpot, Ride, Timeline } from './beats';
import type { Feature, Geometry } from 'geojson';

interface TacticalSurfaceProps {
  battle: Battle;
  replay: Replay;
  phase: Phase;
  phaseIdx: number;
  playing?: boolean;
  speed?: number;
  ended?: boolean;
  // narrated is true while the narrator speaks the replay. A phase then lasts as long as its
  // narration and spreads its moves through it.
  narrated?: boolean;
  prefersReducedMotion?: boolean;
  warCountryColors?: Record<string, string>;
  warFactionAnchors?: Array<{ faction: string; anchor: string }>;
  warSnapshotYear?: number;
}

// hexToRgb converts a CSS hex string to a deck.gl [r, g, b, a] tuple.
function hexToRgb(hex: string, alpha = 255): [number, number, number, number] {
  const m = hex.replace('#', '');
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [
    parseInt(n.slice(0, 2), 16) || 0,
    parseInt(n.slice(2, 4), 16) || 0,
    parseInt(n.slice(4, 6), 16) || 0,
    alpha,
  ];
}

// statusOpacity scales a unit's icon alpha by its current state. Destroyed
// units fade out, broken ones dim, healthy ones render at full strength.
function statusOpacity(status: string | undefined): number {
  if (status === 'destroyed') return 110;
  if (status === 'broken' || status === 'routed') return 170;
  if (status === 'leaving' || status === 'thinning') return 200;
  return 240;
}

// kmBetween is an equirectangular distance approximation, plenty for
// scaling camera flight durations between battlefields.
function kmBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111.32;
  const dLng = (lng2 - lng1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLng);
}

// scaleAlpha multiplies the alpha channel of a deck.gl color tuple.
function scaleAlpha(
  c: [number, number, number, number],
  k: number,
): [number, number, number, number] {
  return [c[0], c[1], c[2], Math.round(c[3] * Math.max(0, Math.min(1, k)))];
}

// Rgba is a deck.gl color tuple.
type Rgba = [number, number, number, number];

// ResolvedUnit is one unit of a phase with its geography and look resolved.
interface ResolvedUnit {
  // index is the unit's position in the phase's unit list.
  index: number;
  // gid is the unit's identity across phases.
  gid: string;
  // position is the spot the phase lists for the unit.
  position: LngLat;
  // side is the faction the unit fights for.
  side: string;
  // color is the faction color with the status opacity.
  color: Rgba;
  // shadowColor is the color of the ground shadow under the symbol.
  shadowColor: Rgba;
  // iconName is the symbol drawn for the unit type.
  iconName: string;
  // size is the symbol size in pixels.
  size: number;
  // status is the unit's state in the phase, e.g. broken or routed.
  status: string | undefined;
  // label is the unit's name as authored.
  label: string;
  // strength is the unit's strength, 3 when unset.
  strength: number;
}

// ResolvedTrip is one movement of a phase with its ends and look resolved.
interface ResolvedTrip {
  // index is the movement's position in the phase's movement list.
  index: number;
  // kind is the movement kind, e.g. charge or withdrawal.
  kind: string | undefined;
  // color is the faction color.
  color: Rgba;
  // fillAlpha is the arrow fill opacity for the kind.
  fillAlpha: number;
  // label is the movement's name as authored.
  label: string;
  // midpoint is halfway between tail and tip, where the label anchors.
  midpoint: LngLat;
  // from is the arrow's tail.
  from: LngLat;
  // to is the arrow's tip.
  to: LngLat;
}

// ResolvedPhase is one phase with its units and movements resolved and the ride rule
// applied.
interface ResolvedPhase {
  // trips are the movements that resolved, in data order.
  trips: ResolvedTrip[];
  // unitPoints are the units that resolved, in data order.
  unitPoints: ResolvedUnit[];
  // beatUnits are the units as the timeline reads them, in the same order.
  beatUnits: BeatUnit[];
  // beatArrows are the trips as the timeline reads them, in the same order.
  beatArrows: BeatArrow[];
  // ride is the ride rule over the units and trips.
  ride: Ride;
}

// PhaseGeo is what resolving a phase needs beyond the phase itself.
interface PhaseGeo {
  // lat is the battle's latitude, the center of a field replay.
  lat: number;
  // lng is the battle's longitude, the center of a field replay.
  lng: number;
  // extentLatDeg is the latitude span a field replay is laid over.
  extentLatDeg: number;
  // extentLngDeg is the longitude span a field replay is laid over.
  extentLngDeg: number;
}

// resolvePhase resolves a phase's units and movements to map coordinates, gives every
// unit its identity across phases, and applies the ride rule.
function resolvePhase(phase: Phase, geo: PhaseGeo, replay: Replay): ResolvedPhase {
  const movements: Movement[] = phase.movements ?? [];
  const units: Unit[] = phase.units ?? [];

  const trips: ResolvedTrip[] = [];
  movements.forEach((m, i) => {
    const from = resolvePoint(m.fromX, m.fromY, m.fromLat, m.fromLng, geo.lat, geo.lng, geo.extentLatDeg, geo.extentLngDeg);
    const to = resolvePoint(m.toX, m.toY, m.toLat, m.toLng, geo.lat, geo.lng, geo.extentLatDeg, geo.extentLngDeg);
    if (!from || !to) return;
    trips.push({
      index: i,
      kind: m.kind,
      color: hexToRgb(factionColorFor(m.faction, replay), 255),
      fillAlpha: alphaForKind(m.kind),
      label: m.label || '',
      midpoint: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
      from,
      to,
    });
  });

  const occurrence = new Map<string, number>();
  const unitPoints: ResolvedUnit[] = [];
  units.forEach((u, i) => {
    // Stable identity across phases: curated id when present, else label plus faction
    // with an occurrence counter so twin unnamed formations stay distinct. Counted
    // before the position test, as the check scripts do.
    const base = u.id ?? `${u.label || u.unitType || 'unit'}|${u.faction}`;
    const n = occurrence.get(base) ?? 0;
    occurrence.set(base, n + 1);
    const p = resolvePoint(u.x, u.y, u.lat, u.lng, geo.lat, geo.lng, geo.extentLatDeg, geo.extentLngDeg);
    if (!p) return;
    unitPoints.push({
      index: i,
      gid: `${base}|${n}`,
      position: p,
      side: u.faction,
      color: hexToRgb(factionColorFor(u.faction, replay), statusOpacity(u.status)),
      shadowColor: [10, 8, 6, 120],
      iconName: iconNameFor(u.unitType),
      // One symbol size, nudged by strength. Status shows through the stamp and the
      // fade, not the size.
      size: symbolSize(u.strength),
      status: u.status,
      label: u.label || '',
      strength: u.strength ?? 3,
    });
  });

  const beatUnits: BeatUnit[] = unitPoints.map((u) => ({ gid: u.gid, side: u.side, listed: u.position, status: u.status }));
  const beatArrows: BeatArrow[] = trips.map((t) => ({
    side: movements[t.index].faction,
    kind: t.kind,
    from: t.from,
    to: t.to,
  }));
  return { trips, unitPoints, beatUnits, beatArrows, ride: rideRule(beatUnits, beatArrows) };
}

// UnitAtlasLike matches the shape returned by the unit-icons bakers.
interface UnitAtlasLike {
  // canvas is the baked atlas, null before the browser can bake it.
  canvas: HTMLCanvasElement | null;
  // mapping places each icon in the atlas.
  mapping: Record<string, { x: number; y: number; width: number; height: number; anchorY?: number; mask?: boolean }>;
}

// TRAIL_DASH_PX is the length of one dash and one gap of a unit's trail, in pixels.
const TRAIL_DASH_PX = 7;

// buildUnitLayers renders the trails, shadows, icons, and status stamps of the units
// as the timeline draws them at one moment. look holds each track's unit, and dashes
// returns how many dashes fit between two spots on screen.
function buildUnitLayers(
  state: DrawnState,
  look: Array<ResolvedUnit | undefined>,
  phaseIdx: number,
  unitAtlas: UnitAtlasLike,
  statusAtlas: UnitAtlasLike,
  dashes: (a: LngLat, b: LngLat) => number,
): unknown[] {
  if (state.units.length === 0) return [];
  const live = state.units.flatMap((d) => {
    const u = look[d.track];
    if (!u) return [];
    return [{
      ...u,
      position: d.position,
      color: scaleAlpha(u.color, d.alpha),
      shadowColor: scaleAlpha(u.shadowColor, d.alpha),
      stamped: d.stamped,
      trailFrom: d.trailFrom,
    }];
  });
  type Live = (typeof live)[number];

  const result: unknown[] = [];
  const trail: Array<{ a: LngLat; b: LngLat; color: Rgba }> = [];
  for (const u of live) {
    if (!u.trailFrom) continue;
    const a = u.trailFrom;
    const b = u.position;
    const n = dashes(a, b);
    for (let i = 0; i < n; i++) {
      const s0 = i / n;
      const s1 = (i + 0.5) / n;
      trail.push({
        a: [a[0] + (b[0] - a[0]) * s0, a[1] + (b[1] - a[1]) * s0],
        b: [a[0] + (b[0] - a[0]) * s1, a[1] + (b[1] - a[1]) * s1],
        color: [u.color[0], u.color[1], u.color[2], Math.round(u.color[3] * 0.6)],
      });
    }
  }
  if (trail.length > 0) {
    result.push(new LineLayer({
      id: `unit-trails-${phaseIdx}`,
      data: trail,
      getSourcePosition: (d: { a: LngLat }) => d.a,
      getTargetPosition: (d: { b: LngLat }) => d.b,
      getColor: (d: { color: Rgba }) => d.color,
      getWidth: 1.5,
      widthUnits: 'pixels',
      parameters: { depthTest: false },
    }));
  }
  result.push(new ScatterplotLayer({
    id: `unit-shadows-${phaseIdx}`,
    data: live,
    getPosition: (d: Live) => d.position,
    getFillColor: (d: Live) => d.shadowColor,
    getRadius: (d: Live) => d.size * 3.2,
    radiusUnits: 'meters',
    stroked: false,
    radiusMinPixels: 5,
    radiusMaxPixels: 14,
    parameters: { depthTest: false },
  }));
  if (unitAtlas.canvas) {
    result.push(new IconLayer({
      id: `unit-icons-${phaseIdx}`,
      data: live,
      // deck.gl's iconAtlas typing intersects Texture into the canvas
      // branch; the runtime accepts a plain canvas.
      iconAtlas: unitAtlas.canvas as unknown as string,
      iconMapping: unitAtlas.mapping,
      getIcon: (d: Live) => d.iconName,
      getPosition: (d: Live) => d.position,
      getColor: (d: Live) => d.color,
      getSize: (d: Live) => d.size,
      sizeUnits: 'pixels',
      pickable: true,
      parameters: { depthTest: false },
    }));
  }
  if (statusAtlas.canvas) {
    const stamped = live.filter((u) => u.stamped && hasStatusOverlay(u.status as never));
    if (stamped.length > 0) {
      result.push(new IconLayer({
        id: `unit-status-${phaseIdx}`,
        data: stamped,
        iconAtlas: statusAtlas.canvas as unknown as string,
        iconMapping: statusAtlas.mapping,
        getIcon: (d: Live) => d.status as string,
        getPosition: (d: Live) => d.position,
        getColor: (d: Live) => scaleAlpha([255, 255, 255, 240], d.color[3] / 255),
        getSize: (d: Live) => d.size * 1.06,
        sizeUnits: 'pixels',
        parameters: { depthTest: false },
      }));
    }
  }
  return result;
}

// buildMotionLayers renders the arrows as the timeline draws them at one moment: each
// arrow grown to its progress and dimmed once its beat has ended, and a flash at the
// tip on arrival for the kinds that flash.
function buildMotionLayers(state: DrawnState, trips: ResolvedTrip[], phaseIdx: number): unknown[] {
  if (state.arrows.length === 0) return [];
  const result: unknown[] = [];

  const arrowsLive = state.arrows.map((d) => {
    const trip = trips[d.arrow];
    const tip: LngLat = [
      trip.from[0] + (trip.to[0] - trip.from[0]) * d.progress,
      trip.from[1] + (trip.to[1] - trip.from[1]) * d.progress,
    ];
    return { trip, dim: d.dim, polygon: buildAtlasArrow(trip.from, tip, trip.kind as never, 1) };
  });
  type LiveArrow = (typeof arrowsLive)[number];

  // Beevor/Ambrose treatment: heavy warm-black outline grounds the
  // silhouette; saturated faction fill reads as a single deliberate
  // brushstroke. The draw-on growth is the motion cue; no comet.
  result.push(new PolygonLayer({
    id: `atlas-arrows-outline-${phaseIdx}`,
    data: arrowsLive,
    getPolygon: (d: LiveArrow) => d.polygon,
    getFillColor: [12, 10, 8, 0],
    getLineColor: (d: LiveArrow) => [12, 10, 8, Math.round(250 * d.dim)] as Rgba,
    getLineWidth: 6,
    lineWidthUnits: 'pixels',
    stroked: true,
    filled: false,
    pickable: false,
    parameters: { depthTest: false },
  }));
  result.push(new PolygonLayer({
    id: `atlas-arrows-fill-${phaseIdx}`,
    data: arrowsLive,
    getPolygon: (d: LiveArrow) => d.polygon,
    getFillColor: (d: LiveArrow) =>
      [d.trip.color[0], d.trip.color[1], d.trip.color[2], Math.round(d.trip.fillAlpha * d.dim)] as Rgba,
    getLineColor: [0, 0, 0, 0],
    stroked: false,
    filled: true,
    pickable: false,
    parameters: { depthTest: false },
  }));

  // Tip flash on arrival, only for the kinds that strike: a bright disc that grows
  // and fades. No ring: the unit itself now arrives at the tip.
  const flashes = state.arrows
    .filter((d) => d.flash >= 0)
    .map((d) => {
      const trip = trips[d.arrow];
      const easeOut = 1 - Math.pow(1 - d.flash, 3);
      return {
        position: trip.to,
        color: [trip.color[0], trip.color[1], trip.color[2], Math.round(245 * (1 - easeOut))] as Rgba,
        radius: 250 + 4000 * easeOut,
      };
    });
  if (flashes.length > 0) {
    result.push(new ScatterplotLayer({
      id: `impacts-${phaseIdx}`,
      data: flashes,
      getPosition: (d: { position: LngLat }) => d.position,
      getFillColor: (d: { color: Rgba }) => d.color,
      getRadius: (d: { radius: number }) => d.radius,
      radiusUnits: 'meters',
      stroked: false,
      radiusMinPixels: 0,
      radiusMaxPixels: 50,
      parameters: { depthTest: false },
    }));
  }

  return result;
}

// PhaseTimeline is the timeline of the phase on screen and the unit drawn by each of
// its tracks.
interface PhaseTimeline {
  // battleId is the battle the timeline belongs to.
  battleId: string;
  // phaseIdx is the phase the timeline belongs to.
  phaseIdx: number;
  // tl is the timeline.
  tl: Timeline;
  // look holds the unit each track draws, in track order.
  look: Array<ResolvedUnit | undefined>;
  // entrySpeed is the playback speed the camera move was timed at. The clock runs at
  // it until the move ends, so a speed change mid-move cannot start units early.
  entrySpeed: number;
  // roles holds each track's label role, null for a unit that gets no label.
  roles: Array<LabelRole | null>;
}

// DrawnFrame is the state the frame loop last drew, which the labels follow.
interface DrawnFrame {
  // battleId is the battle the frame belongs to.
  battleId: string;
  // phaseIdx is the phase the frame belongs to.
  phaseIdx: number;
  // state is what was drawn.
  state: DrawnState;
  // t is the clock time drawn, Infinity for the end state.
  t: number;
}

// LABEL_OUTLINE is the dark outline around label text, as a text shadow.
const LABEL_OUTLINE =
  '0 0 2px rgba(10,8,6,0.95), 1px 1px 0 rgba(10,8,6,0.9), -1px -1px 0 rgba(10,8,6,0.9), 1px -1px 0 rgba(10,8,6,0.9), -1px 1px 0 rgba(10,8,6,0.9)';

// LABEL_GAP_PX is the gap between a symbol's lower edge and its label.
const LABEL_GAP_PX = 3;

// ARROW_LABEL_OFFSET_PX is how far an arrow's label sits off the arrow's line, so the
// unit riding the arrow never passes under it.
const ARROW_LABEL_OFFSET_PX = 34;

// ARROW_LABEL_STEPS are the extra distances off the line an arrow's label tries when
// the spot beside the line is taken, nearest first.
const ARROW_LABEL_STEPS = [0, 24, 52];

// ARROW_LABEL_ALONG are the shares of the arrow's length an arrow's label tries,
// midpoint first.
const ARROW_LABEL_ALONG = [0.5, 0.35, 0.65, 0.2, 0.8];

// Box is a screen rectangle in pixels.
interface Box {
  // x0 is the left edge.
  x0: number;
  // y0 is the top edge.
  y0: number;
  // x1 is the right edge.
  x1: number;
  // y1 is the bottom edge.
  y1: number;
}

// boxesMeet reports whether two boxes overlap.
function boxesMeet(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

// centeredBox returns the box of size w by h centered on x, y.
function centeredBox(x: number, y: number, w: number, h: number): Box {
  return { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
}

// priorFromUnits returns the spots units of a phase end on, by gid, for the next phase
// to start from.
function priorFromUnits(units: ResolvedUnit[], ends: LngLat[], drawn: LngLat[]): Map<string, PriorSpot> {
  return new Map(units.map((u, i) => [u.gid, { drawn: drawn[i], end: ends[i], status: u.status }] as [string, PriorSpot]));
}

// Cartographic MapLibre style. No keys, no signups, CORS-open, and every
// source is under open terms that allow public use with attribution.
// A label-free dark plate over a warm matte, with hillshade computed from
// open elevation data so ridges and river valleys read as terrain rather
// than flat paper. No streaming satellite imagery and no 3D terrain mesh:
// the old satellite stack streamed slowly and read as a tech demo. This is
// the documentary-atlas plate, a map rather than Google Earth.
//
// The plate draws only water, rivers, and woodland from OpenStreetMap.
// Modern roads, towns, and borders are left out on purpose, since they
// would sit anachronistically under a battle fought centuries earlier.
//
// Earlier bases were Carto dark_all, until CARTO began burning "API KEY
// REQUIRED" into unauthenticated tiles, and then Esri's keyless canvas,
// whose terms for keyless public use were unclear. Any keyless tile source
// can change under us, so if the plate ever looks wrong, fetch a single
// tile and look at it before trusting the network tab.
const PLATE_LAND = '#1a1814';
const PLATE_WATER = '#0d1113';
const PLATE_WOOD = '#1e1d17';

const OPEN_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    // OpenFreeMap vector tiles in the OpenMapTiles schema: keyless, free,
    // and without usage limits.
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution: 'OpenFreeMap, OpenMapTiles, OpenStreetMap contributors',
    },
    // Mapzen terrain tiles on the AWS Open Data registry, terrarium encoded.
    // MapLibre shades them itself, which is what makes a battlefield look
    // like ground: the ridge a flank anchors on and the valley a cavalry
    // charge runs down are otherwise invisible.
    terrain: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      minzoom: 0,
      maxzoom: 15,
      attribution: 'Mapzen terrain tiles: USGS, NASA SRTM, NOAA ETOPO1, GMTED2010, and others',
    },
  },
  layers: [
    // Warm matte land under everything. Reads as film base, not blue
    // slate, and seals any gap while tiles arrive.
    {
      id: 'matte',
      type: 'background',
      paint: { 'background-color': PLATE_LAND },
    },
    // Woodland and wetland, barely lifted off the land so cover a battle
    // turned on is visible without competing with the faction palette.
    {
      id: 'woodland',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'wetland']]],
      paint: { 'fill-color': PLATE_WOOD, 'fill-opacity': 0.9 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': PLATE_WATER },
    },
    {
      id: 'rivers',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]],
      paint: {
        'line-color': PLATE_WATER,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 10, 1.6, 14, 4],
      },
    },
    // Relief. Held subtle: enough to model the ground, not enough to grey
    // out the plate or steal contrast from the units.
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrain',
      paint: {
        'hillshade-exaggeration': 0.45,
        'hillshade-illumination-direction': 315,
        'hillshade-shadow-color': 'rgba(0, 0, 0, 0.75)',
        'hillshade-highlight-color': 'rgba(255, 236, 210, 0.07)',
        'hillshade-accent-color': 'rgba(0, 0, 0, 0.35)',
      },
    },
  ],
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
};

export default function TacticalSurface({
  battle,
  replay,
  phase,
  phaseIdx,
  playing = true,
  speed = 1,
  ended = false,
  narrated = false,
  prefersReducedMotion = false,
  warCountryColors,
  warFactionAnchors,
  warSnapshotYear,
}: TacticalSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  // mapReady becomes true after the first style.load so the per-phase
  // overlay effect can wait on it. Without this the initial frame paints
  // with no layers attached because MapboxOverlay's addControl resolves
  // before MapLibre's style is parsed.
  const [mapReady, setMapReady] = useState(false);
  // mapIdle fires once MapLibre's tile loading + style parse are done
  // and the first real frame has painted. Drives the cinematic loading
  // slate's fade so the user never stares at a dark void after clicking
  // "Watch the replay" — they see a battle title card immediately, then
  // it fades out as the map comes in.
  const [mapIdle, setMapIdle] = useState(false);
  // countries is the Natural Earth feature array used for war-cinematic
  // country shading. Loaded once via the shared promise cache.
  const [countries, setCountries] = useState<Feature<Geometry>[]>([]);
  // terrainReady flips when MapLibre reaches idle (tiles fetched and
  // painted). Until then a small streaming indicator shows so a half
  // dark frame reads as loading, not a freeze. Reset per battle via the
  // render-adjust pair below.
  const [terrainReady, setTerrainReady] = useState(false);
  const [tileBattleId, setTileBattleId] = useState(battle.id);
  if (tileBattleId !== battle.id) {
    setTileBattleId(battle.id);
    setTerrainReady(false);
  }
  // Failsafe: a single stuck tile request can hold MapLibre's idle
  // event hostage; the indicator must never outlive its welcome.
  useEffect(() => {
    if (terrainReady) return;
    const t = setTimeout(() => setTerrainReady(true), 12000);
    return () => clearTimeout(t);
  }, [tileBattleId, terrainReady]);
  // zoomBucket is the live MapLibre zoom quantized to the nearest
  // integer, updated only on zoomend. Territory alpha tiers and label
  // dedup cells read this instead of a continuous zoom value so a
  // camera flight does not rebuild the heavy layers 60 times a second
  // mid-flight (the alpha tiers still land correctly once the move
  // settles).
  const [zoomBucket, setZoomBucket] = useState<number>(7);
  // clockRef is the phase clock in ms for the phase it belongs to. It starts at minus
  // the camera entry so the action begins once the camera is still, and it survives a
  // pause, a resume, or a speed change inside the phase. Mutated by the RAF loop; never
  // React state.
  const clockRef = useRef<{ battleId: string; phaseIdx: number; t: number }>({ battleId: '', phaseIdx: -1, t: 0 });
  // staticLayersRef / animatedLayersRef hold the two halves of the
  // deck.gl layer stack. pushFrame() concatenates them into a single
  // setProps call, from React effects (static) and the RAF (animated).
  const staticLayersRef = useRef<unknown[]>([]);
  const animatedLayersRef = useRef<unknown[]>([]);
  // timelineRef holds the current phase's timeline. The camera effect builds it once it
  // knows the frame and the camera entry; the frame loop draws from it.
  const timelineRef = useRef<PhaseTimeline | null>(null);
  // endsRef keeps, per phase of the current battle, where each unit ended that phase
  // on screen and the container size it was drawn at. A phase starts from the phase
  // before the one shown, never from whatever was last on screen.
  const endsRef = useRef<{ battleId: string; byPhase: Map<number, { size: string; spots: Map<string, PriorSpot> }> }>({
    battleId: '',
    byPhase: new Map(),
  });
  // speedRef is the playback speed, read when a phase starts so a speed change inside
  // a phase never rebuilds its timeline.
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  // narratedRef is the narrator switch, read when a phase starts so a change inside a phase
  // never rebuilds its timeline.
  const narratedRef = useRef(narrated);
  useEffect(() => {
    narratedRef.current = narrated;
  }, [narrated]);
  // labelWrapRef is the HTML label overlay container. Labels are positioned by
  // direct DOM writes on every drawn frame and every map move.
  const labelWrapRef = useRef<HTMLDivElement | null>(null);
  // frameRef is the state the frame loop last drew, for the labels to follow.
  const frameRef = useRef<DrawnFrame | null>(null);
  // hoverGidRef is the unit under the pointer, which shows its label.
  const hoverGidRef = useRef<string | null>(null);
  // tapGidRef is the unit last tapped or clicked, which shows its label until a tap
  // lands elsewhere.
  const tapGidRef = useRef<string | null>(null);
  // userCameraLockRef flips when the viewer grabs the map; the dwell
  // drift stands down until the next phase reclaims the camera.
  const userCameraLockRef = useRef(false);
  // labelPositionRef holds the current label projection routine so the
  // map move listener (attached once at init) always calls the latest.
  const labelPositionRef = useRef<() => void>(() => {});
  // hopBattleIdRef detects battle-to-battle hops inside a war cinematic
  // (this component stays mounted across them). The hop's flight duration
  // becomes the timeline's camera entry, so the action never starts while
  // a long flight is still in the air.
  const hopBattleIdRef = useRef('');
  // camGenRef bumps on every phase-camera change. Each run captures its
  // generation so a settle/drift scheduled by a superseded phase is ignored,
  // and the prior flight/drift is stopped before a new one starts. Overlapping
  // MapLibre animations throw "already running" / "_onEaseFrame is not a
  // function" and can blank the map mid-replay.
  const camGenRef = useRef(0);
  // stageRef is the frame the camera last went to, with the battle and screen
  // size it was framed for, so the next phase can decide to hold still.
  const stageRef = useRef<{ battleId: string; width: number; height: number; frame: StageFrame } | null>(null);
  // reframeRef re-frames the current phase for a new container size. The
  // camera effect replaces it each phase; the resize observer calls it.
  const reframeRef = useRef<() => void>(() => {});
  // spreadRef holds where each unit of the current phase ends the phase after
  // the ride rule and the spread, keyed by gid. The camera effect fills it once
  // it knows the frame; the timeline and the label anchors read it.
  const spreadRef = useRef<Map<string, LngLat>>(new Map());
  // respreadRef spreads the symbols again for the view the viewer zoomed to.
  const respreadRef = useRef<() => void>(() => {});
  // redrawRef rebuilds the unit layers at the current clock, for a spread
  // that changed while the frame loop is parked.
  const redrawRef = useRef<() => void>(() => {});

  const extentLatDeg = replay.extentLatDeg ?? 3;
  const extentLngDeg = (replay.extentLngDeg ?? 3) * (replay.aspectRatio ?? 1.6);

  const cameraLat = phase.cameraLat ?? battle.lat ?? 49.34;
  const cameraLng = phase.cameraLng ?? battle.lng ?? -0.51;

  // Initialise the map once, north up and flat for the life of the replay.
  // Subsequent phase changes drive the camera and overlay setProps via refs.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const start = fallbackFrame(
      [cameraLng, cameraLat],
      extentLngDeg,
      extentLatDeg,
      containerRef.current.clientWidth || 1200,
      containerRef.current.clientHeight || 700,
    );
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OPEN_STYLE,
      center: start.center,
      zoom: start.zoom,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;

    // Hovering or tapping a symbol shows its label, whoever it belongs to.
    type Picked = { layer?: { id: string } | null; object?: { gid?: string } | null };
    const pickedGid = (info: Picked) =>
      info.layer?.id.startsWith('unit-icons-') && info.object?.gid ? info.object.gid : null;
    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      onHover: (info: Picked) => {
        const gid = pickedGid(info);
        map.getCanvas().style.cursor = gid ? 'pointer' : '';
        if (gid === hoverGidRef.current) return;
        hoverGidRef.current = gid;
        labelPositionRef.current();
      },
      onClick: (info: Picked) => {
        const gid = pickedGid(info);
        tapGidRef.current = gid && gid !== tapGidRef.current ? gid : null;
        labelPositionRef.current();
      },
    });
    overlayRef.current = overlay;
    map.addControl(overlay as unknown as maplibregl.IControl);

    map.on('style.load', () => {
      // No 3D terrain any more; the cartographic base is flat, so there is
      // nothing to stream after the style parses. Mark ready immediately so
      // the loading indicator never lingers.
      setMapReady(true);
      setZoomBucket(Math.round(map.getZoom()));
      setTerrainReady(true);
    });
    // Quantized zoom for the alpha-tier memos. Updates only when the
    // move settles AND the integer bucket actually changed, so camera
    // flights never thrash the heavy territory layers mid-flight.
    map.on('zoomend', () => {
      const bucket = Math.round(map.getZoom());
      setZoomBucket((prev) => (prev === bucket ? prev : bucket));
      // A zoom by the viewer changes the pixel gaps between symbols.
      if (userCameraLockRef.current) respreadRef.current();
    });
    // HTML labels track the camera by direct DOM writes; no React.
    map.on('move', () => labelPositionRef.current());
    // Tile/paint settlement signal for the streaming indicator.
    map.on('idle', () => setTerrainReady(true));
    // Viewer grabbing the map stops the camera until the next phase
    // reclaims it, and that phase never holds the viewer's framing.
    const onUserCamera = () => {
      userCameraLockRef.current = true;
      map.stop();
    };
    map.on('mousedown', onUserCamera);
    map.on('wheel', onUserCamera);
    map.on('touchstart', onUserCamera);
    map.on('error', (e) => {
      console.warn('[TacticalSurface] map error', e.error?.message || e);
    });
    // Fade the slate the moment the STYLE is parsed and ready — do not
    // wait for basemap tiles to download. Cold tiles can
    // take 1.5–3s from cold CDN; gating the slate on tile arrival was
    // the "insanely slow" cold-start complaint. Once the style is
    // ready, action layers (units, arrows, country shading) can paint
    // immediately while the basemap streams in behind them. 600ms hard
    // fallback so the slate never gets stuck.
    const onStyleData = () => {
      if (!map.isStyleLoaded()) return;
      setMapIdle(true);
      map.off('styledata', onStyleData);
    };
    map.on('styledata', onStyleData);
    const loadFallback = setTimeout(() => setMapIdle(true), 600);
    map.once('styledata', () => { if (map.isStyleLoaded()) clearTimeout(loadFallback); });
    // The frame belongs to the container size it was computed for. The
    // dossier chrome settling, a window resize, or a phone turning all
    // change that size, so the current phase is framed again.
    const resizeObserver = new ResizeObserver(() => reframeRef.current());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      overlayRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Map is intentionally created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-load Natural Earth country features ONLY after the slate
  // has faded. The shading is editorial context, not the focal layer
  // — making the user wait for a 200KB topojson before the action
  // appears is exactly the "insanely slow load" complaint. Cached at
  // module scope so the second battle is instant.
  useEffect(() => {
    if (!mapIdle) return;
    let cancelled = false;
    loadWorldCountries().then((feats) => {
      if (!cancelled) setCountries(feats);
    }).catch(() => {
      // ignore; territory layer just stays empty
    });
    return () => { cancelled = true; };
  }, [mapIdle]);

  // Build the per-phase derived data. Resolves geographic coordinates and
  // applies the ride rule once so every layer below reads from the same
  // source. The phase before is resolved too: the current phase starts
  // from where its units ended, and its units that left the field fade out.
  const geo = useMemo<PhaseGeo>(
    () => ({ lat: battle.lat, lng: battle.lng, extentLatDeg, extentLngDeg }),
    [battle.lat, battle.lng, extentLatDeg, extentLngDeg],
  );
  const phaseData = useMemo(() => resolvePhase(phase, geo, replay), [phase, geo, replay]);
  const prevPhase = phaseIdx > 0 ? replay.phases[phaseIdx - 1] : undefined;
  const prevData = useMemo(() => (prevPhase ? resolvePhase(prevPhase, geo, replay) : null), [prevPhase, geo, replay]);

  // Per-phase control regions, lifted into the deck.gl PolygonLayer
  // shape. Each ring is faction-colored; alpha scales with zoom so a
  // tactical push-in doesn't flood the frame with a flat color block.
  const controlPolygons = useMemo(() => {
    const out: Array<{
      polygon: Array<[number, number]>;
      fillColor: [number, number, number, number];
      lineColor: [number, number, number, number];
      label: string;
    }> = [];
    // Soften: too much fill turns push-in zooms into flat color blocks
    // and creates the hard banding the user flagged in Pointe du Hoc.
    const fillAlpha = zoomBucket > 9 ? 20 : zoomBucket > 6 ? 32 : 44;
    const lineAlpha = zoomBucket > 9 ? 110 : 140;
    (phase.controlRegions ?? []).forEach((r: ControlRegion) => {
      if (!r.ring || r.ring.length < 3) return;
      const color = factionColorFor(r.controller, replay) ?? '#94a3b8';
      const [rr, gg, bb] = hexToRgb(color, 255);
      out.push({
        polygon: r.ring.map(([lng, lat]) => [lng, lat] as [number, number]),
        fillColor: [rr, gg, bb, fillAlpha],
        lineColor: [rr, gg, bb, lineAlpha],
        label: r.label ?? '',
      });
    });
    return out;
  }, [phase.controlRegions, replay, zoomBucket]);

  // War-cinematic country shading. Maps each color-keyed country to its
  // GeoJSON feature; honors COUNTRY_NAME_ALIASES so historical spellings
  // resolve to the modern Natural Earth name. Alpha scales by zoom so
  // operational pullbacks read brilliantly without flooding tactical
  // zooms (the "territorial shading altitude trap" from past iterations).
  const countryPolygons = useMemo(() => {
    if (!warCountryColors || countries.length === 0) return [];
    const colorByName: Record<string, string> = {};
    for (const [name, hex] of Object.entries(warCountryColors)) {
      colorByName[name] = hex;
      const aliases = COUNTRY_NAME_ALIASES[name];
      if (aliases) for (const a of aliases) colorByName[a] = hex;
    }
    // Country shading: brilliant when pulled back, near-invisible when
    // pushed in tight. Otherwise an Atlantic Wall flat-color band blots
    // out the action layer the way the legacy globe did at low altitude.
    // Keep the fill a translucent WASH at every zoom (never the old opaque
    // 95 slab that buried the base map). Control reads through the colored
    // border more than the fill, atlas-style, so land/roads/labels stay
    // visible under the shading.
    const fillAlpha = zoomBucket > 10 ? 10 : zoomBucket > 8 ? 22 : zoomBucket > 6 ? 38 : 56;
    const lineAlpha = zoomBucket > 10 ? 60 : zoomBucket > 8 ? 110 : 150;
    const out: Array<{
      polygon: Array<Array<[number, number]>>;
      fillColor: [number, number, number, number];
      lineColor: [number, number, number, number];
    }> = [];
    for (const feat of countries) {
      const props = (feat.properties ?? {}) as { name?: string };
      const name = props.name;
      if (!name) continue;
      const hex = colorByName[name];
      if (!hex) continue;
      const [rr, gg, bb] = hexToRgb(hex, 255);
      const geom = feat.geometry;
      if (geom.type === 'Polygon') {
        out.push({
          polygon: geom.coordinates.map((ring) => ring.map(([lng, lat]) => [lng, lat] as [number, number])),
          fillColor: [rr, gg, bb, fillAlpha],
          lineColor: [rr, gg, bb, lineAlpha],
        });
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          out.push({
            polygon: poly.map((ring) => ring.map(([lng, lat]) => [lng, lat] as [number, number])),
            fillColor: [rr, gg, bb, fillAlpha],
            lineColor: [rr, gg, bb, lineAlpha],
          });
        }
      }
    }
    return out;
  }, [warCountryColors, countries, zoomBucket]);

  // Faction banners. Period-accurate flag + editorial caption per
  // controlling power (Nazi Germany, Soviet Union, Free France, etc.).
  // Mirrors what GlobeReplay does so the viewer can tell red Reich from
  // red USSR at a glance even when their territorial fills land in the
  // same hue family. Anchor centroid is resolved from the loaded Natural
  // Earth country features. Falls back gracefully when an anchor name
  // doesn't match the atlas: no banner for that faction, the shading
  // still tells the story.
  const factionBanners = useMemo(() => {
    if (!warFactionAnchors || warFactionAnchors.length === 0) return [];
    if (countries.length === 0) return [];
    const year = warSnapshotYear ?? battle.year ?? 2025;
    type Banner = {
      position: [number, number];
      flag: string | null;
      text: string;
      faction: string;
    };
    const out: Banner[] = [];
    for (const { faction, anchor } of warFactionAnchors) {
      const label = OWNER_LABELS[faction] || faction.replace(/-/g, ' ');
      const target = anchor.toLowerCase();
      const feat = countries.find((f) => {
        const n = (f.properties as Record<string, string>)?.name?.toLowerCase() || '';
        return n === target;
      });
      if (!feat) continue;
      const c = largestPolygonCentroid(feat);
      if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      out.push({
        position: [c[1], c[0]],
        flag: flagForFaction(faction, year),
        text: label.toUpperCase(),
        faction,
      });
    }
    return out;
  }, [warFactionAnchors, countries, warSnapshotYear, battle.year]);

  // Resolve the icon atlases once (lazy on first access, then memoised
  // inside the module). Browser-only; HMR keeps the same canvas.
  const unitAtlas = useMemo(() => getUnitIconAtlas(), []);
  const statusAtlas = useMemo(() => getStatusOverlayAtlas(), []);

  // staticLayers holds everything that does not animate within a
  // phase: territory shading, faction banners, control regions, region
  // labels. Rebuilds only when the phase changes or the zoom bucket
  // flips. Units and movements live in the RAF frame builder because
  // they glide and grow per frame.
  const staticLayers = useMemo(() => {
    const result: unknown[] = [];

    // 1. War-cinematic country shading. Big political layer underneath.
    //    Two-pass borders: a wide low-alpha "glow" stroke underneath
    //    plus a tight crisp 2px line on top. The glow lifts the
    //    political layer off the dark basemap so country shapes read
    //    as deliberate cartographic frames, not flat color blocks.
    if (countryPolygons.length > 0) {
      result.push(new PolygonLayer({
        id: `country-border-glow-${phaseIdx}`,
        data: countryPolygons,
        getPolygon: (d) => d.polygon[0],
        getFillColor: [0, 0, 0, 0],
        getLineColor: (d) => [d.lineColor[0], d.lineColor[1], d.lineColor[2], Math.round(d.lineColor[3] * 0.45)],
        getLineWidth: 6,
        lineWidthUnits: 'pixels',
        stroked: true,
        filled: false,
        pickable: false,
        parameters: { depthTest: false },
      }));
      result.push(new PolygonLayer({
        id: `country-shading-${phaseIdx}`,
        data: countryPolygons,
        getPolygon: (d) => d.polygon[0],
        getFillColor: (d) => d.fillColor,
        getLineColor: (d) => d.lineColor,
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        stroked: true,
        filled: true,
        pickable: false,
        parameters: { depthTest: false },
      }));
    }

    // 1b. Faction banners. Period-accurate flag + editorial caption per
    //     controlling power at the centroid of its anchor country.
    if (factionBanners.length > 0) {
      result.push(new IconLayer({
        id: `faction-flags-${phaseIdx}`,
        data: factionBanners.filter((b) => b.flag),
        getIcon: (d) => ({
          url: d.flag as string,
          width: 90,
          height: 56,
          anchorY: 28,
        }),
        getPosition: (d) => d.position,
        getSize: 56,
        sizeUnits: 'pixels',
        sizeMinPixels: 28,
        sizeMaxPixels: 80,
        getPixelOffset: [0, -18],
        parameters: { depthTest: false },
      }));
      result.push(new TextLayer({
        id: `faction-captions-${phaseIdx}`,
        data: factionBanners,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 16,
        getColor: [248, 250, 252, 245],
        getPixelOffset: [0, 28],
        outlineWidth: 6,
        outlineColor: [10, 8, 6, 255],
        fontSettings: { sdf: true, fontSize: 64, buffer: 6 },
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 700,
        billboard: true,
        characterSet: 'auto',
        parameters: { depthTest: false },
      }));
    }

    // 2. Per-phase control regions.
    if (controlPolygons.length > 0) {
      result.push(new PolygonLayer({
        id: `control-regions-${phaseIdx}`,
        data: controlPolygons,
        getPolygon: (d) => d.polygon,
        getFillColor: (d) => d.fillColor,
        getLineColor: (d) => d.lineColor,
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
        stroked: true,
        filled: true,
        pickable: false,
        parameters: { depthTest: false },
      }));
    }

    // 3. Control-region labels (e.g. "3rd Reich", "Soviet sector"). One
    //     per region with a centroid above the polygon.
    if (controlPolygons.length > 0) {
      const labelData = controlPolygons
        .map((p) => {
          if (!p.label) return null;
          const ring = p.polygon;
          if (!ring || ring.length === 0) return null;
          let sumLng = 0, sumLat = 0;
          for (const [lng, lat] of ring) { sumLng += lng; sumLat += lat; }
          return {
            position: [sumLng / ring.length, sumLat / ring.length] as [number, number],
            text: p.label,
          };
        })
        .filter((d): d is NonNullable<typeof d> => d !== null);
      if (labelData.length > 0) {
        result.push(new TextLayer({
          id: `region-labels-${phaseIdx}`,
          data: labelData,
          getPosition: (d) => d.position,
          getText: (d) => d.text,
          getSize: 15,
          getColor: [255, 255, 255, 220],
          outlineWidth: 6,
          outlineColor: [10, 8, 6, 245],
          fontSettings: { sdf: true, fontSize: 64, buffer: 6 },
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 600,
          billboard: false,
          parameters: { depthTest: false },
        }));
      }
    }

    return result;
  }, [controlPolygons, countryPolygons, factionBanners, phaseIdx]);

  // pushFrame concatenates the static and animated layer halves into a
  // single overlay update. Called from the static-mirror effect and
  // from the RAF loop; never allocates through React.
  const pushFrame = useCallback(() => {
    overlayRef.current?.setProps({
      layers: [
        ...staticLayersRef.current,
        ...animatedLayersRef.current,
      ] as unknown as LayersList,
    });
  }, []);

  // Mirror static layers into their ref whenever they rebuild (phase
  // change, zoom bucket flip, territory update) and push a frame.
  useEffect(() => {
    if (!mapReady) return;
    staticLayersRef.current = staticLayers;
    pushFrame();
  }, [staticLayers, mapReady, pushFrame]);

  // Camera on phase change. The frame is every unit and arrow end of the
  // phase plus the stage margin, north up and flat (stage.ts). The camera
  // holds still when the new phase fits the current frame and fills enough
  // of it, otherwise it makes one eased move, or a longer flight scaled by
  // distance on a battle hop inside a war cinematic. Reduced motion jumps.
  // Once the frame and the camera entry are known, the phase's timeline is
  // built (beats.ts): nothing moves until the camera has settled.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Supersede the previous phase's camera work before starting this one:
    // bump the generation so a pending settle from it is ignored, and stop
    // the move in flight so two never run at once.
    const gen = ++camGenRef.current;
    const wasMoving = map.isMoving();
    map.stop();
    const viewerMoved = userCameraLockRef.current;
    userCameraLockRef.current = false;
    const snap = prefersReducedMotion;
    // Battle hops get a flight duration scaled to the distance flown, and
    // the chosen duration becomes the timeline's camera entry so the action
    // waits for arrival.
    const isHop = hopBattleIdRef.current !== '' && hopBattleIdRef.current !== battle.id;
    hopBattleIdRef.current = battle.id;

    const container = map.getContainer();
    const width = container.clientWidth || 1200;
    const height = container.clientHeight || 700;
    const points: LngLat[] = [];
    for (const u of phaseData.unitPoints) points.push(u.position);
    for (const m of phaseData.trips) {
      points.push(m.from);
      points.push(m.to);
    }
    const box = phaseBox(points);
    const prior = stageRef.current;
    const hold =
      box !== null &&
      prior !== null &&
      phaseIdx > 0 &&
      !isHop &&
      !viewerMoved &&
      !wasMoving &&
      prior.battleId === battle.id &&
      prior.width === width &&
      prior.height === height &&
      holdFrame(prior.frame, box, width, height);
    let frame: StageFrame;
    if (hold && prior) frame = prior.frame;
    else if (box) frame = frameForBox(box, width, height);
    else frame = fallbackFrame([cameraLng, cameraLat], extentLngDeg, extentLatDeg, width, height);
    stageRef.current = { battleId: battle.id, width, height, frame };

    // The move between phases runs at the playback speed, so it takes the same
    // share of the phase clock at every speed. A battle hop keeps its own pace.
    const phaseSpeed = speedRef.current;
    let entryMs = hold || snap ? 0 : Math.round(STAGE_MOVE_MS / phaseSpeed);
    if (isHop && !snap) {
      const from = map.getCenter();
      const km = kmBetween(from.lat, from.lng, frame.center[1], frame.center[0]);
      entryMs = Math.min(5200, Math.max(2400, Math.round(km * 5)));
    }
    // A narrated phase lasts as long as its narration, and its beats spread through the
    // voice. The replay's phase timer takes the same dwell from the same rule.
    const baseDwellMs = phaseDwellMs(phase.durationMs, Boolean(replay.schematic));
    const voiceMs = narratedRef.current ? spokenMs(phase.narration) : 0;
    const dwellMs = voiceMs > 0 ? narratedDwellMs(baseDwellMs, phase.narration) : baseDwellMs;

    // Spread the symbols where units end the phase, at the frame given, and
    // build the timeline from there. The phase starts where the phase before
    // ended on screen, or, when that phase was never drawn at this size, where
    // it ends spread at this frame. The first phase starts from its own spots.
    const units = phaseData.unitPoints;
    const sizes = units.map((u) => u.size);
    const buildTimeline = (f: StageFrame, w: number, h: number) => {
      const size = `${w}x${h}`;
      if (endsRef.current.battleId !== battle.id) endsRef.current = { battleId: battle.id, byPhase: new Map() };
      const drawnEnd = spreadPoints(phaseData.ride.end, sizes, f, w, h);
      spreadRef.current = new Map(units.map((u, i) => [u.gid, drawnEnd[i]] as [string, LngLat]));
      endsRef.current.byPhase.set(phaseIdx, { size, spots: priorFromUnits(units, phaseData.ride.end, drawnEnd) });
      const firstPhase = phaseIdx === 0 || prevData === null;
      let start: Map<string, PriorSpot> | undefined;
      if (firstPhase) {
        const listed = units.map((u) => u.position);
        start = priorFromUnits(units, listed, spreadPoints(listed, sizes, f, w, h));
      } else {
        const kept = endsRef.current.byPhase.get(phaseIdx - 1);
        start = kept && kept.size === size ? kept.spots : undefined;
        if (!start) {
          const prevSizes = prevData.unitPoints.map((u) => u.size);
          start = priorFromUnits(prevData.unitPoints, prevData.ride.end, spreadPoints(prevData.ride.end, prevSizes, f, w, h));
        }
      }
      const tl = phaseTimeline({
        units: phaseData.beatUnits,
        arrows: phaseData.beatArrows,
        ride: phaseData.ride,
        drawnEnd,
        prior: start,
        firstPhase,
        dwellMs,
        entryMs,
        speed: phaseSpeed,
        voiceMs: voiceMs > 0 ? voiceMs : undefined,
      });
      const prevByGid = new Map((prevData?.unitPoints ?? []).map((u) => [u.gid, u] as [string, ResolvedUnit]));
      const look = tl.units.map((t) => (t.unit >= 0 ? units[t.unit] : prevByGid.get(t.gid)));
      timelineRef.current = {
        battleId: battle.id,
        phaseIdx,
        tl,
        look,
        entrySpeed: phaseSpeed,
        roles: labelRoles(tl, firstPhase),
      };
    };
    buildTimeline(frame, width, height);
    respreadRef.current = () => {
      if (gen !== camGenRef.current) return;
      const c = map.getCenter();
      buildTimeline({ center: [c.lng, c.lat], zoom: map.getZoom() }, container.clientWidth, container.clientHeight);
      redrawRef.current();
      labelPositionRef.current();
    };

    // Labels hide during a camera move and fade back in once it settles.
    // A held camera keeps them in place.
    const wrap = labelWrapRef.current;
    const onSettled = () => {
      // A moveend from a superseded phase must not revive this phase's labels.
      if (gen !== camGenRef.current) return;
      if (wrap) {
        wrap.style.transition = 'opacity 500ms ease-out';
        wrap.style.opacity = '1';
      }
      labelPositionRef.current();
    };
    reframeRef.current = () => {
      const now = stageRef.current;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (gen !== camGenRef.current || !w || !h || userCameraLockRef.current) return;
      if (now && now.battleId === battle.id && now.width === w && now.height === h) return;
      const next = box
        ? frameForBox(box, w, h)
        : fallbackFrame([cameraLng, cameraLat], extentLngDeg, extentLatDeg, w, h);
      stageRef.current = { battleId: battle.id, width: w, height: h, frame: next };
      buildTimeline(next, w, h);
      // Stopping a move in flight fires its moveend, which shows the labels.
      map.stop();
      map.jumpTo({ center: next.center, zoom: next.zoom, bearing: 0, pitch: 0 });
      redrawRef.current();
      labelPositionRef.current();
    };
    const target = { center: frame.center, zoom: frame.zoom, bearing: 0, pitch: 0 };
    if (entryMs === 0) {
      map.jumpTo(target);
      onSettled();
      return;
    }
    if (wrap) {
      wrap.style.transition = 'opacity 200ms ease-out';
      wrap.style.opacity = '0';
    }
    map.once('moveend', onSettled);
    map.easeTo({
      ...target,
      duration: entryMs,
      essential: true,
      // Cinematic ease-out: fast accelerate, gentle arrival.
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
    });
  }, [
    phaseIdx,
    phaseData,
    prevData,
    phase.durationMs,
    phase.narration,
    replay.schematic,
    battle.id,
    cameraLat,
    cameraLng,
    extentLatDeg,
    extentLngDeg,
    prefersReducedMotion,
  ]);

  // The per-frame animation loop. Advances the phase clock, draws the
  // timeline's state at that time (units on their tracks, arrows grown and
  // dimmed, tip flashes), and pushes the combined frame straight into the
  // deck.gl overlay. React never re-renders from this loop. The clock belongs
  // to the phase, so a pause, a resume, or a speed change carries on from
  // where it was. The loop parks itself once the phase has settled.
  useEffect(() => {
    const current = timelineRef.current;
    if (!current || current.battleId !== battle.id || current.phaseIdx !== phaseIdx) return;
    if (clockRef.current.battleId !== battle.id || clockRef.current.phaseIdx !== phaseIdx) {
      clockRef.current = { battleId: battle.id, phaseIdx, t: -current.tl.entry };
    }
    const map = mapRef.current;
    const dashes = (a: LngLat, b: LngLat) => {
      if (!map) return 0;
      const pa = map.project(a);
      const pb = map.project(b);
      return Math.max(1, Math.min(80, Math.round(Math.hypot(pa.x - pb.x, pa.y - pb.y) / (2 * TRAIL_DASH_PX))));
    };
    const settleAt = () => timelineRef.current?.tl.settleAt ?? 0;
    const build = (t: number) => {
      const now = timelineRef.current;
      if (!now) return;
      const state = stateAt(now.tl, t);
      animatedLayersRef.current = [
        ...buildUnitLayers(state, now.look, phaseIdx, unitAtlas, statusAtlas, dashes),
        ...buildMotionLayers(state, phaseData.trips, phaseIdx),
      ];
      pushFrame();
      frameRef.current = { battleId: now.battleId, phaseIdx: now.phaseIdx, state, t };
      labelPositionRef.current();
    };
    redrawRef.current = () => {
      if (!mapReady) return;
      if (prefersReducedMotion || ended) build(Infinity);
      else build(Math.min(clockRef.current.t, settleAt() + 1));
    };

    if (prefersReducedMotion || ended) {
      if (mapReady) build(Infinity);
      return;
    }
    if (mapReady) build(Math.min(clockRef.current.t, settleAt() + 1));
    if (!playing || !mapIdle || !mapReady) return;

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const c = clockRef.current;
      let dt = now - last;
      last = now;
      if (c.t < 0) {
        const entrySpeed = Math.max(0.1, timelineRef.current?.entrySpeed ?? speed);
        const used = Math.min(dt, -c.t / entrySpeed);
        c.t += used * entrySpeed;
        dt -= used;
      }
      c.t += dt * Math.max(0.1, speed);
      const end = settleAt();
      if (c.t >= end) {
        // Final frame, then park. Nothing animates past this point.
        build(end + 1);
        return;
      }
      build(c.t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    battle.id,
    phaseIdx,
    phaseData,
    playing,
    speed,
    prefersReducedMotion,
    ended,
    mapIdle,
    mapReady,
    pushFrame,
    unitAtlas,
    statusAtlas,
  ]);

  // Era theme picks the title font, accent hue, and vignette tint for
  // this battle. Drives every cinematic chrome piece below so an ancient
  // siege reads as parchment-and-quill while a Cold War standoff reads
  // as ostinato-and-steel.
  const theme = useMemo(() => themeForEra(battle.era), [battle.era]);

  // Label elements for the HTML overlay: one for every named unit of the phase and
  // one for every named arrow. Which of them show, and where, is decided on every
  // drawn frame by the positioning routine below, so this rebuilds only per phase.
  const labelCandidates = useMemo(() => {
    type Candidate = { key: string; gid?: string; arrow?: number; text: string; color: string };
    const out: Candidate[] = [];
    for (const u of phaseData.unitPoints) {
      if (!u.label) continue;
      out.push({
        key: `unit-${u.gid}`,
        gid: u.gid,
        text: u.label,
        color: `rgb(${u.color[0]},${u.color[1]},${u.color[2]})`,
      });
    }
    phaseData.trips.forEach((t, i) => {
      if (!t.label) return;
      out.push({
        key: `mov-${t.index}`,
        arrow: i,
        text: t.label,
        color: `rgb(${t.color[0]},${t.color[1]},${t.color[2]})`,
      });
    });
    return out;
  }, [phaseData]);

  // Imperative label placement, run on every drawn frame and every map move by
  // direct DOM writes, never a React render. A unit's label sits under its symbol
  // where the symbol is drawn now. An arrow's label sits beside its midpoint, off the
  // line its unit rides. Labels claim room in order: the one the viewer points at,
  // arrows of the beat, then units that travel, new ones, status changes, and the
  // first phase's, by strength. A label hides when its measured box meets a label
  // placed before it or another unit's symbol.
  useEffect(() => {
    const position = () => {
      const map = mapRef.current;
      const wrap = labelWrapRef.current;
      if (!map || !wrap) return;
      const els = Array.from(wrap.children) as HTMLElement[];
      const cur = timelineRef.current;
      const frame = frameRef.current;
      if (
        !cur ||
        !frame ||
        cur.phaseIdx !== phaseIdx ||
        frame.battleId !== cur.battleId ||
        frame.phaseIdx !== cur.phaseIdx
      ) {
        for (const el of els) el.style.visibility = 'hidden';
        return;
      }
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      // Read every size before any write, so the browser lays out once.
      const sizes = els.map((el) => {
        const inner = el.firstElementChild as HTMLElement | null;
        return inner ? [inner.offsetWidth, inner.offsetHeight] : [0, 0];
      });

      type Placed = { gid: string; track: number; x: number; y: number; size: number; alpha: number; strength: number; box: Box };
      const symbols: Placed[] = [];
      const byGid = new Map<string, Placed>();
      for (const d of frame.state.units) {
        const u = cur.look[d.track];
        if (!u) continue;
        const p = map.project(d.position);
        const s = {
          gid: u.gid,
          track: d.track,
          x: p.x,
          y: p.y,
          size: u.size,
          alpha: d.alpha,
          strength: u.strength,
          box: centeredBox(p.x, p.y, u.size, u.size),
        };
        symbols.push(s);
        if (cur.tl.units[d.track].unit >= 0) byGid.set(u.gid, s);
      }

      const endState = !Number.isFinite(frame.t);
      const slots: Array<{ i: number; rank: number; strength: number }> = [];
      els.forEach((el, i) => {
        const gid = el.dataset.gid;
        if (gid) {
          const s = byGid.get(gid);
          if (!s || s.alpha < 0.5) return;
          const pinned = gid === hoverGidRef.current || gid === tapGidRef.current;
          const role = cur.roles[s.track];
          if (!pinned && !role) return;
          slots.push({ i, rank: pinned ? -2 : LABEL_RANK[role as LabelRole], strength: s.strength });
          return;
        }
        const a = Number(el.dataset.arrow);
        const shown = endState ? (cur.tl.arrows[a]?.beat ?? -1) >= 0 : arrowLabelShown(cur.tl, a, frame.t);
        if (shown) slots.push({ i, rank: -1, strength: 0 });
      });
      slots.sort((x, y) => x.rank - y.rank || y.strength - x.strength || x.i - y.i);

      const kept: Box[] = [];
      const fits = (b: Box, own: string | null, pinned: boolean) =>
        b.x0 >= 0 &&
        b.y0 >= 0 &&
        b.x1 <= w &&
        b.y1 <= h &&
        !kept.some((k) => boxesMeet(k, b)) &&
        (pinned || !symbols.some((s) => s.gid !== own && boxesMeet(s.box, b)));
      const show = new Map<number, [number, number]>();
      for (const slot of slots) {
        const el = els[slot.i];
        const [bw, bh] = sizes[slot.i];
        const gid = el.dataset.gid;
        if (gid) {
          const s = byGid.get(gid) as Placed;
          const dy = s.size / 2 + LABEL_GAP_PX + bh / 2;
          const dx = s.size / 2 + LABEL_GAP_PX + bw / 2;
          // First free side of four: under, above, right, left.
          const spots: Array<[number, number]> = [
            [s.x, s.y + dy],
            [s.x, s.y - dy],
            [s.x + dx, s.y],
            [s.x - dx, s.y],
          ];
          for (const [x, y] of spots) {
            const b = centeredBox(x, y, bw, bh);
            if (fits(b, gid, slot.rank === -2)) {
              kept.push(b);
              show.set(slot.i, [x, y]);
              break;
            }
          }
          continue;
        }
        const trip = phaseData.trips[Number(el.dataset.arrow)];
        const pf = map.project(trip.from);
        const pt = map.project(trip.to);
        const len = Math.hypot(pt.x - pf.x, pt.y - pf.y) || 1;
        // The normal that points up the screen, or left for an upright arrow.
        let nx = -(pt.y - pf.y) / len;
        let ny = (pt.x - pf.x) / len;
        if (ny > 1e-6 || (Math.abs(ny) <= 1e-6 && nx > 0)) {
          nx = -nx;
          ny = -ny;
        }
        // Nearest free spot to the midpoint: off the line first, then along it.
        search: for (const step of ARROW_LABEL_STEPS) {
          for (const along of ARROW_LABEL_ALONG) {
            for (const sign of [1, -1]) {
              const off = (ARROW_LABEL_OFFSET_PX + step + bh / 2) * sign;
              const x = pf.x + (pt.x - pf.x) * along + nx * off;
              const y = pf.y + (pt.y - pf.y) * along + ny * off;
              const b = centeredBox(x, y, bw, bh);
              if (fits(b, null, false)) {
                kept.push(b);
                show.set(slot.i, [x, y]);
                break search;
              }
            }
          }
        }
      }

      els.forEach((el, i) => {
        const at = show.get(i);
        if (!at) {
          el.style.visibility = 'hidden';
          return;
        }
        el.style.visibility = 'visible';
        el.style.transform = `translate3d(${at[0]}px, ${at[1]}px, 0)`;
      });
    };
    labelPositionRef.current = position;
    position();
  }, [labelCandidates, mapReady, phaseData, phaseIdx]);

  // Cinematic phase title slate: centered chapter card at the top of
  // the frame, like a film cue. Pulses in on phase change, holds, fades.
  // Era serif sets the typographic register; the accent hairline rule
  // and small caps under-text complete the documentary feel.
  const slateStyle = prefersReducedMotion
    ? { opacity: 1 }
    : { animation: 'tactical-slate-cycle 3000ms ease-out forwards' };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 400 }}>
      <style>{`
        @keyframes tactical-slate-cycle {
          0%   { opacity: 0; transform: translateY(-10px); }
          12%  { opacity: 1; transform: translateY(0); }
          78%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
        @keyframes tactical-rule-cycle {
          0%   { opacity: 0; transform: scaleX(0); }
          18%  { opacity: 0.95; transform: scaleX(1); }
          78%  { opacity: 0.95; transform: scaleX(1); }
          100% { opacity: 0; transform: scaleX(1); }
        }
        @keyframes tactical-loader-bloom {
          0%   { opacity: 0; transform: scale(0.96); }
          18%  { opacity: 1; transform: scale(1); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes tactical-loader-rule {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        @keyframes tactical-loader-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          background: '#0d0a08',
        }}
      />

      {/* Vignette only. Stripped the paper grain, atmosphere wash, and
          letterbox bars — each layer was muddying the focal action.
          Documentary maps SUBTRACT. The vignette stays because it
          guides the eye to the action centroid; everything else
          competed with the focal layer. */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: `radial-gradient(ellipse 70% 65% at 50% 50%, transparent 45%, rgba(0,0,0,0.65) 100%)`,
        }}
      />

      {/* HTML overlay labels: plain text, white with a dark outline. Each label
          carries its unit or arrow; the positioning routine places it at its box
          center by direct DOM writes, and the camera effect fades the whole layer
          during entry flights. The recorder draws the same text from the
          data-rec attributes. */}
      <div ref={labelWrapRef} className="pointer-events-none absolute inset-0 z-[15]">
        {labelCandidates.map((label) => (
          <div
            key={label.key}
            data-gid={label.gid}
            data-arrow={label.arrow}
            data-rec-label={label.text}
            data-rec-color={label.color}
            data-rec-lift={0}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              visibility: 'hidden',
              willChange: 'transform',
            }}
          >
            <div
              className="text-[12px] uppercase font-semibold text-white whitespace-nowrap"
              style={{
                transform: 'translate(-50%, -50%)',
                lineHeight: '15px',
                letterSpacing: '0.14em',
                fontFamily: 'Inter, system-ui, sans-serif',
                textShadow: LABEL_OUTLINE,
              }}
            >
              {label.text}
            </div>
          </div>
        ))}
      </div>

      {/* Cinematic phase title slate. Centered, big era-serif title,
          editorial small-caps strap above, accent rule beneath. Owns
          the top of the frame for the first beat of every phase, then
          fades so the action layer keeps the eye for the rest of the
          dwell. Scales up significantly from the previous pass — this
          IS the chapter card, not a field label. */}
      <div
        key={`slate-${phaseIdx}`}
        className="pointer-events-none absolute left-1/2 top-[7%] z-20 -translate-x-1/2 text-center max-w-[64%]"
        style={slateStyle}
      >
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.46em] mb-2.5"
          style={{
            color: theme.accent,
            textShadow: `0 2px 14px rgba(0,0,0,0.95), 0 0 22px ${theme.accent}55`,
          }}
        >
          Phase {String(phaseIdx + 1).padStart(2, '0')}
          {phase.timeMarker && (
            <>
              <span className="opacity-40 mx-2.5">·</span>
              <span>{phase.timeMarker}</span>
            </>
          )}
        </div>
        <div
          className="text-white"
          style={{
            fontFamily: theme.titleFont,
            fontWeight: 600,
            fontSize: 'clamp(28px, 3.2vw, 46px)',
            letterSpacing: '-0.018em',
            lineHeight: 1.05,
            textShadow: '0 6px 28px rgba(0,0,0,0.95), 0 0 40px rgba(0,0,0,0.6)',
          }}
        >
          {phase.title}
        </div>
        <div
          className="mx-auto mt-4 h-[2px] w-44 origin-center rounded-full"
          style={{
            background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
            boxShadow: `0 0 18px ${theme.accent}cc`,
            animation: prefersReducedMotion ? undefined : 'tactical-rule-cycle 3000ms ease-out forwards',
          }}
        />
      </div>

      {/* Cinematic loading slate. Renders immediately when the
          component mounts and fades the moment MapLibre's first idle
          fires (tiles loaded, paint complete). Eliminates the dark
          gap between "Watch the replay" click and first map paint.
          A documentary doesn't show black — it shows a title card. */}
      {!mapIdle && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center"
          style={{
            background: `radial-gradient(ellipse at center, ${theme.vignette} 0%, #0a0806 100%)`,
            transition: 'opacity 700ms ease-out',
            // Fade the card in rather than popping it: inside a war
            // cinematic this slate appears on every battle hop, and the
            // hard cut read as "bam, another load."
            animation: prefersReducedMotion ? undefined : 'tactical-loader-bloom 320ms ease-out both',
          }}
        >
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.5em] mb-4"
            style={{
              color: theme.accent,
              animation: prefersReducedMotion ? undefined : 'tactical-loader-bloom 700ms ease-out forwards',
              textShadow: `0 0 22px ${theme.accent}88`,
            }}
          >
            Tactical Reconstruction
          </div>
          <div
            className="text-white text-center max-w-[72%]"
            style={{
              fontFamily: theme.titleFont,
              fontWeight: 600,
              fontSize: 'clamp(32px, 4.2vw, 60px)',
              letterSpacing: '-0.018em',
              lineHeight: 1.04,
              animation: prefersReducedMotion ? undefined : 'tactical-loader-bloom 900ms 100ms ease-out both',
              textShadow: '0 6px 30px rgba(0,0,0,0.95)',
            }}
          >
            {replay.title || battle.name}
          </div>
          <div
            className="mt-5 h-[2px] w-56 origin-left rounded-full overflow-hidden"
            style={{
              background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
              boxShadow: `0 0 18px ${theme.accent}cc`,
              animation: prefersReducedMotion ? undefined : 'tactical-loader-rule 900ms 300ms ease-out both',
            }}
          />
          <div
            className="mt-6 flex items-center gap-3 text-[10.5px] uppercase tracking-[0.36em] text-slate-300/80"
            style={{
              animation: prefersReducedMotion ? undefined : 'tactical-loader-bloom 700ms 500ms ease-out both',
            }}
          >
            {battle.era && <span style={{ color: theme.accent }}>{battle.era.replace(/-/g, ' ')}</span>}
            {battle.year && (
              <>
                <span className="opacity-40">·</span>
                <span>{battle.year}</span>
              </>
            )}
            {battle.war && (
              <>
                <span className="opacity-40">·</span>
                <span className="truncate max-w-[36ch]">{battle.war}</span>
              </>
            )}
          </div>
          {/* Loading sweep at the bottom — a thin moving highlight on a
              dim track so the user knows the slate is live, not stuck. */}
          <div className="mt-10 h-[2px] w-72 overflow-hidden rounded-full" style={{ background: 'rgba(148,163,184,0.18)' }}>
            <div
              className="h-full w-1/3 rounded-full"
              style={{
                background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
                boxShadow: `0 0 14px ${theme.accent}aa`,
                animation: prefersReducedMotion ? undefined : 'tactical-loader-sweep 1800ms ease-in-out infinite',
              }}
            />
          </div>
        </div>
      )}

      {/* Terrain streaming indicator: satellite tiles keep arriving for
          a few seconds after the title slate fades, and a half dark
          frame with no signal reads as a freeze. */}
      {mapIdle && !terrainReady && (
        <div
          className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 px-3.5 py-1.5 rounded-full"
          style={{ background: 'rgba(10,8,6,0.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
        >
          <span className="text-[10px] uppercase tracking-[0.3em] text-slate-200/90">Streaming terrain</span>
          <span className="h-[2px] w-16 overflow-hidden rounded-full inline-block" style={{ background: 'rgba(148,163,184,0.25)' }}>
            <span
              className="block h-full w-1/3 rounded-full"
              style={{
                background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
                animation: prefersReducedMotion ? undefined : 'tactical-loader-sweep 1400ms ease-in-out infinite',
              }}
            />
          </span>
        </div>
      )}

      <div className="absolute bottom-2 right-2 z-10 px-2 py-0.5 rounded text-[9px] uppercase tracking-wider text-slate-300/60 pointer-events-none">
        &copy; OpenStreetMap contributors . OpenFreeMap . Mapzen terrain . MapLibre
      </div>
    </div>
  );
}
