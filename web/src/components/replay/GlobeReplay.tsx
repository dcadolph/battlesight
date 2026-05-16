import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';

import type { Battle } from '../../types/battle';
import type { Phase, Replay } from '../../types/replay';
import { FACTION_COLOR } from '../../types/replay';

interface GlobeReplayProps {
  battle: Battle;
  replay: Replay;
  phase: Phase;
  phaseIdx: number;
}

// Default geographic extents in degrees per 100 units of the normalized
// 0-100 space. We pick a default that matches roughly a corps-level
// engagement (~50 km wide). Each replay can override via top-level
// extentLngDeg / extentLatDeg fields on the Replay (not yet curated, so
// the default carries the visual today).
const DEFAULT_EXTENT_DEG = 0.7;

interface Arc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string | string[];
  stroke: number;
  label?: string;
  kind?: string;
}

interface MarkerPoint {
  lat: number;
  lng: number;
  label: string;
  color: string;
  size: number;
  faction: string;
  unitType?: string;
}

// projectToLatLng converts a 0-100 (x, y) coordinate from the phase's local
// frame to (lat, lng) on the globe centered at the battle's location. y is
// inverted (0 is "north" on the map, which corresponds to higher latitude).
function projectToLatLng(
  x: number,
  y: number,
  centerLat: number,
  centerLng: number,
  aspectRatio: number,
  extentLatDeg: number,
  extentLngDeg: number,
): [number, number] {
  // Compress longitude extent by cos(lat) so map appears proportional at
  // non-equatorial latitudes.
  const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
  const lngHalf = extentLngDeg / 2 / cosLat;
  const latHalf = (extentLatDeg / 2) / Math.max(aspectRatio, 0.5);
  const lat = centerLat + (50 - y) / 50 * latHalf;
  const lng = centerLng + (x - 50) / 50 * lngHalf;
  return [lat, lng];
}

export default function GlobeReplay({ battle, replay, phase, phaseIdx }: GlobeReplayProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Resize observer keeps the globe filling its slot when the window changes.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setDims({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const extentLngDeg = DEFAULT_EXTENT_DEG * (replay.aspectRatio ?? 1.6);
  const extentLatDeg = DEFAULT_EXTENT_DEG;

  // Fly the camera to the battle's location once, then keep it there.
  // Altitude tuned so the visible extent comfortably contains the battle.
  // Roughly: altitude in Earth-radii units; smaller altitude = closer view.
  const altitude = Math.max(0.04, Math.min(0.6, extentLngDeg / 8));
  useEffect(() => {
    if (!globeRef.current) return;
    globeRef.current.pointOfView(
      { lat: battle.lat, lng: battle.lng, altitude },
      900,
    );
  }, [battle.lat, battle.lng, altitude]);

  // Convert this phase's movements into arc-layer data.
  const arcs: Arc[] = useMemo(() => {
    const out: Arc[] = [];
    for (const m of phase.movements ?? []) {
      const [startLat, startLng] = projectToLatLng(
        m.fromX, m.fromY, battle.lat, battle.lng,
        replay.aspectRatio ?? 1.6, extentLatDeg, extentLngDeg,
      );
      const [endLat, endLng] = projectToLatLng(
        m.toX, m.toY, battle.lat, battle.lng,
        replay.aspectRatio ?? 1.6, extentLatDeg, extentLngDeg,
      );
      const baseColor = FACTION_COLOR[m.faction];
      // Two-stop arc color: fade from translucent origin to bright destination.
      const color: string[] = [`${baseColor}55`, baseColor];
      let stroke = 1.2;
      if (m.kind === 'charge') stroke = 1.8;
      else if (m.kind === 'flank') stroke = 1.6;
      else if (m.kind === 'rout' || m.kind === 'retreat' || m.kind === 'withdrawal') stroke = 1.0;
      out.push({ startLat, startLng, endLat, endLng, color, stroke, label: m.label, kind: m.kind });
    }
    return out;
  }, [phase, battle.lat, battle.lng, extentLatDeg, extentLngDeg, replay.aspectRatio]);

  // Convert this phase's units into point-layer markers.
  const points: MarkerPoint[] = useMemo(() => {
    return phase.units.map((u) => {
      const [lat, lng] = projectToLatLng(
        u.x, u.y, battle.lat, battle.lng,
        replay.aspectRatio ?? 1.6, extentLatDeg, extentLngDeg,
      );
      const baseColor = FACTION_COLOR[u.faction];
      const size = 0.4 + (u.strength ?? 1) * 0.18;
      return {
        lat, lng, label: u.label, color: baseColor, size,
        faction: u.faction, unitType: u.unitType,
      };
    });
  }, [phase, battle.lat, battle.lng, extentLatDeg, extentLngDeg, replay.aspectRatio]);

  const pointLabel = (p: object) => {
    const m = p as MarkerPoint;
    return `<div style="
      background: rgba(10,10,15,0.92);
      border: 1px solid ${m.color};
      border-radius: 8px;
      padding: 5px 9px;
      font-family: Inter, system-ui, sans-serif;
      font-size: 12px;
      color: #f1f5f9;
      pointer-events: none;
      max-width: 220px;
    "><span style="font-weight:600;color:${m.color}">${m.label}</span>${m.unitType ? `<div style="opacity:0.6;font-size:10px;margin-top:1px;text-transform:capitalize">${m.unitType}</div>` : ''}</div>`;
  };

  const arcLabel = (a: object) => {
    const ar = a as Arc;
    if (!ar.label) return '';
    return `<div style="
      background: rgba(10,10,15,0.92);
      border-left: 2px solid ${Array.isArray(ar.color) ? ar.color[1] : ar.color};
      padding: 3px 8px;
      font-family: Inter, system-ui, sans-serif;
      font-size: 12px;
      color: #e2e8f0;
      pointer-events: none;
    ">${ar.label}${ar.kind ? `<div style="opacity:0.6;font-size:10px;margin-top:1px;text-transform:capitalize">${ar.kind}</div>` : ''}</div>`;
  };

  return (
    <div ref={wrapRef} className="w-full h-full relative">
      <Globe
        ref={globeRef as React.MutableRefObject<GlobeMethods | undefined>}
        width={dims.width}
        height={dims.height}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        atmosphereColor="#4a9eff"
        atmosphereAltitude={0.18}
        // Re-key the arc data on phaseIdx so the dash-animate timing restarts
        // every time the phase advances. Without this, react-globe.gl reuses
        // existing arcs and the visual flow is lost between phases.
        arcsData={arcs.map((a, i) => ({ ...a, _key: `${phaseIdx}-${i}` }))}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor="color"
        arcStroke={(a: object) => (a as Arc).stroke}
        arcAltitudeAutoScale={0.35}
        arcDashLength={0.45}
        arcDashGap={0.25}
        arcDashAnimateTime={2200}
        arcLabel={arcLabel}
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointColor={(p: object) => (p as MarkerPoint).color}
        pointAltitude={(p: object) => 0.005 + (p as MarkerPoint).size * 0.01}
        pointRadius={(p: object) => (p as MarkerPoint).size}
        pointLabel={pointLabel}
        pointsMerge={false}
      />
    </div>
  );
}
