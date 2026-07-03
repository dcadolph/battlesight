import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';
import type { Battle } from '../../types/battle';
import { ERA_COLORS } from '../../types/battle';
import type { Feature, Geometry } from 'geojson';
import { HI_RES_EARTH, TOPOLOGY_BUMP, NIGHT_SKY } from '../../data/cities';
import { OWNER_LABELS } from '../../data/territory-snapshots';
import { flagForFaction } from '../../data/faction-flags';
import { loadWorldCountries, worldCountriesCache } from '../../data/world-countries';
import { formatNumberWithCommas } from '../../lib/format';
import { COUNTRY_NAME_ALIASES } from '../../lib/globe/aliases';
import { largestPolygonCentroid, polygonCentroid } from '../../lib/globe/centroid';
import { findCountry, arcDistance } from '../../lib/globe/geometry';
import { hexToRgba, darkenHex } from '../../lib/globe/colors';
import { buildFactionLabelElement } from '../../lib/globe/faction-label';
import { enhanceGlobe } from '../../lib/globe/cinematic';

// PersistentGlobe is the single Three.js scene mounted at app root. In
// this first cut it behaves identically to the old BattleGlobe — same
// props, same renderer, same camera. The future replay/cinematic mode
// will land via additional optional props (replay, phase, onSceneReady)
// in Step 4 of the AppGlobe refactor. By keeping the surface backward-
// compatible we can swap the App.tsx import today without any other
// changes; replay mode arrives as additive props later.
interface PersistentGlobeProps {
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
  // warFactionAnchors lists one anchor country per controlling power in
  // the active snapshot. Drives the editorial typography label layer so
  // each bloc shows its faction name in small-caps over its mainland (the
  // way Britannica and Map Men style historical atlases) instead of an
  // averaged centroid that lands "FRANCE" over Sudan.
  warFactionAnchors?: Array<{ faction: string; anchor: string }>;
  // warSnapshotYear is the historical year of the active territory
  // snapshot. Period-gates the national-flag overlay so the right banner
  // shows for the era (Nazi swastika 1933-1945, USSR hammer-and-sickle
  // 1922-1991) rather than the modern country flag.
  warSnapshotYear?: number;
  // landingMode controls what the dramatic-mode landing globe shows.
  // 'current' (default): filter to ongoing conflicts only and render
  // them as rippling pulses on a bare Earth. 'all': existing behavior
  // with every battle in the catalog as a colored pillar.
  landingMode?: 'current' | 'all';
  // paused halts the globe's render loop entirely. Set while a battle
  // replay covers the screen so the hidden globe stops burning GPU
  // frames behind the opaque overlay.
  paused?: boolean;
}

// CURRENT_CONFLICT_KEYWORDS matches the war field (lowercased) for
// ongoing post-2014 conflicts that should surface on the "current
// conflicts" default landing. Substring match so longer variants
// ("Russo-Ukrainian War / War in Donbas") still hit.
const CURRENT_CONFLICT_KEYWORDS = [
  'russo-ukrainian',
  'russian invasion of ukraine',
  'war in donbas',
  'syrian civil war',
  'syrian war',
  'iraq war',
  'war in iraq',
  'war against the islamic state',
  'isil',
  'islamic state',
  'israel-hamas',
  'israel–hamas',
  'gaza war',
  'palestine',
  'sudan civil war',
  'sudanese civil war',
  'yemen',
  'yemeni civil war',
  'libyan civil war',
  'second libyan civil war',
  'myanmar civil war',
  'myanmar conflict',
  'cabo delgado',
  'somali civil war',
  'tigray war',
  'second nagorno-karabakh',
  'sahel',
];

function isCurrentConflict(b: Battle): boolean {
  const w = (b.war || '').toLowerCase();
  if (!w) return false;
  const y = b.year ?? 0;
  if (y < 2014) return false;
  return CURRENT_CONFLICT_KEYWORDS.some((kw) => w.includes(kw));
}

// conflictColor maps a war name to a theater-family color so the
// landing globe's pulses sort by region at a glance: red for the
// Russo-Ukrainian front, amber for the Middle East / Levant, orange
// for the African Sahel and Horn of Africa, magenta for SE Asia,
// neutral for unmapped. Hex strings only — the ring renderer expects
// hex + alpha.
function conflictColor(war: string | undefined): string {
  const w = (war || '').toLowerCase();
  if (!w) return '#f87171';
  if (w.includes('ukrain') || w.includes('donbas')) return '#ef4444';
  if (w.includes('israel') || w.includes('hamas') || w.includes('gaza') || w.includes('palestin')) return '#fbbf24';
  if (w.includes('syria') || w.includes('iraq') || w.includes('islamic state') || w.includes('isil')) return '#f59e0b';
  if (w.includes('yemen')) return '#fb923c';
  if (w.includes('libya') || w.includes('sahel') || w.includes('cabo delgado')) return '#fdba74';
  if (w.includes('sudan') || w.includes('tigray') || w.includes('somali')) return '#fb7185';
  if (w.includes('myanmar')) return '#c084fc';
  if (w.includes('nagorno-karabakh')) return '#d8b4fe';
  return '#f87171';
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

export default function PersistentGlobe({ battles, yearRange, onBattleClick, selectedBattle, dramatic, atmosphereColor, warCountries, warAccent, warCountryColors, warFactionAnchors, warSnapshotYear, landingMode = 'current', paused = false }: PersistentGlobeProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [countries, setCountries] = useState<Feature<Geometry>[]>(() => worldCountriesCache() ?? []);

  // visibleBattles filters to the active year window and drops anything
  // without usable geography. An exact 0 on either axis is treated as the
  // importer's "no coords" sentinel rather than a real location. Real
  // battles essentially never land on Null Island, the Prime Meridian
  // exactly, or the equator exactly; permitting them put the Courland
  // Pocket in the North Sea and the Battle of the Atlantic on the equator.
  // Better to hide a battle than to lie about where it happened.
  // Out-of-range coords (typos, bad imports) are silently excluded too so
  // they do not render off the back of the globe or shove the camera.
  // Sanity filter against the import garbage. The wikidata pull cross-
  // contaminates fields on some entries — e.g. "Battle of Betamcarla" is
  // actually a 16th-century Vijayanagara battle in India, but our DB has
  // it at year=2025 in the Russo-Ukrainian War with coords in Brazil.
  // Until the importer is fixed, hide these on the front end: any battle
  // tagged with a current war (Russo-Ukrainian, Israel-Hamas, Sudan, etc)
  // whose year is implausible for that war gets dropped.
  const CURRENT_WAR_YEAR_RANGES: Record<string, [number, number]> = {
    'russo-ukrainian war': [2014, 2030],
    'war in donbas': [2014, 2030],
    'israel-hamas war': [2023, 2030],
    'israel–hamas war': [2023, 2030],
    'gaza war': [2023, 2030],
    'sudan civil war': [2023, 2030],
    'tigray war': [2020, 2024],
    'syrian civil war': [2011, 2030],
    'yemeni civil war': [2014, 2030],
    'second nagorno-karabakh war': [2020, 2024],
  };
  const visibleBattles = useMemo(
    () => battles.filter((b) => {
      if (b.year < yearRange[0] || b.year > yearRange[1]) return false;
      if (b.lat === 0 || b.lng === 0) return false;
      if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return false;
      if (b.lat < -90 || b.lat > 90) return false;
      if (b.lng < -180 || b.lng > 180) return false;
      // Cross-field garbage check: if the war is one of the known current
      // conflicts but the year sits outside that war's plausible range,
      // the import joined the wrong fields. Hide it.
      const war = (b.war || '').toLowerCase().trim();
      const range = CURRENT_WAR_YEAR_RANGES[war];
      if (range && (b.year < range[0] || b.year > range[1])) return false;
      // Current-conflicts landing: drop everything that isn't an ongoing
      // post-2014 war. The user gets a clean Earth with pulses on Ukraine,
      // Gaza, Sudan, Yemen, Syria, Myanmar, etc. — first impression is
      // "what's happening now," not "every battle ever." A toggle in the
      // chrome flips landingMode to 'all' for the full historical view.
      if (dramatic && landingMode === 'current' && !isCurrentConflict(b)) return false;
      return true;
    }),
    [battles, yearRange, dramatic, landingMode],
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Appends transient ignition pulses when new battles enter the visible set; imperative animation bookkeeping, not derivable state.
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

  // Selection-driven ignition burst + campaign-trace arc. Every time the user
  // (or cinematic) lands on a new battle, emit a ring on the new location so
  // even tooltip-only entries get a satisfying flash. When a previous battle
  // existed, also draw a fading arc from there to here — that arc IS the
  // movement story for the war: "the campaign moved from there to here."
  const lastSelectedRef = useRef<{ id: string; lat: number; lng: number } | null>(null);
  // suppressInitialBurstRef prevents the very first selection from firing
  // the shock-wave/impact rings on page load. Without it, an URL-hash deep
  // link or auto-featured battle on cold load would fire a flurry of rings
  // before the user has even rendered the first frame — distracting and
  // unwarranted. Flips false after the first selection arrives.
  const suppressInitialBurstRef = useRef(true);
  const [traceArcs, setTraceArcs] = useState<Array<{ id: string; startLat: number; startLng: number; endLat: number; endLng: number; color: string; expires: number }>>([]);
  useEffect(() => {
    if (!selectedBattle) {
      lastSelectedRef.current = null;
      return;
    }
    const prev = lastSelectedRef.current;
    if (prev?.id === selectedBattle.id) return;
    // Hoist tNow + color to the function scope so the trace-arc block below
    // can read them too. Previously they were scoped to the else branch and
    // the trace-arc setter referenced an undefined tNow on the very first
    // selection (when suppressInitialBurstRef is true), crashing BattleGlobe
    // and rendering the whole app as a black screen.
    const tNow = performance.now();
    const color = ERA_COLORS[selectedBattle.era] || '#fbbf24';
    if (suppressInitialBurstRef.current) {
      suppressInitialBurstRef.current = false;
    } else {
      setIgnitionRings((existing) => {
        const alive = existing.filter((r) => r.expires > tNow);
        // Quad-burst impact moment — bright white core flash, two era-
        // colored shock waves, and a slow trailing ripple. Staggered
        // expiries produce a layered "collision" feel rather than one
        // flat pulse.
        return [
          ...alive,
          { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `sel-${selectedBattle.id}-core-${tNow}`, kind: 'ignition' as const, color: '#ffffff', expires: tNow + 900 },
          { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `sel-${selectedBattle.id}-a-${tNow}`, kind: 'ignition' as const, color, expires: tNow + 2000 },
          { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `sel-${selectedBattle.id}-b-${tNow}`, kind: 'ignition' as const, color, expires: tNow + 2800 },
          { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `sel-${selectedBattle.id}-c-${tNow}`, kind: 'ignition' as const, color, expires: tNow + 3600 },
        ];
      });
    }
    if (prev) {
      // Distance check — skip arcs spanning more than half the globe (rare
      // jumps between distant theaters look like noise, not narrative).
      const dLat = selectedBattle.lat - prev.lat;
      const dLng = ((selectedBattle.lng - prev.lng + 540) % 360) - 180;
      const angular = Math.sqrt(dLat * dLat + dLng * dLng);
      if (angular > 1) {
        setTraceArcs((arcs) => {
          const alive = arcs.filter((a) => a.expires > tNow);
          return [
            ...alive,
            {
              id: `trace-${selectedBattle.id}-${tNow}`,
              startLat: prev.lat,
              startLng: prev.lng,
              endLat: selectedBattle.lat,
              endLng: selectedBattle.lng,
              color,
              expires: tNow + 4000,
            },
          ];
        });
      }
    }
    lastSelectedRef.current = { id: selectedBattle.id, lat: selectedBattle.lat, lng: selectedBattle.lng };
  }, [selectedBattle]);

  // Sweep expired trace arcs.
  useEffect(() => {
    if (traceArcs.length === 0) return;
    const id = setInterval(() => {
      const tNow = performance.now();
      setTraceArcs((arcs) => arcs.filter((a) => a.expires > tNow));
    }, 400);
    return () => clearInterval(id);
  }, [traceArcs.length]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Appends transient territory-flip pulses when the snapshot ownership changes; imperative animation bookkeeping, not derivable state.
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

  // Hard-clear all transient ring/arc layers whenever EITHER the war context
  // goes away (warCountryColors empty/undefined) OR no battle is selected.
  // Both are signals that the user is back on the bare main globe and
  // shouldn't see leftover rings or campaign-trace arcs from a previous
  // cinematic. Also resets the initial-burst guard so the next selection
  // lands cleanly.
  useEffect(() => {
    const noWar = !warCountryColors || Object.keys(warCountryColors).length === 0;
    const noSelection = !selectedBattle;
    if (noWar && noSelection) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clears transient animation layers when the war/selection context empties; imperative bookkeeping, not derivable state.
      setIgnitionRings([]);
      setTraceArcs([]);
      setFlipRings([]);
      suppressInitialBurstRef.current = true;
      lastSelectedRef.current = null;
    }
  }, [warCountryColors, selectedBattle]);

  // Focus rings: a bright doppler pulse pinned to the currently selected
  // battle. Three concentric copies stacked so the rings cascade outward
  // like sonar pings. Always lives while a battle is selected — gives the
  // user a clear "the action is here" anchor on the globe behind any
  // open replay or war cinematic.
  const focusRings = useMemo(() => {
    if (!selectedBattle) return [] as Array<{ lat: number; lng: number; id: string; kind: 'focus'; color: string }>;
    const eraColor = ERA_COLORS[selectedBattle.era] || '#fbbf24';
    // Five stacked rings instead of three — gives a denser, more dramatic
    // pulsing radar sweep on the active battle. White core ring reads as the
    // "epicenter flash" anchoring the eye.
    return [
      { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `focus-${selectedBattle.id}-core`, kind: 'focus' as const, color: '#ffffff' },
      { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `focus-${selectedBattle.id}-a`, kind: 'focus' as const, color: eraColor },
      { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `focus-${selectedBattle.id}-b`, kind: 'focus' as const, color: eraColor },
      { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `focus-${selectedBattle.id}-c`, kind: 'focus' as const, color: eraColor },
      { lat: selectedBattle.lat, lng: selectedBattle.lng, id: `focus-${selectedBattle.id}-d`, kind: 'focus' as const, color: eraColor },
    ];
  }, [selectedBattle]);

  // Current-conflict pulse rings, aggregated. Dense theaters (49 Donbas
  // entries within 200 km of each other, 27 Syrian battles around Aleppo)
  // were rendering as a tangled mesh of overlapping rings because every
  // catalog entry got its own broadcast. Cluster by war + 8-degree grid
  // cell and keep one ring per bucket. That collapses ~300 battles into
  // ~15 strong theater pulses the eye can read at a glance.
  const currentConflictRings = useMemo(() => {
    if (!dramatic || landingMode !== 'current') {
      return [] as Array<{ lat: number; lng: number; id: string; kind: 'conflict'; color: string }>;
    }
    const seen = new Set<string>();
    const out: Array<{ lat: number; lng: number; id: string; kind: 'conflict'; color: string }> = [];
    for (const b of visibleBattles) {
      const cell = `${(b.war || '').toLowerCase()}|${Math.round(b.lat / 8)}|${Math.round(b.lng / 8)}`;
      if (seen.has(cell)) continue;
      seen.add(cell);
      out.push({
        lat: b.lat,
        lng: b.lng,
        id: `cc-${b.id}`,
        kind: 'conflict' as const,
        color: conflictColor(b.war),
      });
    }
    return out;
  }, [dramatic, landingMode, visibleBattles]);

  const rings = useMemo(
    () => [...replayRings, ...ignitionRings, ...flipRings, ...focusRings, ...currentConflictRings],
    [replayRings, ignitionRings, flipRings, focusRings, currentConflictRings],
  );

  useEffect(() => {
    // The state initializer above already reads the hot cache synchronously,
    // so most mounts paint polygons on the first frame. This effect covers
    // the cold path; on a hot cache the promise resolves immediately with
    // the same array reference and the setState bails out.
    let cancelled = false;
    loadWorldCountries()
      .then((feats) => { if (!cancelled) setCountries(feats); })
      .catch(() => {});
    return () => { cancelled = true; };
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
    // Dedupe by NAME, not object reference. The previous reference-based
    // Set let the same country slip in twice (once via selectedBattle's
    // findCountry, again via the world-atlas iteration) because the two
    // code paths produce different Feature object instances. Two polygons
    // on the same country at the same altitude → GPU z-fighting and the
    // checkerboard pattern the user reported on France during the cinematic.
    const seenNames = new Set<string>();
    if (selectedBattle) {
      const match = findCountry(selectedBattle.lat, selectedBattle.lng, countries);
      if (match) {
        const name = (match.properties as Record<string, string>)?.name?.toLowerCase() || '';
        if (name && !seenNames.has(name)) {
          out.push(match);
          seenNames.add(name);
        }
      }
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
      for (const f of countries) {
        const name = (f.properties as Record<string, string>)?.name?.toLowerCase() || '';
        if (!name) continue;
        if (seenNames.has(name)) {
          // Already mounted via the selectedBattle path; just record its
          // color so colorFor resolves it correctly.
          const c = wanted.get(name);
          colors.set(name, c || '__neutral__');
          continue;
        }
        out.push(f);
        seenNames.add(name);
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

  // factionLabels renders one editorial faction tag per controlling power
  // at the mainland centroid of its anchor country. The tag is a small
  // period-accurate flag (Nazi banner for Reich, hammer-sickle for USSR,
  // modern country flag for present-day belligerents) stacked above the
  // faction name in editorial small-caps. Period gating means the Soviet
  // flag stops at 1991, the Nazi banner at 1945, etc. When no flag asset
  // exists for the era, the typography stands alone.
  const factionLabels = useMemo(() => {
    if (!warFactionAnchors || warFactionAnchors.length === 0) return [];
    if (countries.length === 0) return [];
    const year = warSnapshotYear ?? new Date().getFullYear();
    const out: Array<{ lat: number; lng: number; text: string; flag: string | null; faction: string }> = [];
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
        lat: c[0], lng: c[1],
        text: label.toUpperCase(),
        flag: flagForFaction(faction, year),
        faction,
      });
    }
    return out;
  }, [warFactionAnchors, countries, warSnapshotYear]);

  useEffect(() => {
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Halt the render loop while an opaque replay covers the screen. Two
  // concurrent WebGL contexts were rasterizing during every battle
  // replay; the hidden one is pure waste.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    if (paused) globe.pauseAnimation();
    else globe.resumeAnimation();
  }, [paused]);

  // cameraPov tracks the globe camera's facing at a coarse cadence so
  // the faction-label layer can hemisphere-cull. htmlElementsData DOM
  // nodes have no depth test: without the cull a far-side anchor
  // (an Australia label during a Pacific war) bleeds through onto the
  // visible face. 400ms poll: culling is a per-phase concern, not a
  // per-frame one, and polling avoids per-frame listener churn.
  const [cameraPov, setCameraPov] = useState<{ lat: number; lng: number }>({ lat: 42, lng: 22 });
  const hasFactionLabels = !!(warFactionAnchors && warFactionAnchors.length > 0);
  useEffect(() => {
    if (!hasFactionLabels) return;
    const timer = setInterval(() => {
      const globe = globeRef.current;
      if (!globe) return;
      const pov = globe.pointOfView() as { lat: number; lng: number };
      if (!pov || !Number.isFinite(pov.lat) || !Number.isFinite(pov.lng)) return;
      setCameraPov((prev) => {
        const moved = Math.abs(prev.lat - pov.lat) > 2 || Math.abs(prev.lng - pov.lng) > 2;
        return moved ? { lat: pov.lat, lng: pov.lng } : prev;
      });
    }, 400);
    return () => clearInterval(timer);
  }, [hasFactionLabels]);

  // visibleFactionLabels drops anchors more than 88 degrees of great-
  // circle from the camera facing, i.e. on the far hemisphere.
  const visibleFactionLabels = useMemo(() => {
    if (factionLabels.length === 0) return factionLabels;
    const camLat = (cameraPov.lat * Math.PI) / 180;
    const camLng = (cameraPov.lng * Math.PI) / 180;
    const limit = Math.cos((88 * Math.PI) / 180);
    return factionLabels.filter((l) => {
      const lat = (l.lat * Math.PI) / 180;
      const lng = (l.lng * Math.PI) / 180;
      const cosAngle =
        Math.sin(camLat) * Math.sin(lat) +
        Math.cos(camLat) * Math.cos(lat) * Math.cos(lng - camLng);
      return cosAngle > limit;
    });
  }, [factionLabels, cameraPov]);

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

    // Cold-open cinematography: land directly on a continental vantage
    // centered over Central Europe. The earlier opener parked the camera
    // off the West African coast at 12N -8E (Atlantic Ocean, looks like a
    // blank blue sphere) and then eased to the Mediterranean at 32N 14E
    // (also mostly ocean in frame). Both reads as "the app starts in the
    // damn ocean" before any content shows up. Now we open on land — 48N
    // 16E is roughly Vienna/Central Europe, where the densest historical
    // battle clusters live — with a gentle settle to the resting frame.
    controls.autoRotate = false;
    globe.pointOfView({ lat: 48, lng: 16, altitude: 2.6 });
    const introTimer = setTimeout(() => {
      globe.pointOfView({ lat: 42, lng: 22, altitude: 2.05 }, 2800);
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

    // Single smooth pan to the new battle. The earlier two-step
    // lift-and-drop was meant to feel like a fly-over but read as the
    // camera "jumping around" between battles. A direct great-arc glide
    // at a moderate duration feels intentional and lands cleanly.
    // Altitude stays constant across the move (no zoom-out lift) so the
    // shaded territories stay visible throughout.
    const arcDeg = prev ? arcDistance(prev, selectedBattle) : 0;
    const tweenMs = prev ? Math.max(1600, Math.min(2800, 1000 + arcDeg * 12)) : 1500;
    globe.pointOfView(
      { lat: selectedBattle.lat, lng: selectedBattle.lng, altitude: 1.1 },
      tweenMs,
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
      // In current-conflicts mode the points are rendered as flat dots
      // and the eye is led by the pulse rings below — no pillars.
      if (landingMode === 'current') return 0.002;
      const mag = battleMagnitude(b);
      const base = 0.012 + Math.abs(Math.sin(b.lat * 0.13 + b.lng * 0.17)) * 0.018;
      return base + mag * 0.06;
    }
    if (selectedBattle?.id === b.id) return 0.08;
    if (selectedBattle) return 0;
    return 0;
  }, [selectedBattle, dramatic, landingMode]);

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
      onGlobeReady={() => enhanceGlobe(globeRef.current)}
      globeImageUrl={HI_RES_EARTH}
      bumpImageUrl={TOPOLOGY_BUMP}
      backgroundImageUrl={NIGHT_SKY}
      atmosphereColor={atmosphereColor || '#8cc6ff'}
      atmosphereAltitude={0.18}
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
      // cylinders. Each battle is its own mesh (merge would kill click
      // handling), so segment count scales draw cost directly: 12 still
      // reads as a smooth pillar at globe scale, and the full-catalog
      // landing drops to 6 to keep ~12k cylinders viable.
      pointResolution={visibleBattles.length > 2000 ? 6 : 12}
      ringsData={rings}
      ringLat="lat"
      ringLng="lng"
      ringColor={(d: object) => {
        const r = d as { kind: 'replay' | 'ignition' | 'flip' | 'focus' | 'conflict'; color: string };
        const base = r.color;
        if (r.kind === 'ignition') {
          const peak = base === '#ffffff' ? 1.0 : 0.98;
          return (t: number) => hexToRgba(base, t < 0.12 ? peak : peak * Math.max(0, 1 - (t - 0.12) / 0.88));
        }
        if (r.kind === 'flip') {
          return (t: number) => hexToRgba(base, t < 0.18 ? 0.98 : 0.98 * (1 - (t - 0.18) / 0.82));
        }
        if (r.kind === 'focus') {
          const isCore = base === '#ffffff';
          const peak = isCore ? 1.0 : 0.92;
          return (t: number) => hexToRgba(base, peak * (1 - t * t));
        }
        if (r.kind === 'conflict') {
          // Continuous broadcast pulse for an active conflict location.
          // Brighter inner core, softer falloff than the replay ring so
          // a dense theater (Ukraine front, Gaza) reads as a sustained
          // signal rather than a flicker.
          return (t: number) => hexToRgba(base, 0.95 * Math.pow(1 - t, 1.6));
        }
        return (t: number) => hexToRgba(base, 0.78 * (1 - t));
      }}
      ringMaxRadius={5.5}
      ringPropagationSpeed={2.8}
      ringRepeatPeriod={1100}
      ringAltitude={0.008}
      arcsData={traceArcs}
      arcStartLat={(d: object) => (d as { startLat: number }).startLat}
      arcStartLng={(d: object) => (d as { startLng: number }).startLng}
      arcEndLat={(d: object) => (d as { endLat: number }).endLat}
      arcEndLng={(d: object) => (d as { endLng: number }).endLng}
      arcColor={(d: object) => {
        const a = d as { color: string };
        return [`${a.color}f0`, `${a.color}30`];
      }}
      arcAltitudeAutoScale={0.5}
      arcStroke={0.45}
      arcDashLength={0.35}
      arcDashGap={0.18}
      arcDashAnimateTime={1600}
      arcsTransitionDuration={0}
      polygonsData={highlightedCountry}
      polygonCapColor={(feat: object) => {
        if (!hasWarShading) return 'rgba(59,130,246,0.14)';
        const c = colorFor(feat);
        // Non-belligerents get an opaque neutral slate so the satellite-
        // photo greens don't bleed through. Earlier 36% alpha left the
        // map looking patchy — green Earth visible between every shaded
        // country. 78% alpha covers the green while staying clearly
        // distinct from the colored belligerents. Belligerents punch
        // through at 0.94 alpha for editorial weight.
        if (c === '__neutral__') return 'rgba(48,56,72,0.78)';
        return hexToRgba(c, 0.94);
      }}
      polygonSideColor={() => 'rgba(0,0,0,0)'}
      polygonStrokeColor={(feat: object) => {
        if (!hasWarShading) return 'rgba(59,130,246,0.55)';
        const c = colorFor(feat);
        if (c === '__neutral__') return 'rgba(110,124,148,0.65)';
        return hexToRgba(c, 1.0);
      }}
      polygonAltitude={() => 0.002}
      polygonsTransitionDuration={650}
      polygonLabel={polygonLabel}
      htmlElementsData={visibleFactionLabels}
      htmlLat={(d: object) => (d as { lat: number }).lat}
      htmlLng={(d: object) => (d as { lng: number }).lng}
      htmlAltitude={0.014}
      htmlElement={(d: object) => buildFactionLabelElement(d as { text: string; faction: string; flag: string | null })}
    />
    </div>
  );
}
