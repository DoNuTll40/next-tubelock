'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Volume1,
  Settings,
  Maximize,
  Minimize,
  Check,
} from 'lucide-react';
import CcSubtitleIcon from '../icons/CcSubtitleIcon';
import { formatTime } from './playerUtils';

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * Compact TubeLock Mini Player bottom bar & floating Speed dropdown
 * modeled directly after YouTube Studio's minimalist mini player controls.
 */
export default function MiniPlayerBottomBar({
  isFullscreen = false,
  showControls = true,
  isPlaying = false,
  isEnded = false,
  isScrubbing = false,
  activeTimeDisplay = '0:00 / 0:00',
  timeDisplayRef,
  togglePlay,
  toggleMute,
  isMuted = false,
  volume = 0.8,
  handleVolumeChange,
  playbackRate = 1,
  onSelectPlaybackRate,
  isCcActive = true,
  hasSubtitles = false,
  subtitleLabel = '',
  onCycleOrToggleCc,
  toggleFullscreen,
  // Scrubber props
  seekTrackRef,
  bufferBarRef,
  progressBarRef,
  scrubberKnobRef,
  initialBufferPct = 0,
  activeScrubPercent = 0,
  hoverPercent = 0,
  hoverTime = 0,
  previewTime = 0,
  previewPercent = 0,
  isHoveringSeek = false,
  setIsHoveringSeek,
  handlePointerDown,
  handleSeekMouseMove,
  handlePointerUp,
  resetControlsTimer,
  showSpeedMenu,
  setShowSpeedMenu,
}) {
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const gearBtnRef = useRef(null);
  const menuPanelRef = useRef(null);

  const computeMenuPosition = () => {
    const btn = gearBtnRef.current;
    if (!btn || typeof window === 'undefined') return null;
    const rect = btn.getBoundingClientRect();
    const menuWidth = 152;
    const estimatedHeight = 256;
    const left = Math.max(
      8,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)
    );
    const openUpward = isFullscreen || rect.bottom + estimatedHeight > window.innerHeight - 12;
    return {
      left,
      top: openUpward ? Math.max(8, rect.top - estimatedHeight - 8) : rect.bottom + 8,
    };
  };

  const handleToggleSpeedMenu = (e) => {
    e.stopPropagation();
    if (showSpeedMenu) {
      setShowSpeedMenu(false);
      return;
    }
    setMenuPos(computeMenuPosition());
    setShowSpeedMenu(true);
    resetControlsTimer?.();
  };

  useEffect(() => {
    if (!showSpeedMenu) return;

    const handleOutside = (e) => {
      if (
        menuPanelRef.current?.contains(e.target) ||
        gearBtnRef.current?.contains(e.target)
      ) {
        return;
      }
      setShowSpeedMenu(false);
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') setShowSpeedMenu(false);
    };
    const handleReposition = () => {
      setMenuPos(computeMenuPosition());
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSpeedMenu, isFullscreen]);

  const portalTarget =
    typeof document !== 'undefined'
      ? document.fullscreenElement || document.body
      : null;

  const badgeTime = isScrubbing ? previewTime : hoverTime;
  const badgeLeft = Math.max(6, Math.min(94, isScrubbing ? previewPercent : hoverPercent));
  const showSeekBadge = (isScrubbing || isHoveringSeek) && !showSpeedMenu;

  return (
    <>
      <div
        className={`absolute bottom-0 left-0 right-0 z-30 transition-all duration-150 bg-gradient-to-t from-black/90 via-black/50 to-transparent ${
          isFullscreen ? 'px-5 pb-3 pt-10' : 'px-2 pb-1.5 pt-5'
        } ${
          showControls || !isPlaying || isScrubbing || showSpeedMenu
            ? 'opacity-100 pointer-events-auto translate-y-0'
            : 'opacity-0 pointer-events-none translate-y-1'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Minimal Timeline Scrubber */}
        <div
          ref={seekTrackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handleSeekMouseMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onMouseEnter={(e) => {
            if (e?.pointerType !== 'touch' && !showSpeedMenu) {
              setIsHoveringSeek?.(true);
            }
          }}
          onMouseLeave={() => setIsHoveringSeek?.(false)}
          className={`relative flex items-center cursor-pointer touch-none group/seek ${
            isFullscreen ? 'h-5 py-1' : 'h-4 py-0.5'
          }`}
        >
          {/* Floating Timestamp Pill (no oversized sprite cards) */}
          {showSeekBadge && (
            <div
              className={`absolute -translate-x-1/2 pointer-events-none z-40 px-1.5 py-0.5 rounded bg-black/85 border border-white/15 text-white font-mono font-semibold whitespace-nowrap shadow-md ${
                isFullscreen ? 'bottom-6 text-xs px-2' : 'bottom-5 text-[10px]'
              }`}
              style={{ left: `${badgeLeft}%` }}
            >
              {formatTime(badgeTime)}
            </div>
          )}

          {/* Track */}
          <div
            className={`w-full ${
              isFullscreen ? 'h-1 group-hover/seek:h-1.5' : 'h-[3px] group-hover/seek:h-1'
            } bg-white/25 rounded-full overflow-hidden relative pointer-events-none transition-all duration-100`}
          >
            <div
              ref={bufferBarRef}
              className="absolute left-0 top-0 bottom-0 bg-white/40"
              style={{ width: `${initialBufferPct}%` }}
            />
            {isHoveringSeek && !isScrubbing && (
              <div
                className="absolute left-0 top-0 bottom-0 bg-white/30"
                style={{ width: `${hoverPercent}%` }}
              />
            )}
            <div
              ref={progressBarRef}
              className="absolute left-0 top-0 bottom-0 bg-[#FF7A00]"
              style={{ width: `${activeScrubPercent}%` }}
            />
          </div>

          {/* Scrubber Knob */}
          <div
            ref={scrubberKnobRef}
            className={`absolute -translate-x-1/2 rounded-full bg-[#FF7A00] ring-1 ring-white/90 shadow-md pointer-events-none transition-transform duration-100 ${
              isFullscreen ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'
            } ${
              isScrubbing
                ? 'scale-125'
                : 'scale-100 sm:scale-0 sm:group-hover/seek:scale-100'
            }`}
            style={{ left: `${activeScrubPercent}%` }}
          />
        </div>

        {/* Bottom Control Row */}
        <div
          className={`flex items-center justify-between text-white select-none gap-1 ${
            isFullscreen ? 'pt-1 text-sm' : 'pt-0.5 text-xs'
          }`}
        >
          {/* Left: Play/Pause, Mute + Compact Volume Slider, Time */}
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={togglePlay}
              title={isEnded ? 'เล่นใหม่' : isPlaying ? 'หยุดชั่วคราว' : 'เล่น'}
              className={`${
                isFullscreen ? 'w-9 h-9 rounded-xl' : 'w-7 h-7 rounded-lg'
              } flex items-center justify-center hover:bg-white/15 active:scale-90 transition cursor-pointer shrink-0`}
            >
              {isEnded ? (
                <RotateCcw className={isFullscreen ? 'w-5 h-5' : 'w-4 h-4'} />
              ) : isPlaying ? (
                <Pause className={`${isFullscreen ? 'w-5 h-5' : 'w-4 h-4'} fill-white`} />
              ) : (
                <Play className={`${isFullscreen ? 'w-5 h-5' : 'w-4 h-4'} fill-white ml-0.5`} />
              )}
            </button>

            <div
              className="flex items-center relative"
              onMouseEnter={() => setShowVolumeSlider(true)}
              onMouseLeave={() => setShowVolumeSlider(false)}
            >
              <button
                type="button"
                onClick={toggleMute}
                title={isMuted || volume === 0 ? 'เปิดเสียง' : 'ปิดเสียง'}
                className={`${
                  isFullscreen ? 'w-9 h-9 rounded-xl' : 'w-7 h-7 rounded-lg'
                } flex items-center justify-center hover:bg-white/15 transition cursor-pointer shrink-0`}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className={`${isFullscreen ? 'w-5 h-5' : 'w-4 h-4'} fill-white`} />
                ) : volume < 0.5 ? (
                  <Volume1 className={`${isFullscreen ? 'w-5 h-5' : 'w-4 h-4'} fill-white`} />
                ) : (
                  <Volume2 className={`${isFullscreen ? 'w-5 h-5' : 'w-4 h-4'} fill-white`} />
                )}
              </button>

              <div
                className={`overflow-hidden transition-all duration-150 flex items-center ${
                  showVolumeSlider
                    ? isFullscreen
                      ? 'w-24 opacity-100 ml-1.5 h-7 bg-white/15 border border-white/15 backdrop-blur-md px-2 rounded-full'
                      : 'w-12 opacity-100 ml-0.5 h-6 bg-white/15 border border-white/15 backdrop-blur-md px-1.5 rounded-full'
                    : 'w-0 opacity-0 pointer-events-none'
                }`}
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-full h-1 bg-white/35 rounded-full cursor-pointer accent-white appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                />
              </div>
            </div>

            <span
              ref={timeDisplayRef}
              className={`font-mono text-white/95 font-medium whitespace-nowrap shrink-0 ${
                isFullscreen
                  ? 'text-xs px-2.5 h-7 rounded-full bg-white/15 border border-white/15 flex items-center'
                  : 'text-[10.5px] px-1'
              }`}
            >
              {activeTimeDisplay}
            </span>
          </div>

          {/* Right: CC (only when subtitles exist), Speed Gear, Fullscreen */}
          <div className="flex items-center gap-0.5 shrink-0">
            {hasSubtitles && (
              <button
                type="button"
                onClick={onCycleOrToggleCc}
                title={
                  isCcActive
                    ? `คำบรรยายเปิดอยู่${subtitleLabel ? `: ${subtitleLabel}` : ''}`
                    : 'เปิดคำบรรยาย'
                }
                className={`relative ${
                  isFullscreen ? 'p-2 rounded-xl' : 'p-1.5 rounded-lg'
                } transition cursor-pointer ${
                  isCcActive
                    ? 'text-white bg-white/15 hover:bg-white/25'
                    : 'text-zinc-300 hover:text-white hover:bg-white/15'
                }`}
              >
                <CcSubtitleIcon
                  active={Boolean(isCcActive)}
                  className={isFullscreen ? 'w-5 h-5' : 'w-4 h-4'}
                />
                {isCcActive && (
                  <span className="absolute bottom-0.5 left-1.5 right-1.5 h-0.5 bg-[#FF7A00] rounded-full" />
                )}
              </button>
            )}

            <button
              ref={gearBtnRef}
              type="button"
              onClick={handleToggleSpeedMenu}
              title={`ความเร็ว (${playbackRate === 1 ? 'ปกติ' : `${playbackRate}x`})`}
              className={`relative ${
                isFullscreen ? 'p-2 rounded-xl' : 'p-1.5 rounded-lg'
              } transition cursor-pointer ${
                showSpeedMenu
                  ? 'text-[#FF7A00] bg-white/15'
                  : 'text-zinc-200 hover:text-white hover:bg-white/15'
              }`}
            >
              <Settings className={isFullscreen ? 'w-5 h-5' : 'w-4 h-4'} />
              {playbackRate !== 1 && (
                <span className="absolute -top-0.5 -right-0.5 bg-[#FF7A00] text-white font-bold text-[7px] leading-none px-1 py-0.5 rounded shadow pointer-events-none">
                  {playbackRate}x
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'ออกจากเต็มจอ' : 'เต็มจอ'}
              className={`${
                isFullscreen ? 'p-2 rounded-xl' : 'p-1.5 rounded-lg'
              } text-white hover:bg-white/15 transition cursor-pointer active:scale-90`}
            >
              {isFullscreen ? (
                <Minimize className="w-5 h-5" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Studio-style Speed Dropdown Portal (drops below the card without 180px box clipping!) */}
      {showSpeedMenu &&
        menuPos &&
        portalTarget &&
        createPortal(
          <div
            ref={menuPanelRef}
            onClick={(e) => e.stopPropagation()}
            style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
            className="fixed z-[9999] w-[152px] rounded-xl bg-[#212121]/95 border border-white/15 text-white shadow-2xl backdrop-blur-md py-1.5 text-xs select-none"
          >
            <div className="px-3.5 py-1.5 text-[11px] font-semibold text-zinc-400 border-b border-white/10">
              ความเร็ว
            </div>
            <div className="py-1">
              {SPEED_OPTIONS.map((rate) => {
                const active = Math.abs(playbackRate - rate) < 0.01;
                return (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => {
                      onSelectPlaybackRate?.(rate);
                      setShowSpeedMenu(false);
                    }}
                    className={`w-full px-3 py-1.5 flex items-center gap-2.5 text-left hover:bg-white/10 transition cursor-pointer ${
                      active ? 'font-bold text-white' : 'text-zinc-200'
                    }`}
                  >
                    <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                      {active && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
                    </span>
                    <span className="font-mono">{rate === 1 ? 'ปกติ' : String(rate)}</span>
                  </button>
                );
              })}
            </div>
          </div>,
          portalTarget
        )}
    </>
  );
}
