import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeInstance } from 'react-globe.gl';
import type { Battle } from '../types/battle';
import { ERA_COLORS } from '../types/battle';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry, Position } from 'geojson';

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

export default function BattleGlobe({ battles, yearRange, onBattleClick, selectedBattle, dramatic }: BattleGlobeProps) {
  const globeRef = useRef<GlobeInstance | undefined>(undefined);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [countries, setCountries] = useState<Feature<Geometry>[]>([]);

  const filteredBattles = battles.filter(
    (b) => b.year >= yearRange[0] && b.year <= yearRange[1]
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
        if (!selectedBattle) controls.autoRotate = true;
      }, 10000);
    };

    const el = globe.renderer().domElement;
    el.addEventListener('mousedown', stopRotation);
    el.addEventListener('wheel', stopRotation);
    el.addEventListener('touchstart', stopRotation);

    globe.pointOfView({ lat: 30, lng: 10, altitude: 2.2 });

    return () => {
      clearTimeout(idleTimer);
      el.removeEventListener('mousedown', stopRotation);
      el.removeEventListener('wheel', stopRotation);
      el.removeEventListener('touchstart', stopRotation);
    };
  }, [selectedBattle]);

  useEffect(() => {
    if (!selectedBattle || !globeRef.current) return;
    globeRef.current.controls().autoRotate = false;
    globeRef.current.pointOfView(
      { lat: selectedBattle.lat, lng: selectedBattle.lng, altitude: 1.8 },
      1000
    );
  }, [selectedBattle]);

  const handleBattleClick = useCallback((point: object) => {
    const battle = point as Battle;
    const match = battles.find((b) => b.id === battle.id);
    if (match) onBattleClick(match);
  }, [battles, onBattleClick]);

  const pointColor = useCallback((point: object) => {
    const b = point as Battle;
    if (selectedBattle && selectedBattle.id !== b.id) return 'rgba(100,100,120,0.12)';
    return ERA_COLORS[b.era] || '#ffffff';
  }, [selectedBattle]);

  const pointAltitude = useCallback((point: object) => {
    const b = point as Battle;
    if (dramatic) return 0.04 + Math.random() * 0.06;
    if (selectedBattle?.id === b.id) return 0.15;
    if (selectedBattle) return 0;
    return 0;
  }, [selectedBattle, dramatic]);

  const pointRadius = useCallback((point: object) => {
    const b = point as Battle;
    if (dramatic) return 0.25;
    if (selectedBattle?.id === b.id) return 0.4;
    if (selectedBattle) return 0.04;
    return 0.2;
  }, [selectedBattle, dramatic]);

  const pointLabel = useCallback((point: object) => {
    const b = point as Battle;
    const yearStr = b.year < 0 ? `${Math.abs(b.year)} BC` : `${b.year}`;
    return `<div style="
      background: rgba(10,10,15,0.92);
      border: 1px solid ${ERA_COLORS[b.era] || '#fff'};
      border-radius: 8px;
      padding: 8px 12px;
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px;
      color: #e2e8f0;
      max-width: 220px;
      pointer-events: none;
    ">
      <div style="font-weight:600; font-size:14px; color:${ERA_COLORS[b.era] || '#fff'}">${b.name}</div>
      <div style="opacity:0.6; margin-top:2px; font-size:11px">${yearStr}${b.war ? ' · ' + b.war : ''}</div>
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
    ">${name}</div>`;
  }, []);

  return (
    <Globe
      ref={globeRef as React.MutableRefObject<GlobeInstance | undefined>}
      width={dimensions.width}
      height={dimensions.height}
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
      backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
      atmosphereColor="#4a9eff"
      atmosphereAltitude={0.15}
      pointsData={filteredBattles}
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
      polygonsData={highlightedCountry}
      polygonCapColor={() => 'rgba(59,130,246,0.08)'}
      polygonSideColor={() => 'rgba(59,130,246,0.15)'}
      polygonStrokeColor={() => 'rgba(59,130,246,0.4)'}
      polygonAltitude={0.005}
      polygonLabel={polygonLabel}
    />
  );
}
