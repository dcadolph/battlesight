import { useEffect, useState } from 'react';

// PHONE_QUERY matches the widths where the chrome stacks into rows and the
// dossier becomes a bottom sheet.
export const PHONE_QUERY = '(max-width: 639px)';

// useIsPhone reports whether the viewport is phone width and follows changes
// such as a rotation or a resized window.
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}
