import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

import type { Battle } from '../../types/battle';
import type { Phase, Replay, Faction, ControlRegion, PaletteContext } from '../../types/replay';
import { factionColorFor } from '../../types/replay';
import { HI_RES_EARTH, TOPOLOGY_BUMP, NIGHT_SKY } from '../../data/cities';
import { themeForEra } from '../../theme/era';
import { playImpact } from '../../audio/sound';

interface GlobeReplayProps {
  battle: Battle;
  replay: Replay;
  phase: Phase;
  phaseIdx: number;
  // warCountryColors carries the war cinematic's current territory snapshot
  // down into the battle replay so the country-level shading stays visible
  // when the user is watching an individual battle inside a war playback.
  // Without it, opening a replay collapses the globe to just the highlighted
  // host country and the user loses the "Germany takes Europe" sweep.
  warCountryColors?: Record<string, string>;
}

// Default geographic extent in degrees per 100 units of normalized 0-100 phase
// space. 3° is about 330 km wide, a campaign / operational scale wide enough
// that arrows traverse visible geography.
const DEFAULT_EXTENT_DEG = 3.0;

const COUNTRIES_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';

// COUNTRY_NAME_ALIASES maps territory-snapshot country labels to the long
// names the world-atlas topology uses. Kept in sync with the equivalent
// table in BattleGlobe so the same warCountryColors prop produces the same
// shading on both globes.
const COUNTRY_NAME_ALIASES: Record<string, string[]> = {
  'United States': ['United States of America'],
  'United Kingdom': ['United Kingdom'],
  Korea: ['South Korea', 'North Korea'],
  Rome: ['Italy'],
  Palestine: ['Palestine'],
};

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

// arrowTiming returns the timing budget for a single movement at a given
// queue position. Centralized so the trace, the marching dashes, and the
// impact flash all share the same arithmetic. Without this, the flash drifts
// out of sync with the trace (a long retreat trace lands two seconds after
// its flash, or a snappy charge flashes before its line arrives).
function arrowTiming(kind: string | undefined, index: number): {
  appearDelay: number;
  traceMs: number;
  marchSpeed: number;
  // impactDelay is when the destination ring + thump should fire. Tuned to
  // hit just as the trace completes so the eye reads "force arrives → land."
  impactDelay: number;
} {
  const appearDelay = index * 280;
  // Sweep timings deliberately slower than they used to be so every arrow
  // reads as a flowing campaign movement rather than a quick diagram line.
  // Even charges get a meaningful arc; retreats are stretched longer so
  // the somber drift back has weight.
  const traceMs = kind === 'charge'
    ? 1100
    : kind === 'flank'
      ? 1400
      : kind === 'rout' || kind === 'retreat' || kind === 'withdrawal'
        ? 1800
        : 1500;
  const marchSpeed = kind === 'charge'
    ? 900
    : kind === 'flank'
      ? 1100
      : kind === 'rout' || kind === 'retreat' || kind === 'withdrawal'
        ? 2400
        : 1400;
  // Impact fires 80ms before the trace formally ends so the ring and the
  // arrowhead read as a single event. Retreats land more softly but still
  // get a beat so the eye knows the unit completed its movement.
  const impactDelay = appearDelay + traceMs - 80;
  return { appearDelay, traceMs, marchSpeed, impactDelay };
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

// relaxUnitCollisions pushes overlapping unit markers apart so a dense
// battlefield does not stack a dozen disks into one indistinguishable blob.
// Greedy: process in queue order, for each unit walk every earlier unit and
// nudge it outward along the line between them if the disks would overlap.
// One pass is enough at the densities we render and keeps the projection
// loop cheap.
function relaxUnitCollisions(units: ProjectedUnit[]): ProjectedUnit[] {
  const out = units.map((u) => ({ ...u }));
  const gap = 2;
  for (let i = 0; i < out.length; i++) {
    if (!out[i].visible) continue;
    for (let j = 0; j < i; j++) {
      if (!out[j].visible) continue;
      const dx = out[i].x - out[j].x;
      const dy = out[i].y - out[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = out[i].radius + out[j].radius + gap;
      if (dist > 0 && dist < minDist) {
        const push = (minDist - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        out[i].x += nx * push;
        out[i].y += ny * push;
        out[j].x -= nx * push;
        out[j].y -= ny * push;
      } else if (dist === 0) {
        // Exact overlap, push i by a deterministic offset so collisions are
        // resolved consistently across frames.
        out[i].x += minDist;
      }
    }
  }
  return out;
}

export default function GlobeReplay({ battle, replay, phase, phaseIdx, warCountryColors }: GlobeReplayProps) {
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
  // default to the battle location; cameraAltitude defaults to a tighter
  // operational view than before. Dropping the divisor from 8 to 12 brings
  // the camera in roughly 33%, which makes arrows traverse a meaningful
  // fraction of the viewport instead of looking like short flicks against
  // a wide-open continent.
  const defaultAltitude = Math.max(0.12, Math.min(0.55, extentLngDeg / 12));
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

  // Camera choreography per phase. The first phase of any battle snaps the
  // camera straight to the target longitude with a slightly-pulled-back
  // altitude — this kills the "globe starts on the Atlantic, slowly flies to
  // Europe" awkwardness that made replays feel like they were buffering. The
  // tween then settles in to the desired vantage. Subsequent phases run the
  // full eased tween because they're moving from one curated vantage to the
  // next.
  const firstPhaseAppliedRef = useRef(false);
  useEffect(() => {
    if (!globeRef.current) return;
    const globe = globeRef.current;
    const controls = globe.controls();
    controls.autoRotate = false;

    if (!firstPhaseAppliedRef.current) {
      // Single hard snap directly to the final pose. The previous snap-then-
      // settle produced two visible camera moves on mount (a hard jump
      // followed by a 900ms ease), which read as a stutter. One snap, no
      // tween, no second move — the first frame already shows the right
      // region at the right altitude. Subsequent phases get the smooth
      // tween because they're moving between two curated vantages.
      globe.pointOfView(
        { lat: cameraLat, lng: cameraLng, altitude: cameraAlt },
        0,
      );
      firstPhaseAppliedRef.current = true;
    } else {
      globe.pointOfView(
        { lat: cameraLat, lng: cameraLng, altitude: cameraAlt },
        tweenMs,
      );
    }

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

  // Reset the snap-on-mount flag when the battle changes so the next battle
  // also gets a clean snap-then-settle on its first phase.
  useEffect(() => {
    firstPhaseAppliedRef.current = false;
  }, [battle.id]);

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

  // Polygons rendered on the globe: every country shaded by the active
  // war-territory snapshot (so the sweep stays visible while watching a
  // single battle inside a war cinematic), the host country highlight, and
  // per-phase control regions (tinted by the phase-local controlling
  // faction). All bundled into one polygonsData array so the engine
  // renders them in a single pass and animates color transitions between
  // snapshots.
  const polygonData: PolygonDatum[] = useMemo(() => {
    const out: PolygonDatum[] = [];
    // War-territory country shading. Every country is mounted, even when
    // it is not in the current snapshot, so the polygon engine never has
    // to mount/unmount features as the playhead crosses snapshot
    // boundaries — that mount/unmount was the source of the in-and-out
    // flicker the user reported. Non-belligerent countries render with
    // zero alpha so they are invisible but the feature identity stays
    // stable, which lets the colour transition tween cleanly.
    if (warCountryColors && countries.length > 0) {
      const colorByName: Record<string, string> = {};
      for (const [name, hex] of Object.entries(warCountryColors)) {
        colorByName[name] = hex;
        const aliases = COUNTRY_NAME_ALIASES[name];
        if (aliases) for (const a of aliases) colorByName[a] = hex;
      }
      for (const feat of countries) {
        const props = (feat.properties ?? {}) as { name?: string };
        const name = props.name;
        if (!name) continue;
        const color = colorByName[name];
        if (color) {
          out.push({
            feature: feat as Feature<Geometry>,
            capColor: hexWithAlpha(color, 0.50),
            strokeColor: hexWithAlpha(color, 0.55),
            sideColor: 'rgba(0,0,0,0)',
            altitude: 0.0035,
          });
        } else {
          out.push({
            feature: feat as Feature<Geometry>,
            capColor: 'rgba(64,72,90,0)',
            strokeColor: 'rgba(64,72,90,0)',
            sideColor: 'rgba(64,72,90,0)',
            altitude: 0.0005,
          });
        }
      }
    }
    if (highlightedCountry.length) {
      out.push({
        feature: highlightedCountry[0],
        capColor: 'rgba(59,130,246,0.05)',
        strokeColor: 'rgba(147,197,253,0.40)',
        sideColor: 'rgba(0,0,0,0)',
        altitude: 0.0035,
      });
    }
    (phase.controlRegions ?? []).forEach((r: ControlRegion) => {
      const color = factionColorFor(r.controller, replay) ?? '#94a3b8';
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
        capColor: hexWithAlpha(color, 0.22),
        strokeColor: hexWithAlpha(color, 0.45),
        sideColor: 'rgba(0,0,0,0)',
        altitude: 0.005,
      });
    });
    return out;
  }, [highlightedCountry, phase.controlRegions, warCountryColors, countries, replay]);

  // RAF loop projects all phase geometry onto screen pixels. Updates every
  // frame so the SVG overlay tracks camera fly-ins and any user drag without
  // visible lag. mountedRef guards against state updates queued in the same
  // frame as an unmount (closing the replay mid-tween). Without the guard,
  // React logs "update on unmounted component" and the next phase mount can
  // briefly inherit the stale projection from the previous phase.
  useEffect(() => {
    let raf = 0;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
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
        if (!mounted) return;
        setArrows(nextArrows);

        const projected: ProjectedUnit[] = defenderGeo.map((u) => {
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
        const nextUnits = relaxUnitCollisions(projected);
        if (!mounted) return;
        setUnits(nextUnits);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, [movementGeo, defenderGeo]);

  return (
    <div ref={wrapRef} className="w-full h-full relative">
      {/* On-stage side legend. Floats at the top-left of the replay stage
          so the eye can always map an arrow color to a faction without
          looking off into the sidebar. The sidebar's SideRow shows the
          same info but during a fast-paced phase the user is watching the
          arrows, not the sidebar. */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none flex flex-col gap-1.5">
        <SideTag color={factionColorFor('a', replay)} label={replay.factionA} />
        <SideTag color={factionColorFor('b', replay)} label={replay.factionB} />
        {replay.factionC && <SideTag color={factionColorFor('c', replay)} label={replay.factionC} />}
      </div>

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
        polygonGeoJsonGeometry={(d: object) => (d as PolygonDatum).feature.geometry as unknown as { type: string; coordinates: number[] }}
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
          {(['a', 'b', 'c'] as Faction[]).map((f) => {
            const c = factionColorFor(f, replay);
            // Open chevron arrowhead. Stroke not fill so the eye reads it
            // as a force vector landing rather than a static triangle pin.
            // Larger marker box + tighter inner stroke gives weight at the
            // cinematic globe scale.
            return (
              <marker
                key={`${phaseIdx}-${f}`}
                id={`gr-arrow-${phaseIdx}-${f}`}
                viewBox="0 0 14 14"
                refX="12"
                refY="7"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path
                  d="M 1 1.5 L 12.5 7 L 1 12.5"
                  fill="none"
                  stroke={c}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: `drop-shadow(0 0 2px ${c}) drop-shadow(0 0 3.5px ${c}aa)` }}
                />
              </marker>
            );
          })}
        </defs>
        {/* Defender units render under the arrows so an incoming arrow visibly
            terminates at the defender's position rather than vice versa. */}
        {units.filter((u) => u.visible).map((u) => (
          <UnitMarker key={`unit-${phaseIdx}-${u.index}`} unit={u} phaseIdx={phaseIdx} paletteCtx={replay} />
        ))}
        {arrows.filter((a) => a.visible).map((a) => (
          <ArrowVector
            key={`arrow-${phaseIdx}-${a.index}`}
            phaseIdx={phaseIdx}
            arrow={a}
            paletteCtx={replay}
          />
        ))}
        {/* Impact flashes timed to each arrow's individual trace duration, so
            a slow retreat does not flash before it has finished moving and a
            fast charge does not flash long after it has landed. The shared
            arrowTiming helper keeps the flash and the trace honest. */}
        {arrows.filter((a) => a.visible).map((a) => (
          <ImpactFlash
            key={`flash-${phaseIdx}-${a.index}`}
            x={a.x2}
            y={a.y2}
            color={factionColorFor(a.faction, replay)}
            delay={arrowTiming(a.kind, a.index).impactDelay}
          />
        ))}
        {/* Arrow labels. Each labelled movement gets a small pill at its
            midpoint after the trace lands. Previously the label field on a
            movement was invisible: curators wrote "Mi-8 air assault lands
            on apron" and the user saw a generic swoosh. The pill now
            attaches that prose to the geometry so the arrow tells the
            story instead of needing the sidebar narration to do it. */}
        {arrows.filter((a) => a.visible && a.label).map((a) => (
          <ArrowLabel
            key={`label-${phaseIdx}-${a.index}`}
            arrow={a}
            color={factionColorFor(a.faction, replay)}
            timing={arrowTiming(a.kind, a.index)}
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
  paletteCtx?: PaletteContext;
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
function ArrowVector({ phaseIdx, arrow, paletteCtx }: ArrowVectorProps) {
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

  let stroke = 4.5;
  if (kind === 'charge') stroke = 6.5;
  else if (kind === 'flank') stroke = 5.5;
  else if (kind === 'rout' || kind === 'retreat' || kind === 'withdrawal') stroke = 3.5;

  const color = factionColorFor(faction, paletteCtx);
  const markerId = `gr-arrow-${phaseIdx}-${faction}`;
  const path = `M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}`;

  const dashLen = Math.max(14, stroke * 4.5);
  const gapLen = Math.max(8, stroke * 2.8);
  const period = dashLen + gapLen;
  const { appearDelay, traceMs, marchSpeed } = arrowTiming(kind, index);
  // Marching dashes appear right as the trace completes (10% overlap for a
  // seamless handoff). The arrowhead lives on the marching layer so it shows
  // up at the same time the dashes do, which is right when the trace lands.
  const marchDelay = appearDelay + traceMs - 100;

  // Path length for the comet head animation. SVG getTotalLength would be
  // ideal but we want this server-renderable, so the visual hack uses a
  // pathLength=1 dash with a tiny visible window that slides from 0 to 1.
  return (
    <g>
      {/* Single soft halo. Wide-but-not-smudgy glow gives the arrow weight
          from cinematic distance without the previous double-halo stack that
          made overlapping arrows read as smoke smears. */}
      <path
        d={path}
        stroke={color}
        strokeOpacity={0}
        strokeWidth={stroke + 12}
        fill="none"
        strokeLinecap="round"
        style={{
          filter: 'blur(6px)',
          animation: `arrow-halo-in 800ms ${appearDelay}ms ease-out forwards`,
        }}
      />
      {/* Inner glow underlay. Tighter and brighter so the line itself reads
          as glowing rather than only the halo. */}
      <path
        d={path}
        stroke={color}
        strokeOpacity={0}
        strokeWidth={stroke + 6}
        fill="none"
        strokeLinecap="round"
        style={{
          filter: 'blur(3px)',
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
      {/* Comet head: a bright short stroke window that slides along the path
          during the trace. Reads as a moving spearpoint of light. The window
          is 6% of the path length so it sits visibly on the leading edge of
          the trace without overrunning it. */}
      <path
        d={path}
        stroke="#ffffff"
        strokeWidth={stroke + 1.5}
        fill="none"
        strokeLinecap="round"
        pathLength={1}
        style={{
          filter: 'blur(0.5px)',
          opacity: 0,
          strokeDasharray: '0.06 1',
          strokeDashoffset: 1,
          animation: `arrow-comet-fade 220ms ${appearDelay}ms ease-out forwards, arrow-comet ${traceMs}ms ${appearDelay}ms cubic-bezier(.25,.65,.25,1) forwards, arrow-comet-out 320ms ${appearDelay + traceMs - 240}ms ease-out forwards`,
        }}
      />
      {/* Persistent solid spine: a thinner, lower-opacity solid line under
          the marching dashes. Always visible after the trace lands so a
          long campaign arrow never collapses to a floating chevron just
          because the dashes happen to gap at the wrong moment. The march
          dashes ride on top to convey motion. */}
      <path
        d={path}
        stroke={color}
        strokeWidth={Math.max(1.6, stroke * 0.55)}
        fill="none"
        strokeLinecap="round"
        style={{
          opacity: 0,
          animation: `arrow-spine-in 320ms ${marchDelay}ms ease-out forwards`,
        }}
      />
      {/* Marching layer. Hidden until the trace finishes, then loops forever.
          The arrowhead is attached here so it appears only after the line
          has actually arrived. Dashes pulled tighter and softer than before
          so multiple overlapping arrows don't render as a smudgy hatch. */}
      <path
        d={path}
        stroke={color}
        strokeWidth={Math.max(1.4, stroke * 0.7)}
        fill="none"
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
        style={{
          opacity: 0,
          strokeDasharray: `${Math.max(8, stroke * 2.4)} ${Math.max(10, stroke * 3)}`,
          ['--march' as string]: `${-period}px`,
          animation: `arrow-march-in 220ms ${marchDelay}ms ease-out forwards, march ${marchSpeed * 1.25}ms ${marchDelay}ms linear infinite`,
        }}
      />
    </g>
  );
}

// SideTag is the on-stage faction badge. Color swatch + name in a dark
// glass pill. Bold enough to read at a glance during an arrow flurry but
// quiet enough to fade behind the cinematic action.
function SideTag({ color, label }: { color: string; label: string }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 backdrop-blur-md"
      style={{
        background: 'rgba(8, 10, 18, 0.78)',
        border: `1px solid ${color}88`,
        boxShadow: `0 6px 16px -6px ${color}55`,
      }}
    >
      <span
        className="flex-shrink-0 rounded-full"
        style={{
          width: 10,
          height: 10,
          background: color,
          boxShadow: `0 0 8px ${color}`,
        }}
      />
      <span
        className="text-[12px] font-semibold tracking-wide text-white whitespace-nowrap max-w-[260px] truncate"
        title={label}
      >
        {label}
      </span>
    </div>
  );
}

interface ArrowLabelProps {
  arrow: ProjectedArrow;
  color: string;
  timing: { appearDelay: number; traceMs: number; marchSpeed: number; impactDelay: number };
}

// ArrowLabel renders the movement's prose label (e.g. "Mi-8 air assault
// lands on apron") as a small color-rimmed pill at the arrow's midpoint.
// Pops in just as the trace completes so the story arrives with the force.
// Curators on hand-crafted replays write these labels; for schematic
// replays the field is empty and the label silently drops, which is the
// right behavior because schematic arrows are generic and there is nothing
// honest to caption them with.
function ArrowLabel({ arrow, color, timing }: ArrowLabelProps) {
  const { x1, y1, x2, y2, label } = arrow;
  if (!label) return null;
  // Place at the geometric midpoint and push perpendicular to the arrow,
  // far enough that the pill sits OUTSIDE the arrow's halo + glow band.
  // Charge arrows with stroke ~6.5 and a 22-unit blur halo need a 40-50
  // unit offset to be visually clear; thinner advances need ~30. Sign
  // alternates with the arrow index so labels distribute above/below.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const sign = arrow.index % 2 === 0 ? 1 : -1;
  // Offset proportional to arrow stroke (charge thicker → push label
  // further). Min 30, max ~52 so very long arrows don't fling labels
  // off-screen.
  const offset = 38;
  const midX = (x1 + x2) / 2 + (-dy / len) * offset * sign;
  const midY = (y1 + y2) / 2 + (dx / len) * offset * sign;
  const appearAt = timing.appearDelay + timing.traceMs - 200;
  return (
    <g
      transform={`translate(${midX} ${midY})`}
      style={{
        opacity: 0,
        animation: `arrow-label-in 500ms ${appearAt}ms cubic-bezier(.2,.7,.25,1) forwards`,
        pointerEvents: 'none',
      }}
    >
      <foreignObject
        x={-110}
        y={-13}
        width={220}
        height={26}
        style={{ overflow: 'visible' }}
      >
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            display: 'inline-block',
            padding: '3px 9px',
            borderRadius: 9999,
            background: 'rgba(8, 10, 18, 0.86)',
            border: `1px solid ${color}80`,
            color: '#fff',
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.01em',
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            boxShadow: `0 6px 18px -6px rgba(0,0,0,0.6), 0 0 14px -4px ${color}55`,
            transform: 'translate(-50%, -50%)',
            position: 'relative',
            left: '50%',
            top: '50%',
          }}
        >
          {label}
        </div>
      </foreignObject>
    </g>
  );
}

interface UnitMarkerProps {
  phaseIdx: number;
  unit: ProjectedUnit;
  paletteCtx?: PaletteContext;
}

// UnitMarker renders a static defender / position marker at a unit's
// projected screen position. The marker is a faction-colored disk with a
// pale rim and a unit-type glyph in the center. Pop-in uses a slight
// overshoot bezier so each unit lands with weight, not a flat fade.
function UnitMarker({ unit, paletteCtx }: UnitMarkerProps) {
  const { x, y, faction, radius, unitType, status, index, label } = unit;
  const color = factionColorFor(faction, paletteCtx);
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
      {/* Persistent unit caption underneath the marker. Was previously only
          shown on hover via the SVG <title>, which is invisible on touch
          devices and easy to miss with the cursor on the move. Captioning
          the marker directly tells the user "this is the 4th Rapid
          Reaction Brigade" without making them hunt for it. */}
      {label && (
        <foreignObject
          x={-90}
          y={radius + 4}
          width={180}
          height={20}
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              display: 'inline-block',
              padding: '1.5px 7px',
              borderRadius: 9999,
              background: 'rgba(8, 10, 18, 0.78)',
              border: `1px solid ${color}66`,
              color: '#e2e8f0',
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: 10,
              fontWeight: 500,
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              transform: 'translateX(-50%)',
              position: 'relative',
              left: '50%',
              opacity: 0.92,
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

// UNIT_ICON maps a unit type to a unicode glyph rendered inside the marker.
// Chess pieces and military symbols are recognisable at small sizes and read
// far better than the previous thin SVG lines. The chess "knight" stands in
// for cavalry, the "pawn" for infantry foot soldiers, the "rook" for siege
// artillery, the "bishop" for archers (their angled silhouette suggests a
// drawn bow). Aircraft, ships, and tanks get dedicated unicode icons.
const UNIT_ICON: Record<string, string> = {
  infantry: '♟',
  cavalry: '♞',
  archers: '♝',
  artillery: '♜',
  command: '★',
  armor: '▰',
  aircraft: '✈',
  ships: '⚓',
};

// UnitGlyph renders the unit-type icon inside a marker. Sized to fit, with a
// subtle dark stroke so the glyph stays legible against the faction-colored
// disk regardless of theme.
function UnitGlyph({ radius, unitType }: { radius: number; unitType?: string }) {
  const icon = unitType ? UNIT_ICON[unitType] : '';
  if (!icon) return null;
  const fontSize = radius * 1.6;
  return (
    <text
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={fontSize}
      fontWeight={600}
      fill="#f8fafc"
      stroke="rgba(15,18,30,0.85)"
      strokeWidth={Math.max(0.6, fontSize * 0.06)}
      paintOrder="stroke fill"
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      {icon}
    </text>
  );
}

interface ImpactFlashProps {
  x: number;
  y: number;
  color: string;
  delay: number;
}

// ImpactFlash renders an expanding ring + bright core + a starburst of
// outward-flying sparks at (x, y), keyed so it plays once per phase per
// arrow. It signals "the arrow has arrived" with more visual weight than a
// single ring. The associated low-frequency thump is scheduled in lockstep.
function ImpactFlash({ x, y, color, delay }: ImpactFlashProps) {
  useEffect(() => {
    const id = setTimeout(() => playImpact(), delay);
    return () => clearTimeout(id);
  }, [delay]);
  // Twelve inner sparks tight to the impact point + eight outer sparks
  // thrown further. Two rings of debris read as a real engagement rather
  // than a single starburst.
  const INNER = 12;
  const innerSparks = Array.from({ length: INNER }, (_, i) => {
    const angle = (Math.PI * 2 * i) / INNER + 0.18;
    const dist = 22;
    return { i, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist };
  });
  const OUTER = 8;
  const outerSparks = Array.from({ length: OUTER }, (_, i) => {
    const angle = (Math.PI * 2 * i) / OUTER;
    const dist = 38;
    return { i, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist };
  });
  return (
    <g transform={`translate(${x} ${y})`} style={{ pointerEvents: 'none' }}>
      {/* Bright core flash. */}
      <circle
        r={6}
        fill={color}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-core 900ms ${delay}ms cubic-bezier(.25,.7,.25,1) forwards`,
          filter: `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 12px ${color}aa)`,
        }}
      />
      {/* Primary shockwave. */}
      <circle
        r={6}
        fill="none"
        stroke={color}
        strokeWidth={2.6}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-ring 1100ms ${delay}ms cubic-bezier(.2,.6,.25,1) forwards`,
        }}
      />
      {/* Secondary shockwave, slightly delayed and softer. */}
      <circle
        r={6}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeOpacity={0.65}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-ring 1500ms ${delay + 200}ms cubic-bezier(.2,.6,.25,1) forwards`,
        }}
      />
      {/* Tertiary atmospheric ring — wider, slower, faintest. Lingers a
          beat after the flash so the impact has weight. */}
      <circle
        r={6}
        fill="none"
        stroke={color}
        strokeWidth={1.0}
        strokeOpacity={0.4}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-ring 2200ms ${delay + 450}ms cubic-bezier(.2,.6,.25,1) forwards`,
        }}
      />
      {innerSparks.map((s) => (
        <circle
          key={`spark-i-${s.i}`}
          r={1.8}
          fill="#ffffff"
          style={{
            opacity: 0,
            ['--sx' as string]: `${s.dx}px`,
            ['--sy' as string]: `${s.dy}px`,
            animation: `impact-spark 800ms ${delay + 40}ms cubic-bezier(.25,.65,.25,1) forwards`,
          }}
        />
      ))}
      {outerSparks.map((s) => (
        <circle
          key={`spark-o-${s.i}`}
          r={1.2}
          fill={color}
          style={{
            opacity: 0,
            ['--sx' as string]: `${s.dx}px`,
            ['--sy' as string]: `${s.dy}px`,
            animation: `impact-spark 1200ms ${delay + 180}ms cubic-bezier(.25,.65,.25,1) forwards`,
          }}
        />
      ))}
    </g>
  );
}
