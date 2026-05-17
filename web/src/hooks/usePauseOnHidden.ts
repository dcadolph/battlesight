import { useEffect } from 'react';

// usePauseOnHidden fires the supplied callback whenever the browser tab
// becomes hidden (visibilitychange to hidden) or the window loses focus
// (blur). Use it to stop running playback, RAF loops, or audio so the user
// doesn't return to a tab that has been animating into the void for an hour.
//
// The callback should be idempotent: pause that's already paused is a no-op.
// We don't auto-resume on visibility return because the user explicitly
// chose to leave; let them hit play again when they come back.
export function usePauseOnHidden(pause: () => void): void {
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') pause();
    };
    const onBlur = () => pause();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onBlur);
    };
  }, [pause]);
}
