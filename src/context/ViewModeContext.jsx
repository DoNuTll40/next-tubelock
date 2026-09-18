'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const ViewModeContext = createContext(null);

function ViewModeProviderInternal({ children }) {
  const searchParams = useSearchParams();

  // 'auto' | 'desktop' | 'mobile'
  const [overrideMode, setOverrideMode] = useState('auto');
  const [isClientMobile, setIsClientMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Clear any legacy poisoned localStorage
  useEffect(() => {
    try {
      localStorage.removeItem('tubelock_app_mode');
    } catch {}
  }, []);

  // Sync screen width dynamically
  useEffect(() => {
    setMounted(true);
    const checkWidth = () => {
      setIsClientMobile(window.innerWidth < 768);
    };

    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  // Read URL param: ONLY override if explicitly specified in query
  useEffect(() => {
    const appParam = searchParams.get('app');
    if (appParam === 'desktop') {
      setOverrideMode('desktop');
    } else if (appParam === 'm' || appParam === 'mobile') {
      setOverrideMode('mobile');
    } else {
      // No param = Natural Auto mode (respects screen width)
      setOverrideMode('auto');
    }
  }, [searchParams]);

  // Effective mode calculation
  const isMobile = overrideMode === 'mobile' || (overrideMode === 'auto' && isClientMobile);
  const isDesktop = !isMobile;
  const activeMode = overrideMode !== 'auto' ? overrideMode : (isClientMobile ? 'mobile' : 'desktop');

  // Change mode via UI switcher — update URL without causing full page remount
  const setMode = useCallback((target) => {
    const params = new URLSearchParams(window.location.search);

    if (target === 'desktop') {
      setOverrideMode('desktop');
      params.set('app', 'desktop');
    } else if (target === 'mobile' || target === 'm') {
      setOverrideMode('mobile');
      params.set('app', 'm');
    } else {
      // Auto: remove query param, revert to screen-width detection
      setOverrideMode('auto');
      params.delete('app');
    }

    const query = params.toString() ? `?${params.toString()}` : '';
    const newUrl = `${window.location.pathname}${query}`;
    // Use replaceState (no re-render, no router re-run) — just update URL bar
    window.history.replaceState({}, '', newUrl);
  }, []);

  return (
    <ViewModeContext.Provider
      value={{
        mode: activeMode,
        overrideMode,
        isMobile,
        isDesktop,
        setMode,
        mounted,
      }}
    >
      {children}
    </ViewModeContext.Provider>
  );
}

export function ViewModeProvider({ children }) {
  return (
    <Suspense fallback={children}>
      <ViewModeProviderInternal>{children}</ViewModeProviderInternal>
    </Suspense>
  );
}

export function useViewMode() {
  const ctx = useContext(ViewModeContext);
  if (!ctx) {
    return {
      mode: 'desktop',
      overrideMode: 'auto',
      isMobile: false,
      isDesktop: true,
      setMode: () => {},
      mounted: false,
    };
  }
  return ctx;
}
