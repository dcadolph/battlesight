import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

import type { Battle } from '../../types/battle';
import type { Phase, Replay, Faction, ControlRegion } from '../../types/replay';
import { FACTION_COLOR } from '../../types/replay';
import { HI_RES_EARTH, TOPOLOGY_BUMP, NIGHT_SKY } from '../../data/cities';
import { themeForEra } from '../../theme/era';
import { playImpact } from '../../audio/sound';

interface GlobeReplayProps {
  battle: Battle;
  replay: Replay;
  phase: Phase;
  phaseIdx: number;
}

// Default geographic extent in degrees per 100 units of normalized 0-100 phase
// space. 3° is about 330 km wide, a campaign / operational scale wide enough
// that arrows traverse visible geography.
const DEFAULT_EXTENT_DEG = 3.0;

const COUNTRIES_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

// projectToLatLng converts a 0-100 (x, y) coordinate from the phase's local
// frame to (lat, lng) centered at the battle's location. y is inverted (0 is
// "north" on the map, higher latitude).
function projectToLatLng(
  x: number,
  y: number,
  centerLat: number,
  centerLng: number,
  aspectRatio: number,
  extentLatDeg: number,
  extentLngDeg: number,
): [number, number] {
  const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
  const lngHalf = extentLngDeg / 2 / cosLat;
  const latHalf = (extentLatDeg / 2) / Math.max(aspectRatio, 0.5);
  const lat = centerLat + (50 - y) / 50 * latHalf;
  const lng = centerLng + (x - 50) / 50 * lngHalf;
  return [lat, lng];
}

// geoOrProject returns geographic coordinates for a phase point. When (lat,
// lng) are set on the source, they win directly. Hand-curated phases pin
// arrows to real geography. Otherwise the normalized x/y is projected around
// the battle center using the replay's extent.
function geoOrProject(
  x: number,
  y: number,
  lat: number | undefined,
  lng: number | undefined,
  centerLat: number,
  centerLng: number,
  aspectRatio: number,
  extentLatDeg: number,
  extentLngDeg: number,
): [number, number] {
  if (typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0)) {
    return [lat, lng];
  }
  return projectToLatLng(x, y, centerLat, centerLng, aspectRatio, extentLatDeg, extentLngDeg);
}

function pointInPolygon(lat: number, lng: number, coords: Position[][]): boolean {
  for (const ring of coords) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

function findCountry(lat: number, lng: number, countries: Feature<Geometry>[]): Feature<Geometry> | null {
  for (const c of countries) {
    const geom = c.geometry;
    if (geom.type === 'Polygon') {
      if (pointInPolygon(lat, lng, geom.coordinates)) return c;
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (pointInPolygon(lat, lng, poly)) return c;
      }
    }
  }
  return null;
}

interface MovementGeo {
  index: number;
  faction: Faction;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  kind?: string;
  label?: string;
}

interface UnitGeo {
  index: number;
  faction: Faction;
  lat: number;
  lng: number;
  strength: number;
  unitType?: string;
  status?: string;
  label: string;
}

interface ProjectedArrow {
  index: number;
  faction: Faction;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  visible: boolean;
  kind?: string;
  label?: string;
}

interface ProjectedUnit {
  index: number;
  faction: Faction;
  x: number;
  y: number;
  radius: number;
  unitType?: string;
  status?: string;
  label: string;
  visible: boolean;
}

interface PolygonDatum {
  feature: Feature<Geometry>;
  capColor: string;
  strokeColor: string;
  sideColor: string;
  altitude: number;
}

export default function GlobeReplay({ battle, replay, phase, phaseIdx }: GlobeReplayProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [countries, setCountries] = useState<Feature<Geometry>[]>([]);
  const [arrows, setArrows] = useState<ProjectedArrow[]>([]);
  const [units, setUnits] = useState<ProjectedUnit[]>([]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setDims({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((topo: Topology) => {
        const fc = feature(topo, topo.objects.countries) as FeatureCollection;
        setCountries(fc.features);
      })
      .catch(() => {});
  }, []);

  const highlightedCountry = useMemo(() => {
    if (countries.length === 0) return [];
    const match = findCountry(battle.lat, battle.lng, countries);
    return match ? [match] : [];
  }, [battle.lat, battle.lng, countries]);

  const extentLngDeg = (replay.extentLngDeg ?? DEFAULT_EXTENT_DEG) * (replay.aspectRatio ?? 1.6);
  const extentLatDeg = replay.extentLatDeg ?? DEFAULT_EXTENT_DEG;

  // Resolve the effective camera target for this phase. cameraLat/cameraLng
  // default to the battle location; cameraAltitude defaults to a comfortable
  // operational view derived from the replay's extent.
  const defaultAltitude = Math.max(0.18, Math.min(0.7, extentLngDeg / 8));
  const cameraLat = phase.cameraLat ?? battle.lat;
  const cameraLng = phase.cameraLng ?? battle.lng;
  const cameraAlt = phase.cameraAltitude ?? defaultAltitude;
  const tweenMs = phase.cameraTweenMs ?? 1400;

  // Movement centroid: average destination of this phase's arrows. The camera
  // drifts toward it after the main flythrough lands, so the framing visibly
  // leans into the direction of action rather than staring at the geometric
  // center the whole time.
  const movementCentroid = useMemo(() => {
    const ms = phase.movements ?? [];
    if (ms.length === 0) return null;
    let latSum = 0, lngSum = 0, n = 0;
    for (const m of ms) {
      const [endLat, endLng] = geoOrProject(
        m.toX, m.toY, m.toLat, m.toLng,
        battle.lat, battle.lng,
        replay.aspectRatio ?? 1.6, extentLatDeg, extentLngDeg,
      );
      latSum += endLat;
      lngSum += endLng;
      n++;
    }
    if (n === 0) return null;
    return { lat: latSum / n, lng: lngSum / n };
  }, [phase, battle.lat, battle.lng, extentLatDeg, extentLngDeg, replay.aspectRatio]);

  // Camera choreography per phase:
  //   1. Cut to the curated phase target on a long ease (the establishing shot).
  //   2. After it lands, drift the framing toward the action centroid and
  //      push in slightly so the climax feels closer than the setup.
  //   3. Run a near-imperceptible auto-rotate during the hold so the globe
  //      never freezes between phases. That tiny drift is what reads as
  //      "alive" versus "screenshot."
  useEffect(() => {
    if (!globeRef.current) return;
    const globe = globeRef.current;
    const controls = globe.controls();
    controls.autoRotate = false;

    globe.pointOfView(
      { lat: cameraLat, lng: cameraLng, altitude: cameraAlt },
      tweenMs,
    );

    const driftTimer = setTimeout(() => {
      if (!globeRef.current) return;
      const targetLat = movementCentroid
        ? cameraLat + (movementCentroid.lat - cameraLat) * 0.4
        : cameraLat;
      const targetLng = movementCentroid
        ? cameraLng + (movementCentroid.lng - cameraLng) * 0.4
        : cameraLng;
      const tighter = Math.max(0.08, cameraAlt * 0.85);
      globeRef.current.pointOfView(
        { lat: targetLat, lng: targetLng, altitude: tighter },
        2400,
      );
    }, tweenMs);

    const breatheTimer = setTimeout(() => {
      const c = globeRef.current?.controls();
      if (!c) return;
      c.autoRotate = true;
      c.autoRotateSpeed = 0.05;
    }, tweenMs + 800);

    return () => {
      clearTimeout(driftTimer);
      clearTimeout(breatheTimer);
      const c = globeRef.current?.controls();
      if (c) c.autoRotate = false;
    };
  }, [cameraLat, cameraLng, cameraAlt, tweenMs, movementCentroid]);

  // Pre-compute lat/lng for each movement. Geographic coordinates take
  // precedence; normalized x/y is the fallback for legacy / auto-generated
  // phases.
  const movementGeo: MovementGeo[] = useMemo(() => {
    const out: MovementGeo[] = [];
    (phase.movements ?? []).forEach((m, i) => {
      const [startLat, startLng] = geoOrProject(
        m.fromX, m.fromY, m.fromLat, m.fromLng,
        battle.lat, battle.lng,
        replay.aspectRatio ?? 1.6, extentLatDeg, extentLngDeg,
      );
      const [endLat, endLng] = geoOrProject(
        m.toX, m.toY, m.toLat, m.toLng,
        battle.lat, battle.lng,
        replay.aspectRatio ?? 1.6, extentLatDeg, extentLngDeg,
      );
      out.push({
        index: i,
        faction: m.faction,
        startLat, startLng, endLat, endLng,
        kind: m.kind,
        label: m.label,
      });
    });
    return out;
  }, [phase, battle.lat, battle.lng, extentLatDeg, extentLngDeg, replay.aspectRatio]);

  // Defender units: every unit in the phase that isn't the explicit source of
  // a movement. Source-of-arrow units are visually represented by the arrow
  // itself, so we don't double up. Anyone holding ground gets a marker.
  const defenderGeo: UnitGeo[] = useMemo(() => {
    const sourceKeys = new Set<string>();
    (phase.movements ?? []).forEach((m) => {
      sourceKeys.add(`${m.fromX.toFixed(1)}|${m.fromY.toFixed(1)}`);
      if (typeof m.fromLat === 'number' && typeof m.fromLng === 'number') {
        sourceKeys.add(`${m.fromLat.toFixed(3)}|${m.fromLng.toFixed(3)}`);
      }
    });
    const out: UnitGeo[] = [];
    (phase.units ?? []).forEach((u, i) => {
      const xyKey = `${u.x.toFixed(1)}|${u.y.toFixed(1)}`;
      const llKey = `${(u.lat ?? 0).toFixed(3)}|${(u.lng ?? 0).toFixed(3)}`;
      if (sourceKeys.has(xyKey) || sourceKeys.has(llKey)) return;
      const [lat, lng] = geoOrProject(
        u.x, u.y, u.lat, u.lng,
        battle.lat, battle.lng,
        replay.aspectRatio ?? 1.6, extentLatDeg, extentLngDeg,
      );
      out.push({
        index: i,
        faction: u.faction,
        lat, lng,
        strength: u.strength ?? 5,
        unitType: u.unitType,
        status: u.status,
        label: u.label,
      });
    });
    return out;
  }, [phase, battle.lat, battle.lng, extentLatDeg, extentLngDeg, replay.aspectRatio]);

  // Polygons rendered on the globe: the host country (faint outline for
  // anchoring) plus per-phase control regions (tinted by controlling faction
  // for the "territory flips" effect). All bundled into one polygonsData
  // array so the engine renders them in a single pass.
  const polygonData: PolygonDatum[] = useMemo(() => {
    const out: PolygonDatum[] = [];
    if (highlightedCountry.length) {
      out.push({
        feature: highlightedCountry[0],
        capColor: 'rgba(59,130,246,0.04)',
        strokeColor: 'rgba(147,197,253,0.55)',
        sideColor: 'rgba(59,130,246,0.08)',
        altitude: 0.003,
      });
    }
    (phase.controlRegions ?? []).forEach((r: ControlRegion) => {
      const color = FACTION_COLOR[r.controller] ?? '#94a3b8';
      const closed = r.ring.length > 0 && (
        r.ring[0][0] !== r.ring[r.ring.length - 1][0] ||
        r.ring[0][1] !== r.ring[r.ring.length - 1][1]
      ) ? [...r.ring, r.ring[0]] : r.ring;
      out.push({
        feature: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [closed] },
          properties: { id: r.id, label: r.label ?? '' },
        },
        capColor: hexWithAlpha(color, 0.16),
        strokeColor: hexWithAlpha(color, 0.55),
        sideColor: hexWithAlpha(color, 0.12),
        altitude: 0.006,
      });
    });
    return out;
  }, [highlightedCountry, phase.controlRegions]);

  // RAF loop projects all phase geometry onto screen pixels. Updates every
  // frame so the SVG overlay tracks camera fly-ins and any user drag without
  // visible lag.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const globe = globeRef.current;
      if (globe && typeof globe.getScreenCoords === 'function') {
        const nextArrows: ProjectedArrow[] = movementGeo.map((m) => {
          const start = globe.getScreenCoords(m.startLat, m.startLng, 0) as { x: number; y: number } | null;
          const end = globe.getScreenCoords(m.endLat, m.endLng, 0) as { x: number; y: number } | null;
          const sOk = !!start && Number.isFinite(start.x) && Number.isFinite(start.y);
          const eOk = !!end && Number.isFinite(end.x) && Number.isFinite(end.y);
          return {
            index: m.index,
            faction: m.faction,
            x1: sOk ? start!.x : 0,
            y1: sOk ? start!.y : 0,
            x2: eOk ? end!.x : 0,
            y2: eOk ? end!.y : 0,
            visible: sOk && eOk,
            kind: m.kind,
            label: m.label,
          };
        });
        setArrows(nextArrows);

        const nextUnits: ProjectedUnit[] = defenderGeo.map((u) => {
          const p = globe.getScreenCoords(u.lat, u.lng, 0) as { x: number; y: number } | null;
          const ok = !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
          return {
            index: u.index,
            faction: u.faction,
            x: ok ? p!.x : 0,
            y: ok ? p!.y : 0,
            radius: 6 + Math.min(8, u.strength * 0.6),
            unitType: u.unitType,
            status: u.status,
            label: u.label,
            visible: ok,
          };
        });
        setUnits(nextUnits);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [movementGeo, defenderGeo]);

  return (
    <div ref={wrapRef} className="w-full h-full relative">
      <Globe
        ref={globeRef as React.MutableRefObject<GlobeMethods | undefined>}
        width={dims.width}
        height={dims.height}
        globeImageUrl={HI_RES_EARTH}
        bumpImageUrl={TOPOLOGY_BUMP}
        backgroundImageUrl={NIGHT_SKY}
        atmosphereColor={themeForEra(battle.era).atmosphere}
        atmosphereAltitude={0.16}
        polygonsData={polygonData}
        polygonCapColor={(d: object) => (d as PolygonDatum).capColor}
        polygonSideColor={(d: object) => (d as PolygonDatum).sideColor}
        polygonStrokeColor={(d: object) => (d as PolygonDatum).strokeColor}
        polygonAltitude={(d: object) => (d as PolygonDatum).altitude}
        polygonsTransitionDuration={900}
      />
      <svg
        className="absolute inset-0 pointer-events-none"
        width={dims.width}
        height={dims.height}
        viewBox={`0 0 ${dims.width} ${dims.height}`}
      >
        <defs>
          {(['a', 'b', 'c'] as Faction[]).map((f) => (
            <marker
              key={`${phaseIdx}-${f}`}
              id={`gr-arrow-${phaseIdx}-${f}`}
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 12 6 L 0 12 z" fill={FACTION_COLOR[f]} />
            </marker>
          ))}
        </defs>
        {/* Defender units render under the arrows so an incoming arrow visibly
            terminates at the defender's position rather than vice versa. */}
        {units.filter((u) => u.visible).map((u) => (
          <UnitMarker key={`unit-${phaseIdx}-${u.index}`} unit={u} phaseIdx={phaseIdx} />
        ))}
        {arrows.filter((a) => a.visible).map((a) => (
          <ArrowVector
            key={`arrow-${phaseIdx}-${a.index}`}
            phaseIdx={phaseIdx}
            arrow={a}
          />
        ))}
        {/* Impact flashes triggered shortly after each arrow appears. A
            burst of color at the destination signals "force has arrived." */}
        {arrows.filter((a) => a.visible).map((a) => (
          <ImpactFlash
            key={`flash-${phaseIdx}-${a.index}`}
            x={a.x2}
            y={a.y2}
            color={FACTION_COLOR[a.faction]}
            delay={a.index * 280 + 500}
          />
        ))}
      </svg>
    </div>
  );
}

// hexWithAlpha converts "#rrggbb" to "rgba(r,g,b,a)". Pass-through for already
// non-hex inputs; safe to call without checking color format.
function hexWithAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

interface ArrowVectorProps {
  phaseIdx: number;
  arrow: ProjectedArrow;
}

// ArrowVector renders one phase movement as a curved SVG path. Three stacked
// layers, all on the same geometry:
//   1. Soft blurred glow under the line.
//   2. Trace-in stroke: a solid line that "draws" from start to destination
//      over ~1.1s using pathLength=1 with stroke-dashoffset interpolation.
//      This reads as the force actively moving toward the objective. Replaces
//      the old simple fade-in.
//   3. Marching dashes that fade in after the trace lands and loop forever
//      so the arrow keeps reading as a live movement.
// Charges and flanks trace faster, retreats slower. Curve amount and stroke
// width are kind-dependent so the type of movement is legible at a glance.
function ArrowVector({ phaseIdx, arrow }: ArrowVectorProps) {
  const { x1, y1, x2, y2, faction, kind, index } = arrow;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const curveAmount = Math.min(len * 0.18, 50);
  const sign = index % 2 === 0 ? 1 : -1;
  const perpX = (-dy / len) * curveAmount * sign;
  const perpY = (dx / len) * curveAmount * sign;
  const cpX = midX + perpX;
  const cpY = midY + perpY;

  let stroke = 2.8;
  if (kind === 'charge') stroke = 4.4;
  else if (kind === 'flank') stroke = 3.4;
  else if (kind === 'rout' || kind === 'retreat' || kind === 'withdrawal') stroke = 2.0;

  const color = FACTION_COLOR[faction];
  const markerId = `gr-arrow-${phaseIdx}-${faction}`;
  const path = `M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}`;

  const dashLen = Math.max(10, stroke * 5);
  const gapLen = Math.max(6, stroke * 3);
  const period = dashLen + gapLen;
  const marchSpeed = kind === 'charge' ? 700 : kind === 'flank' ? 850 : kind === 'rout' || kind === 'retreat' || kind === 'withdrawal' ? 1500 : 1100;
  // Trace duration scales with movement type: charges snap in fast, retreats
  // are slower so the eye reads them as withdrawal.
  const traceMs = kind === 'charge' ? 700 : kind === 'flank' ? 950 : kind === 'rout' || kind === 'retreat' || kind === 'withdrawal' ? 1500 : 1100;
  const appearDelay = index * 240;
  // Marching dashes appear right as the trace completes (10% overlap for a
  // seamless handoff). The arrowhead lives on the marching layer so it shows
  // up at the same time the dashes do, which is right when the trace lands.
  const marchDelay = appearDelay + traceMs - 100;

  return (
    <g>
      {/* Glow underlay. Fades in alongside the trace so the destination
          doesn't suddenly brighten when the marching dashes appear. */}
      <path
        d={path}
        stroke={color}
        strokeOpacity={0}
        strokeWidth={stroke + 5}
        fill="none"
        strokeLinecap="round"
        style={{
          filter: 'blur(4px)',
          animation: `arrow-glow-in 700ms ${appearDelay}ms ease-out forwards`,
        }}
      />
      {/* Trace-in line. pathLength=1 lets stroke-dashoffset move from 1 to 0
          regardless of the actual path length. Fades out as the marching
          layer takes over to avoid double-bright stroke during the handoff. */}
      <path
        d={path}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        pathLength={1}
        style={{
          strokeDasharray: '1 1',
          strokeDashoffset: 1,
          animation: `arrow-trace ${traceMs}ms ${appearDelay}ms cubic-bezier(.25,.65,.25,1) forwards, arrow-trace-fade 240ms ${marchDelay + 100}ms ease-out forwards`,
        }}
      />
      {/* Marching layer. Hidden until the trace finishes, then loops forever.
          The arrowhead is attached here so it appears only after the line
          has actually arrived. */}
      <path
        d={path}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
        style={{
          opacity: 0,
          strokeDasharray: `${dashLen} ${gapLen}`,
          ['--march' as string]: `${-period}px`,
          animation: `arrow-march-in 220ms ${marchDelay}ms ease-out forwards, march ${marchSpeed}ms ${marchDelay}ms linear infinite`,
        }}
      />
    </g>
  );
}

interface UnitMarkerProps {
  phaseIdx: number;
  unit: ProjectedUnit;
}

// UnitMarker renders a static defender / position marker at a unit's
// projected screen position. The marker is a faction-colored disk with a
// pale rim and a unit-type glyph in the center. Pop-in uses a slight
// overshoot bezier so each unit lands with weight, not a flat fade.
function UnitMarker({ unit }: UnitMarkerProps) {
  const { x, y, faction, radius, unitType, status, index, label } = unit;
  const color = FACTION_COLOR[faction];
  const isBroken = status === 'broken' || status === 'routed' || status === 'destroyed';
  const fill = isBroken ? hexWithAlpha(color, 0.35) : hexWithAlpha(color, 0.75);
  const stroke = isBroken ? hexWithAlpha(color, 0.55) : '#f8fafc';
  const appearDelay = index * 80;
  const titleText = status ? `${label} (${status})` : label;

  return (
    <g
      transform={`translate(${x} ${y})`}
      style={{
        opacity: 0,
        transformBox: 'fill-box',
        transformOrigin: 'center',
        // unit-pop-in: scale from 0.4 with an overshoot, then settle. The
        // cubic-bezier overshoots ~1.15 around 65% then eases back to 1.0.
        animation: `unit-pop-in 520ms ${appearDelay}ms cubic-bezier(.34,1.56,.4,1) forwards`,
        pointerEvents: 'auto',
      }}
    >
      <title>{titleText}</title>
      {/* Soft halo, scaled separately so it breathes slightly larger than
          the disk for that "this is a live force" feel. */}
      <circle
        r={radius + 3}
        fill={hexWithAlpha(color, 0.22)}
        style={{
          filter: 'blur(3px)',
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `unit-halo-breath 3200ms ${appearDelay + 600}ms ease-in-out infinite`,
        }}
      />
      <circle r={radius} fill={fill} stroke={stroke} strokeWidth={1.4} />
      <UnitGlyph radius={radius} unitType={unitType} />
      {isBroken && (
        <line
          x1={-radius * 0.8}
          y1={-radius * 0.8}
          x2={radius * 0.8}
          y2={radius * 0.8}
          stroke="#f8fafc"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

// UnitGlyph draws a tiny NATO-style symbol inside a unit marker. Centered at
// the parent group's origin and sized relative to the marker radius.
function UnitGlyph({ radius, unitType }: { radius: number; unitType?: string }) {
  const r = radius * 0.55;
  const stroke = '#f8fafc';
  const sw = 1.4;
  switch (unitType) {
    case 'infantry':
      return (
        <>
          <line x1={-r} y1={-r} x2={r} y2={r} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <line x1={-r} y1={r} x2={r} y2={-r} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </>
      );
    case 'cavalry':
      return <line x1={-r} y1={r} x2={r} y2={-r} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />;
    case 'armor':
      return <ellipse cx={0} cy={0} rx={r} ry={r * 0.55} fill="none" stroke={stroke} strokeWidth={sw} />;
    case 'artillery':
      return <circle r={r * 0.35} fill={stroke} />;
    case 'aircraft':
      return (
        <>
          <line x1={-r} y1={0} x2={r} y2={0} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <line x1={0} y1={-r * 0.6} x2={0} y2={r * 0.6} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </>
      );
    case 'ships':
      return <path d={`M ${-r} 0 L ${r} 0 M 0 ${-r * 0.6} L 0 ${r * 0.6}`} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />;
    case 'command':
      return (
        <path
          d={`M 0 ${-r} L ${r * 0.3} ${-r * 0.3} L ${r} 0 L ${r * 0.3} ${r * 0.3} L 0 ${r} L ${-r * 0.3} ${r * 0.3} L ${-r} 0 L ${-r * 0.3} ${-r * 0.3} Z`}
          fill={stroke}
          opacity={0.85}
        />
      );
    case 'archers':
      return <path d={`M ${-r} ${r * 0.6} Q 0 ${-r} ${r} ${r * 0.6}`} fill="none" stroke={stroke} strokeWidth={sw} />;
    default:
      return null;
  }
}

interface ImpactFlashProps {
  x: number;
  y: number;
  color: string;
  delay: number;
}

// ImpactFlash renders a single expanding ring + bright core at (x, y), keyed
// so it plays once per phase per arrow. It signals "the arrow has arrived"
// in the same way a hit-effect telegraphs contact in a real-time map. The
// associated low-frequency thump is scheduled in lockstep with the visual.
function ImpactFlash({ x, y, color, delay }: ImpactFlashProps) {
  useEffect(() => {
    const id = setTimeout(() => playImpact(), delay);
    return () => clearTimeout(id);
  }, [delay]);
  return (
    <g transform={`translate(${x} ${y})`} style={{ pointerEvents: 'none' }}>
      <circle
        r={6}
        fill={color}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-core 900ms ${delay}ms cubic-bezier(.25,.7,.25,1) forwards`,
        }}
      />
      <circle
        r={6}
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-ring 1100ms ${delay}ms cubic-bezier(.2,.6,.25,1) forwards`,
        }}
      />
      <circle
        r={6}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeOpacity={0.55}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-ring 1500ms ${delay + 200}ms cubic-bezier(.2,.6,.25,1) forwards`,
        }}
      />
    </g>
  );
}
