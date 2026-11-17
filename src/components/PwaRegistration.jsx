'use client';

import { useEffect } from 'react';

export default function PwaRegistration() {
  useEffect(() => {
    if (!window.matchMedia('(display-mode: standalone)').matches) return;
    const lockPortrait = () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      window.screen.orientation?.lock?.('portrait-primary').catch(() => {});
    };

    lockPortrait();
    document.addEventListener('fullscreenchange', lockPortrait);
    document.addEventListener('webkitfullscreenchange', lockPortrait);
    return () => {
      document.removeEventListener('fullscreenchange', lockPortrait);
      document.removeEventListener('webkitfullscreenchange', lockPortrait);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('TubeLock service worker registration failed:', error);
    });
  }, []);

  return null;
}
