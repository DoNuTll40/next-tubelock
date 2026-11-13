'use client';

import { useLayoutEffect, useState } from 'react';
import { POSTER_PREFERENCE, syncPosterPreferenceCookie } from './posterPreference';

export function usePosterPreference(isMature, initiallyEnabled = false) {
  const [enabled, setEnabled] = useState(initiallyEnabled);

  useLayoutEffect(() => {
    if (!isMature) return;

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
  }, [isMature]);

  return isMature && enabled;
}
