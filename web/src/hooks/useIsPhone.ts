import { useEffect, useState } from 'react';

// PHONE_QUERY matches the widths where the chrome stacks into rows and the
// dossier becomes a bottom sheet.
export const PHONE_QUERY = '(max-width: 639px)';

// COMPACT_QUERY matches a phone in either orientation: narrow in portrait,
// short in landscape.
export const COMPACT_QUERY = '(max-width: 639px), (max-height: 500px)';

// COMPACT_LANDSCAPE_QUERY matches a phone held sideways.
export const COMPACT_LANDSCAPE_QUERY = '(max-height: 500px) and (orientation: landscape)';

// useMediaQuery reports whether the query matches and follows changes such
// as a rotation or a resized window.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// useIsPhone reports whether the viewport is phone width.
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
