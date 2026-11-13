'use client';

import { useLayoutEffect, useState } from 'react';
import { useSession } from '@/context/SessionContext';
import { POSTER_PREFERENCE, syncPosterPreferenceCookie } from './posterPreference';

export function usePosterPreference(isMature, initiallyEnabled = false) {
  const isLoggedIn = Boolean(useSession());
  const [enabled, setEnabled] = useState(isLoggedIn && initiallyEnabled);

  useLayoutEffect(() => {
    if (!isLoggedIn || !isMature) return;

    const update = () => {
      try {
        const allowed = localStorage.getItem(POSTER_PREFERENCE) === '1';
        const hasCookie = document.cookie.split('; ').includes(`${POSTER_PREFERENCE}=1`);
        if (allowed !== hasCookie) syncPosterPreferenceCookie(allowed);
        setEnabled(allowed);
      } catch {}
    };

    update();
    window.addEventListener('tubelock_18plus_changed', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('tubelock_18plus_changed', update);
      window.removeEventListener('storage', update);
    };
  }, [isLoggedIn, isMature]);

  return isLoggedIn && isMature && enabled;
}
