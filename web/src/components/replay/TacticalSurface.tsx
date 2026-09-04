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
import type { Feature, Geometry } from 'geojson';

interface TacticalSurfaceProps {
  battle: Battle;
  replay: Replay;
  phase: Phase;
  phaseIdx: number;
  playing?: boolean;
  speed?: number;
  ended?: boolean;
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

// resolvePoint converts a phase movement / unit position to [lng, lat]
// (deck.gl coordinate order), preferring explicit geographic coords.
// Returns null for placeholder x=50,y=50 sentinels so we never stack
// every unit at the battle centroid.
function resolvePoint(
  x: number,
  y: number,
  lat: number | undefined,
  lng: number | undefined,
  centerLat: number,
  centerLng: number,
  extentLatDeg: number,
  extentLngDeg: number,
): [number, number] | null {
  if (typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0)) {
    return [lng, lat];
  }
  if (x === 50 && y === 50) return null;
  const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
  const lngHalf = extentLngDeg / 2 / cosLat;
  const latHalf = extentLatDeg / 2;
  return [
    centerLng + (x - 50) / 50 * lngHalf,
    centerLat + (50 - y) / 50 * latHalf,
  ];
}

// tripTiming returns the [begin, end] timestamps for a movement based on
// its kind. Charges punch fastest, retreats drift, amphibious and
// airdrops cover distance so they get the longest run. Index staggers
// each arrow so the sequence reads as choreography, not a swarm. Tuned
// slow enough that the eye can follow each axis of advance before the
// next one fires; the earlier faster set read as unfollowable inside
// war cinematics.
function tripTiming(kind: string | undefined, index: number): { begin: number; duration: number } {
  const begin = index * 420;
  let duration = 3000;
  if (kind === 'charge' || kind === 'cavalry-charge') duration = 2100;
  else if (kind === 'flank' || kind === 'envelopment' || kind === 'pincer') duration = 2600;
  else if (kind === 'amphibious' || kind === 'airdrop' || kind === 'air-strike') duration = 3600;
  else if (kind === 'rout' || kind === 'retreat' || kind === 'withdrawal') duration = 3400;
  else if (kind === 'siege' || kind === 'breakout') duration = 3100;
  return { begin, duration };
}

// arrowWidth returns the stroke width for a movement based on its kind.
// Charges and breakouts get the heaviest line; siege / pursuit / supply
// stay slim so they read as supporting motion.
function arrowWidth(kind: string | undefined): number {
  if (kind === 'charge' || kind === 'cavalry-charge' || kind === 'breakout') return 9;
  if (kind === 'amphibious' || kind === 'airdrop' || kind === 'air-strike') return 8;
  if (kind === 'siege' || kind === 'pursuit' || kind === 'reinforcement') return 5;
  return 7;
}

// altitudeToZoom maps the legacy 0..1.5 cameraAltitude (radii on the
// globe) to a Mapbox zoom level. The range is deliberately COMPRESSED: the
// old mapping swung from continental (whole of England + France, battle a
// speck) to buried-in-the-units. Now the far end never pulls past a
// regional view and the near end keeps surroundings, so phase-to-phase
// steps read as a gentle push, not a warp. Tactical (0.06) → ~9.5,
// operational (0.55) → ~7.9, strategic (1.5) → ~6.7 (floored at 6.2).
function altitudeToZoom(altitude: number): number {
  return Math.max(6.2, Math.min(10.6, 9.9 - Math.log2(altitude * 6 + 1) * 0.95));
}

// statusOpacity scales a unit's icon alpha by its current state. Destroyed
// units fade out, broken ones dim, healthy ones render at full strength.
function statusOpacity(status: string | undefined): number {
  if (status === 'destroyed') return 110;
  if (status === 'broken' || status === 'routed') return 170;
  if (status === 'leaving' || status === 'thinning') return 200;
  return 240;
}

// statusSize multiplies the icon size for the few statuses that should
// read as bigger (pressing, pursuing) or smaller (destroyed, isolated).
function statusSize(status: string | undefined): number {
  if (status === 'pressing' || status === 'pursuing') return 1.15;
  if (status === 'destroyed' || status === 'isolated') return 0.92;
  return 1.0;
}

// pitchForAltitude maps the phase camera altitude to a restrained tilt.
// The base is now a flat cartographic map, not a 3D terrain mesh, so a
// strong oblique only shears the map and hurts legibility. Keep a slight
// tilt when tight for a touch of depth, and go flat for the theater
// pullbacks so the atlas plate stays clean and readable.
function pitchForAltitude(altitude: number): number {
  if (altitude < 0.18) return 18;
  if (altitude < 0.55) return 8;
  return 0;
}

// azimuthDeg returns the compass bearing in degrees from one lng/lat
// point toward another, in the same flat-earth frame as the arrows.
function azimuthDeg(from: [number, number], to: [number, number]): number {
  const midLat = (from[1] + to[1]) / 2;
  const dx = (to[0] - from[0]) * Math.cos((midLat * Math.PI) / 180);
  const dy = to[1] - from[1];
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

// bearingForPhase rotates the map a restrained amount toward the focal
// movement's axis of advance so the push reads up-screen. Partial
// rotation with a hard clamp: full alignment would spin the map
// between phases and disorient the viewer.
function bearingForPhase(
  trips: Array<{ from: [number, number]; to: [number, number] }>,
  override: number | undefined,
): number {
  if (typeof override === 'number') return override;
  if (trips.length === 0) return 0;
  let focal = trips[0];
  let best = 0;
  for (const t of trips) {
    const len = Math.hypot(t.to[0] - t.from[0], t.to[1] - t.from[1]);
    if (len > best) {
      best = len;
      focal = t;
    }
  }
  let az = azimuthDeg(focal.from, focal.to);
  while (az > 180) az -= 360;
  while (az < -180) az += 360;
  return Math.max(-30, Math.min(30, az * 0.35));
}

// easeInOutCubic is the glide easing for unit movement between phases.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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

// ResolvedUnit is one unit with its geography resolved and its glide
// bookkeeping attached: where it starts from (previous phase position),
// whether it is entering the field this phase, or exiting (present last
// phase, absent now — rendered as a fading ghost during the glide).
interface ResolvedUnit {
  index: number;
  gid: string;
  position: [number, number];
  from: [number, number] | null;
  entering: boolean;
  exiting: boolean;
  color: Rgba;
  glowColor: Rgba;
  shadowColor: Rgba;
  iconName: string;
  size: number;
  status: string | undefined;
  label: string;
  strength: number;
}

// ResolvedTrip is one movement with geography and animation timing
// resolved.
interface ResolvedTrip {
  index: number;
  kind: string | undefined;
  timestamps: [number, number];
  impactAt: number;
  color: Rgba;
  fillAlpha: number;
  width: number;
  label: string;
  midpoint: [number, number];
  from: [number, number];
  to: [number, number];
}

// UnitAtlasLike matches the shape returned by the unit-icons bakers.
interface UnitAtlasLike {
  canvas: HTMLCanvasElement | null;
  mapping: Record<string, { x: number; y: number; width: number; height: number; anchorY?: number; mask?: boolean }>;
}

// buildUnitLayers renders shadows, halos, icons, and status stamps for
// the units, with positions lerped along their glide and alpha ramps
// for entering/exiting units. gt is the eased glide progress 0..1.
function buildUnitLayers(
  units: ResolvedUnit[],
  gt: number,
  phaseIdx: number,
  unitAtlas: UnitAtlasLike,
  statusAtlas: UnitAtlasLike,
): unknown[] {
  if (units.length === 0) return [];
  const ease = easeInOutCubic(Math.max(0, Math.min(1, gt)));
  const live = units
    .map((u) => {
      if (u.exiting && ease >= 1) return null;
      let position = u.position;
      if (u.from && ease < 1) {
        position = [
          u.from[0] + (u.position[0] - u.from[0]) * ease,
          u.from[1] + (u.position[1] - u.from[1]) * ease,
        ];
      }
      let alphaMul = 1;
      if (u.entering) alphaMul = ease;
      if (u.exiting) alphaMul = 1 - ease;
      if (alphaMul <= 0) return null;
      return {
        ...u,
        position,
        color: scaleAlpha(u.color, alphaMul),
        glowColor: scaleAlpha(u.glowColor, alphaMul),
        shadowColor: scaleAlpha(u.shadowColor, alphaMul),
      };
    })
    .filter((u): u is NonNullable<typeof u> => u !== null);
  if (live.length === 0) return [];

  const result: unknown[] = [];
  result.push(new ScatterplotLayer({
    id: `unit-shadows-${phaseIdx}`,
    data: live,
    getPosition: (d: ResolvedUnit) => d.position,
    getFillColor: (d: ResolvedUnit) => d.shadowColor,
    getRadius: (d: ResolvedUnit) => d.size * 3.2,
    radiusUnits: 'meters',
    stroked: false,
    radiusMinPixels: 5,
    radiusMaxPixels: 14,
    parameters: { depthTest: false },
  }));
  result.push(new ScatterplotLayer({
    id: `unit-halos-${phaseIdx}`,
    data: live,
    getPosition: (d: ResolvedUnit) => d.position,
    getFillColor: (d: ResolvedUnit) => d.glowColor,
    getRadius: (d: ResolvedUnit) => d.size * 5,
    radiusUnits: 'meters',
    stroked: false,
    radiusMinPixels: 7,
    radiusMaxPixels: 18,
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
      getIcon: (d: ResolvedUnit) => d.iconName,
      getPosition: (d: ResolvedUnit) => d.position,
      getColor: (d: ResolvedUnit) => d.color,
      getSize: (d: ResolvedUnit) => d.size,
      sizeUnits: 'pixels',
      sizeMinPixels: 22,
      sizeMaxPixels: 60,
      parameters: { depthTest: false },
    }));
  }
  if (statusAtlas.canvas) {
    const stamped = live.filter((u) => hasStatusOverlay(u.status as never));
    if (stamped.length > 0) {
      result.push(new IconLayer({
        id: `unit-status-${phaseIdx}`,
        data: stamped,
        iconAtlas: statusAtlas.canvas as unknown as string,
        iconMapping: statusAtlas.mapping,
        getIcon: (d: ResolvedUnit) => d.status as string,
        getPosition: (d: ResolvedUnit) => d.position,
        getColor: (d: ResolvedUnit) => scaleAlpha([255, 255, 255, 240], d.color[3] / 255),
        getSize: (d: ResolvedUnit) => d.size * 1.06,
        sizeUnits: 'pixels',
        sizeMinPixels: 22,
        sizeMaxPixels: 60,
        parameters: { depthTest: false },
      }));
    }
  }
  return result;
}

// buildMotionLayers renders the per-frame movement graphics: the atlas
// arrow polygons growing along their lines of advance, terminus
// anchors, the impact disc, and the shockwave ring. t is the phase
// clock in ms.
function buildMotionLayers(trips: ResolvedTrip[], t: number, phaseIdx: number): unknown[] {
  if (trips.length === 0) return [];
  const result: unknown[] = [];

  const arrowsLive = trips
    .map((trip) => {
      if (t < trip.timestamps[0]) return null;
      const dur = Math.max(1, trip.timestamps[1] - trip.timestamps[0]);
      const progress = Math.max(0, Math.min(1, (t - trip.timestamps[0]) / dur));
      const tip: [number, number] = t >= trip.timestamps[1]
        ? trip.to
        : [
            trip.from[0] + (trip.to[0] - trip.from[0]) * progress,
            trip.from[1] + (trip.to[1] - trip.from[1]) * progress,
          ];
      return {
        ...trip,
        arrowPolygon: buildAtlasArrow(trip.from, tip, trip.kind as never, 1),
      };
    })
    .filter((trip): trip is NonNullable<typeof trip> => trip !== null);

  if (arrowsLive.length > 0) {
    // Beevor/Ambrose treatment: heavy warm-black outline grounds the
    // silhouette; saturated faction fill reads as a single deliberate
    // brushstroke. The draw-on growth is the motion cue; no comet.
    result.push(new PolygonLayer({
      id: `atlas-arrows-outline-${phaseIdx}`,
      data: arrowsLive,
      getPolygon: (d: { arrowPolygon: [number, number][] }) => d.arrowPolygon,
      getFillColor: [12, 10, 8, 0],
      getLineColor: [12, 10, 8, 250],
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
      getPolygon: (d: { arrowPolygon: [number, number][] }) => d.arrowPolygon,
      getFillColor: (d: ResolvedTrip) => [d.color[0], d.color[1], d.color[2], d.fillAlpha] as Rgba,
      getLineColor: [0, 0, 0, 0],
      stroked: false,
      filled: true,
      pickable: false,
      parameters: { depthTest: false },
    }));
  }

  // Permanent terminus marker at every arrow tip whose trip has
  // completed. The impact disc flashes and dies; without this anchor
  // the arrowhead reads as orphaned for the rest of the phase.
  const terminusData = trips
    .filter((trip) => t >= trip.impactAt)
    .map((trip) => ({
      position: trip.to,
      inner: [
        Math.min(255, trip.color[0] + 60),
        Math.min(255, trip.color[1] + 60),
        Math.min(255, trip.color[2] + 60),
        255,
      ] as Rgba,
      ring: [trip.color[0], trip.color[1], trip.color[2], 230] as Rgba,
    }));
  if (terminusData.length > 0) {
    result.push(new ScatterplotLayer({
      id: `terminus-ring-${phaseIdx}`,
      data: terminusData,
      getPosition: (d: { position: [number, number] }) => d.position,
      getFillColor: [0, 0, 0, 0],
      getLineColor: (d: { ring: Rgba }) => d.ring,
      getRadius: 8,
      getLineWidth: 3,
      lineWidthUnits: 'pixels',
      radiusUnits: 'pixels',
      stroked: true,
      filled: false,
      parameters: { depthTest: false },
    }));
    result.push(new ScatterplotLayer({
      id: `terminus-dot-${phaseIdx}`,
      data: terminusData,
      getPosition: (d: { position: [number, number] }) => d.position,
      getFillColor: (d: { inner: Rgba }) => d.inner,
      getRadius: 4,
      radiusUnits: 'pixels',
      stroked: false,
      parameters: { depthTest: false },
    }));
  }

  // Impact disc: bright filled flash that grows and fades on arrival.
  const impacts = trips
    .map((trip) => {
      const since = t - trip.impactAt;
      const inWindow = since >= 0 && since < 1500;
      const k = inWindow ? since / 1500 : 1;
      const easeOut = 1 - Math.pow(1 - k, 3);
      return {
        position: trip.to,
        color: [
          trip.color[0],
          trip.color[1],
          trip.color[2],
          inWindow ? Math.round(245 * (1 - easeOut)) : 0,
        ] as Rgba,
        radius: inWindow ? 500 + 8000 * easeOut : 0,
      };
    })
    .filter((d) => d.radius > 0);
  if (impacts.length > 0) {
    result.push(new ScatterplotLayer({
      id: `impacts-${phaseIdx}`,
      data: impacts,
      getPosition: (d: { position: [number, number] }) => d.position,
      getFillColor: (d: { color: Rgba }) => d.color,
      getRadius: (d: { radius: number }) => d.radius,
      radiusUnits: 'meters',
      stroked: false,
      radiusMinPixels: 0,
      radiusMaxPixels: 100,
      parameters: { depthTest: false },
    }));
  }

  // Shockwave ring: races outward faster than the disc, then fades.
  const shockwaves = trips.flatMap((trip) => {
    const since = t - trip.impactAt;
    if (since < 0 || since >= 1800) return [];
    const k = since / 1800;
    const easeOut = 1 - Math.pow(1 - k, 4);
    return [{
      position: trip.to,
      color: [trip.color[0], trip.color[1], trip.color[2], Math.round(255 * (1 - k))] as Rgba,
      radius: 200 + 14000 * easeOut,
    }];
  });
  if (shockwaves.length > 0) {
    result.push(new ScatterplotLayer({
      id: `shockwave-${phaseIdx}`,
      data: shockwaves,
      getPosition: (d: { position: [number, number] }) => d.position,
      getFillColor: [0, 0, 0, 0],
      getLineColor: (d: { color: Rgba }) => d.color,
      getRadius: (d: { radius: number }) => d.radius,
      getLineWidth: 3,
      lineWidthUnits: 'pixels',
      radiusUnits: 'meters',
      stroked: true,
      filled: false,
      radiusMinPixels: 0,
      radiusMaxPixels: 140,
      parameters: { depthTest: false },
    }));
  }

  return result;
}

// Cartographic MapLibre style. No keys, no signups, CORS-open.
// A muted, label-free dark canvas over a warm matte, with a hillshade
// laid over it so ridges and river valleys read as terrain rather than
// flat paper. No streaming satellite imagery and no 3D terrain mesh: the
// old satellite stack streamed slowly and read as a tech demo. This is
// the documentary-atlas plate, a map rather than Google Earth.
//
// The base was Carto dark_all until CARTO began requiring an API key and
// started serving unauthenticated tiles with "API KEY REQUIRED" burned
// into the image. Those tiles still return 200, so nothing errored and
// the watermark simply appeared across every replay. Any keyless tile
// source can do this to us, so if the plate ever looks wrong, fetch a
// single tile and look at it before trusting the network tab.
const OPEN_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    // Esri World Dark Gray Canvas: keyless, CORS-open, label-free, and
    // already the muted grade this plate wants.
    'dark-canvas': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 16,
      attribution: 'Esri, HERE, Garmin, (c) OpenStreetMap contributors',
    },
    // Hillshade over the canvas. This is what makes a battlefield look
    // like ground: the ridge a flank anchors on and the valley a cavalry
    // charge runs down are otherwise invisible.
    hillshade: {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 16,
      attribution: 'Esri, USGS, NOAA',
    },
  },
  layers: [
    // Warm matte under everything. Reads as film base, not blue slate, and
    // seals any gap while tiles arrive.
    {
      id: 'matte',
      type: 'background',
      paint: { 'background-color': '#12100d' },
    },
    // The cartographic base. Desaturated toward the app's warm neutral and
    // held low-contrast so the faction palette stays the loudest thing.
    {
      id: 'dark-canvas',
      type: 'raster',
      source: 'dark-canvas',
      minzoom: 0,
      maxzoom: 19,
      paint: {
        'raster-saturation': -0.35,
        'raster-brightness-min': 0.06,
        'raster-brightness-max': 0.82,
        'raster-contrast': -0.05,
        'raster-fade-duration': 300,
      },
    },
    // Relief. The hillshade is near-white, so it is held to a low opacity
    // and darkened: enough to model the ground, not enough to grey out the
    // plate or steal contrast from the units.
    {
      id: 'hillshade',
      type: 'raster',
      source: 'hillshade',
      minzoom: 0,
      maxzoom: 19,
      paint: {
        'raster-opacity': 0.22,
        'raster-saturation': -1,
        'raster-brightness-max': 0.5,
        'raster-contrast': 0.15,
        'raster-fade-duration': 300,
      },
    },
  ],
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
};

export default function TacticalSurface({
  battle,
  replay,
  phase,
  phaseIdx,
  playing = true,
  speed = 1,
  ended = false,
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
  // timeRef is the per-phase animation clock in ms. Starts negative by
  // the camera tween so the action begins after the camera arrives.
  // Mutated by the RAF loop; never React state.
  const timeRef = useRef(0);
  // staticLayersRef / animatedLayersRef hold the two halves of the
  // deck.gl layer stack. pushFrame() concatenates them into a single
  // setProps call, from React effects (static) and the RAF (animated).
  const staticLayersRef = useRef<unknown[]>([]);
  const animatedLayersRef = useRef<unknown[]>([]);
  // prevUnitsRef remembers the previous phase's resolved unit points by
  // stable id so the next phase can glide units from their old
  // positions instead of teleporting them. glidePrepRef caches the
  // glide-annotated unit list for the current phase so re-running the
  // RAF effect (pause/resume, speed change) doesn't rotate the
  // previous-phase buffer twice. Both live in refs and are touched
  // only inside effects.
  const prevUnitsRef = useRef<{ battleId: string; units: Map<string, ResolvedUnit> }>({
    battleId: '',
    units: new Map(),
  });
  const glidePrepRef = useRef<{ battleId: string; phaseIdx: number; units: ResolvedUnit[] }>({
    battleId: '',
    phaseIdx: -1,
    units: [],
  });
  // labelWrapRef is the HTML label overlay container. Label pills are
  // positioned by direct DOM writes on map move events.
  const labelWrapRef = useRef<HTMLDivElement | null>(null);
  // userCameraLockRef flips when the viewer grabs the map; the dwell
  // drift stands down until the next phase reclaims the camera.
  const userCameraLockRef = useRef(false);
  // labelPositionRef holds the current label projection routine so the
  // map move listener (attached once at init) always calls the latest.
  const labelPositionRef = useRef<() => void>(() => {});
  // hopBattleIdRef detects battle-to-battle hops inside a war cinematic
  // (this component stays mounted across them). entryMsRef carries the
  // camera effect's actual flight duration to the RAF clock so the
  // action never starts while a long hop flight is still in the air.
  const hopBattleIdRef = useRef('');
  const entryMsRef = useRef<number | null>(null);
  // camGenRef bumps on every phase-camera change. Each run captures its
  // generation so a settle/drift scheduled by a superseded phase is ignored,
  // and the prior flight/drift is stopped before a new one starts. Overlapping
  // MapLibre animations throw "already running" / "_onEaseFrame is not a
  // function" and can blank the map mid-replay.
  const camGenRef = useRef(0);

  const extentLatDeg = replay.extentLatDeg ?? 3;
  const extentLngDeg = (replay.extentLngDeg ?? 3) * (replay.aspectRatio ?? 1.6);

  const cameraLat = phase.cameraLat ?? battle.lat ?? 49.34;
  const cameraLng = phase.cameraLng ?? battle.lng ?? -0.51;
  const altitude = phase.cameraAltitude ?? 0.4;
  const cameraZoom = altitudeToZoom(altitude);
  // With a real terrain mesh under the imagery, tilt is the money
  // shot: tactical framings take a strong oblique, strategic pullbacks
  // stay near plan view. Curated phases can override both angles.
  const cameraPitch = phase.cameraPitch ?? pitchForAltitude(altitude);

  // Initialise the map once. Subsequent phase changes drive camera.flyTo
  // and overlay setProps via refs.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OPEN_STYLE,
      center: [cameraLng, cameraLat],
      zoom: cameraZoom,
      pitch: cameraPitch,
      bearing: 0,
      attributionControl: false,
      maxPitch: 62,
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
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
    });
    // HTML labels track the camera by direct DOM writes; no React.
    map.on('move', () => labelPositionRef.current());
    // Tile/paint settlement signal for the streaming indicator.
    map.on('idle', () => setTerrainReady(true));
    // Viewer grabbing the map cancels the dwell drift until the next
    // phase reclaims the camera.
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
    // wait for raster tiles to download. Esri's dark-canvas tiles can
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

    return () => {
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

  // Build the per-phase derived data. Resolves geographic coordinates
  // once so every layer below reads from the same source.
  const phaseData = useMemo(() => {
    const movements: Movement[] = phase.movements ?? [];
    const units: Unit[] = phase.units ?? [];

    const trips: ResolvedTrip[] = movements
      .map((m, i) => {
        const from = resolvePoint(m.fromX, m.fromY, m.fromLat, m.fromLng, battle.lat, battle.lng, extentLatDeg, extentLngDeg);
        const to = resolvePoint(m.toX, m.toY, m.toLat, m.toLng, battle.lat, battle.lng, extentLatDeg, extentLngDeg);
        if (!from || !to) return null;
        const timing = tripTiming(m.kind, i);
        const color = factionColorFor(m.faction, replay);
        return {
          index: i,
          kind: m.kind,
          timestamps: [timing.begin, timing.begin + timing.duration] as [number, number],
          impactAt: timing.begin + timing.duration,
          color: hexToRgb(color, 255),
          fillAlpha: alphaForKind(m.kind),
          width: arrowWidth(m.kind),
          label: m.label || '',
          midpoint: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as [number, number],
          from,
          to,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    const occurrence = new Map<string, number>();
    const unitPoints: ResolvedUnit[] = units
      .map((u, i) => {
        const p = resolvePoint(u.x, u.y, u.lat, u.lng, battle.lat, battle.lng, extentLatDeg, extentLngDeg);
        if (!p) return null;
        const color = factionColorFor(u.faction, replay);
        // Cartographic-scale tokens. The icon is a map marker, not the
        // subject: small enough that dense formations read as distinct
        // pieces and the movement arrows own the frame. Strength nudges
        // size a little; the pixel caps below hold the range tight.
        const baseSize = 40 + (u.strength ?? 3) * 5;
        // Stable identity across phases: curated id when present, else
        // label + faction with an occurrence counter so twin unnamed
        // formations stay distinct.
        const base = u.id ?? `${u.label || u.unitType || 'unit'}|${u.faction}`;
        const n = occurrence.get(base) ?? 0;
        occurrence.set(base, n + 1);
        const gid = `${base}|${n}`;
        return {
          index: i,
          gid,
          position: p,
          from: null,
          entering: false,
          exiting: false,
          color: hexToRgb(color, statusOpacity(u.status)),
          glowColor: hexToRgb(color, 95),
          shadowColor: [10, 8, 6, 200] as Rgba,
          iconName: iconNameFor(u.unitType),
          size: baseSize * statusSize(u.status),
          status: u.status,
          label: u.label || '',
          strength: u.strength ?? 3,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    return { trips, unitPoints };
  }, [phase, battle.lat, battle.lng, replay, extentLatDeg, extentLngDeg]);

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

  // Camera choreography on phase change. Snap (or reduced-motion) is an
  // instant jumpTo. Otherwise fly with cinematic bearing and pitch.
  // Curator-set camera coords win; otherwise auto-fit the action bbox.
  // After the entry move settles, a slow documentary push-in drifts the
  // camera for the rest of the dwell unless the viewer grabbed the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Supersede the previous phase's camera work before starting this one:
    // bump the generation so any pending settle/drift from it is ignored, and
    // stop the in-flight flight or drift so the two never run at once.
    const gen = ++camGenRef.current;
    map.stop();
    userCameraLockRef.current = false;
    const bearing = bearingForPhase(phaseData.trips, phase.cameraBearing);
    const snap = prefersReducedMotion || phase.cameraMotion === 'snap';
    // Battle hops get a flight duration scaled to the distance flown:
    // Kyiv to Kherson deserves a five-second sweep with a high arc, a
    // neighboring phase gets the usual tight tween. The chosen duration
    // is published for the RAF clock so the action waits for arrival.
    const isHop = hopBattleIdRef.current !== '' && hopBattleIdRef.current !== battle.id;
    hopBattleIdRef.current = battle.id;
    let entryMs = phase.cameraTweenMs ?? 1900;
    let flyCurve = 1.6;
    if (isHop && !snap) {
      const from = map.getCenter();
      const km = kmBetween(from.lat, from.lng, cameraLat, cameraLng);
      entryMs = Math.min(5200, Math.max(2400, Math.round(km * 5)));
      flyCurve = 1.85;
    }
    entryMsRef.current = entryMs;

    // Labels hide during the entry flight and fade back in once the
    // camera settles: declutters the move, reads as a documentary cut.
    const wrap = labelWrapRef.current;
    if (wrap && !snap) {
      wrap.style.transition = 'opacity 200ms ease-out';
      wrap.style.opacity = '0';
    }
    const onSettled = () => {
      // A moveend from a superseded phase (or from the stop above) must not
      // revive this phase's labels or start its drift.
      if (gen !== camGenRef.current) return;
      if (wrap) {
        wrap.style.transition = 'opacity 500ms ease-out';
        wrap.style.opacity = '1';
      }
      labelPositionRef.current();
      startDrift();
    };

    // startDrift begins the slow push-in for the remainder of the
    // phase dwell: a touch of zoom, a few degrees of bearing, a nudge
    // of pitch. Linear easing so it reads as drift, not a move.
    let driftStarted = false;
    const startDrift = () => {
      if (gen !== camGenRef.current || driftStarted || snap || userCameraLockRef.current) return;
      driftStarted = true;
      const dwellMs = (phase.durationMs ?? 3000) / Math.max(0.1, speed);
      const driftMs = dwellMs - entryMs - 200;
      if (driftMs < 1200) return;
      map.easeTo({
        zoom: map.getZoom() + 0.07,
        bearing: map.getBearing() + (phaseIdx % 2 === 0 ? 4 : -4),
        pitch: Math.min(58, map.getPitch() + 3),
        duration: driftMs,
        easing: (t: number) => t,
      });
    };

    const hasCurator = typeof phase.cameraLat === 'number' && typeof phase.cameraLng === 'number';
    const points: Array<[number, number]> = [];
    if (!hasCurator) {
      for (const u of phaseData.unitPoints) points.push(u.position);
      for (const m of phaseData.trips) {
        points.push(m.from);
        points.push(m.to);
      }
    }
    if (!hasCurator && points.length >= 2) {
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const [lng, lat] of points) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      // Pad by 42% of the bbox span (or a minimum) so formations, their
      // label pills, and arrow heads all sit comfortably inside the
      // frame instead of crowding the edges.
      const dLng = Math.max((maxLng - minLng) * 0.42, 0.014);
      const dLat = Math.max((maxLat - minLat) * 0.42, 0.014);
      const bounds: [[number, number], [number, number]] = [
        [minLng - dLng, minLat - dLat],
        [maxLng + dLng, maxLat + dLat],
      ];
      const padding = { top: 150, bottom: 96, left: 104, right: 104 };
      if (snap) {
        map.fitBounds(bounds, { padding, animate: false, pitch: 0, bearing: 0 });
        onSettled();
      } else {
        map.once('moveend', onSettled);
        map.fitBounds(bounds, {
          padding,
          duration: entryMs,
          essential: true,
          pitch: cameraPitch,
          bearing,
          // Cinematic ease-out: fast accelerate, gentle arrival.
          easing: (t: number) => 1 - Math.pow(1 - t, 3),
        });
      }
      return;
    }
    const target = {
      center: [cameraLng, cameraLat] as [number, number],
      zoom: cameraZoom,
      pitch: cameraPitch,
      bearing,
    };
    if (snap) {
      map.jumpTo(target);
      onSettled();
      return;
    }
    map.once('moveend', onSettled);
    map.flyTo({
      ...target,
      duration: entryMs,
      essential: true,
      // Slower curve + lower max speed for documentary feel: camera
      // takes a moment to leave, glides, then settles. Battle hops
      // arc higher so the flight reads as travel, not a warp.
      curve: flyCurve,
      speed: 0.9,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
    });
    // phaseIdx stands in for per-phase camera intent; phaseData carries
    // the resolved geometry the bbox and bearing derive from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseIdx, phaseData, cameraLat, cameraLng, cameraZoom, cameraPitch, prefersReducedMotion, speed]);

  // The per-frame animation loop. Advances the phase clock, builds the
  // animated layer half (gliding units, growing arrows, impact
  // effects), and pushes the combined frame straight into the deck.gl
  // overlay. React never re-renders from this loop. The loop parks
  // itself once every animation in the phase has settled.
  useEffect(() => {
    // The camera effect publishes its actual flight duration (battle
    // hops fly longer than the phase default); the clock's negative
    // offset must match or arrows fire mid-flight.
    const camTween = entryMsRef.current ?? phase.cameraTweenMs ?? 1800;
    const glideMs = Math.min(1600, Math.max(600, camTween * 0.85));
    const { trips, unitPoints } = phaseData;

    // Rotate the glide buffers once per phase: annotate each unit with
    // its previous-phase position (glide origin) and enter flag, build
    // fade-out ghosts for units that vanished, then remember this
    // phase's units for the next rotation. Guarded so pause/resume
    // re-runs of this effect reuse the prepared list.
    const prep = glidePrepRef.current;
    if (prep.battleId !== battle.id || prep.phaseIdx !== phaseIdx) {
      const prev = prevUnitsRef.current.battleId === battle.id
        ? prevUnitsRef.current.units
        : new Map<string, ResolvedUnit>();
      const annotated = unitPoints.map((u) => {
        const prior = prev.get(u.gid);
        return {
          ...u,
          from: prior ? prior.position : null,
          entering: !prior && prev.size > 0,
        };
      });
      const liveGids = new Set(unitPoints.map((u) => u.gid));
      for (const [gid, pu] of prev) {
        if (liveGids.has(gid)) continue;
        annotated.push({ ...pu, gid, from: pu.position, entering: false, exiting: true });
      }
      glidePrepRef.current = { battleId: battle.id, phaseIdx, units: annotated };
      prevUnitsRef.current = {
        battleId: battle.id,
        units: new Map(unitPoints.map((u) => [u.gid, u])),
      };
    }
    const glideUnits = glidePrepRef.current.units;
    // Everything is settled once the last shockwave dies and the glide
    // is done; after that the frame is static until the next phase.
    const lastImpact = trips.reduce((acc, t) => Math.max(acc, t.impactAt), 0);
    const settleAt = Math.max(lastImpact + 1900, -camTween + glideMs + 100);

    const build = (t: number) => {
      const gt = (t + camTween) / glideMs;
      animatedLayersRef.current = [
        ...buildUnitLayers(glideUnits, gt, phaseIdx, unitAtlas, statusAtlas),
        ...buildMotionLayers(trips, t, phaseIdx),
      ];
      pushFrame();
    };

    if (prefersReducedMotion || ended) {
      timeRef.current = 1e7;
      if (mapReady) build(1e7);
      return;
    }
    timeRef.current = -camTween;
    if (mapReady) build(timeRef.current);
    if (!playing || !mapIdle || !mapReady) return;

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) * Math.max(0.1, speed);
      last = now;
      timeRef.current += dt;
      if (timeRef.current >= settleAt) {
        // Final frame, then park. Nothing animates past this point.
        build(settleAt + 1);
        return;
      }
      build(timeRef.current);
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
    phase.cameraTweenMs,
    pushFrame,
    unitAtlas,
    statusAtlas,
  ]);

  // Era theme picks the title font, accent hue, and vignette tint for
  // this battle. Drives every cinematic chrome piece below so an ancient
  // siege reads as parchment-and-quill while a Cold War standoff reads
  // as ostinato-and-steel.
  const theme = useMemo(() => themeForEra(battle.era), [battle.era]);

  // Label candidates for the HTML overlay: deduped unit labels plus
  // the top-4 movement labels, geo-anchored and priority-sorted.
  // Projection to screen pixels happens imperatively below, so this
  // memo rebuilds only on phase change or zoom bucket flip.
  const labelCandidates = useMemo(() => {
    type Candidate = {
      key: string;
      anchor: [number, number];
      text: string;
      color: string;
      kind: 'unit' | 'movement';
      priority: number;
    };
    const out: Candidate[] = [];

    // Unit labels — dedup by ~500m grid cell so dense beachheads /
    // urban scenes don't pile a wall of names on one position.
    const cellSize = zoomBucket > 10 ? 0.0035 : zoomBucket > 7 ? 0.012 : 0.04;
    const grid = new Map<string, ResolvedUnit>();
    for (const u of phaseData.unitPoints) {
      if (!u.label) continue;
      const key = `${Math.round(u.position[0] / cellSize)}|${Math.round(u.position[1] / cellSize)}`;
      const prior = grid.get(key);
      if (!prior || u.label.length > prior.label.length) grid.set(key, u);
    }
    for (const u of grid.values()) {
      out.push({
        key: `unit-${u.gid}`,
        anchor: u.position,
        text: u.label,
        color: `rgb(${u.color[0]},${u.color[1]},${u.color[2]})`,
        kind: 'unit',
        priority: u.label.length + (u.strength ?? 1) * 4,
      });
    }

    // Movement labels — top 4 longest per phase so the editorial
    // intent is named without painting a wall of mid-arrow text.
    const movLabels = phaseData.trips
      .filter((t) => t.label)
      .slice()
      .sort((a, b) => b.label.length - a.label.length)
      .slice(0, 4);
    for (const m of movLabels) {
      out.push({
        key: `mov-${m.index}`,
        anchor: m.midpoint,
        text: m.label,
        color: `rgb(${m.color[0]},${m.color[1]},${m.color[2]})`,
        kind: 'movement',
        priority: m.label.length,
      });
    }

    // Priority order doubles as collision precedence: the positioning
    // routine walks children in DOM order and keeps first-come.
    out.sort((a, b) => b.priority - a.priority);
    return out;
  }, [phaseData, zoomBucket]);

  // Imperative label projection. Positions every pill by direct DOM
  // writes with screen-space collision pruning (~150x38px per pill).
  // Registered as the map's move handler via labelPositionRef, so
  // labels track the camera at 60fps without a single React render.
  useEffect(() => {
    const position = () => {
      const map = mapRef.current;
      const wrap = labelWrapRef.current;
      if (!map || !wrap) return;
      const kept: Array<{ x: number; y: number }> = [];
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      for (const child of Array.from(wrap.children)) {
        const el = child as HTMLElement;
        const lng = Number(el.dataset.lng);
        const lat = Number(el.dataset.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const p = map.project([lng, lat]);
        let hidden = p.x < -80 || p.y < -60 || p.x > w + 80 || p.y > h + 60;
        if (!hidden) {
          for (const k of kept) {
            if (Math.abs(p.x - k.x) < 168 && Math.abs(p.y - k.y) < 46) {
              hidden = true;
              break;
            }
          }
        }
        el.style.visibility = hidden ? 'hidden' : 'visible';
        el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
        if (!hidden) kept.push({ x: p.x, y: p.y });
      }
    };
    labelPositionRef.current = position;
    position();
  }, [labelCandidates, mapReady]);

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

      {/* HTML overlay labels. Browser-rendered text is dramatically
          sharper than deck.gl SDF at any scale. Pills carry data-lng /
          data-lat; the positioning routine projects and moves them by
          direct DOM writes on every map move, and the camera effect
          fades the whole layer during entry flights. */}
      <div ref={labelWrapRef} className="pointer-events-none absolute inset-0 z-[15]">
        {labelCandidates.map((label) => (
          <div
            key={label.key}
            data-lng={label.anchor[0]}
            data-lat={label.anchor[1]}
            data-rec-label={label.text}
            data-rec-color={label.color}
            data-rec-lift={label.kind === 'unit' ? 26 : 14}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              visibility: 'hidden',
              willChange: 'transform',
            }}
          >
            <div
              style={{
                transform: `translate(-50%, calc(-100% - ${label.kind === 'unit' ? 26 : 14}px))`,
              }}
            >
              <div
                className="px-3 py-1 rounded-md text-[12px] uppercase font-semibold text-white whitespace-nowrap"
                style={{
                  background: 'rgba(14,10,7,0.88)',
                  border: `1px solid ${label.color}`,
                  boxShadow: `0 4px 14px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.5), 0 0 12px ${label.color}55`,
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  letterSpacing: '0.14em',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                }}
              >
                {label.text}
              </div>
              {/* Leader line down to the position */}
              <div
                className="mx-auto"
                style={{
                  width: 1.5,
                  height: label.kind === 'unit' ? 16 : 6,
                  background: `linear-gradient(to bottom, ${label.color}cc, transparent)`,
                  boxShadow: `0 0 4px ${label.color}99`,
                }}
              />
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
        Esri . USGS . OpenStreetMap . MapLibre
      </div>
    </div>
  );
}
