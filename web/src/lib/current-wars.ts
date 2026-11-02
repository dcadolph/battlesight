import { useEffect, useState } from 'react';
import type { Battle } from '../types/battle';

// CURRENT_FROM_YEAR is the earliest battle year the current-conflicts view
// shows, so a long ongoing war does not pull in its first decade.
export const CURRENT_FROM_YEAR = 2014;

// useCurrentWars loads the war names the server marks as ongoing from the
// sourced status in wars.json. Empty until the request lands.
export function useCurrentWars(): Set<string> {
  const [wars, setWars] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    fetch('/api/wars/current')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { current?: string[] } | null) => {
        if (!cancelled && body?.current) setWars(new Set(body.current));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return wars;
}

// isCurrentConflict reports whether a battle belongs to an ongoing war and
// falls in the current-conflicts window.
export function isCurrentConflict(b: Battle, current: Set<string>): boolean {
  if (!b.war || (b.year ?? 0) < CURRENT_FROM_YEAR) return false;
  return current.has(b.war);
}
