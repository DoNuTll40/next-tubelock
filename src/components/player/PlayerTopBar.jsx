'use client';

import React from 'react';
import {
  ChevronRight, ArrowLeft, Play, Pause, Cast, Subtitles, Settings
} from 'lucide-react';

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

  const is4K = activeLevelLabel?.includes?.('4K') || false;
  const isHD = activeLevelLabel?.includes?.('1080') || activeLevelLabel?.includes?.('720') || activeLevelLabel?.includes?.('HD') || false;

  return (
    <div
      className="absolute top-0 left-0 right-0 px-2.5 sm:px-6 pt-2.5 sm:pt-4 pb-6 sm:pb-8 bg-gradient-to-b from-black/85 via-black/35 to-transparent flex items-center justify-between z-30 transition-opacity duration-150"
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
          className="p-2 -ml-1 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-xs transition active:scale-90 cursor-pointer"
          title="ย้อนกลับ"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      ) : (
        <div className="w-8" />
      )}

      {/* Top-Right: Shown ONLY on Mobile */}
      {isMobileView ? (
        <div className="flex items-center gap-1 sm:gap-3 shrink-0 text-white">
          {/* Autoplay switch */}
          <button
            type="button"
            onClick={() => {
              const next = !isAutoplay;
              setIsAutoplay(next);
              showToast?.(next ? 'เปิดการเล่นอัตโนมัติ' : 'ปิดการเล่นอัตโนมัติ');
              resetControlsTimer?.();
            }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
              isAutoplay ? 'bg-white' : 'bg-white/30'
            }`}
            title={isAutoplay ? 'การเล่นอัตโนมัติเปิดอยู่' : 'การเล่นอัตโนมัติปิดอยู่'}
          >
            <span
              className={`inline-flex items-center justify-center h-3.5 w-3.5 transform rounded-full transition-transform ${
                isAutoplay ? 'translate-x-4.5 bg-black' : 'translate-x-1 bg-white'
              }`}
            >
              {isAutoplay ? (
                <Play className="w-2 h-2 fill-current text-white" />
              ) : (
                <Pause className="w-2 h-2 fill-current text-black" />
              )}
            </span>
          </button>

          {/* Cast */}
          <button
            type="button"
            onClick={() => {
              showToast?.('เชื่อมต่ออุปกรณ์ Cast / TV');
              resetControlsTimer?.();
            }}
            className="p-1.5 rounded-lg hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-300 hover:text-white"
            title="เล่นบนทีวี (Cast)"
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
            className={`p-1.5 rounded-lg hover:bg-white/15 active:scale-90 transition cursor-pointer ${
              isCcActive ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-300 hover:text-white'
            }`}
            title="คำบรรยาย (CC)"
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
            className="p-1.5 rounded-lg hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-300 hover:text-white relative"
            title="การตั้งค่า"
          >
            <Settings className="w-4.5 h-4.5" />
            {is4K ? (
              <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white font-extrabold text-[7px] leading-tight px-1 py-0.5 rounded shadow pointer-events-none">
                4K
              </span>
            ) : isHD ? (
              <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white font-extrabold text-[7px] leading-tight px-0.5 py-0.5 rounded shadow pointer-events-none">
                HD
              </span>
            ) : null}
          </button>
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}
