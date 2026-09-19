'use client';

import { useEffect } from 'react';

/**
 * In-App Mobile DevTools (Eruda)
 * Provides Console, Network, Elements, Resources, and Info tabs on mobile browsers.
 * 
 * Activated when:
 * 1. process.env.NODE_ENV !== 'production' (Local Development)
 * 2. URL contains ?debug=true
 * 3. localStorage has tubelock_debug === 'true'
 */
export default function DevTools() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams(window.location.search);
    const hasDebugParam = searchParams.get('debug') === 'true';
    const hasDisableParam = searchParams.get('debug') === 'false';

    if (hasDisableParam) {
      try {
        localStorage.removeItem('tubelock_debug');
      } catch (_) {}
    } else if (hasDebugParam) {
      try {
        localStorage.setItem('tubelock_debug', 'true');
      } catch (_) {}
    }

    let isDebugEnabled = process.env.NODE_ENV !== 'production';
    try {
      if (hasDebugParam || localStorage.getItem('tubelock_debug') === 'true') {
        isDebugEnabled = true;
      }
    } catch (_) {}

    if (!isDebugEnabled) return;

    // Prevent duplicate initializations
    if (window.__eruda_initialized) return;
    window.__eruda_initialized = true;

    import('eruda')
      .then((erudaModule) => {
        const eruda = erudaModule.default || erudaModule;
        if (!eruda._isInit) {
          eruda.init({
            tool: ['console', 'network', 'elements', 'resources', 'info'],
            useShadowDom: true,
            autoScale: true,
            defaults: {
              displaySize: 50,
              transparency: 90,
              theme: 'Dark',
            },
          });
          console.log('🚀 [Eruda DevTools] In-App Mobile Console & Network inspector loaded!');
        }
      })
      .catch((err) => {
        console.warn('Failed to load Eruda DevTools:', err);
      });

    return () => {
      // Keep eruda active if already initialized
    };
  }, []);

  return null;
}
