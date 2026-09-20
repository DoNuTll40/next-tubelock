'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ThemeContext = createContext({
  theme: 'auto', // 'light' | 'dark' | 'auto'
  resolvedTheme: 'light', // 'light' | 'dark'
  setTheme: () => {},
});

export function ThemeProvider({ children }) {
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

    let isDark = false;
    if (mode === 'dark') {
      isDark = true;
    } else if (mode === 'light') {
      isDark = false;
    } else {
      // 'auto' / 'system'
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
      setResolvedTheme('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
      setResolvedTheme('light');
    }
  }, []);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('tubelock_theme', newTheme);
    } catch (_) {}
    applyTheme(newTheme);
  }, [applyTheme]);

  // Listen to OS dark mode changes when mode is 'auto'
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      try {
        const stored = localStorage.getItem('tubelock_theme') || 'auto';
        if (stored === 'auto') {
          if (e.matches) {
            document.documentElement.classList.add('dark');
            document.documentElement.style.colorScheme = 'dark';
            setResolvedTheme('dark');
          } else {
            document.documentElement.classList.remove('dark');
            document.documentElement.style.colorScheme = 'light';
            setResolvedTheme('light');
          }
        }
      } catch (_) {}
    };

    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
