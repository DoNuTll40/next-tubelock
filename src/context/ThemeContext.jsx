'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';

const ThemeContext = createContext({
  theme: 'auto', // 'light' | 'dark' | 'auto'
  resolvedTheme: 'light', // 'light' | 'dark'
  setTheme: () => {},
});

function isDarkTheme(mode) {
  return mode === 'dark' || (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function clearThemeReveal(root) {
  delete root.dataset.themeReveal;
  root.style.removeProperty('--theme-reveal-origin');
  root.style.removeProperty('--theme-reveal-radius');
}

export function ThemeProvider({ children }) {
  const activeReveal = useRef(null);
  // Initialize from document class which was set instantly by <head> script
  const [theme, setThemeState] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('tubelock_theme') || 'auto';
      } catch (_) {
        return 'auto';
      }
    }
    return 'auto';
  });

  const [resolvedTheme, setResolvedTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'light';
  });

  const applyTheme = useCallback((mode) => {
    if (typeof window === 'undefined') return;

    const dark = isDarkTheme(mode);
    const resolved = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = resolved;
    setResolvedTheme(resolved);
  }, []);

  const setTheme = useCallback((newTheme, { origin } = {}) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('tubelock_theme', newTheme);
    } catch (_) {}

    const root = document.documentElement;
    const previous = activeReveal.current;
    activeReveal.current = null;
    previous?.skipTransition();

    const shouldReveal = origin
      && typeof document.startViewTransition === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && root.classList.contains('dark') !== isDarkTheme(newTheme);

    if (!shouldReveal) {
      if (previous) clearThemeReveal(root);
      applyTheme(newTheme);
      return;
    }

    const { innerWidth, innerHeight } = window;
    const x = Math.max(0, Math.min(origin.x, innerWidth));
    const y = Math.max(0, Math.min(origin.y, innerHeight));
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 2;
    root.style.setProperty('--theme-reveal-origin', `${x}px ${y}px`);
    root.style.setProperty('--theme-reveal-radius', `${radius}px`);
    root.dataset.themeReveal = '';

    let reveal;
    try {
      reveal = document.startViewTransition(() => {
        // A skipped transition still runs its callback. Apply only the latest choice.
        if (activeReveal.current !== reveal) return;
        root.dataset.themeReveal = 'active';
        flushSync(() => applyTheme(newTheme));
      });
    } catch {
      clearThemeReveal(root);
      applyTheme(newTheme);
      return;
    }
    activeReveal.current = reveal;

    const finish = () => {
      if (activeReveal.current !== reveal) return;
      activeReveal.current = null;
      clearThemeReveal(root);
    };
    reveal.ready.catch(() => {});
    reveal.finished.then(finish, finish);
  }, [applyTheme]);

  // Listen to OS dark mode changes when mode is 'auto'
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      try {
        const stored = localStorage.getItem('tubelock_theme') || 'auto';
        if (stored === 'auto') applyTheme('auto');
      } catch (_) {}
    };

    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
