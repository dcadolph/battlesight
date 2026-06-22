// TacticalSurface — phase-replay renderer on top of MapLibre GL (base
// map: satellite + 3D terrain) and deck.gl via MapboxOverlay (units,
// movements, territory, labels). Same Replay/Phase schema as the legacy
// GlobeReplay; richer rendering.
//
// What this stack delivers that the globe could not:
//   - Real satellite imagery at any zoom (Esri / Mapbox), with 3D terrain
//     so cliffs and ridges read as relief.
//   - GPU-accelerated TripsLayer arrows that draw themselves along the
//     line of advance, with a low-alpha base arc that persists.
//   - NATO-style unit icons via a baked sprite atlas so the symbols are
//     instantly recognisable and stay crisp at every zoom.
//   - Per-phase controlRegions + war-cinematic country shading so the
//     viewer always sees who controls what.
//   - Smooth flyTo with pitch + bearing that respects per-phase camera
//     choreography.
//
// No tokens. No signups. All sources CORS-open.

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  IconLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
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
// its kind. Charges punch fast, retreats drift slowly, amphibious and
// airdrops cover distance so they get a longer run. Index staggers each
// arrow so the sequence reads as choreography, not a swarm.
function tripTiming(kind: string | undefined, index: number): { begin: number; duration: number } {
  const begin = index * 240;
  let duration = 2200;
  if (kind === 'charge' || kind === 'cavalry-charge') duration = 1500;
  else if (kind === 'flank' || kind === 'envelopment' || kind === 'pincer') duration = 1900;
  else if (kind === 'amphibious' || kind === 'airdrop' || kind === 'air-strike') duration = 2800;
  else if (kind === 'rout' || kind === 'retreat' || kind === 'withdrawal') duration = 2600;
  else if (kind === 'siege' || kind === 'breakout') duration = 2400;
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
// globe) to a sensible Mapbox zoom level. Tactical (0.06) → 11, operational
// (0.55) → 7, strategic (1.5) → 5.
function altitudeToZoom(altitude: number): number {
  return Math.max(4, Math.min(14, 12 - Math.log2(altitude * 6 + 1) * 1.9));
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

// Cartographic-atlas MapLibre style. No keys, no signups, CORS-open.
// The base raster is Esri's World Shaded Relief — pure grayscale relief
// with no roads, no labels, no satellite noise. We tint it with a paper
// background and let the action layer (arrows, units, territory) own the
// colour budget. This is the "documentary atlas" look: think Beevor's
// "Stalingrad" plates or Ambrose's "Band of Brothers" maps, not Google
// Maps with arrows. AWS Terrarium DEM keeps the 3D terrain extrusion so
// cliffs at Pointe du Hoc and the Mt Agrieliki ridge still read as relief.
const OPEN_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    // Carto dark_nolabels. Same documentary register as Esri Dark
    // Gray but on a HTTP/2 multi-host CDN — cold start is ~5× faster
    // because requests parallelise across {a,b,c,d} subdomains and
    // tiles are gzipped PNG8s. Esri's ArcGIS server serves serially
    // and was the root cause of the "load is insanely slow" feel.
    // Visual register: clean dark base, restrained relief, no baked
    // labels. Action layer pops because the basemap stays quiet.
    'dark-canvas': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: '(c) OpenStreetMap (c) CARTO',
    },
    // Hillshade DEM for terrain relief at tactical zooms. RGB-
    // encoded elevation, free, CORS-open.
    'terrain-dem': {
      type: 'raster-dem',
      tiles: [
        'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: 15,
      attribution: 'Terrain (c) Mapzen / AWS Open Data',
    },
  },
  layers: [
    // Warm matte. Slate-blue was the source of the "everything looks
    // blue" complaint — sat under every translucent layer and bled
    // through. Warm dark coffee reads as film matte, neutral under the
    // faction palette.
    {
      id: 'matte',
      type: 'background',
      paint: { 'background-color': '#0d0a08' },
    },
    {
      id: 'dark-canvas',
      type: 'raster',
      source: 'dark-canvas',
      minzoom: 0,
      maxzoom: 19,
      paint: {
        // Carto dark_nolabels has a cool gray-blue undertone. Drag
        // saturation down so it reads as neutral grayscale relief
        // rather than a blue tinted basemap. Brightness slightly
        // lifted so the faction shading reads against it without
        // washing out cliffs/coastlines.
        'raster-saturation': -0.7,
        'raster-brightness-max': 0.78,
        'raster-contrast': 0.08,
      },
    },
    // Hillshade overlay. Warm accent + warm highlight strips the
    // blue-slate cast off Terrarium DEM's RGB-encoded relief.
    // Exaggeration moderate so ridges read without overpowering
    // the action layer.
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrain-dem',
      paint: {
        'hillshade-shadow-color': '#0a0806',
        'hillshade-highlight-color': '#e7e0d2',
        'hillshade-accent-color': '#1a1612',
        'hillshade-exaggeration': 0.48,
        'hillshade-illumination-direction': 335,
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
  // mapInstance mirrors mapRef.current into React state so the HTML
  // overlay labels can re-project on every render without violating
  // the react-hooks/refs rule against reading refs during render.
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  // currentTime drives TripsLayer animation. Increments via RAF when
  // playing, halts on pause / ended / reduced-motion, scales with speed.
  // Resets on phase change so trips re-fire from the start.
  const [currentTime, setCurrentTime] = useState(0);
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
  // currentZoom tracks the live MapLibre zoom so the territory layers
  // can scale their alpha (memory: bright political fill floods the
  // frame tight; dim it as we zoom in).
  const [currentZoom, setCurrentZoom] = useState<number>(7);
  // mapMoveTick increments on every MapLibre move/zoom event so the
  // HTML overlay labels can re-project their lng/lat to screen pixels
  // and follow the camera in real time. Empty for the brief moment
  // before the map mounts; then bumps ~60Hz during flyTo.
  const [mapMoveTick, setMapMoveTick] = useState(0);

  const extentLatDeg = replay.extentLatDeg ?? 3;
  const extentLngDeg = (replay.extentLngDeg ?? 3) * (replay.aspectRatio ?? 1.6);

  const cameraLat = phase.cameraLat ?? battle.lat ?? 49.34;
  const cameraLng = phase.cameraLng ?? battle.lng ?? -0.51;
  const altitude = phase.cameraAltitude ?? 0.4;
  const cameraZoom = altitudeToZoom(altitude);
  // Documentary maps live mostly top-down. 3D tilt was adding visual
  // chaos at tactical zoom (labels tilted, symbols sheared, terrain
  // bumpy enough to obscure focal arrows). A small pitch only for
  // wider strategic phases where relief reads, otherwise flat.
  const cameraPitch = altitude > 0.5 ? 18 : 0;
  const cameraBearing = 0;

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
      bearing: cameraBearing,
      attributionControl: false,
      maxPitch: 45,
    });
    mapRef.current = map;
    setMapInstance(map);

    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay as unknown as maplibregl.IControl);

    map.on('style.load', () => {
      setMapReady(true);
      setCurrentZoom(map.getZoom());
    });
    map.on('zoom', () => setCurrentZoom(map.getZoom()));
    // HTML label overlay needs to re-project on every camera change.
    // 'move' fires during pan AND flyTo each frame; 'zoom' covers
    // pinch / scroll zoom. Combined coverage so labels track the map.
    const bumpTick = () => setMapMoveTick((t) => (t + 1) % 1_000_000);
    map.on('move', bumpTick);
    map.on('zoom', bumpTick);
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
      setMapInstance(null);
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

  // Phase animation clock. RAF only ticks while playing AND not ended AND
  // not reduced-motion AND the map slate has faded. Gated on mapIdle
  // so cold-start tile fetches aren't stealing frames.
  //
  // Starts at a NEGATIVE offset equal to the camera tween so arrow
  // growth and impact flashes don't fire while the map is still
  // flying to position. The eye reads "camera arrives, then advance
  // begins" instead of "everything happens at once mid-pan", which
  // was the "clunky scene transition" complaint.
  useEffect(() => {
    if (prefersReducedMotion || ended) {
      // Jump to a generous post-animation frame so all trips are fully drawn.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentTime(1e7);
      return;
    }
    const camTween = phase.cameraTweenMs ?? 1800;
    setCurrentTime(-camTween);
    if (!playing || !mapIdle) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) * Math.max(0.1, speed);
      last = now;
      setCurrentTime((t) => t + dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phaseIdx, playing, speed, prefersReducedMotion, ended, mapIdle, phase.cameraTweenMs]);

  // Camera choreography on phase change. Snap (or reduced-motion) is an
  // instant jumpTo. Otherwise fly. When the curator has set explicit
  // camera coords (phase.cameraLat / cameraLng), use those — the
  // hand-authored framing usually has more intent than a fit. When the
  // curator hasn't set them, auto-fit to the action bbox: every unit
  // position + every movement endpoint, with edge padding. The
  // tactical surface no longer sits in the middle of a huge dark void
  // because the camera framed too wide.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const hasCurator = typeof phase.cameraLat === 'number' && typeof phase.cameraLng === 'number';
    const points: Array<[number, number]> = [];
    if (!hasCurator) {
      for (const u of phase.units ?? []) {
        const p = resolvePoint(u.x, u.y, u.lat, u.lng, battle.lat, battle.lng, extentLatDeg, extentLngDeg);
        if (p) points.push(p);
      }
      for (const m of phase.movements ?? []) {
        const from = resolvePoint(m.fromX, m.fromY, m.fromLat, m.fromLng, battle.lat, battle.lng, extentLatDeg, extentLngDeg);
        const to = resolvePoint(m.toX, m.toY, m.toLat, m.toLng, battle.lat, battle.lng, extentLatDeg, extentLngDeg);
        if (from) points.push(from);
        if (to) points.push(to);
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
      // Pad by 30% of the bbox span (or a minimum) so the action sits
      // off the labels in the corners and the unit icons don't bleed
      // into the frame edge.
      const dLng = Math.max((maxLng - minLng) * 0.3, 0.01);
      const dLat = Math.max((maxLat - minLat) * 0.3, 0.01);
      const bounds: [[number, number], [number, number]] = [
        [minLng - dLng, minLat - dLat],
        [maxLng + dLng, maxLat + dLat],
      ];
      const padding = { top: 140, bottom: 80, left: 80, right: 80 };
      if (prefersReducedMotion || phase.cameraMotion === 'snap') {
        map.fitBounds(bounds, { padding, animate: false, pitch: 0, bearing: 0 });
      } else {
        map.fitBounds(bounds, {
          padding,
          duration: phase.cameraTweenMs ?? 1800,
          essential: true,
          pitch: 0,
          bearing: 0,
          // Cinematic ease-out: fast accelerate, gentle arrival. The
          // previous default easeInOutCubic landed too abruptly and
          // read as a mechanical jump-cut on phase change.
          easing: (t: number) => 1 - Math.pow(1 - t, 3),
        });
      }
      return;
    }
    const target = {
      center: [cameraLng, cameraLat] as [number, number],
      zoom: cameraZoom,
      pitch: cameraPitch,
      bearing: cameraBearing,
    };
    if (prefersReducedMotion || phase.cameraMotion === 'snap') {
      map.jumpTo(target);
      return;
    }
    map.flyTo({
      ...target,
      duration: phase.cameraTweenMs ?? 2000,
      essential: true,
      // Slower curve + lower max speed for documentary feel: camera
      // takes a moment to leave, glides, then settles. Default 1.42
      // curve felt like a snap-zoom, which read as "clunky".
      curve: 1.6,
      speed: 0.9,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
    });
  }, [cameraLat, cameraLng, cameraZoom, cameraPitch, cameraBearing, phaseIdx, phase, battle.lat, battle.lng, extentLatDeg, extentLngDeg, prefersReducedMotion]);

  // Build the per-phase derived data. Resolves geographic coordinates
  // once so every layer below reads from the same source.
  const phaseData = useMemo(() => {
    const movements: Movement[] = phase.movements ?? [];
    const units: Unit[] = phase.units ?? [];

    const trips = movements
      .map((m, i) => {
        const from = resolvePoint(m.fromX, m.fromY, m.fromLat, m.fromLng, battle.lat, battle.lng, extentLatDeg, extentLngDeg);
        const to = resolvePoint(m.toX, m.toY, m.toLat, m.toLng, battle.lat, battle.lng, extentLatDeg, extentLngDeg);
        if (!from || !to) return null;
        const timing = tripTiming(m.kind, i);
        const color = factionColorFor(m.faction, replay);
        return {
          index: i,
          kind: m.kind,
          path: [from, to] as Array<[number, number]>,
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

    const unitPoints = units
      .map((u, i) => {
        const p = resolvePoint(u.x, u.y, u.lat, u.lng, battle.lat, battle.lng, extentLatDeg, extentLngDeg);
        if (!p) return null;
        const color = factionColorFor(u.faction, replay);
        // Hollywood-scale tokens. baseSize 100 means a single-battalion
        // icon renders at ~115px, a full division at ~135px. Pixel-space
        // caps below keep clusters from overpowering the frame.
        const baseSize = 100 + (u.strength ?? 3) * 12;
        return {
          index: i,
          position: p,
          color: hexToRgb(color, statusOpacity(u.status)),
          glowColor: hexToRgb(color, 95),
          shadowColor: [10, 8, 6, 200] as [number, number, number, number],
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
    const fillAlpha = currentZoom > 9 ? 30 : currentZoom > 6 ? 50 : 70;
    const lineAlpha = currentZoom > 9 ? 90 : 120;
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
  }, [phase.controlRegions, replay, currentZoom]);

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
    const fillAlpha = currentZoom > 10 ? 12 : currentZoom > 8 ? 28 : currentZoom > 6 ? 55 : 95;
    const lineAlpha = currentZoom > 10 ? 35 : currentZoom > 8 ? 70 : 120;
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
  }, [warCountryColors, countries, currentZoom]);

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

  // staticLayers holds everything that does NOT depend on the per-frame
  // currentTime clock: territory shading, faction banners, control
  // regions, units, status, all text labels. Rebuilds only when the
  // phase changes or the camera zoom crosses a tier (alpha thresholds).
  // This was the perf bottleneck the user flagged as "load times" — the
  // full 10+ layer stack was being reinstantiated 60 times a second.
  const staticLayers = useMemo(() => {
    const { unitPoints } = phaseData;
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

    // 3. Tight unit shadow + thin glow + icon. The previous shadow + halo
    //    radii were ballooning at higher zooms — multiple units at one
    //    position fused into the magenta blob the user flagged on Cannae.
    //    Slammed both down so the icon itself is the visual element and
    //    the halo is just a subtle aura, not a colored bubble.
    if (unitPoints.length > 0) {
      result.push(new ScatterplotLayer({
        id: `unit-shadows-${phaseIdx}`,
        data: unitPoints,
        getPosition: (d) => d.position,
        getFillColor: (d) => d.shadowColor,
        getRadius: (d) => d.size * 3.2,
        radiusUnits: 'meters',
        stroked: false,
        radiusMinPixels: 10,
        radiusMaxPixels: 32,
        parameters: { depthTest: false },
      }));
      result.push(new ScatterplotLayer({
        id: `unit-halos-${phaseIdx}`,
        data: unitPoints,
        getPosition: (d) => d.position,
        getFillColor: (d) => d.glowColor,
        getRadius: (d) => d.size * 5,
        radiusUnits: 'meters',
        stroked: false,
        radiusMinPixels: 14,
        radiusMaxPixels: 42,
        parameters: { depthTest: false },
      }));

      // 8. Unit icons. NATO-style symbol atlas, tinted by faction color
      //    via mask: true in the mapping. Pixel-space size caps keep
      //    units legible across zooms.
      if (unitAtlas.canvas) {
        result.push(new IconLayer({
          id: `unit-icons-${phaseIdx}`,
          data: unitPoints,
          iconAtlas: unitAtlas.canvas,
          iconMapping: unitAtlas.mapping,
          getIcon: (d) => d.iconName,
          getPosition: (d) => d.position,
          getColor: (d) => d.color,
          getSize: (d) => d.size,
          sizeUnits: 'pixels',
          sizeMinPixels: 52,
          sizeMaxPixels: 170,
          parameters: { depthTest: false },
        }));
      }

      // 9. Status overlays. Stamped on top of the unit icon: slash for
      //    destroyed, dashed ring for encircled, etc. Skip units whose
      //    status has no overlay glyph.
      if (statusAtlas.canvas) {
        const stamped = unitPoints.filter((u) => hasStatusOverlay(u.status as never));
        if (stamped.length > 0) {
          result.push(new IconLayer({
            id: `unit-status-${phaseIdx}`,
            data: stamped,
            iconAtlas: statusAtlas.canvas,
            iconMapping: statusAtlas.mapping,
            getIcon: (d) => d.status as string,
            getPosition: (d) => d.position,
            getColor: () => [255, 255, 255, 240],
            getSize: (d) => d.size * 1.06,
            sizeUnits: 'pixels',
            sizeMinPixels: 52,
            sizeMaxPixels: 170,
            parameters: { depthTest: false },
          }));
        }
      }

      // 10. Unit + movement labels are now rendered as HTML overlays
      //     (see <HTMLLabels> in JSX below) instead of SDF text. The
      //     SDF baker was the source of the "blurry names" complaint —
      //     browser-rendered text with proper antialiasing wins on
      //     sharpness at any pixel scale. The dedup grid still curates
      //     which labels show; just the rendering is HTML now.
    }

    // 12. Control-region labels (e.g. "3rd Reich", "Soviet sector"). One
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
  }, [phaseData, controlPolygons, countryPolygons, factionBanners, phaseIdx, unitAtlas, statusAtlas]);

  // animatedLayers holds the per-frame layers: the growing atlas arrow
  // polygon, the motion comet sweeping its spine, and the impact pulse
  // + secondary shockwave at the arrival point. These rebuild on every
  // RAF tick because they read currentTime. Everything that doesn't
  // need the clock lives in staticLayers above so we don't pay the
  // allocation cost 60 times a second.
  const animatedLayers = useMemo(() => {
    const { trips } = phaseData;
    if (trips.length === 0) return [];
    const result: unknown[] = [];

    // Build the in-progress polygon for each trip. While the trip is
    // animating, the arrow extends only from the tail to the comet
    // head (lerp(from, to, progress)) so the arrow LITERALLY grows
    // along the line of advance. Reads as a spearhead pushing forward.
    // Before the window starts: no polygon. After: full polygon.
    const arrowsLive = trips
      .map((t) => {
        const dur = Math.max(1, t.timestamps[1] - t.timestamps[0]);
        const raw = (currentTime - t.timestamps[0]) / dur;
        const progress = Math.max(0, Math.min(1, raw));
        if (currentTime < t.timestamps[0]) return null;
        const tip: [number, number] = currentTime >= t.timestamps[1]
          ? t.to
          : [
              t.from[0] + (t.to[0] - t.from[0]) * progress,
              t.from[1] + (t.to[1] - t.from[1]) * progress,
            ];
        return {
          ...t,
          progress,
          arrowPolygon: buildAtlasArrow(t.from, tip, t.kind, 1),
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    if (arrowsLive.length > 0) {
      // Classic Beevor/Ambrose treatment: two-tone solid arrow. Heavy
      // warm-black outline grounds the silhouette; saturated faction
      // fill reads as a single deliberate brushstroke. Previous halo
      // + inner-highlight layers were stacking nested arrowheads at
      // the tip and reading as a tangle. The Hollywood war-atlas
      // look is brutally minimal — outline + fill + nothing else.
      result.push(new PolygonLayer({
        id: `atlas-arrows-outline-${phaseIdx}`,
        data: arrowsLive,
        getPolygon: (d) => d.arrowPolygon,
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
        getPolygon: (d) => d.arrowPolygon,
        getFillColor: (d) => [d.color[0], d.color[1], d.color[2], d.fillAlpha],
        getLineColor: [0, 0, 0, 0],
        stroked: false,
        filled: true,
        pickable: false,
        parameters: { depthTest: false },
      }));
    }

    // Motion comet. Thin bright spine that sweeps the centreline
    // during the active window. Kept slim (3px) so it adds the
    // "advance happening now" cue without competing with the
    // growing arrow polygon for shape attention.
    result.push(new TripsLayer({
      id: `trips-comet-${phaseIdx}`,
      data: trips,
      getPath: (d) => d.path,
      getTimestamps: (d) => d.timestamps,
      getColor: (d) => [Math.min(255, d.color[0] + 120), Math.min(255, d.color[1] + 120), Math.min(255, d.color[2] + 120), 255],
      getWidth: 3,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      trailLength: 900,
      currentTime,
      fadeTrail: true,
    }));

    // Permanent terminus marker at every arrow tip whose trip has
    // already completed. The impact disc flashes and dies in 1.5s;
    // without this anchor the arrowhead reads as orphaned the moment
    // the flash fades. A small bright dot + dark halo at the tip
    // grounds the arrow in the geography for the rest of the phase.
    const terminusData = trips
      .filter((t) => currentTime >= t.impactAt)
      .map((t) => ({
        position: t.to,
        inner: [
          Math.min(255, t.color[0] + 60),
          Math.min(255, t.color[1] + 60),
          Math.min(255, t.color[2] + 60),
          255,
        ] as [number, number, number, number],
        ring: [t.color[0], t.color[1], t.color[2], 230] as [number, number, number, number],
      }));
    if (terminusData.length > 0) {
      result.push(new ScatterplotLayer({
        id: `terminus-ring-${phaseIdx}`,
        data: terminusData,
        getPosition: (d) => d.position,
        getFillColor: [0, 0, 0, 0],
        getLineColor: (d) => d.ring,
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
        getPosition: (d) => d.position,
        getFillColor: (d) => d.inner,
        getRadius: 4,
        radiusUnits: 'pixels',
        stroked: false,
        parameters: { depthTest: false },
      }));
    }

    // Impact disc. Bright filled flash that grows + fades as the
    // comet arrives. Anchor for the moment of contact.
    const impacts = trips.map((t) => {
      const since = currentTime - t.impactAt;
      const inWindow = since >= 0 && since < 1500;
      const k = inWindow ? since / 1500 : 1;
      const easeOut = 1 - Math.pow(1 - k, 3);
      return {
        position: t.to,
        color: [t.color[0], t.color[1], t.color[2], inWindow ? Math.round(245 * (1 - easeOut)) : 0] as [number, number, number, number],
        radius: inWindow ? 500 + 8000 * easeOut : 0,
      };
    }).filter((d) => d.radius > 0);
    if (impacts.length > 0) {
      result.push(new ScatterplotLayer({
        id: `impacts-${phaseIdx}`,
        data: impacts,
        getPosition: (d) => d.position,
        getFillColor: (d) => d.color,
        getRadius: (d) => d.radius,
        radiusUnits: 'meters',
        stroked: false,
        radiusMinPixels: 0,
        radiusMaxPixels: 100,
        parameters: { depthTest: false },
      }));
    }

    // Secondary shockwave ring. Thin stroked circle that races outward
    // faster than the disc, then fades. Two concentric rings give the
    // impact moment proper documentary weight rather than a single
    // pop. Faction-colored at high alpha so it reads through the
    // cartographic palette.
    const shockwaves = trips.flatMap((t) => {
      const since = currentTime - t.impactAt;
      if (since < 0 || since >= 1800) return [];
      const k = since / 1800;
      const easeOut = 1 - Math.pow(1 - k, 4);
      const alpha = Math.round(255 * (1 - k));
      return [{
        position: t.to,
        color: [t.color[0], t.color[1], t.color[2], alpha] as [number, number, number, number],
        radius: 200 + 14000 * easeOut,
      }];
    });
    if (shockwaves.length > 0) {
      result.push(new ScatterplotLayer({
        id: `shockwave-${phaseIdx}`,
        data: shockwaves,
        getPosition: (d) => d.position,
        getFillColor: [0, 0, 0, 0],
        getLineColor: (d) => d.color,
        getRadius: (d) => d.radius,
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
  }, [phaseData, currentTime, phaseIdx]);

  // Combine static + animated layers for the overlay. MapboxOverlay
  // diffs by layer ID, so the static ones reuse their cached GPU state
  // while only the animated ones re-allocate.
  const layers = useMemo(() => [...staticLayers, ...animatedLayers], [staticLayers, animatedLayers]);

  // Push the latest layer set into the overlay.
  useEffect(() => {
    if (!mapReady) return;
    overlayRef.current?.setProps({ layers });
  }, [layers, mapReady]);

  // Era theme picks the title font, accent hue, and vignette tint for
  // this battle. Drives every cinematic chrome piece below so an ancient
  // siege reads as parchment-and-quill while a Cold War standoff reads
  // as ostinato-and-steel.
  const theme = useMemo(() => themeForEra(battle.era), [battle.era]);

  // HTML overlay labels: deduped unit labels + top-4 movement labels,
  // each projected to screen pixels via map.project(). HTML text wins
  // on sharpness over deck.gl SDF — that "blurry names" complaint
  // dies here. Re-projects every map move/zoom via mapMoveTick. Empty
  // until the map is ready and a phase is loaded.
  const htmlLabels = useMemo(() => {
    const map = mapInstance;
    if (!map || !mapReady) return [];
    type Label = {
      key: string;
      x: number;
      y: number;
      text: string;
      color: string;
      kind: 'unit' | 'movement';
      priority: number;
    };
    const out: Label[] = [];

    // Unit labels — dedup by ~500m grid cell so dense beachheads /
    // urban scenes don't pile a wall of names on one position.
    const cellSize = currentZoom > 10 ? 0.0035 : currentZoom > 7 ? 0.012 : 0.04;
    const grid = new Map<string, typeof phaseData.unitPoints[number]>();
    for (const u of phaseData.unitPoints) {
      if (!u.label) continue;
      const key = `${Math.round(u.position[0] / cellSize)}|${Math.round(u.position[1] / cellSize)}`;
      const prior = grid.get(key);
      if (!prior || u.label.length > prior.label.length) grid.set(key, u);
    }
    for (const u of grid.values()) {
      const p = map.project(u.position);
      out.push({
        key: `unit-${u.index}`,
        x: p.x,
        y: p.y,
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
      const p = map.project(m.midpoint);
      out.push({
        key: `mov-${m.index}`,
        x: p.x,
        y: p.y,
        text: m.label,
        color: `rgb(${m.color[0]},${m.color[1]},${m.color[2]})`,
        kind: 'movement',
        priority: m.label.length,
      });
    }

    // Screen-space collision filter: drop any lower-priority label
    // whose pill (~140px wide × 28px tall) overlaps a higher-priority
    // one already kept. Sorted by priority desc so longer/named
    // formations win the conflict.
    out.sort((a, b) => b.priority - a.priority);
    const kept: Label[] = [];
    const PILL_W = 150;
    const PILL_H = 38;
    for (const l of out) {
      let collides = false;
      for (const k of kept) {
        if (Math.abs(l.x - k.x) < PILL_W && Math.abs(l.y - k.y) < PILL_H) {
          collides = true;
          break;
        }
      }
      if (!collides) kept.push(l);
    }
    return kept;
    // mapMoveTick listed so the projection re-runs on every camera
    // change; phaseData / phaseIdx for content changes. currentZoom
    // changes also bump mapMoveTick via the zoom listener so we don't
    // list it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseData, phaseIdx, mapMoveTick, mapReady, mapInstance]);

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

      {/* HTML overlay labels. Replaces deck.gl SDF text for unit and
          movement labels — browser-rendered text is dramatically sharper
          at any scale. Pill backgrounds with faction-colored border +
          leader line down to the geographic position. Re-projects on
          every map move via mapMoveTick. */}
      <div className="pointer-events-none absolute inset-0 z-[15]">
        {htmlLabels.map((label) => (
          <div
            key={label.key}
            style={{
              position: 'absolute',
              left: label.x,
              top: label.y,
              transform: `translate(-50%, calc(-100% - ${label.kind === 'unit' ? 48 : 14}px))`,
              willChange: 'transform',
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

      <div className="absolute bottom-2 right-2 z-10 px-2 py-0.5 rounded text-[9px] uppercase tracking-wider text-slate-300/60 pointer-events-none">
        NatGeo . Terrarium DEM . MapLibre
      </div>
    </div>
  );
}
