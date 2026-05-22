// world-countries is a shared module-level cache for the Natural Earth
// country polygons. Both BattleGlobe (background) and GlobeReplay (in
// each war/battle cinematic) need the same TopoJSON, and parsing it from
// scratch on every fresh mount was the root cause of the "location
// renders super late" symptom: each new BattleReplay was waiting ~50ms+
// to parse the topology before any polygons could paint, which is what
// the user saw as "stuff keeps starting in the middle of the Atlantic".
//
// The promise begins resolving the moment this module is imported, so by
// the time any component asks for the polygons they are typically already
// cached and resolved synchronously through the read-through accessor.
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

const COUNTRIES_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';

let cachedCountries: Feature<Geometry>[] | null = null;
let pendingPromise: Promise<Feature<Geometry>[]> | null = null;

function load(): Promise<Feature<Geometry>[]> {
  if (cachedCountries) return Promise.resolve(cachedCountries);
  if (pendingPromise) return pendingPromise;
  pendingPromise = fetch(COUNTRIES_URL)
    .then((r) => r.json() as Promise<Topology>)
    .then((topo) => {
      const fc = feature(topo, topo.objects.countries) as FeatureCollection<Geometry>;
      cachedCountries = fc.features;
      return cachedCountries;
    })
    .catch((err) => {
      pendingPromise = null;
      throw err;
    });
  return pendingPromise;
}

// Kick off the load at module-import time. By the time React mounts the
// first component that asks for polygons, the network and parse phase is
// usually already done.
void load();

// loadWorldCountries returns the parsed Natural Earth countries Feature
// array. Resolves immediately when the cache is hot.
export function loadWorldCountries(): Promise<Feature<Geometry>[]> {
  return load();
}

// worldCountriesCache returns the parsed countries synchronously if they
// are already in cache, or null when the load is still pending. Lets
// components paint a first frame with polygons when possible.
export function worldCountriesCache(): Feature<Geometry>[] | null {
  return cachedCountries;
}
