// Per-battle replay JSON cache. The cinematic walks ~80-120 battles per
// run; without caching, every battle change triggers a fresh
// /api/battles/{id}/replay fetch on mount and the user stares at an
// empty globe for the round-trip duration before phase 0 paints. That
// is the "super slow loading" between battles. Same idea as
// world-countries.ts: load once, hit memory thereafter.
//
// The cache is also write-through during prefetch — WarPlayback can warm
// it for the NEXT battle a beat before the current one ends, so the
// camera glide and the data fetch overlap instead of running serially.
import type { Replay } from '../types/replay';
import { deriveSchematicXY } from './derive-xy';

const cache: Map<string, Replay> = new Map();
const inflight: Map<string, Promise<Replay | null>> = new Map();

function fetchReplay(battleId: string): Promise<Replay | null> {
  const hit = cache.get(battleId);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(battleId);
  if (pending) return pending;
  const p = fetch(`/api/battles/${battleId}/replay`)
    .then((res) => {
      if (!res.ok) throw new Error('no replay');
      return res.json() as Promise<Replay>;
    })
    .then((raw) => {
      // Replays authored from geography carry no schematic placement, so
      // fill it in once here rather than in every consumer.
      const data = deriveSchematicXY(raw);
      cache.set(battleId, data);
      inflight.delete(battleId);
      return data;
    })
    .catch(() => {
      inflight.delete(battleId);
      return null;
    });
  inflight.set(battleId, p);
  return p;
}

// loadReplay returns the cached replay or fetches + caches it. Resolves
// null when the battle has no replay (curated or schematic).
export function loadReplay(battleId: string): Promise<Replay | null> {
  return fetchReplay(battleId);
}

// cachedReplay returns the parsed replay synchronously when it's already
// in cache, otherwise null. Lets a component paint the first frame with
// real data when possible.
export function cachedReplay(battleId: string): Replay | null {
  return cache.get(battleId) ?? null;
}

// prefetchReplay starts a fetch (or no-ops on a cache hit). Caller does
// not need to await — by the time the user lands on this battle, the
// data will be hot. Safe to call repeatedly.
export function prefetchReplay(battleId: string): void {
  if (cache.has(battleId)) return;
  if (inflight.has(battleId)) return;
  void fetchReplay(battleId);
}
