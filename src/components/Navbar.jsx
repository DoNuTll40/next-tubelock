'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { User, Menu, Search, Mic, Plus, Bell, X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useSidebar } from '@/context/SidebarContext';
import { useViewMode } from '@/context/ViewModeContext';
import SearchDropdown from './navbar/SearchDropdown';

// Browser Native Crypto SHA-256
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function Navbar({ session }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toggleSidebar, toggleDrawer } = useSidebar();
  const { mode, isDesktop } = useViewMode();
  const [avatarUrl, setAvatarUrl] = useState('');
  const [imgError, setImgError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchContainerRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    const updateAvatar = async () => {
      if (typeof window === 'undefined') return;
      const email = localStorage.getItem('pt_gravatar_email');
      const fallback = localStorage.getItem('pt_fallback_avatar') || 'mp';
      if (email) {
        try {
          const hash = await sha256(email);
          if (isMounted) {
            setAvatarUrl(`https://www.gravatar.com/avatar/${hash}?d=${fallback}&s=80`);
            setImgError(false);
          }
        } catch {
          if (isMounted) setAvatarUrl(`https://www.gravatar.com/avatar/?d=${fallback}&s=80`);
        }
      } else if (isMounted) {
        setAvatarUrl(`https://www.gravatar.com/avatar/?d=${fallback}&s=80`);
      }
    };

    updateAvatar();
    window.addEventListener('storage', updateAvatar);
    return () => {
      isMounted = false;
      window.removeEventListener('storage', updateAvatar);
    };
  }, []);

  const handleSelectQuery = (query, thumbnail) => {
    setSearchQuery(query);
    setIsSearchFocused(false);
    if (query.trim()) {
      try {
        const saved = localStorage.getItem('tubelock_search_history');
        const parsed = saved ? JSON.parse(saved) : [];
        const existing = parsed.find((item) => item.query.toLowerCase() === query.trim().toLowerCase());
        const effectiveThumb = thumbnail || existing?.thumbnail || null;
        const filtered = parsed.filter((item) => item.query.toLowerCase() !== query.trim().toLowerCase());
        const updated = [{ id: 'h_' + Date.now(), query: query.trim(), thumbnail: effectiveThumb }, ...filtered].slice(0, 25);
        localStorage.setItem('tubelock_search_history', JSON.stringify(updated));
      } catch (_) { }

      const formattedQuery = encodeURIComponent(query.trim()).replace(/%20/g, '+');
      router.push(`/results?search_query=${formattedQuery}`);

      // Save to account database if logged in
      fetch('/api/search/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), thumbnail: effectiveThumb }),
      }).catch(() => {});
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setIsSearchFocused(false);
      let foundThumb = null;
      try {
        const saved = localStorage.getItem('tubelock_search_history');
        const parsed = saved ? JSON.parse(saved) : [];
        const existing = parsed.find((item) => item.query.toLowerCase() === searchQuery.trim().toLowerCase());
        foundThumb = existing?.thumbnail || null;
        const filtered = parsed.filter((item) => item.query.toLowerCase() !== searchQuery.trim().toLowerCase());
        const updated = [{ id: 'h_' + Date.now(), query: searchQuery.trim(), thumbnail: foundThumb }, ...filtered].slice(0, 25);
        localStorage.setItem('tubelock_search_history', JSON.stringify(updated));
      } catch (_) { }

      const formattedQuery = encodeURIComponent(searchQuery.trim()).replace(/%20/g, '+');
      router.push(`/results?search_query=${formattedQuery}`);

      // Save to account database if logged in
      fetch('/api/search/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim(), thumbnail: foundThumb }),
      }).catch(() => {});
    }
  };

  // Sync search input from URL when visiting /results
  useEffect(() => {
    if (typeof window !== 'undefined' && pathname === '/results') {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('search_query');
      if (q) {
        setSearchQuery(q);
      }
    }
  }, [pathname]);

  const isWatchPage = pathname?.startsWith('/watch');
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    if (!isWatchPage) return;

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isWatchPage]);

  // On mobile: hide navbar on /watch and /settings
  if ((pathname?.startsWith('/watch') || pathname?.startsWith('/settings')) && !isDesktop) {
    return null;
  }

  // โปร่งแสงบนหน้า /watch เมื่ออยู่ที่ด้านบนสุด เพื่อให้แสง Ambient ลอยทะลุผ่านเหมือน YouTube
  const isTransparent = isWatchPage && !isScrolled;

  return (
    <header
      className={`sticky top-0 z-40 w-full px-4 py-2 select-none h-14 flex items-center transition-colors duration-300 ${isTransparent
        ? 'bg-transparent border-b border-transparent backdrop-blur-none'
        : 'bg-[#FBF9F5]/95 dark:bg-[#0F0F0F]/95 backdrop-blur-md border-b border-[#EFECE6] dark:border-white/10'
        }`}
    >
      <div className="w-full flex items-center justify-between gap-4">
        {/* Left: Hamburger & Logo */}
        <div className="flex items-center gap-3 shrink-0 z-10">
          <button
            type="button"
            onClick={() => {
              if (pathname?.startsWith('/settings') || pathname?.startsWith('/watch') || !isDesktop) {
                toggleDrawer();
              } else {
                toggleSidebar();
              }
            }}
            className="hidden md:block p-2 rounded-full hover:bg-[#EFECE6] dark:hover:bg-[#222222] active:scale-95 transition text-[#212529] dark:text-[#F1F1F1] cursor-pointer"
            title="เมนูนำทาง"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link href="/" className="flex items-center gap-2 transition">
            <img
              src="/images/TubeLock.png"
              alt="TubeLock Logo"
              className="w-7 h-7 rounded-lg object-contain shadow-[0_2px_8px_rgba(255,122,0,0.3)] shrink-0"
            />
            <div className="flex items-start gap-1">
              <span className="font-bold text-base tracking-tight text-[#212529] dark:text-[#F1F1F1]">
                Tube<span className="text-[#FF7A00]">Lock</span>
              </span>
              <span className="text-[9px] font-semibold text-[#8C857B] dark:text-[#888888] -mt-0.5">TH</span>
            </div>
          </Link>
        </div>

        {/* Center: Search Bar (True 50% Viewport Center - YouTube PC Style) */}
        {isDesktop && (
          <div className="absolute left-1/2 -translate-x-1/2 w-full max-w-[500px] lg:max-w-[580px] xl:max-w-[640px] px-4 flex items-center justify-center z-20 pointer-events-none">
            <div ref={searchContainerRef} className="relative flex items-center justify-center w-full pointer-events-auto">
              <div className="relative flex-1">
                <form onSubmit={handleSearch} className="flex items-center w-full h-10">
                  <div
                    className={`h-10 flex items-center flex-1 relative rounded-l-full border bg-white dark:bg-[#121212] overflow-hidden shadow-2xs transition-all duration-200 ${
                      isSearchFocused
                        ? 'border-[#FF7A00] pl-3.5 z-10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]'
                        : 'border-[#EFECE6] dark:border-white/15 pl-4'
                    }`}
                  >
                    {/* Search Icon inside input when focused (YouTube Style) */}
                    {isSearchFocused && (
                      <Search className="w-4 h-4 text-[#8C857B] dark:text-[#AAAAAA] mr-2 shrink-0 animate-in fade-in duration-150" />
                    )}

                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onFocus={() => setIsSearchFocused(true)}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setIsSearchFocused(false);
                          searchInputRef.current?.blur();
                        }
                      }}
                      placeholder="ค้นหาใน TubeLock"
                      className="w-full h-full pr-2 text-md text-[#212529] dark:text-[#F1F1F1] placeholder:text-[#8C857B] dark:placeholder:text-[#777777] focus:outline-none bg-transparent"
                    />

                    {/* Clear "X" button when input has text */}
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          searchInputRef.current?.focus();
                        }}
                        className="p-1 mr-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/15 text-[#8C857B] hover:text-[#212529] dark:text-[#AAAAAA] dark:hover:text-white transition cursor-pointer shrink-0"
                        title="ล้างข้อความค้นหา"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    className="h-10 px-6 rounded-r-full bg-[#F5F2EB] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2a2a2a] border-y border-r border-[#EFECE6] dark:border-white/15 -ml-[1px] text-[#212529] dark:text-[#F1F1F1] flex items-center justify-center cursor-pointer transition active:bg-[#E5E0D8] shrink-0"
                    title="ค้นหา"
                  >
                    <Search className="w-4.5 h-4.5" />
                  </button>
                </form>

                {/* 🔍 YouTube-style Search History & Autocomplete Dropdown */}
                <SearchDropdown
                  isOpen={isSearchFocused}
                  searchQuery={searchQuery}
                  onSelectQuery={handleSelectQuery}
                  onClose={() => setIsSearchFocused(false)}
                  searchContainerRef={searchContainerRef}
                />
              </div>

              {/* Voice Search Button */}
              <button
                type="button"
                className="ml-3 w-10 h-10 rounded-full bg-[#F5F2EB] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2a2a2a] flex items-center justify-center text-[#212529] dark:text-[#F1F1F1] transition cursor-pointer shrink-0"
                title="ค้นหาด้วยเสียง"
              >
                <Mic className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
        )}

        {/* Right: Actions & Gravatar Avatar */}
        <div className="flex items-center gap-2 sm:gap-0.5 ml-auto shrink-0 z-10">
          {/* Mobile Search Icon */}
          {!isDesktop && (
            <button
              type="button"
              className="p-2 rounded-full hover:bg-[#EFECE6] dark:hover:bg-[#222222] text-[#212529] dark:text-[#F1F1F1]"
            >
              <Search className="w-5 h-5" />
            </button>
          )}

          {/* Create / Upload button (Desktop) */}
          {isDesktop && (
            <Link
              href="/upload"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F5F2EB] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2a2a2a] text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] transition active:scale-95"
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
              className="flex p-2 rounded-full hover:bg-[#EFECE6] dark:hover:bg-[#222222] text-[#212529] dark:text-[#F1F1F1] transition"
              title="การแจ้งเตือน"
            >
              <Bell className="w-5 h-5" />
            </button>
          )}

          {/* Gravatar Avatar */}
          <Link
            href="/settings"
            className={`${session && isDesktop && ''} relative group flex justify-center items-end p-0.5 pl-4 bg-transparent ${session && "border"} border-[#EFECE6] dark:border-white/10 rounded-full transition gap-2`}
            title="ตั้งค่าระบบ"
          >
            {session &&
              <div className='flex flex-col'>
                <p className='text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] truncate w-12'>{session?.name}</p>
                <p className='text-[10px] text-[#8C857B] dark:text-[#AAAAAA] truncate w-12'>{session?.email}</p>
              </div>
            }
            <div className="w-8 h-8 rounded-full overflow-hidden bg-[#EFECE6] dark:bg-white/10 border border-[#EFECE6] dark:border-white/10 flex items-center justify-center">
              {avatarUrl && !imgError ? (
                <img
                  src={session?.picture ? session?.picture : avatarUrl}
                  alt="Profile"
                  onError={() => setImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-4 h-4 text-[#8C857B] dark:text-[#AAAAAA]" />
              )}
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-[#FBF9F5] dark:border-[#0F0F0F] rounded-full" />
            </div>
          </Link>
        </div>
      </div>
    </header>
  );
}
