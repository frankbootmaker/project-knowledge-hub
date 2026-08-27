'use client';

import { useEffect, useState } from 'react';
import { AUTH_DESKTOP_MQ } from './auth-mode';

/** `null` until mounted — avoid SSR/client shell mismatch. */
export function useIsDesktopAuth(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const media = window.matchMedia(AUTH_DESKTOP_MQ);
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return isDesktop;
}
