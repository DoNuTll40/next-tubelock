'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

const SidebarContext = createContext(null);

export function SidebarProvider({ children }) {
  const pathname = usePathname();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Auto-close overlay drawer whenever route changes
  useEffect(() => {
    setIsDrawerOpen(false);
    setIsMobileOpen(false);
  }, [pathname]);

  const toggleSidebar = () => {
    setIsExpanded((prev) => !prev);
  };

  const toggleDrawer = () => {
    setIsDrawerOpen((prev) => !prev);
  };

  const openDrawer = () => {
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
  };

  const toggleMobileSidebar = () => {
    setIsMobileOpen((prev) => !prev);
    setIsDrawerOpen((prev) => !prev);
  };

  return (
    <SidebarContext.Provider
      value={{
        isExpanded,
        setIsExpanded,
        toggleSidebar,
        isDrawerOpen,
        setIsDrawerOpen,
        toggleDrawer,
        openDrawer,
        closeDrawer,
        isMobileOpen,
        setIsMobileOpen,
        toggleMobileSidebar,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    return {
      isExpanded: true,
      setIsExpanded: () => {},
      toggleSidebar: () => {},
      isDrawerOpen: false,
      setIsDrawerOpen: () => {},
      toggleDrawer: () => {},
      openDrawer: () => {},
      closeDrawer: () => {},
      isMobileOpen: false,
      setIsMobileOpen: () => {},
      toggleMobileSidebar: () => {},
    };
  }
  return ctx;
}
