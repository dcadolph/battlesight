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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { LayersList } from '@deck.gl/core';
import {
  IconLayer,
  LineLayer,
  PathLayer,
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
  chooseFrame,
  edgePin,
  fallbackFrame,
  frameForBox,
  homeBox,
  phaseBox,
  projectToScreen,
  resolvePoint,
  slidePin,
  spreadPoints,
  symbolSize,
} from './stage';
import type { EdgePin, LngLat, StageFrame } from './stage';
import { splitLabel } from './labels';
import {
  buildGround,
  fieldToLngLat,
  groundNames,
  groundShapes,
  isFieldReplay,
  PAPER_READY,
  placeNames,
} from './ground';
import type { FieldPoint, GroundName, GroundShape, PlacedName, ScreenBox } from './ground';
import { nameInk, plateLook, roleStyle } from './look';
import type { PlateLook } from './look';
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
function buildMotionLayers(state: DrawnState, trips: ResolvedTrip[], phaseIdx: number, maxHalfM: number): unknown[] {
  if (state.arrows.length === 0) return [];
  const result: unknown[] = [];

  const arrowsLive = state.arrows.map((d) => {
    const trip = trips[d.arrow];
    const tip: LngLat = [
      trip.from[0] + (trip.to[0] - trip.from[0]) * d.progress,
      trip.from[1] + (trip.to[1] - trip.from[1]) * d.progress,
    ];
    return { trip, dim: d.dim, polygon: buildAtlasArrow(trip.from, tip, trip.kind as never, 1, maxHalfM) };
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

// paperOutline is the light halo around label text on the paper plate, as a text shadow.
function paperOutline(halo: string): string {
  return `0 0 3px ${halo}, 1px 1px 0 ${halo}, -1px -1px 0 ${halo}, 1px -1px 0 ${halo}, -1px 1px 0 ${halo}`;
}

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

// ARROW_HALF_SHARE is the widest an arrow's half shaft may draw, as a share of the whole fight's span.
const ARROW_HALF_SHARE = 0.02;

// ARROW_HALF_FLOOR_M is the least that cap may be, in meters, so a tiny fight keeps visible arrows.
const ARROW_HALF_FLOOR_M = 60;

// EDGE_RANK places edge pin labels after the one the viewer points at and before
// every other label, since a pin is the only sign of a unit past the edge.
const EDGE_RANK = -1.5;

// EDGE_CHEVRON_PX is the size of an edge pin's chevron.
const EDGE_CHEVRON_PX = 12;

// EDGE_GAP_PX is the space between an edge pin's chevron and its label.
const EDGE_GAP_PX = 4;

// EDGE_SLIDES are the steps along the edge tried, in order, when a pin meets a placed label.
const EDGE_SLIDES = [0, 22, -22, 44, -44, 66, -66];

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

// BASEMAP_LAYERS are the basemap layers a field replay's plate hides, with the paint
// property that fades each one and its value when shown.
const BASEMAP_LAYERS: Array<[string, string, number]> = [
  ['woodland', 'fill-opacity', 0.9],
  ['water', 'fill-opacity', 1],
  ['rivers', 'line-opacity', 1],
  ['hillshade', 'hillshade-exaggeration', 0.45],
];

// openStyle returns the map style. With a plate, the sheet is the plate's land and the
// basemap layers start hidden, so a field replay never shows the dark map first.
function openStyle(plate: PlateLook | null): StyleSpecification {
  const shown = (id: string) => (plate && BASEMAP_LAYERS.some(([l]) => l === id) ? 'none' : 'visible') as 'none' | 'visible';
  return {
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
      paint: { 'background-color': plate ? plate.land : PLATE_LAND },
    },
    // Woodland and wetland, barely lifted off the land so cover a battle
    // turned on is visible without competing with the faction palette.
    {
      id: 'woodland',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'wetland']]],
      layout: { visibility: shown('woodland') },
      paint: { 'fill-color': PLATE_WOOD, 'fill-opacity': 0.9 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      layout: { visibility: shown('water') },
      paint: { 'fill-color': PLATE_WATER, 'fill-opacity': 1 },
    },
    {
      id: 'rivers',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]],
      layout: { visibility: shown('rivers') },
      paint: {
        'line-opacity': 1,
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
      layout: { visibility: shown('hillshade') },
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
}

// setBasemap shows the plate or the true ground on a loaded map, fading over fadeMs. The
// returned function cancels the pending hide.
function setBasemap(map: maplibregl.Map, plate: PlateLook | null, fadeMs: number): () => void {
  const transition = { duration: fadeMs, delay: 0 };
  map.setPaintProperty('matte', 'background-color-transition', transition);
  map.setPaintProperty('matte', 'background-color', plate ? plate.land : PLATE_LAND);
  for (const [id, prop, value] of BASEMAP_LAYERS) {
    map.setPaintProperty(id, `${prop}-transition`, transition);
    if (!plate) map.setLayoutProperty(id, 'visibility', 'visible');
    map.setPaintProperty(id, prop, plate ? 0 : value);
  }
  if (!plate) return () => {};
  const hide = () => {
    for (const [id] of BASEMAP_LAYERS) map.setLayoutProperty(id, 'visibility', 'none');
  };
  if (fadeMs <= 0) {
    hide();
    return () => {};
  }
  const t = setTimeout(hide, fadeMs);
  return () => clearTimeout(t);
}

// PAPER_GRAIN is a soft fractal noise tile, the grain of the paper plate.
const PAPER_GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>" +
  "<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>" +
  "<feColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.3 0 0 0 0 0.24 0 0 0 0.55 0'/></filter>" +
  "<rect width='100%' height='100%' filter='url(%23g)'/></svg>\")";

// PLACE_SERIF is the face of place names on the plate. Georgia first: its italic keeps
// every tail inside the glyph's own box, which the font atlas needs.
const PLACE_SERIF = "Georgia, 'Times New Roman', serif";

// PlateGeo is what maps field space onto the map.
interface PlateGeo {
  // lat is the field's center latitude.
  lat: number;
  // lng is the field's center longitude.
  lng: number;
  // extentLatDeg is the field's latitude span.
  extentLatDeg: number;
  // extentLngDeg is the field's longitude span.
  extentLngDeg: number;
}

// plateLngLat maps a field point onto the map.
function plateLngLat(p: FieldPoint, geo: PlateGeo): [number, number] {
  return fieldToLngLat(p, geo.lat, geo.lng, geo.extentLatDeg, geo.extentLngDeg);
}

// DrawnShape is a ground shape mapped onto the map, with its look.
interface DrawnShape {
  // path is the shape's points on the map.
  path: Array<[number, number]>;
  // color is the shape's color.
  color: Rgba;
  // widthPx is the line width in pixels.
  widthPx: number;
}

// buildGroundLayers draws a plate's ground as deck layers under everything else, each run of fills or lines in drawing order, so a river crosses a
// hill and a town sits on a road. opacity fades the whole ground.
function buildGroundLayers(shapes: GroundShape[], look: PlateLook, geo: PlateGeo, key: string, opacity: number): unknown[] {
  const out: unknown[] = [];
  let run: { fill: boolean; items: DrawnShape[] } | null = null;
  const flush = () => {
    if (!run || run.items.length === 0) return;
    const id = `plate-${run.fill ? 'fill' : 'line'}-${out.length}-${key}`;
    if (run.fill) {
      out.push(new PolygonLayer<DrawnShape>({
        id,
        data: run.items,
        getPolygon: (d) => d.path,
        getFillColor: (d) => d.color,
        filled: true,
        stroked: false,
        opacity,
        pickable: false,
        parameters: { depthCompare: 'always' },
      }));
    } else {
      out.push(new PathLayer<DrawnShape>({
        id,
        data: run.items,
        getPath: (d) => d.path,
        getColor: (d) => d.color,
        getWidth: (d) => d.widthPx,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        opacity,
        pickable: false,
        parameters: { depthCompare: 'always' },
      }));
    }
  };
  for (const sh of shapes) {
    const st = roleStyle(look, sh.role);
    const item: DrawnShape = {
      path: sh.points.map((p) => plateLngLat(p, geo)),
      color: hexToRgb(st.color, st.alpha),
      widthPx: st.widthPx,
    };
    if (!run || run.fill !== sh.fill) {
      flush();
      run = { fill: sh.fill, items: [] };
    }
    run.items.push(item);
  }
  flush();
  return out;
}

// buildNameLayer draws a plate's place names as one deck text layer, italic serif with a
// light halo, towns upright.
function buildNameLayer(placed: PlacedName[], look: PlateLook, geo: PlateGeo, key: string, opacity: number): unknown[] {
  if (placed.length === 0) return [];
  const halo = hexToRgb(look.halo, 235);
  const layer = (upright: boolean) =>
    new TextLayer<PlacedName>({
      id: `plate-names-${upright ? 'town' : 'place'}-${key}`,
      data: placed.filter((p) => (p.kind === 'town' || p.kind === 'fort') === upright),
      getPosition: (d) => plateLngLat(d.spot.at, geo),
      getText: (d) => d.text,
      getSize: (d) => d.sizePx,
      getColor: (d) => hexToRgb(nameInk(look, d.kind), 255),
      getAngle: (d) => d.spot.angle,
      getTextAnchor: (d) => d.spot.anchor,
      getAlignmentBaseline: (d) => d.spot.baseline,
      getPixelOffset: (d) => d.spot.offset,
      fontFamily: PLACE_SERIF,
      fontWeight: upright ? '600' : '500',
      // A wide buffer keeps italic overhangs and descenders whole in the font atlas.
      fontSettings: { sdf: true, fontSize: 64, buffer: 14 },
      outlineWidth: 4,
      outlineColor: halo,
      characterSet: 'auto',
      sizeUnits: 'pixels',
      billboard: true,
      opacity,
      pickable: false,
      parameters: { depthCompare: 'always' },
    });
  return [layer(false), layer(true)];
}

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
  // idleRef mirrors mapIdle for the camera effect, which must not rerun when it flips.
  const idleRef = useRef(false);
  // establishRef holds the first move of a replay, kept until the loading card lifts so
  // the viewer sees the whole field before the camera goes in.
  const establishRef = useRef<(() => void) | null>(null);
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

  // The plate. A field replay whose ground is ready is drawn on paper from the ground its
  // own phases name. Every other replay keeps the real map. The ground is built once a
  // replay, from every phase, so it never changes under the viewer.
  const fieldPlate = useMemo(() => isFieldReplay(replay) && PAPER_READY.has(battle.id), [replay, battle.id]);
  const look = useMemo(() => plateLook(battle.era), [battle.era]);
  const plateDraw = useMemo(() => {
    if (!fieldPlate) return null;
    const ground = buildGround(replay, extentLngDeg / extentLatDeg);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const ph of replay.phases) {
      for (const u of ph.units ?? []) {
        sx += u.x;
        sy += u.y;
        n++;
      }
    }
    const heart: FieldPoint = n > 0 ? [sx / n, sy / n] : [50, 50];
    return { shapes: groundShapes(ground, heart), names: groundNames(ground) };
  }, [fieldPlate, replay, extentLngDeg, extentLatDeg]);
  // plateWantRef is the plate the current battle wants. The map puts it down when the
  // camera lands, so a battle hop flies over the old ground and fades to the new.
  const plateWantRef = useRef<{
    battleId: string;
    look: PlateLook | null;
    shapes: GroundShape[];
    names: GroundName[];
    geo: PlateGeo;
  }>({ battleId: '', look: null, shapes: [], names: [], geo: { lat: 0, lng: 0, extentLatDeg: 3, extentLngDeg: 3 } });
  useLayoutEffect(() => {
    plateWantRef.current = {
      battleId: battle.id,
      look: plateDraw ? look : null,
      shapes: plateDraw?.shapes ?? [],
      names: plateDraw?.names ?? [],
      geo: { lat: battle.lat, lng: battle.lng, extentLatDeg, extentLngDeg },
    };
  }, [battle.id, battle.lat, battle.lng, plateDraw, look, extentLatDeg, extentLngDeg]);
  // plateRef is the plate the map shows now and the battle it belongs to.
  const plateRef = useRef<{ battleId: string; look: PlateLook | null; geo: PlateGeo | null }>({
    battleId: '',
    look: null,
    geo: null,
  });
  // paperShown is the plate on screen, for the chrome around the map.
  const [paperShown, setPaperShown] = useState<PlateLook | null>(() => (plateDraw ? look : null));
  // groundLayersRef and nameLayersRef hold the plate's deck layers, drawn under the
  // territory and the units. namesRef holds the names placed for the current phase.
  const groundLayersRef = useRef<unknown[]>([]);
  const nameLayersRef = useRef<unknown[]>([]);
  const namesRef = useRef<{ battleId: string; placed: PlacedName[] }>({ battleId: '', placed: [] });
  // plateFadeRef cancels a fade or a pending basemap hide when the plate changes again.
  const plateFadeRef = useRef<() => void>(() => {});
  // applyPlateRef puts down the plate the current battle wants, fading over fadeMs.
  const applyPlateRef = useRef<(fadeMs: number) => void>(() => {});
  // drawNamesRef rebuilds the name layer from the names placed for the current phase.
  const drawNamesRef = useRef<(opacity: number) => void>(() => {});

  const cameraLat = phase.cameraLat ?? battle.lat ?? 49.34;
  const cameraLng = phase.cameraLng ?? battle.lng ?? -0.51;

  // geo is the battle center and extent every phase resolves its positions against.
  const geo = useMemo<PhaseGeo>(
    () => ({ lat: battle.lat, lng: battle.lng, extentLatDeg, extentLngDeg }),
    [battle.lat, battle.lng, extentLatDeg, extentLngDeg],
  );
  // The box of the whole fight, from every phase, so the camera never pulls back
  // past the field.
  const fightBox = useMemo(
    () =>
      homeBox(
        replay.phases.map((p) => {
          const r = resolvePhase(p, geo, replay);
          return [...r.unitPoints.map((u) => u.position), ...r.trips.flatMap((t) => [t.from, t.to])];
        }),
      ),
    [geo, replay],
  );

  // arrowHalfM is the widest an arrow's half shaft may draw, a small share of the whole
  // fight, so one long arrow never paints a band across a small field.
  const arrowHalfM = useMemo(() => {
    if (!fightBox) return Infinity;
    const cos = Math.cos((((fightBox[1] + fightBox[3]) / 2) * Math.PI) / 180);
    const spanM = Math.max((fightBox[3] - fightBox[1]) * 111_320, (fightBox[2] - fightBox[0]) * 111_320 * cos);
    return Math.max(ARROW_HALF_FLOOR_M, spanM * ARROW_HALF_SHARE);
  }, [fightBox]);

  // Initialise the map once, north up and flat for the life of the replay.
  // Subsequent phase changes drive the camera and overlay setProps via refs.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // The replay opens on the frame of the whole fight, under the loading card.
    const startW = containerRef.current.clientWidth || 1200;
    const startH = containerRef.current.clientHeight || 700;
    const start = fightBox
      ? frameForBox(fightBox, startW, startH)
      : fallbackFrame([cameraLng, cameraLat], extentLngDeg, extentLatDeg, startW, startH);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: openStyle(plateWantRef.current.look),
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
  // The loading card lifted: make the first move held for it.
  useEffect(() => {
    idleRef.current = mapIdle;
    if (!mapIdle) return;
    const move = establishRef.current;
    establishRef.current = null;
    move?.();
  }, [mapIdle]);

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
    // The plate is drawn ground, not the real map, so it carries no country shading
    // and no country banners: they would sit on the wrong ground.
    if (countryPolygons.length > 0 && !paperShown) {
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
    if (factionBanners.length > 0 && !paperShown) {
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
  }, [controlPolygons, countryPolygons, factionBanners, phaseIdx, paperShown]);

  // pushFrame concatenates the static and animated layer halves into a
  // single overlay update. Called from the static-mirror effect and
  // from the RAF loop; never allocates through React.
  const pushFrame = useCallback(() => {
    overlayRef.current?.setProps({
      layers: [
        ...groundLayersRef.current,
        ...nameLayersRef.current,
        ...staticLayersRef.current,
        ...animatedLayersRef.current,
      ] as unknown as LayersList,
    });
  }, []);

  // The plate is put down here and nowhere else: on the first loaded frame with no fade,
  // and after a battle hop has landed with a fade, so the ground never swaps mid-flight.
  useEffect(() => {
    drawNamesRef.current = (opacity: number) => {
      const shown = plateRef.current;
      const placed = namesRef.current;
      nameLayersRef.current =
        shown.look && shown.geo && placed.battleId === shown.battleId
          ? buildNameLayer(placed.placed, shown.look, shown.geo, shown.battleId, opacity)
          : [];
    };
    applyPlateRef.current = (fadeMs: number) => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;
      const want = plateWantRef.current;
      plateFadeRef.current();
      plateRef.current = { battleId: want.battleId, look: want.look, geo: want.geo };
      const cancelHide = setBasemap(map, want.look, fadeMs);
      setPaperShown(want.look);
      const draw = (opacity: number) => {
        groundLayersRef.current = want.look
          ? buildGroundLayers(want.shapes, want.look, want.geo, want.battleId, opacity)
          : [];
        drawNamesRef.current(opacity);
        pushFrame();
      };
      if (fadeMs <= 0 || !want.look) {
        draw(1);
        plateFadeRef.current = cancelHide;
        return;
      }
      let raf = 0;
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / fadeMs);
        draw(k);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      plateFadeRef.current = () => {
        cancelAnimationFrame(raf);
        cancelHide();
      };
    };
  }, [pushFrame]);

  // The first plate goes down as soon as the map has loaded.
  useEffect(() => {
    if (!mapReady || plateRef.current.battleId !== '') return;
    applyPlateRef.current(0);
  }, [mapReady]);

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
    const mayHold =
      prior !== null &&
      phaseIdx > 0 &&
      !isHop &&
      !viewerMoved &&
      !wasMoving &&
      prior.battleId === battle.id &&
      prior.width === width &&
      prior.height === height;
    const home = fightBox ? frameForBox(fightBox, width, height) : null;
    const fallback = () => fallbackFrame([cameraLng, cameraLat], extentLngDeg, extentLatDeg, width, height);
    // The first phase of a replay opened here starts from the home frame and always moves
    // in to its own action, never holding.
    const establishing =
      phaseIdx === 0 && !isHop && !viewerMoved && home !== null && (prior === null || prior.battleId !== battle.id);
    if (establishing) map.jumpTo({ center: home.center, zoom: home.zoom, bearing: 0, pitch: 0 });
    const unitSpots = phaseData.unitPoints.map((u) => u.position);
    const choice = chooseFrame(
      mayHold && prior ? prior.frame : null,
      box,
      home,
      fallback,
      width,
      height,
      unitSpots,
      points,
    );
    const hold = choice.hold;
    const frame: StageFrame = choice.frame;
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
      // Place names where they meet no unit symbol and no unit label at phase end.
      const want = plateWantRef.current;
      if (want.look && want.names.length > 0) {
        const blocked: ScreenBox[] = [];
        units.forEach((u, i) => {
          const [x, y] = projectToScreen(drawnEnd[i], f, w, h);
          const r = u.size / 2 + 3;
          blocked.push({ x1: x - r, y1: y - r, x2: x + r, y2: y + r });
          const name = splitLabel(u.label).name;
          if (name) {
            const lw = name.length * 7 + 6;
            const top = y + u.size / 2 + LABEL_GAP_PX;
            blocked.push({ x1: x - lw / 2, y1: top, x2: x + lw / 2, y2: top + 18 });
          }
        });
        // Arrows too: a name never sits on a move.
        for (const trip of phaseData.trips) {
          const [ax, ay] = projectToScreen(trip.from, f, w, h);
          const [bx, by] = projectToScreen(trip.to, f, w, h);
          const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 16));
          for (let k = 0; k <= steps; k++) {
            const x = ax + ((bx - ax) * k) / steps;
            const y = ay + ((by - ay) * k) / steps;
            blocked.push({ x1: x - 12, y1: y - 12, x2: x + 12, y2: y + 12 });
          }
        }
        const placed = placeNames(
          want.names,
          (p) => projectToScreen(plateLngLat(p, want.geo), f, w, h),
          blocked,
          w,
          h,
        );
        namesRef.current = { battleId: battle.id, placed };
      } else {
        namesRef.current = { battleId: battle.id, placed: [] };
      }
      if (plateRef.current.battleId === battle.id) {
        drawNamesRef.current(1);
        pushFrame();
      }
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
      if (plateRef.current.battleId !== battle.id) applyPlateRef.current(isHop ? 600 : 0);
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
      const next = chooseFrame(
        null,
        box,
        fightBox ? frameForBox(fightBox, w, h) : null,
        () => fallbackFrame([cameraLng, cameraLat], extentLngDeg, extentLatDeg, w, h),
        w,
        h,
        unitSpots,
        points,
      ).frame;
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
    const move = () => {
      if (gen !== camGenRef.current) return;
      // The establishing frame shows the ground before the camera goes in.
      if (establishing && plateRef.current.battleId !== battle.id) applyPlateRef.current(0);
      map.once('moveend', onSettled);
      map.easeTo({
        ...target,
        duration: entryMs,
        essential: true,
        // Cinematic ease-out: fast accelerate, gentle arrival.
        easing: (t: number) => 1 - Math.pow(1 - t, 3),
      });
    };
    establishRef.current = null;
    // The phase clock waits for the loading card to lift, so the first move does too.
    if (establishing && !idleRef.current) establishRef.current = move;
    else move();
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
    fightBox,
    prefersReducedMotion,
    pushFrame,
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
        ...buildMotionLayers(state, phaseData.trips, phaseIdx, arrowHalfM),
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
    arrowHalfM,
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
    type Candidate = { key: string; gid?: string; arrow?: number; text: string; note: string; color: string };
    const out: Candidate[] = [];
    for (const u of phaseData.unitPoints) {
      if (!u.label) continue;
      const { name, note } = splitLabel(u.label);
      out.push({
        key: `unit-${u.gid}`,
        gid: u.gid,
        text: name,
        note,
        color: `rgb(${u.color[0]},${u.color[1]},${u.color[2]})`,
      });
    }
    phaseData.trips.forEach((t, i) => {
      if (!t.label) return;
      out.push({
        key: `mov-${t.index}`,
        arrow: i,
        text: splitLabel(t.label).name,
        note: '',
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
      // A pinned unit label shows its note under the name. Set before measuring.
      for (const el of els) {
        const note = el.querySelector<HTMLElement>('[data-note]');
        if (!note) continue;
        const gid = el.dataset.gid;
        const want = gid && (gid === hoverGidRef.current || gid === tapGidRef.current) ? 'block' : 'none';
        if (note.style.display !== want) note.style.display = want;
      }
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
      // A unit past the screen edge, or an arrow that ends past it, gets an edge pin:
      // a chevron on the edge pointing at it, with its label beside the chevron.
      const edgeOf = new Map<number, { pin: EdgePin; target: [number, number] }>();
      const slots: Array<{ i: number; rank: number; strength: number }> = [];
      els.forEach((el, i) => {
        const gid = el.dataset.gid;
        if (gid) {
          const s = byGid.get(gid);
          if (!s || s.alpha < 0.5) return;
          const pin = edgePin([s.x, s.y], null, w, h);
          if (pin) {
            edgeOf.set(i, { pin, target: [s.x, s.y] });
            slots.push({ i, rank: EDGE_RANK, strength: s.strength });
            return;
          }
          const pinned = gid === hoverGidRef.current || gid === tapGidRef.current;
          const role = cur.roles[s.track];
          if (!pinned && !role) return;
          slots.push({ i, rank: pinned ? -2 : LABEL_RANK[role as LabelRole], strength: s.strength });
          return;
        }
        const a = Number(el.dataset.arrow);
        const shown = endState ? (cur.tl.arrows[a]?.beat ?? -1) >= 0 : arrowLabelShown(cur.tl, a, frame.t);
        if (!shown) return;
        const trip = phaseData.trips[a];
        const pf = map.project(trip.from);
        const pt = map.project(trip.to);
        const pin = edgePin([pt.x, pt.y], [pf.x, pf.y], w, h);
        if (pin) edgeOf.set(i, { pin, target: [pt.x, pt.y] });
        slots.push({ i, rank: pin ? EDGE_RANK : -1, strength: 0 });
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
      const chevronAt = new Map<number, EdgePin>();
      for (const slot of slots) {
        const el = els[slot.i];
        const [bw, bh] = sizes[slot.i];
        const gid = el.dataset.gid;
        const edge = edgeOf.get(slot.i);
        if (edge) {
          // Slide along the edge until the chevron and the label meet nothing placed.
          for (const by of EDGE_SLIDES) {
            const pin = by === 0 ? edge.pin : slidePin(edge.pin, by, edge.target, w, h);
            const reach = EDGE_CHEVRON_PX / 2 + EDGE_GAP_PX;
            const [x, y] =
              pin.side === 'left'
                ? [pin.x + reach + bw / 2, pin.y]
                : pin.side === 'right'
                  ? [pin.x - reach - bw / 2, pin.y]
                  : pin.side === 'top'
                    ? [Math.min(w - bw / 2, Math.max(bw / 2, pin.x)), pin.y + reach + bh / 2]
                    : [Math.min(w - bw / 2, Math.max(bw / 2, pin.x)), pin.y - reach - bh / 2];
            const b = centeredBox(x, y, bw, bh);
            const c = centeredBox(pin.x, pin.y, EDGE_CHEVRON_PX, EDGE_CHEVRON_PX);
            if (fits(b, gid ?? null, false) && fits(c, gid ?? null, false)) {
              kept.push(b, c);
              show.set(slot.i, [x, y]);
              chevronAt.set(slot.i, { ...pin, x: pin.x - x, y: pin.y - y });
              break;
            }
          }
          continue;
        }
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
        const chevron = el.querySelector<HTMLElement>('[data-chevron]');
        const pin = chevronAt.get(i);
        if (chevron) {
          chevron.style.display = pin ? 'block' : 'none';
          if (pin) {
            chevron.style.transform = `translate(${pin.x}px, ${pin.y}px) translate(-50%, -50%) rotate(${pin.angle}rad)`;
          }
        }
        if (pin) el.dataset.recPin = `${pin.x.toFixed(1)},${pin.y.toFixed(1)},${pin.angle.toFixed(3)}`;
        else delete el.dataset.recPin;
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
          background: paperShown ? paperShown.land : '#0d0a08',
        }}
      />

      {/* Vignette only. Stripped the paper grain, atmosphere wash, and
          letterbox bars — each layer was muddying the focal action.
          Documentary maps SUBTRACT. The vignette stays because it
          guides the eye to the action centroid; everything else
          competed with the focal layer. */}
      {/* Paper grain over the plate, fixed to the screen like the grain of a sheet. */}
      {paperShown && (
        <div
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            backgroundImage: PAPER_GRAIN,
            backgroundSize: '220px 220px',
            opacity: paperShown.grainAlpha / 100,
            mixBlendMode: 'multiply',
          }}
        />
      )}
      {!paperShown && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background: `radial-gradient(ellipse 70% 65% at 50% 50%, transparent 45%, rgba(0,0,0,0.65) 100%)`,
          }}
        />
      )}

      {/* HTML overlay labels: plain text, white with a dark outline. Each label
          carries its unit or arrow; the positioning routine places it at its box
          center by direct DOM writes, and the camera effect fades the whole layer
          during entry flights. The recorder draws the same text from the
          data-rec attributes. */}
      <div
        ref={labelWrapRef}
        className="pointer-events-none absolute inset-0 z-[15]"
        data-rec-ink={paperShown ? paperShown.labelInk : undefined}
        data-rec-halo={paperShown ? paperShown.halo : undefined}
      >
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
              className="text-[13px] font-semibold whitespace-nowrap text-center"
              style={{
                transform: 'translate(-50%, -50%)',
                lineHeight: '16px',
                fontFamily: 'Inter, system-ui, sans-serif',
                color: paperShown ? paperShown.labelInk : '#ffffff',
                textShadow: paperShown ? paperOutline(paperShown.halo) : LABEL_OUTLINE,
              }}
            >
              {label.text}
              {label.note && (
                <div
                  data-note
                  className="text-[12px] font-normal"
                  style={{ display: 'none', color: paperShown ? paperShown.labelInk : '#e2e8f0' }}
                >
                  {label.note}
                </div>
              )}
            </div>
            <svg
              data-chevron
              width={EDGE_CHEVRON_PX}
              height={EDGE_CHEVRON_PX}
              viewBox="0 0 12 12"
              style={{ position: 'absolute', left: 0, top: 0, display: 'none', overflow: 'visible' }}
            >
              <path
                d="M3 1.5 L9 6 L3 10.5"
                fill="none"
                stroke={paperShown ? paperShown.halo : 'rgba(10,8,6,0.9)'}
                strokeWidth={5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3 1.5 L9 6 L3 10.5"
                fill="none"
                stroke={paperShown ? paperShown.labelInk : '#ffffff'}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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

      {/* The plate draws no map data, so the map credits show only on true ground. */}
      {!paperShown && (
        <div className="absolute bottom-2 right-2 z-10 px-2 py-0.5 rounded text-[9px] uppercase tracking-wider text-slate-300/60 pointer-events-none">
          &copy; OpenStreetMap contributors . OpenFreeMap . Mapzen terrain . MapLibre
        </div>
      )}
    </div>
  );
}
