import { useEffect } from 'react';

// PauseOnHiddenOptions tune when usePauseOnHidden fires.
export interface PauseOnHiddenOptions {
  // onBlur fires the callback when the window loses focus too. On by default.
  onBlur?: boolean;
}

// usePauseOnHidden fires the supplied callback whenever the browser tab
// becomes hidden (visibilitychange to hidden) or, unless onBlur is false,
// the window loses focus (blur). Use it to stop running playback, RAF loops,
// or audio so the user doesn't return to a tab that has been animating into
// the void for an hour.
//
// The callback should be idempotent: pause that's already paused is a no-op.
// We don't auto-resume on visibility return because the user explicitly
// chose to leave; let them hit play again when they come back.
export function usePauseOnHidden(pause: () => void, { onBlur = true }: PauseOnHiddenOptions = {}): void {
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') pause();
    };
    const onWindowBlur = () => pause();
    document.addEventListener('visibilitychange', onHide);
    if (onBlur) window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [pause, onBlur]);
}
