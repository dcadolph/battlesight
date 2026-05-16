import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';
import type { Battle } from '../types/battle';
import { ERA_COLORS } from '../types/battle';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry, Position } from 'geojson';
import { HI_RES_EARTH, TOPOLOGY_BUMP, NIGHT_SKY } from '../data/cities';

interface BattleGlobeProps {
  battles: Battle[];
  yearRange: [number, number];
  onBattleClick: (battle: Battle) => void;
  selectedBattle: Battle | null;
  dramatic: boolean;
}

const COUNTRIES_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

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

// extractNumber pulls the largest comma-separated integer ≤ 10M from a string.
function extractNumber(s: string | undefined): number {
  if (!s) return 0;
  const matches = s.replace(/,/g, '').match(/\d+/g);
  if (!matches) return 0;
  let best = 0;
  for (const m of matches) {
    const n = parseInt(m, 10);
    if (n > best && n <= 10_000_000) best = n;
  }
  return best;
}

// totalCasualties sums up casualty estimates across all sides of a battle.
function totalCasualties(b: Battle): number {
  if (!b.sides) return 0;
  let total = 0;
  for (const s of b.sides) total += extractNumber(s.casualties);
  return total;
}

// formatNumber renders an integer with thousands separators (en-US style).
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

// escapeHTML protects user-supplied text against the dangerouslyInnerHTML-style
// tooltip rendering path used by react-globe.gl.
function escapeHTML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// hexWithAlpha returns the input #rrggbb hex with the given alpha as an rgba()
// string. Used to dim lower-tier markers without changing their underlying era
// color. Pass-through for non-hex input.
function hexWithAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// battleMagnitude estimates the scale of a battle from its sides' casualties.
// Returns 0 when unknown. Uses log scale so a million-casualty battle isn't
// a million times bigger than a 200-casualty one.
function battleMagnitude(b: Battle): number {
  if (!b.sides || b.sides.length === 0) return 0;
  let total = 0;
  for (const s of b.sides) {
    total += extractNumber(s.casualties);
  }
  if (total <= 0) return 0;
  // log10(100)=2, log10(1M)=6 -> map [2, 6] to [0, 1]
  const v = Math.log10(Math.max(total, 100));
  return Math.max(0, Math.min(1, (v - 2) / 4));
}

export default function BattleGlobe({ battles, yearRange, onBattleClick, selectedBattle, dramatic }: BattleGlobeProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [countries, setCountries] = useState<Feature<Geometry>[]>([]);

  const visibleBattles = useMemo(
    () => battles.filter(
      (b) => b.year >= yearRange[0] && b.year <= yearRange[1] && !(b.lat === 0 && b.lng === 0),
    ),
    [battles, yearRange],
  );

  const replayRings = useMemo(
    () => visibleBattles
      .filter((b) => b.hasReplay)
      .map((b) => ({ lat: b.lat, lng: b.lng, id: b.id, era: b.era })),
    [visibleBattles],
  );

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
    if (!selectedBattle || countries.length === 0) return [];
    const match = findCountry(selectedBattle.lat, selectedBattle.lng, countries);
    return match ? [match] : [];
  }, [selectedBattle, countries]);

  useEffect(() => {
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Keep a ref to the latest selectedBattle so listener closures don't go stale
  // without re-binding (which would also reset the camera).
  const selectedBattleRef = useRef(selectedBattle);
  useEffect(() => { selectedBattleRef.current = selectedBattle; }, [selectedBattle]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;
    controls.enableDamping = true;

    let idleTimer: ReturnType<typeof setTimeout>;

    const stopRotation = () => {
      controls.autoRotate = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!selectedBattleRef.current) controls.autoRotate = true;
      }, 10000);
    };

    const el = globe.renderer().domElement;
    el.addEventListener('mousedown', stopRotation);
    el.addEventListener('wheel', stopRotation);
    el.addEventListener('touchstart', stopRotation);

    // Initial point of view is set once on mount; subsequent battle selections
    // pan smoothly via the dedicated effect below.
    globe.pointOfView({ lat: 30, lng: 10, altitude: 2.2 });

    return () => {
      clearTimeout(idleTimer);
      el.removeEventListener('mousedown', stopRotation);
      el.removeEventListener('wheel', stopRotation);
      el.removeEventListener('touchstart', stopRotation);
    };
  }, []);

  useEffect(() => {
    if (!selectedBattle || !globeRef.current) return;
    globeRef.current.controls().autoRotate = false;
    globeRef.current.pointOfView(
      { lat: selectedBattle.lat, lng: selectedBattle.lng, altitude: 1.8 },
      1000
    );
  }, [selectedBattle]);

  // Frame-the-war camera move. When the visible battle set narrows to a
  // single war (a few up to a few hundred entries) and nothing specific is
  // selected, fly the camera to a vantage that frames every battle of that
  // war. The full unfiltered set (~12k battles) is skipped via the length
  // threshold so the initial load stays at its default vantage.
  useEffect(() => {
    if (selectedBattle) return;
    if (!globeRef.current) return;
    if (visibleBattles.length === 0 || visibleBattles.length > 400) return;

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const b of visibleBattles) {
      if (b.lat < minLat) minLat = b.lat;
      if (b.lat > maxLat) maxLat = b.lat;
      if (b.lng < minLng) minLng = b.lng;
      if (b.lng > maxLng) maxLng = b.lng;
    }
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latSpan = maxLat - minLat;
    const lngSpan = (maxLng - minLng) * Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));
    const span = Math.max(latSpan, lngSpan, 2);
    // Altitude scales with angular span. A 5° war frames at ~0.45 (close);
    // a 100° war frames at ~1.9 (continental); clamped so we never zoom
    // ridiculously close or float past the moon.
    const altitude = Math.max(0.35, Math.min(2.6, 0.18 + span * 0.018));

    globeRef.current.controls().autoRotate = false;
    globeRef.current.pointOfView(
      { lat: centerLat, lng: centerLng, altitude },
      1500,
    );
  }, [visibleBattles, selectedBattle]);

  const handleBattleClick = useCallback((point: object) => {
    const battle = point as Battle;
    const match = battles.find((b) => b.id === battle.id);
    if (match) onBattleClick(match);
  }, [battles, onBattleClick]);

  const pointColor = useCallback((point: object) => {
    const b = point as Battle;
    if (selectedBattle && selectedBattle.id !== b.id) return 'rgba(100,100,120,0.12)';
    const base = ERA_COLORS[b.era] || '#ffffff';
    const tier = b.tier ?? (b.verified ? 'documented' : 'indexed');
    // Indexed entries are dimmed to surface the trust tier visually.
    if (tier === 'indexed') return hexWithAlpha(base, 0.45);
    return base;
  }, [selectedBattle]);

  const pointAltitude = useCallback((point: object) => {
    const b = point as Battle;
    if (dramatic) {
      // Every battle gets a pillar so the globe always reads as "every battle ever".
      // A small oscillation gives variety even where we have no casualty data;
      // known-casualty battles get an additional bump so they stand out.
      const mag = battleMagnitude(b);
      const base = 0.03 + Math.abs(Math.sin(b.lat * 0.13 + b.lng * 0.17)) * 0.05;
      return base + mag * 0.16;
    }
    if (selectedBattle?.id === b.id) return 0.15;
    if (selectedBattle) return 0;
    return 0;
  }, [selectedBattle, dramatic]);

  const pointRadius = useCallback((point: object) => {
    const b = point as Battle;
    const mag = battleMagnitude(b);
    const tier = b.tier ?? (b.verified ? 'documented' : 'indexed');
    let base = 0.18 + mag * 0.32;
    if (tier === 'indexed') base *= 0.7;
    if (tier === 'reconstructed') base = Math.max(base, 0.36);
    if (dramatic) return base;
    if (selectedBattle?.id === b.id) return Math.max(0.4, base);
    if (selectedBattle) return 0.04;
    return base;
  }, [selectedBattle, dramatic]);

  const pointLabel = useCallback((point: object) => {
    const b = point as Battle;
    const eraColor = ERA_COLORS[b.era] || '#94a3b8';
    const yearStr = b.year === 0 ? '' : b.year < 0 ? `${Math.abs(b.year)} BC` : `${b.year}`;
    const dateLine = b.date && b.date !== '0' ? b.date : yearStr;
    const sub = [dateLine, b.war].filter(Boolean).join(' · ');
    const typeBadge = b.battleType
      ? `<span style="display:inline-block;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;padding:1px 6px;border-radius:6px;background:rgba(148,163,184,0.15);color:#cbd5e1">${escapeHTML(b.battleType)}</span>`
      : '';
    const tier = b.tier ?? (b.verified ? 'documented' : 'indexed');
    const tierTone: Record<string, string> = {
      reconstructed: 'background:rgba(59,130,246,0.18);color:#93c5fd',
      documented: 'background:rgba(16,185,129,0.16);color:#6ee7b7',
      indexed: 'background:rgba(245,158,11,0.16);color:#fcd34d',
    };
    const tierLabel: Record<string, string> = {
      reconstructed: 'Reconstructed',
      documented: 'Documented',
      indexed: 'Indexed',
    };
    const tierBadge = `<span style="display:inline-block;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;padding:1px 6px;border-radius:6px;${tierTone[tier]}">${tierLabel[tier]}</span>`;
    const totalCas = totalCasualties(b);
    const casLine = totalCas > 0
      ? `<div style="margin-top:4px;font-size:11px;color:#fbbf24">~${formatNumber(totalCas)} casualties</div>`
      : '';
    const victorLine = b.victor
      ? `<div style="margin-top:2px;font-size:11px;color:#86efac">Victor: ${escapeHTML(b.victor)}</div>`
      : '';
    const replayLine = b.hasReplay
      ? '<div style="margin-top:6px;font-size:10px;color:#93c5fd;letter-spacing:0.08em;text-transform:uppercase">▶ Click marker for phase replay</div>'
      : b.hasSchematic
      ? '<div style="margin-top:6px;font-size:10px;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase">▶ Click marker for schematic</div>'
      : '';
    return `<div style="
      background: rgba(10,10,15,0.94);
      border: 1px solid ${eraColor};
      border-radius: 10px;
      padding: 10px 12px;
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px;
      color: #e2e8f0;
      max-width: 260px;
      pointer-events: none;
    ">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap">${tierBadge}${typeBadge}</div>
      <div style="font-weight:600; font-size:14px; color:${eraColor}">${escapeHTML(b.name)}</div>
      ${sub ? `<div style="opacity:0.65; margin-top:2px; font-size:11px">${escapeHTML(sub)}</div>` : ''}
      ${victorLine}
      ${casLine}
      ${replayLine}
    </div>`;
  }, []);

  const polygonLabel = useCallback((feat: object) => {
    const f = feat as Feature<Geometry>;
    const name = (f.properties as Record<string, string>)?.name || '';
    if (!name) return '';
    return `<div style="
      background: rgba(10,10,15,0.85);
      border: 1px solid rgba(59,130,246,0.5);
      border-radius: 6px;
      padding: 4px 10px;
      font-family: Inter, system-ui, sans-serif;
      font-size: 12px;
      font-weight: 500;
      color: #93c5fd;
      pointer-events: none;
    ">${escapeHTML(name)}</div>`;
  }, []);

  return (
    <Globe
      ref={globeRef as React.MutableRefObject<GlobeMethods | undefined>}
      width={dimensions.width}
      height={dimensions.height}
      globeImageUrl={HI_RES_EARTH}
      bumpImageUrl={TOPOLOGY_BUMP}
      backgroundImageUrl={NIGHT_SKY}
      atmosphereColor="#7ab9ff"
      atmosphereAltitude={0.15}
      pointsData={visibleBattles}
      pointLat="lat"
      pointLng="lng"
      pointColor={pointColor}
      pointAltitude={pointAltitude}
      pointRadius={pointRadius}
      pointLabel={pointLabel}
      onPointClick={handleBattleClick}
      pointsMerge={false}
      pointsTransitionDuration={300}
      pointResolution={8}
      ringsData={replayRings}
      ringLat="lat"
      ringLng="lng"
      ringColor={() => (t: number) => `rgba(147,197,253,${0.7 * (1 - t)})`}
      ringMaxRadius={2.6}
      ringPropagationSpeed={1.2}
      ringRepeatPeriod={2200}
      ringAltitude={0.005}
      polygonsData={highlightedCountry}
      polygonCapColor={() => 'rgba(59,130,246,0.08)'}
      polygonSideColor={() => 'rgba(59,130,246,0.15)'}
      polygonStrokeColor={() => 'rgba(59,130,246,0.4)'}
      polygonAltitude={0.005}
      polygonLabel={polygonLabel}
    />
  );
}
