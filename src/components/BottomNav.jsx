'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, History, Plus, RefreshCw, Settings } from 'lucide-react';

export default function BottomNav() {
  const pathname = usePathname();

  // Hide BottomNav when watching a video or in settings
  if (pathname?.startsWith('/watch') || pathname?.startsWith('/settings')) {
    return null;
  }

  const navItems = [
    { label: 'หน้าแรก', path: '/', icon: Home },
    { label: 'ประวัติ', path: '/history', icon: History },
    { label: 'อัปโหลด', path: '/upload', icon: Plus, isPrimary: true, isDev: false },
    { label: 'ซิงก์', path: '/sync', icon: RefreshCw },
    { label: 'ตั้งค่า', path: '/settings', icon: Settings },
  ];

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#EFECE6] shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
      <nav className="max-w-md mx-auto grid grid-cols-5 items-center h-14 sm:h-16 px-2 relative">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.path;

          // Primary Upload Button (Floating large orange button)
          if (item.isPrimary) {
            return (
              <div key={item.path} className="relative flex justify-center items-center h-full">
                <Link
                  href={item.path}
                  className="absolute -top-3.5 flex flex-col items-center group active:scale-90 transition-transform"
                  title={item.label}
                >
                  <div className="w-[52px] h-[52px] rounded-full bg-[#FF7A00] text-white flex items-center justify-center shadow-[0_6px_20px_rgba(255,122,0,0.45)] border-[3px] border-[#FBF9F5] group-hover:bg-[#E06C00] transition-colors">
                    <Icon className="w-6 h-6 stroke-[2.5]" />
                  </div>
                  {item.isDev && (
                    <span className="absolute -top-1.5 px-1.5 py-0.2 text-[8px] font-bold bg-zinc-900 text-white rounded-full font-mono scale-90 border border-white/20 shadow-xs">
                      Dev
                    </span>
                  )}
                </Link>
              </div>
            );
          }

          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex flex-col items-center justify-center gap-1 h-full transition-colors active:scale-95 ${
                isActive ? 'text-[#FF7A00]' : 'text-[#8C857B] hover:text-[#212529]'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.8]'}`} />
              <span className="text-[10px] font-medium leading-none tracking-tight">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </footer>
  );
}
