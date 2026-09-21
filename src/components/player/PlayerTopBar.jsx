'use client';

import React from 'react';
import {
  ChevronRight, ArrowLeft, Play, Pause, Cast, Subtitles, Settings
} from 'lucide-react';
import { getGearBadge } from '@/lib/videoUtils';

export default function PlayerTopBar({
  showControls,
  isPlaying,
  isFullscreen,
  isMobileView,
  title,
  channelName,
  onBack,
  isAutoplay,
  setIsAutoplay,
  isCcActive,
  setIsCcActive,
  showSettingsMenu,
  setShowSettingsMenu,
  setSettingsPlacement,
  setActiveMenuTab,
  activeLevelLabel,
  showToast,
  resetControlsTimer,
}) {
  if (!showControls && isPlaying) return null;
  if (!isFullscreen && !isMobileView) return null;

  const gearBadge = getGearBadge(activeLevelLabel);

  return (
    <div
      className="absolute top-0 left-0 right-0 px-2.5 sm:px-6 pt-2.5 sm:pt-4 pb-6 sm:pb-8 bg-gradient-to-b from-black/75 via-black/25 to-transparent flex items-center justify-between z-30 transition-opacity duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top-Left: Title in Fullscreen, or Back Button in Mobile Portrait */}
      {isFullscreen ? (
        <div className="flex items-center gap-2 max-w-[75%] min-w-0">
          <div className="flex flex-col min-w-0 text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-white text-xs sm:text-base font-semibold truncate drop-shadow-md select-none">
                {title || 'วิดีโอ TubeLock'}
              </span>
              {isMobileView && <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
            </div>
            {isMobileView && (
              <span className="text-[10px] sm:text-[11px] text-zinc-400 truncate select-none">
                {channelName || 'TubeLock'} • Cloud Stream
              </span>
            )}
          </div>
        </div>
      ) : isMobileView && onBack ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBack();
          }}
          className="p-2 -ml-1 rounded-full bg-black/25 hover:bg-black/70 text-white backdrop-blur-md transition active:scale-90 cursor-pointer border border-white/15 shadow-sm"
          title="ย้อนกลับ"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      ) : (
        <div className="w-8" />
      )}

      {/* Top-Right: Shown ONLY on Mobile */}
      {isMobileView ? (
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 text-white">
          {/* Autoplay switch */}
          <button
            type="button"
            onClick={() => {
              showToast?.('เล่นวิดีโอถัดไปอัตโนมัติ (Coming soon)');
              resetControlsTimer?.();
            }}
            className="relative inline-flex h-6 w-10.5 items-center rounded-full transition-colors cursor-pointer bg-black/25 hover:bg-black/70 border border-white/15 backdrop-blur-md mr-0.5"
          >
            <span className="inline-flex items-center justify-center h-4 w-4 transform rounded-full transition-transform translate-x-1 bg-white/90 shadow-xs">
              <Play className="w-2 h-2 fill-current text-zinc-900 ml-0.5" />
            </span>
          </button>

          {/* Cast */}
          <button
            type="button"
            onClick={() => {
              showToast?.('เชื่อมต่ออุปกรณ์ Cast / TV');
              resetControlsTimer?.();
            }}
            className="p-2 rounded-xl bg-black/25 hover:bg-white/15 border border-white/15 backdrop-blur-md text-zinc-300 hover:text-white active:scale-90 transition cursor-pointer shadow-xs"
          >
            <Cast className="w-4.5 h-4.5" />
          </button>

          {/* CC */}
          <button
            type="button"
            onClick={() => {
              setIsCcActive(!isCcActive);
              showToast?.(isCcActive ? 'ปิดคำบรรยาย' : 'ยังไม่มีไฟล์คำบรรยาย (CC)');
              resetControlsTimer?.();
            }}
            className={`p-2 rounded-xl border backdrop-blur-md active:scale-90 transition cursor-pointer shadow-xs ${isCcActive ? 'text-[#FF7A00] bg-white/20 border-[#FF7A00]/50' : 'bg-black/25 hover:bg-white/15 border-white/15 text-zinc-300 hover:text-white'
              }`}
          >
            <Subtitles className="w-4.5 h-4.5" />
          </button>

          {/* Settings */}
          <button
            type="button"
            data-settings-btn="true"
            onClick={() => {
              setSettingsPlacement?.('top');
              setShowSettingsMenu(!showSettingsMenu);
              setActiveMenuTab?.('main');
              resetControlsTimer?.();
            }}
            className="p-2 rounded-xl bg-black/25 hover:bg-white/15 border border-white/15 backdrop-blur-md active:scale-90 transition cursor-pointer text-zinc-300 hover:text-white relative shadow-xs"
          >
            <Settings className="w-4.5 h-4.5" />
            {gearBadge && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white font-extrabold text-[8px] leading-tight px-1.5 py-0.5 rounded shadow pointer-events-none tracking-tight border border-white/30">
                {gearBadge}
              </span>
            )}
          </button>
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}
