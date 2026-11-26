'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatedTabs } from '@/components/ui/AnimatedTabs';

const CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'shorts', label: 'วิดีโอสั้น / Shorts' },
  { id: 'music', label: 'เพลง / ดนตรี' },
  { id: 'entertainment', label: 'บันเทิง / วาไรตี้' },
  { id: 'gaming', label: 'เกม' },
  { id: 'tech', label: 'เทคโนโลยี' },
  { id: 'education', label: 'การศึกษา' },
  { id: 'hls', label: 'HLS Stream' },
  { id: '4k', label: '4K Ultra HD' },
  { id: '1080p', label: '1080p Full HD' },
  { id: 'av1', label: 'AV1' },
  { id: 'direct', label: 'Direct Stream' },
];

export default function CategoryChips({ activeCategory = 'all', onSelectCategory }) {
  const scrollRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const updateArrows = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftArrow(scrollLeft > 10);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
  }, []);

  useLayoutEffect(() => {
    const rail = scrollRef.current;
    if (!rail) return;

    const observer = new ResizeObserver(updateArrows);
    observer.observe(rail);
    for (const chip of rail.children) observer.observe(chip);
    return () => observer.disconnect();
  }, [updateArrows]);

  const scroll = (direction) => {
    if (!scrollRef.current) return;
    const offset = direction === 'left' ? -200 : 200;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    scrollRef.current.scrollBy({ left: offset, behavior });
  };

  return (
    <div className="sticky top-14 z-30 w-full bg-[#FBF9F5]/95 dark:bg-[#0F0F0F]/95 backdrop-blur-md py-2 px-4 sm:px-6 border-b border-[#EFECE6] dark:border-white/10 select-none shadow-xs transition-colors">
      <div className="relative flex items-center max-w-full">
        {/* Left Arrow (Desktop) */}
        {showLeftArrow && (
          <div className="hidden sm:flex absolute left-0 top-0 bottom-0 items-center pr-4 bg-gradient-to-r from-[#FBF9F5] via-[#FBF9F5] dark:from-[#0F0F0F] dark:via-[#0F0F0F] to-transparent z-10">
            <button
              type="button"
              aria-label="เลื่อนหมวดหมู่ไปทางซ้าย"
              onClick={() => scroll('left')}
              className="w-8 h-8 rounded-full bg-white dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 shadow-md flex items-center justify-center hover:bg-[#F5F2EB] dark:hover:bg-[#2e2e2e] active:scale-95 transition text-[#212529] dark:text-[#F1F1F1] cursor-pointer"
            >
              <ChevronLeft aria-hidden="true" className="w-4 h-4" />
            </button>
          </div>
        )}

        <AnimatedTabs
          scrollRef={scrollRef}
          onScroll={updateArrows}
          tabs={CATEGORIES}
          value={activeCategory}
          onChange={onSelectCategory}
          label="หมวดหมู่วิดีโอ"
          variant="pill"
          behavior="filter"
          className="w-full px-1 py-0.5"
        />

        {/* Right Arrow (Desktop) */}
        {showRightArrow && (
          <div className="hidden sm:flex absolute right-0 top-0 bottom-0 items-center pl-4 bg-gradient-to-l from-[#FBF9F5] via-[#FBF9F5] dark:from-[#0F0F0F] dark:via-[#0F0F0F] to-transparent z-10">
            <button
              type="button"
              aria-label="เลื่อนหมวดหมู่ไปทางขวา"
              onClick={() => scroll('right')}
              className="w-8 h-8 rounded-full bg-white dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 shadow-md flex items-center justify-center hover:bg-[#F5F2EB] dark:hover:bg-[#2e2e2e] active:scale-95 transition text-[#212529] dark:text-[#F1F1F1] cursor-pointer"
            >
              <ChevronRight aria-hidden="true" className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
