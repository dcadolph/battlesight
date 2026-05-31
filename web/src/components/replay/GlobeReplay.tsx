import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';
import type { Feature, Geometry, Position } from 'geojson';

import type { Battle } from '../../types/battle';
import type { Phase, Replay, Faction, ControlRegion, PaletteContext } from '../../types/replay';
import { factionColorFor } from '../../types/replay';
import { HI_RES_EARTH, TOPOLOGY_BUMP, NIGHT_SKY } from '../../data/cities';
import { loadWorldCountries, worldCountriesCache } from '../../data/world-countries';
import { OWNER_LABELS } from '../../data/territory-snapshots';
import { flagForFaction } from '../../data/faction-flags';
import { themeForEra } from '../../theme/era';
import { playImpact } from '../../audio/sound';
import { COUNTRY_NAME_ALIASES } from '../../lib/globe/aliases';
import { largestPolygonCentroid } from '../../lib/globe/centroid';
import { findCountry } from '../../lib/globe/geometry';
import { hexWithAlpha } from '../../lib/globe/colors';
import { buildFactionLabelElement } from '../../lib/globe/faction-label';

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
  // warFactionAnchors + warSnapshotYear drive the in-cinematic faction
  // identity layer: one period-accurate flag banner + editorial label per
  // controlling power, placed at the mainland centroid of each faction's
  // anchor country. Without these the replay overlay would show the
  // shading but no caller-name overlay, so the user can't tell red Reich
  // from red USSR at a glance.
  warFactionAnchors?: Array<{ faction: string; anchor: string }>;
  warSnapshotYear?: number;
  // onSceneReady fires once the Three.js scene is up (globe ref attached
  // + first pointOfView completed). BattleReplay holds its title card
  // opaque until this fires plus a minimum dwell, then crossfades to
  // the live globe — eliminates the "wonky reconciliation" the user
  // sees when polygons, flags, and arrows arrive on different timelines.
  onSceneReady?: () => void;
}

// Default geographic extent in degrees per 100 units of normalized 0-100 phase
// space. 3° is about 330 km wide, a campaign / operational scale wide enough
// that arrows traverse visible geography.
const DEFAULT_EXTENT_DEG = 3.0;

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

export default function GlobeReplay({ battle, replay, phase, phaseIdx, warCountryColors, warFactionAnchors, warSnapshotYear, onSceneReady }: GlobeReplayProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [countries, setCountries] = useState<Feature<Geometry>[]>(() => worldCountriesCache() ?? []);
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
    if (countries.length > 0) return;
    let cancelled = false;
    loadWorldCountries()
      .then((feats) => { if (!cancelled) setCountries(feats); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [countries.length]);

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
  // Guard against (0, 0) and other origin-near garbage coordinates. A battle
  // with `lat: 0, lng: 0` is bad data, not a real location. Snapping the
  // camera there parks the user in the Gulf of Guinea staring at open ocean.
  // Fall back to a neutral mid-latitude European vantage so the polygons
  // still have something to frame.
  const battleCoordsValid = Number.isFinite(battle.lat) && Number.isFinite(battle.lng)
    && (Math.abs(battle.lat) + Math.abs(battle.lng)) > 0.5;
  const safeBattleLat = battleCoordsValid ? battle.lat : 30;
  const safeBattleLng = battleCoordsValid ? battle.lng : 10;
  const cameraLat = phase.cameraLat ?? safeBattleLat;
  const cameraLng = phase.cameraLng ?? safeBattleLng;
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

  // Camera choreography. Three distinct moves:
  //   - Initial mount of GlobeReplay: instant snap so the user lands on the
  //     battle frame instead of watching the camera fly in from Null Island
  //     (react-globe.gl's default vantage).
  //   - First phase of a NEW battle inside the same cinematic session:
  //     smooth eased tween from the previous battle's vantage to the new
  //     one. Hard-snapping here is what made the war cinematic feel like
  //     a slideshow.
  //   - Subsequent phases inside the same battle: long eased tween between
  //     curated phase vantages.
  const initialMountRef = useRef(true);
  const firstPhaseAppliedRef = useRef(false);
  const sceneReadyFiredRef = useRef(false);
  // phaseSettled is the cinematic gate. SVG overlay content (unit
  // markers, arrows, captions) holds at opacity 0 until the camera has
  // arrived at the phase vantage AND a beat of polygon paint has
  // passed. Stops the user from watching airdrop captions render over
  // a still-Asia globe — the symptom in the user's screenshots.
  const [phaseSettled, setPhaseSettled] = useState(false);
  useEffect(() => {
    setPhaseSettled(false);
    // Retry the camera snap on each animation frame until the
    // react-globe.gl ref is attached. Earlier the useEffect tried once
    // and returned; if the ref hadn't been assigned yet the camera
    // never moved and the user saw a default vantage instead of the
    // battle. With a RAF loop, the snap fires reliably within a frame
    // or two of mount.
    let cancelled = false;
    let raf = 0;
    let primaryMs = 0;
    let driftTimer: ReturnType<typeof setTimeout> | undefined;
    let breatheTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;

    const apply = () => {
      if (cancelled) return;
      if (!globeRef.current) {
        raf = requestAnimationFrame(apply);
        return;
      }
      const globe = globeRef.current;
      const controls = globe.controls();
      controls.autoRotate = false;

      if (initialMountRef.current) {
        primaryMs = 0;
        globe.pointOfView({ lat: cameraLat, lng: cameraLng, altitude: cameraAlt }, 0);
        initialMountRef.current = false;
        firstPhaseAppliedRef.current = true;
      } else if (!firstPhaseAppliedRef.current) {
        // First phase of a fresh battle. The previous 1500 ms eased
        // fly felt like a deliberate camera move on every transition;
        // user called it "WAY too slow". 600 ms still reads as a move,
        // not a teleport.
        primaryMs = 600;
        globe.pointOfView({ lat: cameraLat, lng: cameraLng, altitude: cameraAlt }, primaryMs);
        firstPhaseAppliedRef.current = true;
      } else {
        // Subsequent phases inside the same battle. The curator-set
        // tweenMs is honoured but capped so no phase can wait longer
        // than 700 ms on the camera.
        primaryMs = Math.min(700, Math.max(400, tweenMs));
        globe.pointOfView({ lat: cameraLat, lng: cameraLng, altitude: cameraAlt }, primaryMs);
      }

      // Signal scene-ready only AFTER the camera arrives at the
      // battle, so BattleReplay's title-card stays opaque until the
      // user would see the correct frame. On initial mount this is
      // basically instant (primaryMs = 0); on inter-battle transitions
      // it waits for the 1500ms fly.
      if (!sceneReadyFiredRef.current && onSceneReady) {
        readyTimer = setTimeout(() => {
          if (cancelled) return;
          sceneReadyFiredRef.current = true;
          onSceneReady();
        }, primaryMs + 100);
      }

      // phaseSettled gates the SVG overlay. Wait for camera arrival
      // plus a tiny polygon-paint buffer. Buffer was 220 ms — cut to
      // 80 ms so arrows appear right as the camera lands, not a beat
      // after.
      settleTimer = setTimeout(() => {
        if (!cancelled) setPhaseSettled(true);
      }, primaryMs + 80);

      driftTimer = setTimeout(() => {
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
          3200,
        );
      }, primaryMs + 200);

      breatheTimer = setTimeout(() => {
        const c = globeRef.current?.controls();
        if (!c) return;
        c.autoRotate = true;
        c.autoRotateSpeed = 0.03;
      }, primaryMs + 600);
    };

    apply();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (driftTimer) clearTimeout(driftTimer);
      if (breatheTimer) clearTimeout(breatheTimer);
      if (settleTimer) clearTimeout(settleTimer);
      if (readyTimer) clearTimeout(readyTimer);
      const c = globeRef.current?.controls();
      if (c) c.autoRotate = false;
    };
  }, [cameraLat, cameraLng, cameraAlt, tweenMs, movementCentroid, onSceneReady]);

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
    // Altitude-responsive shading. At wide political view (camera high
    // up) the country fills carry the story: France blue, Germany red,
    // the eye reads the war at a glance — the user's image-13 moment of
    // brilliance. At tight tactical zoom (camera close in) the visible
    // polygon is one country, which floods the entire frame with a
    // single colour and kills every other signal on the map (the
    // image-14 disaster: pure blue rectangle with no arrows visible).
    // The fix is to scale the cap alpha by altitude so the same scene
    // reads correctly at every zoom level. Stroke alpha follows but
    // stays a beat brighter so the border outline survives at tight
    // zoom even when the fill fades to near-transparent.
    const belligerentAlpha = cameraAlt > 0.25 ? 0.94
      : cameraAlt > 0.12 ? 0.62
      : 0.22;
    const neutralAlpha = cameraAlt > 0.25 ? 0.78
      : cameraAlt > 0.12 ? 0.48
      : 0.18;
    const strokeAlpha = cameraAlt > 0.25 ? 1.0
      : cameraAlt > 0.12 ? 0.85
      : 0.6;
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
            capColor: hexWithAlpha(color, belligerentAlpha),
            strokeColor: hexWithAlpha(color, strokeAlpha),
            sideColor: 'rgba(0,0,0,0)',
            altitude: 0.002,
          });
        } else {
          out.push({
            feature: feat as Feature<Geometry>,
            capColor: `rgba(48,56,72,${neutralAlpha})`,
            strokeColor: `rgba(110,124,148,${Math.min(0.85, strokeAlpha)})`,
            sideColor: 'rgba(0,0,0,0)',
            altitude: 0.002,
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
  }, [highlightedCountry, phase.controlRegions, warCountryColors, countries, replay, cameraAlt]);

  // factionLabels mirrors the BattleGlobe overlay: one period-accurate
  // flag banner + editorial caps label per controlling power, anchored
  // at the mainland centroid of its anchor country. Without this layer
  // the replay overlay would show colored shading but no caller name,
  // so the user can't tell red Reich from red USSR at a glance.
  const factionLabels = useMemo(() => {
    if (!warFactionAnchors || warFactionAnchors.length === 0) return [];
    if (countries.length === 0) return [];
    const year = warSnapshotYear ?? battle.year ?? new Date().getFullYear();
    // Hemisphere cull. react-globe.gl's HTML elements layer is rendered
    // through CSS3D and does NOT z-cull, so an anchor on the far side of
    // the planet bleeds through onto whatever is on the visible face.
    // Concretely: an AUSTRALIA Allied sub-anchor at (-25 S, 134 E) was
    // appearing stamped on top of Germany when the camera looked at
    // Europe. The fix is a great-circle angle test against the phase
    // camera target: anchors > ~88° from the camera are on the back of
    // the globe and are dropped from the list.
    const toRad = Math.PI / 180;
    const camLatR = cameraLat * toRad;
    const camLngR = cameraLng * toRad;
    const sinCam = Math.sin(camLatR);
    const cosCam = Math.cos(camLatR);
    const cosThreshold = Math.cos(88 * toRad);
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
      const aLatR = c[0] * toRad;
      const aLngR = c[1] * toRad;
      const cosAngle = sinCam * Math.sin(aLatR)
        + cosCam * Math.cos(aLatR) * Math.cos(aLngR - camLngR);
      if (cosAngle < cosThreshold) continue;
      out.push({
        lat: c[0], lng: c[1],
        text: label.toUpperCase(),
        flag: flagForFaction(faction, year),
        faction,
      });
    }
    return out;
  }, [warFactionAnchors, countries, warSnapshotYear, battle.year, cameraLat, cameraLng]);

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
        // Minimum projected arrow length. Sub-km tactical movements
        // (Pegasus Bridge = 440 m, Pointe du Hoc = 200 m) project to
        // 1-2 px even at the curator's tight 0.06 altitude, so the eye
        // sees a dot instead of a vector. If the projected length is
        // under MIN_ARROW_PX, stretch the start point BACKWARD from
        // the (geographically accurate) end point along the arrow
        // direction so the arrow always reads as a directional move.
        // The destination is honest; the origin is symbolic at this
        // scale anyway.
        const MIN_ARROW_PX = 110;
        const nextArrows: ProjectedArrow[] = movementGeo.map((m) => {
          const start = globe.getScreenCoords(m.startLat, m.startLng, 0) as { x: number; y: number } | null;
          const end = globe.getScreenCoords(m.endLat, m.endLng, 0) as { x: number; y: number } | null;
          const sOk = !!start && Number.isFinite(start.x) && Number.isFinite(start.y);
          const eOk = !!end && Number.isFinite(end.x) && Number.isFinite(end.y);
          let x1 = sOk ? start!.x : 0;
          let y1 = sOk ? start!.y : 0;
          const x2 = eOk ? end!.x : 0;
          const y2 = eOk ? end!.y : 0;
          if (sOk && eOk) {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0 && len < MIN_ARROW_PX) {
              const scale = MIN_ARROW_PX / len;
              x1 = x2 - dx * scale;
              y1 = y2 - dy * scale;
            } else if (len === 0) {
              // Same point. Default an inbound vector from the
              // upper-left so the destination at least gets a tip.
              x1 = x2 - MIN_ARROW_PX * 0.7071;
              y1 = y2 - MIN_ARROW_PX * 0.7071;
            }
          }
          return {
            index: m.index,
            faction: m.faction,
            x1, y1, x2, y2,
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
        polygonsTransitionDuration={500}
        htmlElementsData={factionLabels}
        htmlLat={(d: object) => (d as { lat: number }).lat}
        htmlLng={(d: object) => (d as { lng: number }).lng}
        htmlAltitude={0.014}
        htmlElement={(d: object) => buildFactionLabelElement(d as { text: string; faction: string; flag: string | null })}
      />
      <svg
        className="absolute inset-0 pointer-events-none"
        width={dims.width}
        height={dims.height}
        viewBox={`0 0 ${dims.width} ${dims.height}`}
        style={{
          // phaseSettled gates the entire overlay so arrows, units, and
          // captions stay invisible until the camera has arrived at
          // the phase vantage. 200 ms crossfade — fast enough to feel
          // snappy, slow enough to read as a deliberate reveal.
          opacity: phaseSettled ? 1 : 0,
          transition: 'opacity 200ms ease-out',
        }}
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
                viewBox="0 0 12 12"
                refX="11"
                refY="6"
                markerWidth="14"
                markerHeight="14"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                {/* Filled triangle arrowhead in absolute screen pixels.
                    markerUnits=userSpaceOnUse pins the marker size to
                    14 px regardless of stroke width — without this, the
                    SVG default scales the marker by strokeWidth and a
                    stroke=8 charge arrow produced a 112 px blob that
                    swallowed the entire path on short geographic moves.
                    Dark stroke gives a contrast rim so the head reads on
                    any territorial color (blue arrow on blue Allied
                    shading was invisible without it). */}
                <path
                  d="M 0 0 L 12 6 L 0 12 Z"
                  fill={c}
                  stroke="rgba(6,9,18,0.9)"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                  style={{ filter: `drop-shadow(0 1px 2px rgba(0,0,0,0.6))` }}
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
        {/* Unit captions. Tethered field caption under each defender so the
            unit's name and faction read at a glance. Replaces the boxy
            in-marker pill that was hard to read against bright globe colors. */}
        {units.filter((u) => u.visible && u.label).map((u) => (
          <FieldCaption
            key={`unit-cap-${phaseIdx}-${u.index}`}
            ax={u.x}
            ay={u.y}
            text={u.label}
            color={factionColorFor(u.faction, replay)}
            size="unit"
            sideHint="bottom"
            index={u.index}
            appearMs={u.index * 80 + 420}
            stageW={dims.width}
            stageH={dims.height}
          />
        ))}
        {/* Movement captions. Each labelled arrow gets a tethered caption at
            its midpoint, anchored with a small color dot and a thin leader
            line out to the text. Pops in just before the trace lands so the
            story arrives WITH the force, not after. */}
        {arrows.filter((a) => a.visible && a.label).map((a) => {
          const t = arrowTiming(a.kind, a.index);
          const mx = (a.x1 + a.x2) / 2;
          const my = (a.y1 + a.y2) / 2;
          return (
            <FieldCaption
              key={`mov-cap-${phaseIdx}-${a.index}`}
              ax={mx}
              ay={my}
              text={a.label || ''}
              color={factionColorFor(a.faction, replay)}
              size="movement"
              sideHint="auto"
              index={a.index}
              appearMs={t.appearDelay + t.traceMs - 200}
              stageW={dims.width}
              stageH={dims.height}
            />
          );
        })}
        {/* Phase title caption. Anchored at the centroid of the visible
            action — arrow midpoints if there are arrows, otherwise the
            centroid of visible units. The caption holds for the phase
            dwell then fades, replacing the old chapter card that was
            pinned to the bottom of the stage and far from the action. */}
        {(() => {
          const visArrows = arrows.filter((a) => a.visible);
          let cx: number | null = null;
          let cy: number | null = null;
          if (visArrows.length > 0) {
            cx = visArrows.reduce((s, a) => s + (a.x1 + a.x2) / 2, 0) / visArrows.length;
            cy = visArrows.reduce((s, a) => s + (a.y1 + a.y2) / 2, 0) / visArrows.length;
          } else {
            const visUnits = units.filter((u) => u.visible);
            if (visUnits.length > 0) {
              cx = visUnits.reduce((s, u) => s + u.x, 0) / visUnits.length;
              cy = visUnits.reduce((s, u) => s + u.y, 0) / visUnits.length;
            }
          }
          if (cx === null || cy === null) return null;
          const yearTail = phase.timeMarker && battle.year && !/\d{4}/.test(phase.timeMarker)
            ? ` · ${battle.year}` : '';
          const eyebrow = phase.timeMarker ? `${phase.timeMarker}${yearTail}` : (battle.year ? String(battle.year) : '');
          return (
            <FieldCaption
              key={`phase-cap-${phaseIdx}`}
              ax={cx}
              ay={cy}
              eyebrow={eyebrow}
              text={phase.title}
              color={themeForEra(battle.era).accent}
              font={themeForEra(battle.era).titleFont}
              size="phase"
              sideHint="top"
              index={0}
              appearMs={120}
              cycle
              stageW={dims.width}
              stageH={dims.height}
            />
          );
        })()}
      </svg>
    </div>
  );
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

  let stroke = 6;
  if (kind === 'charge') stroke = 8;
  else if (kind === 'flank') stroke = 7;
  else if (kind === 'rout' || kind === 'retreat' || kind === 'withdrawal') stroke = 4.5;

  const color = factionColorFor(faction, paletteCtx);
  const markerId = `gr-arrow-${phaseIdx}-${faction}`;
  const path = `M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}`;

  const { appearDelay, traceMs } = arrowTiming(kind, index);

  // Two layers. Halo for weight, shaft for the line of advance with the
  // arrowhead pinned to its leading end. The trace IS the motion: the
  // line writes itself from base to objective over ~1.2-2s and then
  // holds. Military maps don't march dashes; they show static arrows
  // you read at a glance. The arrowhead marker uses userSpaceOnUse on
  // the <marker> so it stays a fixed 14 px tip regardless of stroke
  // width — without that, a charge stroke of 8 multiplied a 14-unit
  // marker into a 112 px blob that swallowed the whole shaft.
  return (
    <g>
      {/* Soft halo. Wide blurred glow under the line gives the arrow
          weight at cinematic distance without overdrawing the line. */}
      <path
        d={path}
        stroke={color}
        strokeOpacity={0}
        strokeWidth={stroke + 10}
        fill="none"
        strokeLinecap="round"
        style={{
          filter: 'blur(5px)',
          animation: `arrow-halo-in 700ms ${appearDelay}ms ease-out forwards`,
        }}
      />
      {/* Dark underlay stroke. Stacks under the colored shaft and
          renders ~3 px wider so a thin dark rim shows on both sides of
          the line. Without this, a blue arrow disappears against the
          blue Allied territorial shading (the user's Pegasus Bridge
          screenshot — clean coastline + nearly invisible movement
          arrow). Animated with the same trace so the rim draws in
          along with the shaft, not as a separate event. */}
      <path
        d={path}
        stroke="rgba(6,9,18,0.85)"
        strokeWidth={stroke + 3}
        fill="none"
        strokeLinecap="round"
        pathLength={1}
        style={{
          strokeDasharray: '1 1',
          strokeDashoffset: 1,
          animation: `arrow-trace ${traceMs}ms ${appearDelay}ms cubic-bezier(.25,.65,.25,1) forwards`,
        }}
      />
      {/* Shaft. The line of advance. Solid bold stroke drawn from start
          to objective via a pathLength=1 dashoffset trace, then held at
          full opacity so it stays as a clean line on the map. The
          arrowhead marker is attached HERE so it lands exactly when the
          trace reaches the objective. */}
      <path
        d={path}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        pathLength={1}
        markerEnd={`url(#${markerId})`}
        style={{
          strokeDasharray: '1 1',
          strokeDashoffset: 1,
          filter: `drop-shadow(0 1px 2px rgba(0,0,0,0.55))`,
          animation: `arrow-trace ${traceMs}ms ${appearDelay}ms cubic-bezier(.25,.65,.25,1) forwards`,
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

interface FieldCaptionProps {
  // ax, ay are the screen-space anchor point on the action — usually the
  // midpoint of an arrow, the center of a unit marker, or the centroid
  // of all visible arrows for a phase title.
  ax: number;
  ay: number;
  // text is the caption body. eyebrow is an optional small-caps line
  // above it (used by the phase title to carry the time marker).
  text: string;
  eyebrow?: string;
  // color drives the anchor dot and leader line. The text itself reads
  // white with a dark stroke so it stays legible on any globe color.
  color: string;
  // size selects type weight and offsets. phase is the loudest beat;
  // movement is mid; unit is the smallest tag under a defender marker.
  size: 'phase' | 'movement' | 'unit';
  // sideHint controls which side of the anchor the caption sits on.
  // 'top' / 'bottom' pin a direction. 'auto' alternates above/below by
  // index so a flurry of arrows distributes labels evenly.
  sideHint: 'top' | 'bottom' | 'auto';
  // index drives the auto-side alternation. Pass the arrow / unit index.
  index?: number;
  // appearMs is the delay before the caption animates in. Tied to the
  // arrow's trace timing so the caption arrives WITH the force, not
  // after.
  appearMs: number;
  // cycle uses the held-then-fade animation so the caption acts like a
  // phase beat (shows, holds for a few seconds, fades). One-shot
  // captions stay parked.
  cycle?: boolean;
  // stageW / stageH let the caption flip to the inward side when its
  // anchor is near a stage edge, so the label never falls off-screen.
  stageW: number;
  stageH: number;
  // font overrides the main text's font-family. The phase caption
  // passes the era's title font (serif for ancient / medieval /
  // napoleonic / world wars) so the beat lands with editorial weight
  // instead of UI-sans.
  font?: string;
}

// FieldCaption renders a tethered caption near the action. Anchor dot
// pops at the action, a thin leader line draws out toward the text,
// then the text fades in. No background box — paint-order: stroke fill
// puts a dark stroke under a white fill so the words read on any globe
// color the camera flies over. Replaces the boxy pill labels that
// previously sat low on the stage and covered too much map.
function FieldCaption({
  ax, ay, text, eyebrow, color, size, sideHint, index = 0,
  appearMs, cycle = false, stageW, stageH, font,
}: FieldCaptionProps) {
  // Vertical direction: top means caption above the anchor. Auto
  // alternates by index, then flips inward if it would fall off the
  // top or bottom of the stage.
  const edge = 90;
  let dirY: 1 | -1;
  if (sideHint === 'top') dirY = ay > edge ? -1 : 1;
  else if (sideHint === 'bottom') dirY = ay < stageH - edge ? 1 : -1;
  else dirY = index % 2 === 0 ? (ay > edge ? -1 : 1) : (ay < stageH - edge ? 1 : -1);

  // Horizontal direction: lean toward the center of the stage so the
  // caption never hugs the edge.
  const dirX: 1 | -1 = ax < stageW / 2 ? 1 : -1;

  // Offsets per size. Phase reads loudest and needs the most room from
  // the action. Movement sits closer; unit sits tightest.
  const offX = size === 'phase' ? 64 : size === 'movement' ? 40 : 24;
  const offY = size === 'phase' ? 52 : size === 'movement' ? 34 : 20;
  const tx = ax + dirX * offX;
  const ty = ay + dirY * offY;
  const textAnchor = dirX > 0 ? 'start' : 'end';

  const fontSize = size === 'phase' ? 28 : size === 'movement' ? 13 : 11;
  const fontWeight = size === 'phase' ? 600 : size === 'movement' ? 600 : 500;
  const eyebrowSize = size === 'phase' ? 10 : 9;
  const strokeWidth = size === 'phase' ? 4.5 : 3;
  const dotR = size === 'phase' ? 3.6 : 2.8;
  const mainFont = font ?? "'Inter', system-ui, sans-serif";

  // Animation choice: cycle = held-then-fade (phase title beat),
  // otherwise = one-shot fade-in that stays.
  const dotAnim = cycle
    ? `phase-dot-cycle 3200ms ${appearMs}ms ease-out forwards`
    : `field-dot-in 360ms ${appearMs}ms ease-out forwards`;
  const leaderAnim = cycle
    ? `phase-leader-cycle 3200ms ${appearMs + 60}ms ease-out forwards`
    : `field-leader-in 420ms ${appearMs + 60}ms cubic-bezier(.25,.65,.25,1) forwards`;
  const textAnim = cycle
    ? `phase-caption-cycle 3200ms ${appearMs + 140}ms ease-out forwards`
    : `field-caption-in 460ms ${appearMs + 140}ms cubic-bezier(.2,.7,.25,1) forwards`;

  // Curved leader from the anchor to a point just before the text
  // begins. Quadratic with a control point biased toward the anchor
  // gives a gentle arc rather than a ruled line.
  const leadEndX = textAnchor === 'start' ? tx - 6 : tx + 6;
  const leadEndY = ty + 2;
  const ctrlX = ax + (leadEndX - ax) * 0.55;
  const ctrlY = ay + (leadEndY - ay) * 0.92;
  const leaderPath = `M ${ax} ${ay} Q ${ctrlX} ${ctrlY} ${leadEndX} ${leadEndY}`;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle
        cx={ax}
        cy={ay}
        r={dotR}
        fill={color}
        style={{
          opacity: 0,
          filter: `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 8px ${color}80)`,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: dotAnim,
        }}
      />
      <path
        d={leaderPath}
        stroke={color}
        strokeWidth={1}
        fill="none"
        strokeLinecap="round"
        pathLength={1}
        style={{
          strokeDasharray: '1 1',
          strokeDashoffset: 1,
          opacity: 0,
          animation: leaderAnim,
        }}
      />
      {eyebrow && (
        <text
          x={tx}
          y={ty - fontSize - 2}
          textAnchor={textAnchor}
          fontFamily="'Inter', system-ui, sans-serif"
          fontWeight={700}
          fontSize={eyebrowSize}
          letterSpacing={2.6}
          paintOrder="stroke fill"
          stroke="rgba(6,9,18,0.92)"
          strokeWidth={3}
          strokeLinejoin="round"
          fill={color}
          style={{ opacity: 0, animation: textAnim }}
        >
          {eyebrow.toUpperCase()}
        </text>
      )}
      <text
        x={tx}
        y={ty}
        textAnchor={textAnchor}
        fontFamily={mainFont}
        fontWeight={fontWeight}
        fontSize={fontSize}
        letterSpacing={size === 'phase' ? -0.2 : 0.13}
        paintOrder="stroke fill"
        stroke="rgba(6,9,18,0.94)"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        fill="#f5f7fc"
        style={{ opacity: 0, animation: textAnim }}
      >
        {text}
      </text>
      {/* Phase accent rule. Short colored bar under the title that grows
          from the text anchor outward, holds with the title, then fades
          together. Gives the title beat editorial chrome without the
          weight of a box. */}
      {size === 'phase' && (
        <line
          x1={tx}
          y1={ty + 10}
          x2={textAnchor === 'start' ? tx + 64 : tx - 64}
          y2={ty + 10}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          style={{
            opacity: 0,
            transformBox: 'fill-box',
            transformOrigin: textAnchor === 'start' ? 'left center' : 'right center',
            filter: `drop-shadow(0 0 4px ${color}aa)`,
            animation: cycle
              ? `phase-rule-cycle 3200ms ${appearMs + 240}ms ease-out forwards`
              : `field-caption-in 460ms ${appearMs + 280}ms ease-out forwards`,
          }}
        />
      )}
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
      {/* Unit caption is rendered separately as a FieldCaption in the
          GlobeReplay SVG overlay so it tethers to this marker without
          dragging a boxy pill underneath. Hover still shows the SVG
          <title> above. */}
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

// ImpactFlash renders the moment the arrow arrives at its objective.
// Layered for weight:
//   1. Spearhead bloom — a bright white disk, fired slightly ahead of
//      the rest, announces the instant of contact.
//   2. Bright core — peak intensity at impact, fades fast.
//   3. Three stacked shockwaves at staggered delays — close, medium,
//      and a wide atmospheric wash so the engagement reads from a
//      cinematic camera distance.
//   4. Two rings of sparks — inner debris tight to the hit, outer
//      shrapnel thrown further.
//   5. Scorch — a low-opacity colored stain that fades in just after
//      the flash and lingers for several seconds, anchoring the eye
//      to "this happened here" through the rest of the phase.
// The low-frequency thump is scheduled in lockstep with (2).
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
    const dist = 24;
    return { i, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist };
  });
  const OUTER = 8;
  const outerSparks = Array.from({ length: OUTER }, (_, i) => {
    const angle = (Math.PI * 2 * i) / OUTER;
    const dist = 44;
    return { i, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist };
  });
  return (
    <g transform={`translate(${x} ${y})`} style={{ pointerEvents: 'none' }}>
      {/* Scorch stain — two layers. Outer faction-color wash sits under
          everything and lingers for several seconds, anchoring the eye
          to "this happened here" through the rest of the phase. Inner
          white-hot core fades faster, so the instant after impact reads
          as a flash-burned mark settling into the colored stain. */}
      <circle
        r={28}
        fill={color}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          filter: 'blur(8px)',
          animation: `scorch-cycle 4400ms ${delay + 220}ms cubic-bezier(.2,.5,.25,1) forwards`,
        }}
      />
      <circle
        r={11}
        fill="#ffffff"
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          filter: `blur(4px) drop-shadow(0 0 6px ${color}cc)`,
          animation: `scorch-hot 2200ms ${delay + 140}ms cubic-bezier(.2,.5,.25,1) forwards`,
        }}
      />
      {/* Spearhead bloom — bright white disk fires 60ms ahead of the core.
          Reads as the instant of contact, gives the arrow's landing a
          felt percussion before the shockwave widens. */}
      <circle
        r={5}
        fill="#ffffff"
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          filter: `drop-shadow(0 0 8px ${color}) drop-shadow(0 0 18px ${color}cc) drop-shadow(0 0 34px ${color}77)`,
          animation: `spearhead-bloom 520ms ${Math.max(0, delay - 60)}ms cubic-bezier(.2,.7,.25,1) forwards`,
        }}
      />
      {/* Bright core flash. */}
      <circle
        r={6}
        fill={color}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-core 900ms ${delay}ms cubic-bezier(.25,.7,.25,1) forwards`,
          filter: `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 14px ${color}cc)`,
        }}
      />
      {/* Primary shockwave. Stroke punched up so the front edge of the
          ring reads as a wavefront rather than a hairline. */}
      <circle
        r={6}
        fill="none"
        stroke={color}
        strokeWidth={3.2}
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
        strokeWidth={1.8}
        strokeOpacity={0.7}
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
        strokeOpacity={0.45}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-ring 2200ms ${delay + 450}ms cubic-bezier(.2,.6,.25,1) forwards`,
        }}
      />
      {/* Outer wash. Big, soft, slow ring at the edge of the field
          that gives the impact a cinematic scale beyond the arrow's
          local terrain. */}
      <circle
        r={10}
        fill="none"
        stroke={color}
        strokeWidth={1.0}
        strokeOpacity={0.32}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-ring 2600ms ${delay + 700}ms cubic-bezier(.2,.6,.25,1) forwards`,
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
