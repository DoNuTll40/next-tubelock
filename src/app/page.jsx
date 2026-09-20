'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import VideoCard from '@/components/VideoCard';
import CategoryChips from '@/components/CategoryChips';
import { Film, Loader2 } from 'lucide-react';
import { formatResolutionBadge } from '@/lib/videoUtils';

import { useViewMode } from '@/context/ViewModeContext';

export default function FeedPage() {
  const { isMobile, isDesktop } = useViewMode();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');

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
      const res = await fetch('/api/videos');
      const json = await res.json();
      setVideos(json?.data || []);
    } catch (err) {
      console.error('Failed to load feed videos:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      setPullY(0);
    }
  }, []);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  // Touch Handlers for Mobile Pull to Refresh
  const handleTouchStart = (e) => {
    if (window.scrollY <= 0 && !isRefreshing) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  };

  const handleTouchMove = (e) => {
    if (!isPulling.current || isRefreshing || window.scrollY > 0) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartY.current;

    if (diff > 0) {
      const dampedPull = Math.min(diff * 0.45, 110);
      setPullY(dampedPull);
    }
  };

  const handleTouchEnd = () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullY >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullY(0);
      loadData(true);
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
      if (activeCategory === 'mv') return v.title?.toLowerCase().includes('mv') || v.title?.includes('เพลง') || v.title?.includes('official');
      return true;
    });
  }, [videos, activeCategory]);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ overscrollBehaviorY: 'contain' }}
      className="flex flex-col w-full min-h-[85vh]"
    >
      {/* Category Chips Bar (YouTube Sticky Filter) */}
      <CategoryChips
        activeCategory={activeCategory}
        onSelectCategory={setActiveCategory}
      />

      {/* Pull down indicator (Mobile) */}
      <AnimatePresence>
        {pullY > 10 && (
          <div className="fixed top-14 left-0 right-0 z-30 flex justify-center pointer-events-none">
            <motion.div
              style={{ y: pullY - 10, scale: Math.min(pullY / PULL_THRESHOLD, 1) }}
              className="w-10 h-10 rounded-full bg-white border border-[#EFECE6] shadow-lg flex items-center justify-center"
            >
              <Loader2 
                className={`w-5 h-5 text-[#FF7A00] transition-transform ${
                  pullY >= PULL_THRESHOLD ? 'animate-spin' : ''
                }`}
                style={{ transform: `rotate(${pullY * 4}deg)` }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Grid View */}
      <div className="px-4 sm:px-6 pt-4 flex-1">
        {loading ? (
          /* SKELETON LOADING GRID */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-6 animate-pulse select-none">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="flex flex-col gap-2.5">
                <div className="aspect-video w-full bg-[#EFECE6] rounded-2xl" />
                <div className="flex gap-3 pt-1">
                  <div className="w-9 h-9 rounded-full bg-[#EFECE6] shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-4/5 bg-[#EFECE6] rounded" />
                    <div className="h-3 w-1/2 bg-[#EFECE6] rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredVideos.length === 0 ? (
          <div className="bg-white border border-[#EFECE6] rounded-2xl p-12 text-center flex flex-col items-center gap-3 text-[#6C757D] select-none my-8 max-w-lg mx-auto">
            <Film className="w-10 h-10 text-[#C4BEB4] stroke-[1.5]" />
            <p className="text-sm">ไม่พบวิดีโอในหมวดหมู่นี้</p>
            {activeCategory !== 'all' && (
              <button
                type="button"
                onClick={() => setActiveCategory('all')}
                className="mt-1 px-4 py-2 rounded-xl bg-[#F5F2EB] text-[#212529] text-xs font-semibold hover:bg-[#EFECE6]"
              >
                ดูทั้งหมด
              </button>
            )}
          </div>
        ) : (
          /* YOUTUBE PC & MOBILE RESPONSIVE VIDEO GRID */
          <div className={isMobile ? "grid grid-cols-1 gap-y-5 max-w-xl mx-auto" : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-7"}>
            {filteredVideos.map((vid) => (
              <VideoCard 
                key={vid.id} 
                video={vid} 
                onDelete={(deletedId) => {
                  setVideos((prev) => prev.filter((v) => v.id !== deletedId));
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
