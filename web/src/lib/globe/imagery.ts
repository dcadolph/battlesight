import { useEffect, useState, useSyncExternalStore } from 'react';
import type { GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';

import { HI_RES_EARTH, TOPOLOGY_BUMP } from '../../data/cities';

// IMAGERY_LAYER is the EOX Sentinel-2 cloudless WMTS layer the globe streams.
// The 2017 layer is the newest one EOX publishes under CC BY 4.0. Later years
// carry a non-commercial share-alike license and are not used.
export const IMAGERY_LAYER = 's2cloudless-2017_3857';

// IMAGERY_TILE_PREFIX is the WMTS tile path up to the zoom level, in the Web
// Mercator tile matrix set g.
const IMAGERY_TILE_PREFIX = `https://tiles.maps.eox.at/wmts/1.0.0/${IMAGERY_LAYER}/default/g/`;

// earthTileUrl returns the Sentinel-2 cloudless tile for a Web Mercator x, y
// and zoom level.
export const earthTileUrl = (x: number, y: number, level: number): string =>
  `${IMAGERY_TILE_PREFIX}${level}/${y}/${x}.jpg`;

// IMAGERY_ATTRIBUTION is the attribution EOX publishes for IMAGERY_LAYER in
// its WMTS capabilities, verbatim. IMAGERY_LINKS holds the two links that
// string names.
export const IMAGERY_ATTRIBUTION =
  'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus ' +
  'Sentinel data 2017) released under Creative Commons Attribution 4.0 International License.';
export const IMAGERY_LINKS = {
  eox: 'https://cloudless.eox.at',
  license: 'https://creativecommons.org/licenses/by/4.0/',
};

// IMAGERY_MAX_LEVEL caps the tile zoom level. Below the camera floor the
// tactical map takes over, so deeper tiles would never be seen.
export const IMAGERY_MAX_LEVEL = 12;

// CAMERA_FLOOR_ALTITUDE is the lowest camera altitude, in globe radii, the
// orbit controls allow. 0.06 is about 380 km above the surface.
export const CAMERA_FLOOR_ALTITUDE = 0.06;

// TILE_ERROR_WINDOW_MS and TILE_ERROR_LIMIT set the fallback trip: more than
// TILE_ERROR_LIMIT failed tile loads inside the window turn tiles off for the
// session.
const TILE_ERROR_WINDOW_MS = 10_000;
const TILE_ERROR_LIMIT = 12;

// tileErrorTimes holds the timestamps of recent tile load failures.
let tileErrorTimes: number[] = [];
// tilesFailed records that the fallback tripped. It never resets in a session.
let tilesFailed = false;
// watcherInstalled guards the one-time loading manager hook.
let watcherInstalled = false;
// listeners are notified once when tilesFailed flips.
const listeners = new Set<() => void>();

// installTileErrorWatcher hooks three.js's default loading manager, which the
// tile engine's TextureLoader reports image errors through, and counts the
// failures that belong to the imagery host.
function installTileErrorWatcher(): void {
  if (watcherInstalled) return;
  watcherInstalled = true;
  const manager = THREE.DefaultLoadingManager;
  const previous = manager.onError;
  manager.onError = (url: string) => {
    previous?.call(manager, url);
    if (tilesFailed || !url.startsWith(IMAGERY_TILE_PREFIX)) return;
    const now = performance.now();
    tileErrorTimes = tileErrorTimes.filter((t) => now - t < TILE_ERROR_WINDOW_MS);
    tileErrorTimes.push(now);
    if (tileErrorTimes.length <= TILE_ERROR_LIMIT) return;
    tilesFailed = true;
    console.warn(
      `globe imagery: ${tileErrorTimes.length} tile errors in ${TILE_ERROR_WINDOW_MS / 1000} s: ` +
        'falling back to the stock texture',
    );
    listeners.forEach((fn) => fn());
  };
}

// subscribeTilesFailed registers fn for the fallback trip.
function subscribeTilesFailed(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// tileEngineOf finds the three-slippy-map-globe instance in the scene. It is
// the only object carrying both a thresholds array and a maxLevel.
function tileEngineOf(scene: THREE.Scene): { thresholds: number[]; maxLevel: number } | undefined {
  let found: { thresholds: number[]; maxLevel: number } | undefined;
  scene.traverse((obj) => {
    const o = obj as unknown as { thresholds?: unknown; maxLevel?: unknown };
    if (!found && Array.isArray(o.thresholds) && typeof o.maxLevel === 'number') {
      found = o as { thresholds: number[]; maxLevel: number };
    }
  });
  return found;
}

// stockSphereHasMap reports whether the hidden stock sphere has its texture,
// so the fallback can show it without a frame of untextured shader.
function stockSphereHasMap(scene: THREE.Scene): boolean {
  let has = false;
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const mat = mesh.material as THREE.MeshPhongMaterial | undefined;
    if (mesh.isMesh && mat?.isMeshPhongMaterial && mat.map) has = true;
  });
  return has;
}

// PLANET_LEVELS is the highest tile level used for the whole-planet framings.
// Level 3 puts about 1 000 texels across the visible hemisphere, which is one
// texel per device pixel for the landing globe on a high-density screen.
const PLANET_LEVELS = 3;

// tileThreshold returns the camera altitude, in globe radii, at or above which
// tile level idx is chosen. The library default of 8 / 2^idx lands one level
// short at close range (level 7 at altitude 0.08 stretches each texel over
// about 1.3 screen pixels), so the base is 16. Past the planet levels the
// base also scales with the device pixel ratio, so a high-density screen gets
// level 9 at altitude 0.08 while the landing globe stays near 40 tiles.
function tileThreshold(idx: number): number {
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  return (idx <= PLANET_LEVELS ? 16 : 16 * dpr) / 2 ** idx;
}

// tuneGlobe applies the camera floor and the tile engine's level limits to a
// ready globe. The globe reports ready before its layers join the scene, so
// the engine lookup retries every frame, which also catches it before the
// first tiles are requested.
export function tuneGlobe(globe: GlobeMethods | undefined): void {
  if (!globe) return;
  try {
    globe.controls().minDistance = globe.getGlobeRadius() * (1 + CAMERA_FLOOR_ALTITUDE);
  } catch (err) {
    console.warn('globe imagery: camera floor skipped:', err);
  }
  let attempts = 0;
  const tryEngine = () => {
    attempts++;
    try {
      const engine = tileEngineOf(globe.scene());
      if (!engine) {
        if (attempts < 120) requestAnimationFrame(tryEngine);
        else console.warn('globe imagery: tile engine not found: default levels kept');
        return;
      }
      engine.maxLevel = IMAGERY_MAX_LEVEL;
      engine.thresholds = engine.thresholds.map((_, idx) => tileThreshold(idx));
    } catch (err) {
      console.warn('globe imagery: tile tuning skipped:', err);
    }
  };
  tryEngine();
}

// ImageryStage is where a globe is in the fallback sequence: streaming tiles,
// loading the stock texture behind the tiles, or showing the stock sphere.
export type ImageryStage = 'tiles' | 'loading' | 'stock';

// GlobeImageryProps is the imagery prop bundle a react-globe.gl Globe takes.
export interface GlobeImageryProps {
  // globeTileEngineUrl streams tiles while set.
  globeTileEngineUrl: ((x: number, y: number, level: number) => string) | null;
  // globeImageUrl is the stock texture, only requested once the fallback trips.
  globeImageUrl: string | null;
  // bumpImageUrl is the stock relief map, requested with globeImageUrl.
  bumpImageUrl: string | null;
}

// useGlobeImagery returns the imagery props for a globe and its fallback
// stage. Both globes share it so they cannot drift. On the fallback trip it
// requests the stock texture first and hides the tiles only once the stock
// sphere has its map.
export function useGlobeImagery(globeRef: { current: GlobeMethods | undefined }): {
  props: GlobeImageryProps;
  stage: ImageryStage;
} {
  installTileErrorWatcher();
  const failed = useSyncExternalStore(subscribeTilesFailed, () => tilesFailed);
  const [stockReady, setStockReady] = useState(false);

  useEffect(() => {
    if (!failed || stockReady) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      attempts++;
      const globe = globeRef.current;
      if (globe && stockSphereHasMap(globe.scene())) {
        setStockReady(true);
        return;
      }
      if (attempts < 100) timer = setTimeout(poll, 120);
      else console.warn('globe imagery: stock texture never loaded: keeping tiles');
    };
    poll();
    return () => clearTimeout(timer);
  }, [failed, stockReady, globeRef]);

  const stage: ImageryStage = !failed ? 'tiles' : stockReady ? 'stock' : 'loading';
  return {
    stage,
    props: {
      globeTileEngineUrl: stage === 'stock' ? null : earthTileUrl,
      globeImageUrl: failed ? HI_RES_EARTH : null,
      bumpImageUrl: failed ? TOPOLOGY_BUMP : null,
    },
  };
}
