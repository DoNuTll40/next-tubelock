'use client';

import React from 'react';
import { Check, Copy, Activity } from 'lucide-react';
import { formatTime } from './playerUtils';

export default function PlayerContextMenu({
  contextMenu,
  setContextMenu,
  video,
  isLooping,
  setIsLooping,
  showStats,
  setShowStats,
  showToast,
}) {
  if (!contextMenu) return null;

  return (
    <div
      className="absolute z-50 bg-black/50 border border-white/15 rounded-xl py-1.5 w-56 text-xs text-zinc-200 shadow-2xl backdrop-blur-md"
      style={{ top: contextMenu.y, left: contextMenu.x }}
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={() => setContextMenu?.(null)}
    >
      <button
        type="button"
        onClick={() => {
          if (video?.current) {
            const nextLoop = !isLooping;
            video.current.loop = nextLoop;
            setIsLooping?.(nextLoop);
            showToast?.(nextLoop ? 'เปิดการเล่นวนซ้ำ' : 'ปิดการเล่นวนซ้ำ');
          }
          setContextMenu?.(null);
        }}
        className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer"
      >
        <span>เล่นวนซ้ำ (Loop)</span>
        {isLooping && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
      </button>

      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined') {
            navigator.clipboard.writeText(window.location.href);
            showToast?.('คัดลอก URL ของวิดีโอแล้ว');
          }
          setContextMenu?.(null);
        }}
        className="w-full flex items-center gap-2 px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5"
      >
        <Copy className="w-3.5 h-3.5 text-zinc-400" />
        <span>คัดลอก URL ของวิดีโอ</span>
      </button>

      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && video?.current) {
            const url = new URL(window.location.href);
            url.searchParams.set('t', Math.floor(video.current.currentTime || 0));
            navigator.clipboard.writeText(url.toString());
            showToast?.(`คัดลอก URL ที่เวลา ${formatTime(video.current.currentTime)} แล้ว`);
          }
          setContextMenu?.(null);
        }}
        className="w-full flex items-center gap-2 px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer"
      >
        <Copy className="w-3.5 h-3.5 text-zinc-400" />
        <span>คัดลอก URL ตามเวลาปัจจุบัน</span>
      </button>

      <button
        type="button"
        onClick={() => {
          setShowStats?.(!showStats);
          setContextMenu?.(null);
        }}
        className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5"
      >
        <span className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span>สถิติสำหรับเด็กเนิร์ด</span>
        </span>
        {showStats && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
      </button>
    </div>
  );
}
