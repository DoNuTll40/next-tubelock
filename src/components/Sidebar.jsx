'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSidebar } from '@/context/SidebarContext';
import { 
  Home, History, PlusSquare, RefreshCw, 
  Settings, PlaySquare, ChevronRight, ListOrdered, Gauge
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();
  const { isExpanded } = useSidebar();

  // YouTube UX: Hide docked sidebar on watch page and settings page
  // On settings page, main navigation opens as an overlay drawer when clicking hamburger
  if (pathname?.startsWith('/watch') || pathname?.startsWith('/settings')) {
    return null;
  }

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

  // Match helper: exact for '/', startsWith for everything else
  const isItemActive = (item) => {
    if (item.exact) return pathname === item.path;
    return pathname === item.path || pathname?.startsWith(item.path + '/');
  };

  // MINI RAIL SIDEBAR (Collapsed Desktop)
  if (!isExpanded) {
    return (
      <aside className="flex flex-col items-center py-3 w-[72px] shrink-0 sticky top-14 h-[calc(100vh-56px)] bg-[#FBF9F5] dark:bg-[#0F0F0F] border-r border-[#EFECE6] dark:border-white/10 select-none z-20">
        {[
          { label: 'หน้าแรก', path: '/', icon: Home, exact: true },
          { label: 'อัปโหลด', path: '/upload', icon: PlusSquare, exact: true },
          { label: 'คิวงาน', path: '/upload/queue', icon: ListOrdered, exact: true },
          { label: 'ประวัติ', path: '/history', icon: History, exact: false },
          { label: 'ซิงก์', path: '/sync', icon: RefreshCw, exact: false },
          { label: 'เบนช์มาร์ก', path: '/benchmark', icon: Gauge, exact: false },
          { label: 'ตั้งค่า', path: '/settings', icon: Settings, exact: false },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = item.exact ? pathname === item.path : (pathname === item.path || pathname?.startsWith(item.path + '/'));
          return (
            <Link
              key={item.path + item.label}
              href={item.path}
              className={`w-16 h-16 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-colors mb-1 ${
                isActive
                  ? 'text-[#FF7A00] bg-[#FFF4EB] dark:bg-[#FF7A00]/15'
                  : 'text-[#212529] dark:text-[#E1E1E1] hover:bg-[#F0EDE6] dark:hover:bg-white/5'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-[2]'}`} />
              <span className={`text-[10px] font-medium leading-none tracking-tight ${isActive ? 'font-bold' : ''}`}>
                {item.label}
              </span>
            </Link>
          );
        })}

        <div className="mt-auto pb-2 text-[9px] text-[#A09A90] dark:text-[#666666] font-mono">
          v1.0
        </div>
      </aside>
    );
  }

  // EXPANDED FULL SIDEBAR (YouTube PC Style)
  return (
    <aside className="flex flex-col w-56 shrink-0 py-2.5 px-3 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto bg-[#FBF9F5] dark:bg-[#0F0F0F] border-r border-[#EFECE6] dark:border-white/10 select-none z-20">
      {/* Main Navigation */}
      <div className="flex flex-col gap-0.5 pb-3 border-b border-[#EFECE6] dark:border-white/10">
        {mainItems.map((item) => {
          const Icon = item.icon;
          const isActive = isItemActive(item);
          return (
            <Link
              key={item.path + item.label}
              href={item.path}
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

      {/* You Section */}
      <div className="flex flex-col gap-0.5 py-3 border-b border-[#EFECE6] dark:border-white/10">
        <Link
          href="/history"
          className="flex items-center justify-between px-3.5 py-1 text-xs font-bold text-[#212529] dark:text-[#F1F1F1] hover:text-[#FF7A00] dark:hover:text-[#FF7A00] transition-colors"
        >
          <span>คุณ</span>
          <ChevronRight className="w-3.5 h-3.5 text-[#8C857B] dark:text-[#AAAAAA]" />
        </Link>
        {userItems.map((item) => {
          const Icon = item.icon;
          const isActive = isItemActive(item);
          return (
            <Link
              key={item.path + item.label}
              href={item.path}
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

      {/* System Section */}
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

      {/* Footer Branding */}
      <div className="mt-auto pt-4 pb-3 px-3 border-t border-[#EFECE6] dark:border-white/10 text-[10px] text-[#8C857B] dark:text-[#888888] leading-relaxed">
        <p className="font-semibold text-[#5A554E] dark:text-[#AAAAAA]">TubeLock v1.0 (HLS)</p>
        <p className="text-[9px] text-[#A09A90] dark:text-[#666666]">Private Cloud Streaming</p>
      </div>
    </aside>
  );
}

function GaugeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  );
}
