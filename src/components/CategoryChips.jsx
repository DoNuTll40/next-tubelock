'use client';

import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'hls', label: 'HLS Stream' },
  { id: 'direct', label: 'Direct Stream' },
  { id: '4k', label: '4K Ultra HD' },
  { id: '2k', label: '2K / 1440p' },
  { id: '1080p', label: '1080p Full HD' },
  { id: '720p', label: '720p HD' },
  { id: 'av1', label: 'AV1' },
  { id: 'hevc', label: 'HEVC / H.265' },
  { id: 'h264', label: 'H.264' },
  { id: 'large', label: 'ไฟล์ใหญ่ (>100MB)' },
  { id: 'mv', label: 'MV / เพลง' },
];

export default function CategoryChips({ activeCategory = 'all', onSelectCategory }) {
  const scrollRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftArrow(scrollLeft > 10);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
  };

  const scroll = (direction) => {
    if (!scrollRef.current) return;
    const offset = direction === 'left' ? -200 : 200;
    scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
  };

  return (
    <div className="sticky top-14 z-30 w-full bg-[#FBF9F5]/98 backdrop-blur-md py-2 px-4 sm:px-6 border-b border-[#EFECE6] select-none shadow-xs">
      <div className="relative flex items-center max-w-full">
        {/* Left Arrow (Desktop) */}
        {showLeftArrow && (
          <div className="hidden sm:flex absolute left-0 top-0 bottom-0 items-center pr-4 bg-gradient-to-r from-[#FBF9F5] via-[#FBF9F5] to-transparent z-10">
            <button
              type="button"
              onClick={() => scroll('left')}
              className="w-8 h-8 rounded-full bg-white border border-[#EFECE6] shadow-md flex items-center justify-center hover:bg-[#F5F2EB] active:scale-95 transition text-[#212529] cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Scrollable Chips List */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex items-center gap-2 overflow-x-auto scrollbar-none scroll-smooth w-full no-scrollbar px-1 py-0.5"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelectCategory(cat.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-[#212529] text-white shadow-xs'
                    : 'bg-[#F0EDE6] hover:bg-[#E5E0D8] text-[#212529]'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Right Arrow (Desktop) */}
        {showRightArrow && (
          <div className="hidden sm:flex absolute right-0 top-0 bottom-0 items-center pl-4 bg-gradient-to-l from-[#FBF9F5] via-[#FBF9F5] to-transparent z-10">
            <button
              type="button"
              onClick={() => scroll('right')}
              className="w-8 h-8 rounded-full bg-white border border-[#EFECE6] shadow-md flex items-center justify-center hover:bg-[#F5F2EB] active:scale-95 transition text-[#212529] cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
