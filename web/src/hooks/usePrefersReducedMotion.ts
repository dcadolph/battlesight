import { useEffect, useState } from 'react';

// usePrefersReducedMotion subscribes to the OS-level "Reduce motion"
// accessibility preference and returns a stable boolean. Components use
// this to short-circuit decorative animations: cinematic timers jump
// straight to onDone, pulses paint as no-ops, and CSS transitions are
// expected to be disabled inside a @media (prefers-reduced-motion: reduce)
// block so the static frame still reads correctly.
//
// Returns false on the server (no window). Updates live when the user
// toggles the preference in System Settings without requiring a refresh.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Safari < 14 uses the deprecated addListener.
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    const legacy = mq as unknown as { addListener: (h: (e: MediaQueryListEvent) => void) => void; removeListener: (h: (e: MediaQueryListEvent) => void) => void };
    legacy.addListener(handler);
    return () => legacy.removeListener(handler);
  }, []);

  return reduced;
}
