'use client';

import {
  ChevronRight, ArrowLeft, Play, Pause, Cast, Settings, Layers
} from 'lucide-react';
import CcSubtitleIcon from '../icons/CcSubtitleIcon';
import { getGearBadge } from '@/lib/videoUtils';

export default function PlayerTopBar({
  showControls,
  isFullscreen,
  isMobileView,
  title,
  channelName,
  onBack,
  isAutoplay,
  setIsAutoplay,
  isCcActive,
  setIsCcActive,
  hasSubtitles = false,
  showSettingsMenu,
  setShowSettingsMenu,
  setSettingsPlacement,
  setActiveMenuTab,
  activeLevelLabel,
  showToast,
  resetControlsTimer,
  versions = [],
  activeVersion = null,
}) {
  if (!showControls) return null;
  if (!isFullscreen && !isMobileView) return null;

  const gearBadge = getGearBadge(activeLevelLabel);
  const playableVersions = Array.isArray(versions)
    ? versions.filter((v) => !v?.status || ['READY', 'COMPLETED'].includes(String(v.status).toUpperCase()))
    : [];
  const hasMultipleVersions = playableVersions.length > 1;

  return (
    <div
      className={`absolute top-0 left-0 right-0 [--bar-x:0.625rem] sm:[--bar-x:1.5rem] [--bar-top:0.625rem] sm:[--bar-top:1rem] pl-[calc(var(--bar-x)+var(--player-safe-left,0px))] pr-[calc(var(--bar-x)+var(--player-safe-right,0px))] pt-[calc(var(--bar-top)+var(--player-safe-top,0px))] pb-6 sm:pb-8 bg-gradient-to-b from-black/40 via-black/10 to-transparent flex items-center justify-between z-30 transition-opacity duration-150 ${isMobileView ? 'pointer-events-none [&_button]:pointer-events-auto' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top-Left: Title in Fullscreen, or Back Button in Mobile Portrait */}
      {isFullscreen ? (
        <div className="flex items-center gap-2 max-w-[75%] min-w-0">
          <div className="flex flex-col min-w-0 text-left">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-white text-xs sm:text-base font-medium truncate drop-shadow-sm select-none">
                {title || 'วิดีโอ TubeLock'}
              </span>
              {hasMultipleVersions && activeVersion && (
                <button
                  type="button"
                  data-settings-btn="true"
                  onClick={() => {
                    setSettingsPlacement?.(isMobileView ? 'top' : 'bottom');
                    setActiveMenuTab?.('version');
                    setShowSettingsMenu?.(true);
                    resetControlsTimer?.();
                  }}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FF7A00]/20 hover:bg-[#FF7A00]/35 border border-[#FF7A00]/45 text-[#FFB36B] text-[10px] sm:text-[11px] font-bold tracking-wide transition cursor-pointer"
                  title="สลับเวอร์ชันวิดีโอ"
                >
                  <Layers className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[110px]">
                    {activeVersion.badge || activeVersion.label}
                  </span>
                </button>
              )}
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
          className="p-2 -ml-1 rounded-full bg-black/40 active:bg-black/70 text-white backdrop-blur-sm transition-[background-color] duration-100 active:scale-90 cursor-pointer border border-white/15 shadow-sm"
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
            className="p-2 rounded-xl bg-black/40 hover:bg-white/15 border border-white/15 backdrop-blur-sm text-zinc-300 hover:text-white active:scale-90 transition-[background-color] duration-100 cursor-pointer shadow-xs"
          >
            <Cast className="w-4.5 h-4.5" />
          </button>

          {/* CC */}
          <button
            type="button"
            onClick={() => {
              if (!hasSubtitles) {
                showToast?.('วิดีโอนี้ยังไม่มีคำบรรยาย (CC)');
                resetControlsTimer?.();
                return;
              }
              const next = !isCcActive;
              setIsCcActive(next);
              showToast?.(next ? 'เปิดคำบรรยาย: ไทย (สร้างอัตโนมัติ)' : 'ปิดคำบรรยาย');
              resetControlsTimer?.();
            }}
            className={`relative p-2 rounded-xl border backdrop-blur-sm active:scale-90 transition-[background-color] duration-100 cursor-pointer shadow-xs ${
              isCcActive && hasSubtitles
                ? 'text-white bg-white/25 border-white/40'
                : 'bg-black/40 hover:bg-white/15 border-white/15 text-zinc-200 hover:text-white'
            }`}
          >
            <CcSubtitleIcon active={Boolean(isCcActive && hasSubtitles)} className="w-4.5 h-4.5" />
            {isCcActive && hasSubtitles && (
              <span className="absolute bottom-1 left-2.5 right-2.5 h-0.5 bg-[#FF7A00] rounded-full shadow-xs" />
            )}
          </button>

          {/* Settings */}
          <button
            type="button"
            data-settings-btn="true"
            aria-label="การตั้งค่า"
            onClick={() => {
              setSettingsPlacement?.('top');
              setShowSettingsMenu(!showSettingsMenu);
              setActiveMenuTab?.('main');
              resetControlsTimer?.();
            }}
            className="p-2 rounded-xl bg-black/40 hover:bg-white/15 border border-white/15 backdrop-blur-sm active:scale-90 transition-[background-color] duration-100 cursor-pointer text-zinc-300 hover:text-white relative shadow-xs"
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
