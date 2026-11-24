'use client';

import {
  ChevronDown, ChevronRight, ArrowLeft, Play, Pause, Cast, Settings, Layers, LockKeyhole
} from 'lucide-react';
import CcSubtitleIcon from '../icons/CcSubtitleIcon';
import { getGearBadge, isMatureVideo, RESTRICTED_POSTER } from '@/lib/videoUtils';
import { formatBadgeDuration } from './PlayerEndScreen';

export default function PlayerTopBar({
  showControls,
  isFullscreen,
  isMobileView,
  isEnded = false,
  upNextVideo = null,
  onSelectVideo = null,
  title,
  channelName,
  onBack,
  onToggleMiniplayer = null,
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
  const upNextMature = upNextVideo ? isMatureVideo(upNextVideo) : false;
  const upNextThumb = upNextVideo
    ? (upNextMature
      ? RESTRICTED_POSTER
      : (upNextVideo.thumbnail_url || (upNextVideo.id ? `/streams/stream_vid_${upNextVideo.id}/poster.jpg` : null)))
    : null;
  const upNextDuration = upNextVideo ? formatBadgeDuration(upNextVideo.duration) : '00:00';

  return (
    <div
      className={`absolute top-0 left-0 right-0 px-2.5 sm:px-6 [--bar-top:0.625rem] sm:[--bar-top:1rem] pt-[calc(var(--bar-top)+var(--player-safe-top,0px))] pb-6 sm:pb-8 bg-gradient-to-b from-black/40 via-black/10 to-transparent flex items-center justify-between z-30 transition-opacity duration-150 ${isMobileView ? 'pointer-events-none [&_button]:pointer-events-auto' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top-Left: "รายการถัดไป" card or Title in Fullscreen, or Back Button in Mobile Portrait */}
      {isFullscreen ? (
        isMobileView && isEnded && upNextVideo ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectVideo?.(upNextVideo, 0);
            }}
            className="flex items-center gap-2.5 p-1.5 pr-3.5 rounded-xl bg-[#141414]/80 hover:bg-[#1f1f1f]/90 border border-white/15 backdrop-blur-md max-w-[68%] sm:max-w-[360px] text-left transition active:scale-[0.98] cursor-pointer shadow-lg"
          >
            <div className="relative w-20 sm:w-24 aspect-video rounded-lg overflow-hidden bg-zinc-900 shrink-0 border border-white/10">
              {upNextThumb && (
                <img
                  src={upNextThumb}
                  alt={upNextVideo.title || 'รายการถัดไป'}
                  className="w-full h-full object-cover"
                />
              )}
              {upNextMature && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <LockKeyhole className="w-3.5 h-3.5 text-[#FF9A40]" />
                </div>
              )}
              {upNextVideo.duration > 0 && (
                <span className="absolute right-1 bottom-1 px-1 py-0.2 bg-black/85 text-white font-mono font-semibold text-[9px] sm:text-[10px] rounded leading-tight">
                  {upNextDuration}
                </span>
              )}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[10px] sm:text-[11px] text-[#FF7A00] font-semibold leading-tight">
                รายการถัดไป
              </span>
              <span className="text-xs sm:text-sm text-white font-bold truncate leading-snug mt-0.5">
                {upNextVideo.title}
              </span>
              <span className="text-[10px] sm:text-xs text-zinc-400 truncate leading-tight mt-0.5">
                {upNextVideo.author_name || 'TubeLock'}
              </span>
            </div>
          </button>
        ) : (
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
        )
      ) : isMobileView && (onToggleMiniplayer || onBack) ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (onToggleMiniplayer) onToggleMiniplayer();
            else onBack?.();
          }}
          className="p-2 -ml-1 rounded-full text-white active:bg-white/15 active:scale-90 transition cursor-pointer drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]"
          title={onToggleMiniplayer ? 'ย่อเป็น Miniplayer' : 'ย้อนกลับ'}
          aria-label={onToggleMiniplayer ? 'ย่อเป็น Miniplayer' : 'ย้อนกลับ'}
        >
          {onToggleMiniplayer ? <ChevronDown className="w-6 h-6" /> : <ArrowLeft className="w-5 h-5" />}
        </button>
      ) : (
        <div className="w-8" />
      )}

      {/* Top-Right: Shown ONLY on Mobile — Clean YouTube-style frameless icons (ZERO backdrop-blur = 0 frame drops!) */}
      {isMobileView ? (
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 text-white">
          {/* Autoplay switch */}
          <button
            type="button"
            onClick={() => {
              showToast?.('เล่นวิดีโอถัดไปอัตโนมัติ (Coming soon)');
              resetControlsTimer?.();
            }}
            className="relative inline-flex h-5.5 w-10 items-center rounded-full transition-colors cursor-pointer bg-white/25 mr-1"
            aria-label="เล่นอัตโนมัติ"
          >
            <span className="inline-flex items-center justify-center h-4 w-4 transform rounded-full transition-transform translate-x-1 bg-white shadow-xs">
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
            className="p-2 rounded-full text-white/95 active:bg-white/15 active:scale-90 transition cursor-pointer drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]"
            aria-label="Cast"
          >
            <Cast className="w-5 h-5" />
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
            className="relative p-2 rounded-full text-white/95 active:bg-white/15 active:scale-90 transition cursor-pointer drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]"
            aria-label="คำบรรยาย (CC)"
          >
            <CcSubtitleIcon active={Boolean(isCcActive && hasSubtitles)} className="w-5 h-5" />
            {isCcActive && hasSubtitles && (
              <span className="absolute bottom-1 left-2.5 right-2.5 h-0.5 bg-[#FF7A00] rounded-full" />
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
            className="relative p-2 rounded-full text-white/95 active:bg-white/15 active:scale-90 transition cursor-pointer drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]"
          >
            <Settings className="w-5 h-5" />
            {gearBadge && (
              <span className="absolute top-0.5 right-0.5 bg-red-600 text-white font-extrabold text-[8px] leading-tight px-1 py-0.2 rounded pointer-events-none tracking-tight">
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
