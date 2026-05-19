import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';
import type { Battle } from '../types/battle';
import { ERA_COLORS } from '../types/battle';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry, Position } from 'geojson';
import { HI_RES_EARTH, TOPOLOGY_BUMP, NIGHT_SKY } from '../data/cities';
import { formatNumberWithCommas } from '../lib/format';

interface BattleGlobeProps {
  battles: Battle[];
  yearRange: [number, number];
  onBattleClick: (battle: Battle) => void;
  selectedBattle: Battle | null;
  dramatic: boolean;
  // atmosphereColor lets the parent shift the globe's atmosphere hue to match
  // the active era. Falls back to the default cyan when unset.
  atmosphereColor?: string;
  // warCountries lists the top participating countries of the currently
  // selected war (e.g. ["United States", "Germany", "Russia"]). When set,
  // those countries are shaded on the globe so the user can see which
  // territories the war touched at a glance.
  warCountries?: string[];
  // warAccent is the era-themed accent color used to shade the warCountries
  // polygons. Falls back to a generic blue when not supplied.
  warAccent?: string;
  // warCountryColors is the time-shifting territory snapshot in effect for
  // the war currently being watched (e.g. WW2 mid-1941: Germany red over
  // Poland/France/Norway/etc., USSR blue over Russia, UK blue over its
  // empire). When set it overrides the flat warAccent shading so each
  // country gets its controller's accent. Keyed by canonical country
  // name; the COUNTRY_NAME_ALIASES table handles atlas mismatches.
  warCountryColors?: Record<string, string>;
  // territoryLabel is the short caption shown briefly when a new snapshot
  // takes effect ("June 1944: D-Day, Bagration"). Drives a HUD overlay so
  // the user reads the campaign beat as a labeled stage.
  territoryLabel?: string;
}

// COUNTRY_NAME_ALIASES maps our canonical country labels to the names used
// by the world-atlas topology. The atlas is the Natural Earth dataset which
// uses long-form English names ("United States of America") while our
// canonisation produces short forms ("United States"). Korea is split into
// two atlas features but our normaliser collapses them, so we list both.
const COUNTRY_NAME_ALIASES: Record<string, string[]> = {
  'United States': ['United States of America'],
  'United Kingdom': ['United Kingdom'],
  Korea: ['South Korea', 'North Korea'],
  Rome: ['Italy'],
  Palestine: ['Palestine'],
};

const COUNTRIES_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';

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

// polygonCentroid averages every coordinate of a polygon or multipolygon
// geometry to produce a rough centroid. Good enough for placing a pulse
// ring inside the country (we use it only for the territory-flip
// animation, not for cartographic measurement). Returns [lat, lng] or null
// when the geometry has no usable coordinates.
function polygonCentroid(geom: Geometry): [number, number] | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (rings: Position[][]) => {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          sx += lng;
          sy += lat;
          n++;
        }
      }
    }
  };
  if (geom.type === 'Polygon') {
    walk(geom.coordinates);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) walk(poly);
  } else {
    return null;
  }
  if (n === 0) return null;
  return [sy / n, sx / n];
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

// formatNumber is a thin alias for the shared comma-formatter, kept so the
// existing call sites in this file (tooltip strings) read unchanged while
// the actual implementation lives in one place.
const formatNumber = formatNumberWithCommas;

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

// hexToRgba converts "#rrggbb" + alpha into an "rgba(r,g,b,a)" string.
// Used by ring color callbacks where the alpha animates over the ring's
// propagation, so a solid hex doesn't cut it.
function hexToRgba(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// darkenHex returns a solid darker variant of an #rrggbb color by scaling
// each channel by factor (0..1). Solid output keeps the merged point buffer
// fully opaque so depth sorting stays stable.
function darkenHex(hex: string, factor: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  const pad = (n: number) => n.toString(16).padStart(2, '0');
  return `#${pad(r)}${pad(g)}${pad(b)}`;
}

// midpoint returns the geographic midpoint between two points, handling
// antimeridian wrap so a Pearl Harbor → Doolittle Raid pair midpoints in the
// Pacific rather than over Africa. Latitude is a simple average; longitude
// chooses the shorter great-arc path.
function midpoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }): { lat: number; lng: number } {
  let dlng = b.lng - a.lng;
  if (dlng > 180) dlng -= 360;
  if (dlng < -180) dlng += 360;
  let midLng = a.lng + dlng / 2;
  if (midLng > 180) midLng -= 360;
  if (midLng < -180) midLng += 360;
  return { lat: (a.lat + b.lat) / 2, lng: midLng };
}

// arcDistance is a cheap surrogate for great-circle distance in degrees,
// using haversine on a unit sphere. Returns 0–180. Good enough to scale
// camera altitude on the war-playback flythrough without pulling in a real
// geo dependency.
function arcDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dphi = toRad(b.lat - a.lat);
  const dlambda = toRad(b.lng - a.lng);
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return (c * 180) / Math.PI;
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

export default function BattleGlobe({ battles, yearRange, onBattleClick, selectedBattle, dramatic, atmosphereColor, warCountries, warAccent, warCountryColors, territoryLabel }: BattleGlobeProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [countries, setCountries] = useState<Feature<Geometry>[]>([]);

  // visibleBattles filters to the active year window and drops anything
  // without usable geography. An exact 0 on either axis is treated as the
  // importer's "no coords" sentinel rather than a real location. Real
  // battles essentially never land on Null Island, the Prime Meridian
  // exactly, or the equator exactly; permitting them put the Courland
  // Pocket in the North Sea and the Battle of the Atlantic on the equator.
  // Better to hide a battle than to lie about where it happened.
  // Out-of-range coords (typos, bad imports) are silently excluded too so
  // they do not render off the back of the globe or shove the camera.
  const visibleBattles = useMemo(
    () => battles.filter((b) => {
      if (b.year < yearRange[0] || b.year > yearRange[1]) return false;
      if (b.lat === 0 || b.lng === 0) return false;
      if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return false;
      if (b.lat < -90 || b.lat > 90) return false;
      if (b.lng < -180 || b.lng > 180) return false;
      return true;
    }),
    [battles, yearRange],
  );

  const replayRings = useMemo(
    () => visibleBattles
      .filter((b) => b.hasReplay)
      .map((b) => ({ lat: b.lat, lng: b.lng, id: b.id, kind: 'replay' as const, color: '#93c5fd' })),
    [visibleBattles],
  );

  // Battle-ignition pulses: when a battle becomes newly visible (because the
  // history sweep just crossed its year), emit a one-shot ring in the era
  // color at its location. Lives for ~2.2s, then drops out so the rings
  // layer doesn't grow unbounded. Reads as "the battle just lit up" rather
  // than a static pin appearing.
  const lastIdsRef = useRef<Set<string>>(new Set());
  const [ignitionRings, setIgnitionRings] = useState<Array<{ lat: number; lng: number; id: string; kind: 'ignition'; color: string; expires: number }>>([]);

  useEffect(() => {
    const tNow = performance.now();
    const current = new Set<string>();
    const fresh: Battle[] = [];
    for (const b of visibleBattles) {
      current.add(b.id);
      if (!lastIdsRef.current.has(b.id) && lastIdsRef.current.size > 0) {
        fresh.push(b);
      }
    }
    lastIdsRef.current = current;
    // Two guards against the seizure-flashing the user hit during a fast
    // history scrub:
    //   1. If a single frame admits more than 30 new battles, the user is
    //      scrubbing rather than watching the ticker advance year by year.
    //      Skip the pulse entirely — the eye reads it as visual noise.
    //   2. Otherwise cap to a small random sample (max 6 per frame) so the
    //      pulse remains a cinematic accent, not a wall of strobing rings.
    if (fresh.length === 0) return;
    if (fresh.length > 30) return;
    const SAMPLE_CAP = 6;
    let chosen = fresh;
    if (fresh.length > SAMPLE_CAP) {
      const shuffled = [...fresh].sort(() => Math.random() - 0.5);
      chosen = shuffled.slice(0, SAMPLE_CAP);
    }
    const additions = chosen.map((b) => ({
      lat: b.lat,
      lng: b.lng,
      id: `ig-${b.id}-${tNow}`,
      kind: 'ignition' as const,
      color: ERA_COLORS[b.era] || '#ffffff',
      expires: tNow + 2200,
    }));
    setIgnitionRings((prev) => {
      const alive = prev.filter((r) => r.expires > tNow);
      return [...alive, ...additions];
    });
  }, [visibleBattles]);

  // Sweep expired ignition rings every 500ms when any are alive. Cheap
  // and bounded; stays idle when the history sweep is not active.
  useEffect(() => {
    if (ignitionRings.length === 0) return;
    const id = setInterval(() => {
      const tNow = performance.now();
      setIgnitionRings((prev) => prev.filter((r) => r.expires > tNow));
    }, 500);
    return () => clearInterval(id);
  }, [ignitionRings.length]);

  // Territory-flip pulses: when the war cinematic crosses a snapshot
  // boundary and a country's owner changes color, emit a brief ring at
  // that country's centroid so the user catches the flip even when the
  // smooth color tween is too subtle. Tracks the previous warCountryColors
  // map by reference so the very first paint of a fresh war doesn't fire
  // a ring on every country at once.
  const prevWarColorsRef = useRef<Record<string, string> | undefined>(undefined);
  const [flipRings, setFlipRings] = useState<Array<{ lat: number; lng: number; id: string; kind: 'flip'; color: string; expires: number }>>([]);

  useEffect(() => {
    const prev = prevWarColorsRef.current;
    prevWarColorsRef.current = warCountryColors ?? undefined;
    if (!warCountryColors || !prev || countries.length === 0) return;
    const changed: Array<{ name: string; color: string }> = [];
    for (const [name, color] of Object.entries(warCountryColors)) {
      if (prev[name] !== color) changed.push({ name, color });
    }
    if (changed.length === 0) return;
    // Resolve each changed country to a centroid by averaging its polygon
    // coordinates. World-atlas country geometries are stable enough that a
    // simple coordinate-average lands inside the country for every entry
    // we shade. A perfect cartographic centroid would be overkill for a
    // pulse animation.
    const tNow = performance.now();
    const fresh: Array<{ lat: number; lng: number; id: string; kind: 'flip'; color: string; expires: number }> = [];
    for (const { name, color } of changed) {
      const aliases = COUNTRY_NAME_ALIASES[name] ?? [name];
      const allNames = [name, ...aliases].map((s) => s.toLowerCase());
      const feat = countries.find((f) => allNames.includes(((f.properties as Record<string, string>)?.name ?? '').toLowerCase()));
      if (!feat) continue;
      const centroid = polygonCentroid(feat.geometry);
      if (!centroid) continue;
      fresh.push({
        lat: centroid[0],
        lng: centroid[1],
        id: `flip-${name}-${tNow}`,
        kind: 'flip',
        color,
        expires: tNow + 2400,
      });
    }
    if (fresh.length === 0) return;
    setFlipRings((prev) => {
      const alive = prev.filter((r) => r.expires > tNow);
      return [...alive, ...fresh];
    });
  }, [warCountryColors, countries]);

  useEffect(() => {
    if (flipRings.length === 0) return;
    const id = setInterval(() => {
      const tNow = performance.now();
      setFlipRings((prev) => prev.filter((r) => r.expires > tNow));
    }, 500);
    return () => clearInterval(id);
  }, [flipRings.length]);

  // Focus rings: a bright doppler pulse pinned to the currently selected
  // battle. Three concentric copies stacked so the rings cascade outward
  // like sonar pings. Always lives while a battle is selected — gives the
  // user a clear "the action is here" anchor on the globe behind any
  // open replay or war cinematic.
  const focusRings = useMemo(() => {
    if (!selectedBattle) return [] as Array<{ lat: number; lng: number; id: string; kind: 'focus'; color: string }>;
    const eraColor = ERA_COLORS[selectedBattle.era] || '#fbbf24';
    return [
      { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `focus-${selectedBattle.id}-a`, kind: 'focus' as const, color: eraColor },
      { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `focus-${selectedBattle.id}-b`, kind: 'focus' as const, color: eraColor },
      { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `focus-${selectedBattle.id}-c`, kind: 'focus' as const, color: eraColor },
    ];
  }, [selectedBattle]);

  const rings = useMemo(() => [...replayRings, ...ignitionRings, ...flipRings, ...focusRings], [replayRings, ignitionRings, flipRings, focusRings]);

  useEffect(() => {
    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((topo: Topology) => {
        const fc = feature(topo, topo.objects.countries) as FeatureCollection;
        setCountries(fc.features);
      })
      .catch(() => {});
  }, []);

  // featureColors maps each polygon feature shown on the globe to the
  // colour it should render in. When the war cinematic is active we keep
  // every country mounted in polygonsData so the polygon transition can
  // tween colour smoothly across snapshot changes. Countries that aren't
  // a belligerent at the current snapshot get a transparent fill (so they
  // are still mounted, just invisible) — that stops the pop-in/pop-out
  // flicker that happens when polygon features unmount.
  const { highlightedCountry, featureColors } = useMemo(() => {
    if (countries.length === 0) {
      return { highlightedCountry: [] as Feature<Geometry>[], featureColors: new Map<string, string>() };
    }
    const out: Feature<Geometry>[] = [];
    const colors = new Map<string, string>();
    if (selectedBattle) {
      const match = findCountry(selectedBattle.lat, selectedBattle.lng, countries);
      if (match) out.push(match);
    }
    const wanted = new Map<string, string | null>();
    if (warCountries && warCountries.length > 0) {
      for (const c of warCountries) {
        wanted.set(c.toLowerCase(), null);
        const aliases = COUNTRY_NAME_ALIASES[c];
        if (aliases) for (const a of aliases) wanted.set(a.toLowerCase(), null);
      }
    }
    if (warCountryColors) {
      for (const [country, color] of Object.entries(warCountryColors)) {
        wanted.set(country.toLowerCase(), color);
        const aliases = COUNTRY_NAME_ALIASES[country];
        if (aliases) for (const a of aliases) wanted.set(a.toLowerCase(), color);
      }
    }
    if (wanted.size > 0) {
      const seen = new Set(out.map((f) => f));
      // Include EVERY world-atlas country in the polygon set so react-
      // globe.gl never has to mount/unmount features as snapshots change.
      // Belligerent countries get their war color; everyone else gets the
      // sentinel '__neutral__' which polygonCapColor renders fully
      // transparent. This makes snapshot transitions a pure colour tween.
      for (const f of countries) {
        const name = (f.properties as Record<string, string>)?.name?.toLowerCase() || '';
        if (!name) continue;
        if (seen.has(f)) continue;
        out.push(f);
        const c = wanted.get(name);
        if (c) colors.set(name, c);
        else colors.set(name, '__neutral__');
      }
    }
    return { highlightedCountry: out, featureColors: colors };
  }, [selectedBattle, countries, warCountries, warCountryColors]);

  // hasWarShading determines whether the polygon overlay should render in the
  // multi-country war palette (accented, brighter borders) or in the single-
  // country battle-context palette (faint blue). We pick by checking whether
  // a war is currently active.
  const hasWarShading = !!(warCountries && warCountries.length > 0) || !!(warCountryColors && Object.keys(warCountryColors).length > 0);
  const warShadeColor = warAccent || '#3b82f6';

  // colorFor resolves a feature to its per-country colour from
  // featureColors, or falls back to warShadeColor. Used by the polygon
  // callbacks so each owner's territory paints in their accent.
  const colorFor = useCallback((feat: object): string => {
    const f = feat as Feature<Geometry>;
    const name = (f.properties as Record<string, string>)?.name?.toLowerCase() || '';
    return featureColors.get(name) || warShadeColor;
  }, [featureColors, warShadeColor]);

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

    // Runtime texture tuning (setPixelRatio, anisotropy, needsUpdate flags)
    // was removed here. On some GPU/driver combinations it forced a WebGL
    // context-loss/restore cycle, and three.js's onContextRestore crashes
    // with "TypeError: undefined is not an object (evaluating
    // 'info.autoReset')" inside three.module.js. The next sharpness pass
    // should ship a higher-resolution Earth texture file rather than poke
    // the renderer's pipeline at mount time.

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

    // Cold-open cinematography: snap to a high oblique vantage instantly,
    // then ease into the resting frame over a few seconds. The "tilt" is
    // implicit because the destination lat differs from the start lat, so
    // the camera pitches as it descends. Auto-rotate is paused during the
    // intro so the move reads as a directed shot rather than two motions
    // competing for the eye.
    controls.autoRotate = false;
    globe.pointOfView({ lat: 12, lng: -8, altitude: 3.4 });
    const introTimer = setTimeout(() => {
      globe.pointOfView({ lat: 32, lng: 14, altitude: 2.15 }, 3400);
    }, 220);
    const resumeRotateTimer = setTimeout(() => {
      if (!selectedBattleRef.current) controls.autoRotate = true;
    }, 4200);

    return () => {
      clearTimeout(idleTimer);
      clearTimeout(introTimer);
      clearTimeout(resumeRotateTimer);
      el.removeEventListener('mousedown', stopRotation);
      el.removeEventListener('wheel', stopRotation);
      el.removeEventListener('touchstart', stopRotation);
    };
  }, []);

  // previousBattleRef remembers the prior selection so a successive A → B
  // transition can fly through the midpoint instead of cutting straight from
  // one anchor to another. In cinematic war playback the user reads the
  // chain as "show A, lift back to read the campaign, drop onto B" rather
  // than yanking between unrelated points.
  const previousBattleRef = useRef<Battle | null>(null);
  useEffect(() => {
    if (!selectedBattle || !globeRef.current) {
      // Clear the memory once nothing is selected so the next first-pick
      // does its cleanest single descent.
      previousBattleRef.current = selectedBattle;
      return;
    }
    const globe = globeRef.current;
    globe.controls().autoRotate = false;
    const prev = previousBattleRef.current;
    previousBattleRef.current = selectedBattle;

    if (!prev || prev.id === selectedBattle.id) {
      // First selection (or a re-selection of the same battle). Single
      // smooth descent to the target. No midpoint, nothing to lift over.
      globe.pointOfView(
        { lat: selectedBattle.lat, lng: selectedBattle.lng, altitude: 1.1 },
        1500,
      );
      return;
    }

    // Two-step cinematic move: rise to the midpoint of prev and next at an
    // altitude that frames both, then drop into next. The lift altitude
    // scales with the great-arc distance so a near-neighbor jump barely
    // pulls back while a hop across continents really shows the journey.
    const mid = midpoint(prev, selectedBattle);
    const arcDeg = arcDistance(prev, selectedBattle);
    const liftAlt = Math.max(1.6, Math.min(2.8, 0.9 + arcDeg / 30));

    globe.pointOfView(
      { lat: mid.lat, lng: mid.lng, altitude: liftAlt },
      900,
    );
    const settle = setTimeout(() => {
      if (!globeRef.current) return;
      globeRef.current.pointOfView(
        { lat: selectedBattle.lat, lng: selectedBattle.lng, altitude: 1.1 },
        1100,
      );
    }, 950);
    return () => clearTimeout(settle);
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
    // Keep every color path opaque. Mixing alpha into the merged points
    // buffer flips the whole mesh to transparent, which causes pillars to
    // flicker as the depth sort swaps under camera motion.
    if (selectedBattle && selectedBattle.id !== b.id) return '#2a2a36';
    const base = ERA_COLORS[b.era] || '#ffffff';
    const tier = b.tier ?? (b.verified ? 'documented' : 'indexed');
    if (tier === 'indexed') return darkenHex(base, 0.55);
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
    const displayName = b.name?.trim() || 'Unnamed battle';
    // Date logic: prefer the full date string when present (carries the
    // day-of-month detail the user can't extract from year alone), else
    // fall back to a year-only line. Both branches feed the dedicated
    // DATE row so the placement is fixed across every battle.
    const yearStr = b.year === 0 ? '' : b.year < 0 ? `${Math.abs(b.year)} BC` : `${b.year}`;
    const dateText = b.date && b.date !== '0' ? b.date : yearStr;
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

    // Structured fact rows. Each one is a small-caps label + value pair
    // anchored to a fixed left column so the eye can scan dates straight
    // down across multiple tooltips without re-parsing the line every
    // time. Hidden rather than collapsed when a field is missing.
    const labelStyle =
      'display:inline-block;width:48px;font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(148,163,184,0.7);font-weight:600';
    const valueStyle = 'font-size:12px;color:#e2e8f0';
    const factRow = (label: string, value: string, valColor?: string) =>
      value
        ? `<div style="margin-top:3px;display:flex;align-items:baseline;gap:8px"><span style="${labelStyle}">${label}</span><span style="${valueStyle}${valColor ? `;color:${valColor}` : ''}">${escapeHTML(value)}</span></div>`
        : '';

    const totalCas = totalCasualties(b);
    const casText = totalCas > 0 ? `~${formatNumber(totalCas)}` : '';

    const replayLine = b.hasReplay
      ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(148,163,184,0.18);font-size:10px;color:#93c5fd;letter-spacing:0.08em;text-transform:uppercase">▶ Click marker for phase replay</div>'
      : b.hasSchematic
      ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(148,163,184,0.18);font-size:10px;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase">▶ Click marker for schematic</div>'
      : '';
    return `<div style="
      background: rgba(10,10,15,0.94);
      border: 1px solid ${eraColor};
      border-radius: 10px;
      padding: 10px 12px;
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px;
      color: #e2e8f0;
      max-width: min(280px, 84vw);
      box-shadow: 0 12px 32px rgba(0,0,0,0.55);
      pointer-events: none;
    ">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">${tierBadge}${typeBadge}</div>
      <div style="font-weight:600; font-size:14px; color:${eraColor}; line-height:1.2; margin-bottom:6px">${escapeHTML(displayName)}</div>
      ${factRow('Date', dateText)}
      ${factRow('War', b.war || '')}
      ${factRow('Victor', b.victor || '', '#86efac')}
      ${factRow('Cas.', casText, '#fbbf24')}
      ${replayLine}
    </div>`;
  }, []);

  const polygonLabel = useCallback((feat: object) => {
    const f = feat as Feature<Geometry>;
    const name = (f.properties as Record<string, string>)?.name || '';
    if (!name) return '';
    // Skip the tooltip for non-belligerent countries during war shading —
    // we keep them mounted (transparent) to stop polygon flicker, but
    // tooltipping every other country in the world is confusing.
    const featColor = featureColors.get(name.toLowerCase());
    if (featColor === '__neutral__') return '';
    // Wartime tooltip: country name + owner label if we know it. Owner
    // pulled by reverse-mapping featureColors → warCountryColors.
    let ownerHint = '';
    if (warCountryColors && featColor && featColor !== '__neutral__') {
      // Find the owner whose color matches; surface a short label.
      const ownerLabel = (() => {
        for (const [country, color] of Object.entries(warCountryColors)) {
          if (color === featColor) {
            // Map country → owner via OWNER_LABELS would be cleaner; for
            // now just show the country itself (the snapshot's structure
            // is owner→countries, so the same color = same owner).
            return country;
          }
        }
        return '';
      })();
      if (ownerLabel && ownerLabel !== name) {
        ownerHint = `<div style="color:#94a3b8;font-size:10px;margin-top:2px;">${escapeHTML(ownerLabel)} sphere</div>`;
      }
    }
    return `<div style="
      background: rgba(10,10,15,0.92);
      border: 1px solid rgba(59,130,246,0.6);
      border-radius: 6px;
      padding: 5px 11px;
      font-family: Inter, system-ui, sans-serif;
      font-size: 12px;
      font-weight: 600;
      color: #f1f5f9;
      pointer-events: none;
      box-shadow: 0 6px 18px rgba(0,0,0,0.5);
    ">${escapeHTML(name)}${ownerHint}</div>`;
  }, [featureColors, warCountryColors]);

  // The bottom-edge TimelineSlider visually weights the lower portion of
  // the viewport, so the geometric centre of the screen reads as too low.
  // Nudge the globe up by ~36px (roughly half the timeline strip) so the
  // sphere lands where the eye expects "centre" to be.
  return (
    <div style={{ transform: 'translateY(-36px)' }}>
    <Globe
      ref={globeRef as React.MutableRefObject<GlobeMethods | undefined>}
      width={dimensions.width}
      height={dimensions.height}
      globeImageUrl={HI_RES_EARTH}
      bumpImageUrl={TOPOLOGY_BUMP}
      backgroundImageUrl={NIGHT_SKY}
      atmosphereColor={atmosphereColor || '#7ab9ff'}
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
      pointsTransitionDuration={0}
      // pointResolution drives the segment count of the extruded point
      // cylinders. 6 reads as hexagonal prisms which feels chunky at globe
      // scale; 20 reads as smooth pillars without measurable GPU cost at
      // this point count.
      pointResolution={20}
      ringsData={rings}
      ringLat="lat"
      ringLng="lng"
      ringColor={(d: object) => {
        const r = d as { kind: 'replay' | 'ignition' | 'flip' | 'focus'; color: string };
        const base = r.color;
        if (r.kind === 'ignition') {
          // Single bright burst that fades fast: era-colored core dropping
          // from 95% to 0 alpha along the ring's outward propagation.
          return (t: number) => hexToRgba(base, 0.95 * (1 - t));
        }
        if (r.kind === 'flip') {
          // Territory-flip pulse: country flares in the new owner's color
          // as control changes hands at a snapshot boundary. Brighter than
          // the replay ring, with a slight inner-glow plateau before fade.
          return (t: number) => hexToRgba(base, t < 0.18 ? 0.95 : 0.95 * (1 - (t - 0.18) / 0.82));
        }
        if (r.kind === 'focus') {
          // Persistent doppler pulse on the selected battle. Bright at
          // start, smooth fade to zero so the three stacked copies cascade
          // outward like radar sweeps without flat banding.
          return (t: number) => hexToRgba(base, 0.85 * (1 - t * t));
        }
        return (t: number) => hexToRgba(base, 0.7 * (1 - t));
      }}
      ringMaxRadius={3.2}
      ringPropagationSpeed={1.8}
      ringRepeatPeriod={1900}
      ringAltitude={0.005}
      polygonsData={highlightedCountry}
      polygonCapColor={(feat: object) => {
        if (!hasWarShading) return 'rgba(59,130,246,0.08)';
        const c = colorFor(feat);
        return c === '__neutral__' ? 'rgba(64,72,90,0.0)' : hexToRgba(c, 0.68);
      }}
      polygonSideColor={(feat: object) => {
        if (!hasWarShading) return 'rgba(59,130,246,0.15)';
        const c = colorFor(feat);
        return c === '__neutral__' ? 'rgba(64,72,90,0.0)' : hexToRgba(c, 0.88);
      }}
      polygonStrokeColor={(feat: object) => {
        if (!hasWarShading) return 'rgba(59,130,246,0.4)';
        const c = colorFor(feat);
        return c === '__neutral__' ? 'rgba(64,72,90,0.0)' : hexToRgba(c, 1.0);
      }}
      polygonAltitude={(feat: object) => {
        if (!hasWarShading) return 0.005;
        const c = colorFor(feat);
        return c === '__neutral__' ? 0.0005 : 0.022;
      }}
      polygonsTransitionDuration={1200}
      polygonLabel={polygonLabel}
    />
    </div>
  );
}
