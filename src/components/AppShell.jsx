'use client';

import React from 'react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import SidebarDrawer from '@/components/SidebarDrawer';
import BottomNav from '@/components/BottomNav';
import { useViewMode } from '@/context/ViewModeContext';
import { usePathname } from 'next/navigation';

export default function AppShell({ children }) {
  const pathname = usePathname();
  const { isDesktop, isMobile, mounted } = useViewMode();

  // Avoid flash of wrong layout before hydration
  // On server, default to desktop layout (avoids SSR mismatch)
  const showDesktopLayout = !mounted ? true : isDesktop;
  const showMobileLayout = !mounted ? false : isMobile;
  const isExcludedPage = pathname?.startsWith('/watch') || pathname?.startsWith('/settings');

  return (
    <div className="flex flex-col min-h-screen w-full relative bg-[#FBF9F5] dark:bg-[#0F0F0F] text-[#212529] dark:text-[#F1F1F1] transition-colors duration-200">
      {/* Top Navigation */}
      <Navbar />

      {/* Main Body */}
      <div className="flex-1 flex w-full">
        {/* Desktop Sidebar (automatically hides on /settings and /watch) */}
        {showDesktopLayout && <Sidebar />}

        <main className={`flex-1 w-full min-w-0 transition-all duration-0 ${showMobileLayout && !isExcludedPage ? 'pb-20' : 'pb-12'}`}>
          {children}
        </main>
      </div>

      {/* Slide-over Overlay Drawer (YouTube-style drawer for /settings, /watch, or when toggled) */}
      <SidebarDrawer />

      {/* Mobile Bottom Nav */}
      {showMobileLayout && <BottomNav />}
    </div>
  );
}
