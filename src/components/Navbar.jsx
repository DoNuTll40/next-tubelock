'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layers, User, Menu, Search, Mic, Plus, Bell } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSidebar } from '@/context/SidebarContext';
import { useViewMode } from '@/context/ViewModeContext';

// Browser Native Crypto SHA-256
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function Navbar() {
  const pathname = usePathname();
  const { toggleSidebar, toggleDrawer } = useSidebar();
  const { mode, isDesktop } = useViewMode();
  const [avatarUrl, setAvatarUrl] = useState('');
  const [imgError, setImgError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');


  const updateAvatar = async () => {
    if (typeof window === 'undefined') return;
    const email = localStorage.getItem('pt_gravatar_email');
    const fallback = localStorage.getItem('pt_fallback_avatar') || 'mp';
    if (email) {
      try {
        const hash = await sha256(email);
        setAvatarUrl(`https://www.gravatar.com/avatar/${hash}?d=${fallback}&s=80`);
        setImgError(false);
      } catch {
        setAvatarUrl(`https://www.gravatar.com/avatar/?d=${fallback}&s=80`);
      }
    } else {
      setAvatarUrl(`https://www.gravatar.com/avatar/?d=${fallback}&s=80`);
    }
  };

  useEffect(() => {
    updateAvatar();
    window.addEventListener('storage', updateAvatar);
    return () => window.removeEventListener('storage', updateAvatar);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/?q=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  // On watch page: show on PC / Desktop, hide on mobile
  if (pathname?.startsWith('/watch') && !isDesktop) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 w-full bg-[#FBF9F5]/95 backdrop-blur-md border-b border-[#EFECE6] px-4 py-2 select-none h-14 flex items-center">
      <div className="w-full flex items-center justify-between gap-4">
        {/* Left: Hamburger & Logo */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (pathname?.startsWith('/settings') || pathname?.startsWith('/watch') || !isDesktop) {
                toggleDrawer();
              } else {
                toggleSidebar();
              }
            }}
            className="p-2 rounded-full hover:bg-[#EFECE6] active:scale-95 transition text-[#212529] cursor-pointer"
            title="เมนูนำทาง"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link href="/" className="flex items-center gap-2 transition">
            <div className="w-7 h-7 rounded-lg bg-[#FF7A00] flex items-center justify-center text-white shadow-[0_2px_8px_rgba(255,122,0,0.3)]">
              <Layers className="w-3.5 h-3.5 fill-white stroke-[2]" />
            </div>
            <div className="flex items-start gap-1">
              <span className="font-bold text-base tracking-tight text-[#212529]">
                Tube<span className="text-[#FF7A00]">Lock</span>
              </span>
              <span className="text-[9px] font-semibold text-[#8C857B] -mt-0.5">TH</span>
            </div>
          </Link>
        </div>

        {/* Center: Search Bar (YouTube PC Style) */}
        {isDesktop ? (
          <div className="flex items-center justify-center flex-1 max-w-[620px] mx-auto">
            <form onSubmit={handleSearch} className="flex items-center w-full">
              <div className="flex items-center flex-1 relative rounded-l-full border border-[#EFECE6] focus-within:border-[#FF7A00] bg-white overflow-hidden shadow-2xs transition-colors">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาใน TubeLock"
                  className="w-full py-2 pl-4 pr-3 text-xs text-[#212529] placeholder:text-[#8C857B] focus:outline-none bg-transparent"
                />
              </div>
              <button
                type="submit"
                className="h-[34px] px-5 rounded-r-full bg-[#F5F2EB] hover:bg-[#EFECE6] border-y border-r border-[#EFECE6] text-[#212529] flex items-center justify-center cursor-pointer transition active:bg-[#E5E0D8]"
                title="ค้นหา"
              >
                <Search className="w-4 h-4" />
              </button>
            </form>

            {/* Voice Search Button */}
            <button
              type="button"
              className="ml-2.5 w-9 h-9 rounded-full bg-[#F5F2EB] hover:bg-[#EFECE6] flex items-center justify-center text-[#212529] transition cursor-pointer"
              title="ค้นหาด้วยเสียง"
            >
              <Mic className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* Right: Actions & Gravatar Avatar */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mobile Search Icon */}
          {!isDesktop && (
            <button
              type="button"
              className="p-2 rounded-full hover:bg-[#EFECE6] text-[#212529]"
            >
              <Search className="w-5 h-5" />
            </button>
          )}

          {/* Create / Upload button (Desktop) */}
          {isDesktop && (
            <Link
              href="/upload"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F5F2EB] hover:bg-[#EFECE6] text-xs font-semibold text-[#212529] transition active:scale-95"
              title="อัปโหลดวิดีโอ"
            >
              <Plus className="w-4 h-4 text-[#FF7A00]" />
              <span>สร้าง</span>
            </Link>
          )}

          {/* Notifications Bell */}
          {isDesktop && (
            <button
              type="button"
              className="flex p-2 rounded-full hover:bg-[#EFECE6] text-[#212529] transition"
              title="การแจ้งเตือน"
            >
              <Bell className="w-5 h-5" />
            </button>
          )}

          {/* Gravatar Avatar */}
          <Link
            href="/settings"
            className="relative group flex items-center p-0.5 rounded-full transition active:scale-95"
            title="ตั้งค่าระบบ"
          >
            <div className="w-8 h-8 rounded-full overflow-hidden bg-[#EFECE6] border border-[#EFECE6] flex items-center justify-center">
              {avatarUrl && !imgError ? (
                <img
                  src={avatarUrl}
                  alt="Profile"
                  onError={() => setImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-4 h-4 text-[#8C857B]" />
              )}
            </div>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-[#FBF9F5] rounded-full" />
          </Link>
        </div>
      </div>
    </header>
  );
}
