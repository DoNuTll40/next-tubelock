'use client';

import React, { createContext, useContext, useEffect, useCallback, useSyncExternalStore, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const ViewModeContext = createContext(null);

function subscribeToResize(onResize) {
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

const getMobileViewport = () => window.innerWidth < 768;
const getServerViewport = () => null;

function ViewModeProviderInternal({ children }) {
  const searchParams = useSearchParams();
  const appParam = searchParams.get('app');
  const isClientMobile = useSyncExternalStore(subscribeToResize, getMobileViewport, getServerViewport);
  const mounted = isClientMobile !== null;
  const overrideMode = appParam === 'desktop' ? 'desktop'
    : appParam === 'm' || appParam === 'mobile' ? 'mobile' : 'auto';

  // Clear any legacy poisoned localStorage
  useEffect(() => {
    try {
      localStorage.removeItem('tubelock_app_mode');
    } catch {}
  }, []);

  const isMobile = overrideMode === 'mobile' || (overrideMode === 'auto' && isClientMobile === true);
  const isDesktop = !isMobile;
  const activeMode = overrideMode !== 'auto' ? overrideMode : (isClientMobile ? 'mobile' : 'desktop');

  // Change mode via UI switcher — update URL without causing full page remount
  const setMode = useCallback((target) => {
    const params = new URLSearchParams(window.location.search);

    if (target === 'desktop') {
      params.set('app', 'desktop');
    } else if (target === 'mobile' || target === 'm') {
      params.set('app', 'm');
    } else {
      params.delete('app');
    }

    const query = params.toString() ? `?${params.toString()}` : '';
    const newUrl = `${window.location.pathname}${query}${window.location.hash}`;
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
