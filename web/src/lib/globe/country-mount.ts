// Feeds the country outlines to the globe a few at a time, so that no step
// holds the page for long and no country is built on a click.
//
// three-globe triangulates a polygon when it first appears in polygonsData,
// and the renderer uploads it on the first frame that draws it. Both costs
// are paid here, in idle time. The list only grows, so each country is built
// once per page load.
import { useEffect, useMemo, useState } from 'react';
import type { Feature, Geometry } from 'geojson';

// CountryMount is the state of the country outlines on the globe.
export type CountryMount = {
  // mounted is the list to hand to the globe. It only grows.
  mounted: Feature<Geometry>[];
  // drawn holds the mounted features the globe has built and drawn once.
  drawn: ReadonlySet<Feature<Geometry>>;
  // complete tells whether every country is mounted and drawn.
  complete: boolean;
};

// MountState is the progress through one list of countries.
type MountState = {
  // source is the ordered list the progress belongs to.
  source: Feature<Geometry>[];
  // mounted holds the features handed to the globe so far.
  mounted: Feature<Geometry>[];
  // drawnCount is the number of leading mounted features already drawn.
  drawnCount: number;
};

// VERTEX_MS and VERTEX_PAIR_MS estimate the time to triangulate one polygon.
// One share grows with its vertex count and one with the square of it.
// Fitted to countries-50m in V8, where the largest ring takes about 110 ms.
const VERTEX_MS = 0.003;
const VERTEX_PAIR_MS = 0.000004;

// IDLE_SLICE_MS is the estimated build time of one slice while nothing on
// screen waits for the outlines.
const IDLE_SLICE_MS = 12;

// URGENT_SLICE_MS is the estimated build time of one slice while a selection
// waits to be shaded.
const URGENT_SLICE_MS = 30;

// IDLE_TIMEOUT_MS is the longest a slice waits for an idle period.
const IDLE_TIMEOUT_MS = 500;

// IDLE_FALLBACK_MS is the wait between slices where the browser has no idle
// callback.
const IDLE_FALLBACK_MS = 50;

// MOUNTED_MARK names the performance mark set once every country is drawn.
const MOUNTED_MARK = 'countries-mounted';

const NOTHING: Feature<Geometry>[] = [];

// buildCost estimates the milliseconds three-globe needs to build a feature.
export function buildCost(feature: Feature<Geometry>): number {
  const geometry = feature.geometry;
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates
        : [];
  let cost = 0;
  for (const polygon of polygons) {
    let vertices = 0;
    for (const ring of polygon) vertices += ring.length;
    cost += vertices * VERTEX_MS + vertices * vertices * VERTEX_PAIR_MS;
  }
  return cost;
}

// featureName returns the lowercased country name of a feature.
export function featureName(feature: Feature<Geometry>): string {
  return ((feature.properties as Record<string, string> | null)?.name ?? '').toLowerCase();
}

// nextSlice picks the features to mount next: the ones named in first, then
// the rest in order, until the estimated cost passes the budget. A feature
// that costs more than the budget goes alone.
export function nextSlice(
  remaining: Feature<Geometry>[], first: ReadonlySet<string>, budgetMs: number,
): Feature<Geometry>[] {
  const queue = first.size === 0 ? remaining : [
    ...remaining.filter((f) => first.has(featureName(f))),
    ...remaining.filter((f) => !first.has(featureName(f))),
  ];
  const slice: Feature<Geometry>[] = [];
  let spent = 0;
  for (const feature of queue) {
    const cost = buildCost(feature);
    if (slice.length > 0 && spent + cost > budgetMs) break;
    slice.push(feature);
    spent += cost;
  }
  return slice;
}

// isBuilt tells whether three-globe has processed a feature. Its polygon
// layer stamps an id on each feature in the same step that builds it.
function isBuilt(feature: Feature<Geometry>): boolean {
  return (feature as { __id?: string }).__id !== undefined;
}

// whenIdle runs fn in the next idle period and returns a function that
// cancels it.
function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(id);
}

// useCountryMount grows the list of country features for the globe in small
// slices. It runs while active is true, which the caller holds false until
// the globe renders frames. The features named in first are mounted before
// the others. When urgent is true the slices are larger and do not wait for
// idle time, since something on screen is waiting for them.
export function useCountryMount(
  countries: Feature<Geometry>[], active: boolean, urgent: boolean, first: ReadonlySet<string>,
): CountryMount {
  // Cheap countries go first so that most of the map is ready early.
  const ordered = useMemo(
    () => [...countries].sort((a, b) => buildCost(a) - buildCost(b)),
    [countries],
  );
  const [state, setState] = useState<MountState>({ source: NOTHING, mounted: NOTHING, drawnCount: 0 });
  const mounted = state.source === ordered ? state.mounted : NOTHING;
  const drawnCount = state.source === ordered ? state.drawnCount : 0;

  useEffect(() => {
    if (!active || ordered.length === 0) return;
    const pending = drawnCount < mounted.length;
    if (!pending && mounted.length === ordered.length) return;

    let frame = 0;
    let cancelIdle = () => {};

    // advance records the pending slice as drawn and mounts the next one.
    const advance = () => {
      const have = new Set(mounted);
      const slice = nextSlice(
        ordered.filter((f) => !have.has(f)), first, urgent ? URGENT_SLICE_MS : IDLE_SLICE_MS,
      );
      setState({
        source: ordered,
        mounted: slice.length > 0 ? [...mounted, ...slice] : mounted,
        drawnCount: mounted.length,
      });
    };

    // step moves on at once when something is waiting, else at idle time.
    const step = () => {
      if (urgent) advance();
      else cancelIdle = whenIdle(advance);
    };

    if (pending) {
      // The slice counts as drawn one frame after the globe has built it.
      const last = mounted[mounted.length - 1];
      let built = false;
      const tick = () => {
        if (built) {
          step();
          return;
        }
        built = isBuilt(last);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } else {
      frame = requestAnimationFrame(step);
    }
    return () => {
      cancelAnimationFrame(frame);
      cancelIdle();
    };
  }, [active, urgent, first, ordered, mounted, drawnCount]);

  const complete = ordered.length > 0 && drawnCount === ordered.length;
  useEffect(() => {
    if (complete && performance.getEntriesByName(MOUNTED_MARK).length === 0) {
      performance.mark(MOUNTED_MARK);
    }
  }, [complete]);

  const drawn = useMemo(() => new Set(mounted.slice(0, drawnCount)), [mounted, drawnCount]);
  return { mounted, drawn, complete };
}
