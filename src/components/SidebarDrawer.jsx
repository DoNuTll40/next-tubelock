'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSidebar } from '@/context/SidebarContext';
import {
  Menu, Layers, Home, PlusSquare, RefreshCw,
  History, PlaySquare, Settings, Gauge, ChevronRight, X, ListOrdered
} from 'lucide-react';

export default function SidebarDrawer() {
  const pathname = usePathname();
  const { isDrawerOpen, closeDrawer } = useSidebar();

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isDrawerOpen) {
        closeDrawer();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen, closeDrawer]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isDrawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDrawerOpen]);

  if (!isDrawerOpen) return null;

  const mainItems = [
    { label: 'หน้าแรก', path: '/', icon: Home, exact: true },
    { label: 'อัปโหลด', path: '/upload', icon: PlusSquare, exact: true },
    { label: 'คิวแปลงไฟล์', path: '/upload/queue', icon: ListOrdered, exact: true },
    { label: 'ซิงก์ OneDrive', path: '/sync', icon: RefreshCw, exact: false },
  ];

  const userItems = [
    { label: 'ประวัติการรับชม', path: '/history', icon: History, exact: false },
    { label: 'คลังวิดีโอ', path: '/videos', icon: PlaySquare, exact: false },
  ];

  const systemItems = [
    { label: 'การตั้งค่า', path: '/settings', icon: Settings, exact: false },
    { label: 'เบนช์มาร์ก', path: '/benchmark', icon: Gauge, exact: false },
  ];

  const isItemActive = (item) => {
    if (item.exact) return pathname === item.path;
    return pathname === item.path || pathname?.startsWith(item.path + '/');
  };

  return (
    <div className="fixed inset-0 z-50 flex select-none animate-fadeIn">
      {/* Dark Backdrop (Click to close) */}
      <div
        onClick={closeDrawer}
        className="fixed inset-0 bg-black/45 backdrop-blur-[2px] transition-opacity duration-300"
        aria-hidden="true"
      />

      {/* Drawer Panel (YouTube Style Slide-Over) */}
      <aside
        className="relative z-10 w-64 max-w-[85vw] h-full bg-[#FBF9F5] dark:bg-[#0F0F0F] shadow-2xl flex flex-col border-r border-[#EFECE6] dark:border-white/10 overflow-y-auto animate-slideRight text-[#212529] dark:text-[#F1F1F1]"
      >
        {/* Drawer Header: Hamburger + TubeLock Logo */}
        <div className="h-14 px-4 flex items-center gap-3 border-b border-[#EFECE6] dark:border-white/10 shrink-0">
          <button
            type="button"
            onClick={closeDrawer}
            className="p-2 rounded-full hover:bg-[#EFECE6] dark:hover:bg-[#222222] active:scale-95 transition text-[#212529] dark:text-[#F1F1F1] cursor-pointer"
            title="ปิดเมนู"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link
            href="/"
            onClick={closeDrawer}
            className="flex items-center gap-2 active:scale-95 transition"
          >
            <div className="w-7 h-7 rounded-lg bg-[#FF7A00] flex items-center justify-center text-white shadow-[0_2px_8px_rgba(255,122,0,0.3)]">
              <Layers className="w-3.5 h-3.5 fill-white stroke-[2]" />
            </div>
            <div className="flex items-start gap-1">
              <span className="font-bold text-base tracking-tight text-[#212529] dark:text-[#F1F1F1]">
                Tube<span className="text-[#FF7A00]">Lock</span>
              </span>
              <span className="text-[9px] font-semibold text-[#8C857B] dark:text-[#888888] -mt-0.5">TH</span>
            </div>
          </Link>
        </div>

        {/* Navigation Content */}
        <div className="flex-1 py-2 px-3 overflow-y-auto">
          {/* Main Links */}
          <div className="flex flex-col gap-0.5 pb-3 border-b border-[#EFECE6] dark:border-white/10">
            {mainItems.map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={closeDrawer}
                  className={`flex items-center gap-4 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                    isActive
                      ? 'bg-[#FFF4EB] dark:bg-[#FF7A00]/15 text-[#FF7A00] font-bold'
                      : 'text-[#212529] dark:text-[#E1E1E1] hover:bg-[#F0EDE6] dark:hover:bg-white/5'
                  }`}
                >
                  <Icon className={`w-[18px] h-[18px] ${isActive ? 'stroke-[2.5]' : 'stroke-[2]'}`} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>

          {/* User Links */}
          <div className="flex flex-col gap-0.5 py-3 border-b border-[#EFECE6] dark:border-white/10">
            <Link
              href="/history"
              onClick={closeDrawer}
              className="flex items-center justify-between px-3.5 py-1 text-xs font-bold text-[#212529] dark:text-[#F1F1F1] hover:text-[#FF7A00] dark:hover:text-[#FF7A00] transition-colors"
            >
              <span>คุณ</span>
              <ChevronRight className="w-3.5 h-3.5 text-[#8C857B] dark:text-[#888888]" />
            </Link>
            {userItems.map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={closeDrawer}
                  className={`flex items-center gap-4 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-[#FFF4EB] dark:bg-[#FF7A00]/15 text-[#FF7A00] font-bold'
                      : 'text-[#212529] dark:text-[#E1E1E1] hover:bg-[#F0EDE6] dark:hover:bg-white/5'
                  }`}
                >
                  <Icon className={`w-[18px] h-[18px] ${isActive ? 'stroke-[2.5]' : 'stroke-[2]'}`} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>

          {/* System Links */}
          <div className="flex flex-col gap-0.5 pt-3">
            <span className="px-3.5 py-1 text-[11px] font-bold text-[#8C857B] dark:text-[#888888] uppercase tracking-wider">
              ระบบ
            </span>
            {systemItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.path;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={closeDrawer}
                  className={`flex items-center gap-4 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-[#FFF4EB] dark:bg-[#FF7A00]/15 text-[#FF7A00] font-bold'
                      : 'text-[#212529] dark:text-[#E1E1E1] hover:bg-[#F0EDE6] dark:hover:bg-white/5'
                  }`}
                >
                  <Icon className={`w-4.5 h-4.5 ${isActive ? 'stroke-[2.5]' : 'stroke-[2]'}`} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#EFECE6] dark:border-white/10 shrink-0 text-[10px] text-[#8C857B] dark:text-[#888888]">
          <p className="font-semibold text-[#5A554E] dark:text-[#AAAAAA]">TubeLock v1.0 (HLS)</p>
          <p className="text-[9px] text-[#A09A90] dark:text-[#666666] mt-0.5">Private Cloud Streaming</p>
        </div>
      </aside>
    </div>
  );
}
