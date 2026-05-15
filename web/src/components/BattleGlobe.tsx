import { useEffect, useRef, useState, useCallback } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeInstance } from 'react-globe.gl';
import type { Battle } from '../types/battle';
import { ERA_COLORS } from '../types/battle';

interface BattleGlobeProps {
  battles: Battle[];
  yearRange: [number, number];
  onBattleClick: (battle: Battle) => void;
  selectedBattle: Battle | null;
}

export default function BattleGlobe({ battles, yearRange, onBattleClick, selectedBattle }: BattleGlobeProps) {
  const globeRef = useRef<GlobeInstance | undefined>(undefined);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  const filteredBattles = battles.filter(
    (b) => b.year >= yearRange[0] && b.year <= yearRange[1]
  );

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
        if (!selectedBattle) {
          controls.autoRotate = true;
        }
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
      { lat: selectedBattle.lat, lng: selectedBattle.lng, altitude: 1.5 },
      800
    );
  }, [selectedBattle]);

  const handleBattleClick = useCallback((point: object) => {
    const battle = point as Battle;
    const match = battles.find((b) => b.id === battle.id);
    if (match) onBattleClick(match);
  }, [battles, onBattleClick]);

  const pointColor = useCallback((point: object) => {
    const b = point as Battle;
    return ERA_COLORS[b.era] || '#ffffff';
  }, []);

  const pointAltitude = useCallback((point: object) => {
    const b = point as Battle;
    return selectedBattle?.id === b.id ? 0.12 : 0.04;
  }, [selectedBattle]);

  const pointRadius = useCallback((point: object) => {
    const b = point as Battle;
    return selectedBattle?.id === b.id ? 0.7 : 0.45;
  }, [selectedBattle]);

  const pointLabel = useCallback((point: object) => {
    const b = point as Battle;
    const yearStr = b.year < 0 ? `${Math.abs(b.year)} BC` : `${b.year}`;
    return `<div style="
      background: rgba(10,10,15,0.9);
      backdrop-filter: blur(8px);
      border: 1px solid ${ERA_COLORS[b.era] || '#fff'};
      border-radius: 8px;
      padding: 8px 12px;
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px;
      color: #e2e8f0;
      max-width: 200px;
    ">
      <div style="font-weight:600; font-size:14px; color:${ERA_COLORS[b.era] || '#fff'}">${b.name}</div>
      <div style="opacity:0.7; margin-top:2px">${yearStr} &middot; ${b.war}</div>
    </div>`;
  }, []);

  return (
    <Globe
      ref={globeRef as React.MutableRefObject<GlobeInstance | undefined>}
      width={dimensions.width}
      height={dimensions.height}
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
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
    />
  );
}
