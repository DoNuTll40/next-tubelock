'use client';

import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import VideoCard from '@/components/VideoCard';
import CategoryChips from '@/components/CategoryChips';
import { AnimatedTabPanel } from '@/components/ui/AnimatedTabs';
import FeedSkeleton from '@/components/FeedSkeleton';
import { Film, Loader2 } from 'lucide-react';
import { formatResolutionBadge } from '@/lib/videoUtils';

import { useViewMode } from '@/context/ViewModeContext';

// Window-level SPA feed cache + scroll/category restoration (survives route transitions & HMR chunk reloads!)
const FEED_CACHE_KEY = '__TUBELOCK_FEED_CACHE__';
const FEED_CACHE_FRESH_MS = 10 * 60_000;

function readFeedCache() {
  if (typeof window === 'undefined') return null;
  return window[FEED_CACHE_KEY] || null;
}

function writeFeedCache(patch) {
  if (typeof window === 'undefined') return;
  window[FEED_CACHE_KEY] = {
    ...(window[FEED_CACHE_KEY] || { videos: null, fetchedAt: 0, scrollY: 0, category: 'all' }),
    ...patch,
  };
}

export default function FeedPage() {
  const { isMobile } = useViewMode();
  const [videos, setVideos] = useState(() => readFeedCache()?.videos || []);
  const [loading, setLoading] = useState(() => !Array.isArray(readFeedCache()?.videos));
  const [activeCategory, setActiveCategory] = useState(() => readFeedCache()?.category || 'all');

  useEffect(() => {
    writeFeedCache({ category: activeCategory });
  }, [activeCategory]);

  // Restore exact scroll position when returning to cached Home feed (runs after Next.js route-commit scroll reset)
  useLayoutEffect(() => {
    const cache = readFeedCache();
    const targetY = cache?.scrollY || 0;
    if (!Array.isArray(cache?.videos) || cache.videos.length === 0 || targetY <= 0) return;

    window.scrollTo(0, targetY);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      window.scrollTo(0, targetY);
      raf2 = requestAnimationFrame(() => {
        window.scrollTo(0, targetY);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);

  // Save scroll position ONLY on real user scroll while on '/' (never overwrite with 0 during unmount!)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onScroll = () => {
      if (window.location.pathname === '/') {
        writeFeedCache({ scrollY: window.scrollY });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Pull to Refresh States (Mobile)
  const [pullY, setPullY] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);

  const PULL_THRESHOLD = 75;

  const loadData = useCallback(async (showSkeleton = false) => {
    try {
      if (showSkeleton) {
        setLoading(true);
      }
      const res = await fetch('/api/videos', { cache: 'no-store' });
      const json = await res.json();
      const nextVideos = json?.data || [];
      writeFeedCache({ videos: nextVideos, fetchedAt: Date.now() });
      setVideos(nextVideos);
    } catch (err) {
      console.error('Failed to load feed videos:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      setPullY(0);
    }
  }, []);

  useEffect(() => {
    const cache = readFeedCache();
    const isCacheFresh =
      Array.isArray(cache?.videos) &&
      cache.videos.length > 0 &&
      Date.now() - (cache.fetchedAt || 0) < FEED_CACHE_FRESH_MS;
    if (isCacheFresh) return;

    const timer = setTimeout(() => {
      loadData(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  // Touch Handlers for Mobile Pull to Refresh
  const handleTouchStart = (e) => {
    if (e.touches.length === 1 && window.scrollY <= 0 && !isRefreshing) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length !== 1) {
      cancelPull();
      return;
    }
    if (!isPulling.current || isRefreshing || window.scrollY > 0) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartY.current;

    if (diff > 0) {
      const dampedPull = Math.min(diff * 0.45, 110);
      setPullY(dampedPull);
    }
  };

  const cancelPull = () => {
    isPulling.current = false;
    setPullY(0);
  };

  const handleTouchEnd = () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullY >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullY(0);
      loadData(false);
    } else {
      setPullY(0);
    }
  };

  // Filter videos by category chip
  const filteredVideos = useMemo(() => {
    if (!Array.isArray(videos)) return [];
    if (activeCategory === 'all') return videos;

    return videos.filter((v) => {
      const res = formatResolutionBadge(v.resolution);
      const codec = (v.codec || '').toLowerCase();
      const vCat = (v.category || '').toLowerCase();
      const vTags = Array.isArray(v.tags) ? v.tags.map((t) => String(t).toLowerCase()) : [];
      const titleLower = (v.title || '').toLowerCase();

      // Content categories
      if (activeCategory === 'shorts') {
        return vCat === 'shorts' || vTags.includes('shorts') || (v.resolution && v.resolution.includes('Vertical')) || titleLower.includes('#shorts');
      }
      if (activeCategory === 'music') {
        return vCat === 'music' || vTags.includes('music') || vTags.includes('เพลง') || titleLower.includes('mv') || titleLower.includes('เพลง') || titleLower.includes('official');
      }
      if (activeCategory === 'entertainment') {
        return vCat === 'entertainment' || vTags.includes('entertainment') || vTags.includes('บันเทิง');
      }
      if (activeCategory === 'gaming') {
        return vCat === 'gaming' || vTags.includes('gaming') || vTags.includes('เกม');
      }
      if (activeCategory === 'tech') {
        return vCat === 'tech' || vTags.includes('tech') || vTags.includes('ไอที') || vTags.includes('code');
      }
      if (activeCategory === 'education') {
        return vCat === 'education' || vTags.includes('education') || vTags.includes('การศึกษา');
      }

      // Technical categories
      if (activeCategory === 'hls') return v.source_type === 'hls';
      if (activeCategory === 'direct') return v.source_type === 'file';
      if (activeCategory === '4k') return res === '4K';
      if (activeCategory === '2k') return res === '2K';
      if (activeCategory === '1080p') return res === '1080p';
      if (activeCategory === '720p') return res === '720p';
      if (activeCategory === 'av1') return codec.includes('av1') || codec.includes('av01');
      if (activeCategory === 'hevc') return codec.includes('hevc') || codec.includes('h265') || codec.includes('hvc1');
      if (activeCategory === 'h264') return codec.includes('h264') || codec.includes('avc1');
      if (activeCategory === 'large') return Number(v.file_size_bytes || 0) > 100 * 1024 * 1024;
      return true;
    });
  }, [videos, activeCategory]);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={cancelPull}
      style={{ overscrollBehaviorY: 'contain' }}
      className="flex flex-col w-full min-h-[85vh]"
    >
      {/* Category Chips Bar (YouTube Sticky Filter) */}
      <CategoryChips
        activeCategory={activeCategory}
        onSelectCategory={setActiveCategory}
      />

      {/* Pull-to-Refresh Spinner emerging cleanly from underneath Sticky Header (z-35 < Navbar z-40) */}
      <AnimatePresence>
        {(pullY > 6 || isRefreshing) && (
          <div className="fixed top-14 left-0 right-0 z-[35] flex justify-center pointer-events-none">
            <motion.div
              initial={{ y: -44, opacity: 0, scale: 0.7 }}
              animate={{
                y: isRefreshing ? 14 : Math.min(pullY * 0.78, 62) - 24,
                opacity: isRefreshing ? 1 : Math.min(1, pullY / 36),
                scale: isRefreshing ? 1 : Math.max(0.75, Math.min(1, pullY / PULL_THRESHOLD)),
              }}
              exit={{ y: -44, opacity: 0, scale: 0.7 }}
              transition={
                isRefreshing
                  ? { type: 'spring', stiffness: 360, damping: 28 }
                  : { duration: 0.06, ease: 'linear' }
              }
              className="w-10 h-10 rounded-full bg-white dark:bg-[#212121] border border-[#EFECE6] dark:border-white/15 shadow-[0_6px_20px_rgba(0,0,0,0.45)] flex items-center justify-center"
            >
              <Loader2
                className={`w-5 h-5 text-[#FF7A00] ${
                  isRefreshing || pullY >= PULL_THRESHOLD ? 'animate-spin' : ''
                }`}
                style={
                  isRefreshing || pullY >= PULL_THRESHOLD
                    ? undefined
                    : { transform: `rotate(${pullY * 4.5}deg)` }
                }
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Grid View */}
      <AnimatedTabPanel value={activeCategory} behavior="filter" className="px-1 sm:px-6 py-2 flex-1">
        {loading ? (
          /* SKELETON LOADING GRID with GSAP Shimmer Wave */
          <FeedSkeleton count={8} />
        ) : filteredVideos.length === 0 ? (
          <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-12 text-center flex flex-col items-center gap-3 text-[#6C757D] dark:text-[#AAAAAA] select-none my-8 max-w-lg mx-auto">
            <Film className="w-10 h-10 text-[#C4BEB4] dark:text-[#666666] stroke-[1.5]" />
            <p className="text-sm">ไม่พบวิดีโอในหมวดหมู่นี้</p>
            {activeCategory !== 'all' && (
              <button
                type="button"
                onClick={() => setActiveCategory('all')}
                className="mt-1 px-4 py-2 rounded-xl bg-[#F5F2EB] dark:bg-white/10 text-[#212529] dark:text-[#F1F1F1] text-xs font-semibold hover:bg-[#EFECE6] dark:hover:bg-white/15 cursor-pointer"
              >
                ดูทั้งหมด
              </button>
            )}
          </div>
        ) : (
          /* YOUTUBE PC & MOBILE RESPONSIVE VIDEO GRID */
          <div className={isMobile ? "grid grid-cols-1 gap-y-5 max-w-xl mx-auto" : "grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 items-start gap-y-4 "}>
            {filteredVideos.map((vid) => (
              <div key={vid.id}>
                <VideoCard
                  video={vid}
                  onDelete={(deletedId) => {
                    setVideos((prev) => prev.filter((v) => v.id !== deletedId));
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </AnimatedTabPanel>
    </div>
  );
}
