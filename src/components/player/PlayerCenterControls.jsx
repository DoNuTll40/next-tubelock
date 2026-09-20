'use client';

import React from 'react';
import {
  Play, Pause, ChevronLeft, ChevronRight, RotateCcw, RotateCw, Loader2
} from 'lucide-react';

export default function PlayerCenterControls({
  toastMessage,
  centerRipple,
  doubleTapSide,
  accumulatedSeconds,
  showControls,
  isPlaying,
  isBuffering,
  hlsError,
  isMobileView,
  seekStep = 10,
  togglePlay,
  commitSeek,
  video,
  duration,
  showToast,
  resetControlsTimer,
}) {
  return (
    <>
      {/* On-Screen Toast Notification */}
      {toastMessage && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-40 bg-[#151413]/40 backdrop-blur-md text-white px-4 py-2 rounded-full border border-white/15 text-xs font-semibold shadow-xl flex items-center gap-2 pointer-events-none animate-fadeIn">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Momentary Play/Pause Ripple Flash (Auto vanishes in 400ms) */}
      {centerRipple && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-scaleFade">
          <div className="w-16 h-16 rounded-full bg-black/65 border border-white/20 flex items-center justify-center text-white shadow-2xl">
            {centerRipple === 'play' ? (
              <Play className="w-7 h-7 fill-white ml-0.5" />
            ) : (
              <Pause className="w-7 h-7 fill-white" />
            )}
          </div>
        </div>
      )}

      {/* YouTube-Style Double Click/Tap Animated Ripple Feedback */}
      {doubleTapSide && (
        <div
          className={`absolute ${
            doubleTapSide === 'left' ? 'left-8 sm:left-16' : 'right-8 sm:right-16'
          } top-1/2 -translate-y-1/2 pointer-events-none z-30 select-none animate-scaleFade`}
        >
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-black/75 border border-white/20 flex flex-col items-center justify-center text-white shadow-2xl backdrop-blur-xs">
            <div className="flex items-center">
              {doubleTapSide === 'left' ? (
                <>
                  <ChevronLeft className="w-5 h-5 -mr-2 text-white/70 animate-pulse" />
                  <ChevronLeft className="w-5 h-5 text-white" />
                </>
              ) : (
                <>
                  <ChevronRight className="w-5 h-5 text-white" />
                  <ChevronRight className="w-5 h-5 -ml-2 text-white/70 animate-pulse" />
                </>
              )}
            </div>
            <span className="text-xs font-bold font-mono mt-1">
              {accumulatedSeconds > 0 ? `+${accumulatedSeconds}s` : `${accumulatedSeconds}s`}
            </span>
          </div>
        </div>
      )}

      {/* Center Controls: Mobile shows Trio (-10s, Play/Pause, +10s), Desktop remains clean while playing */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
        {hlsError ? (
          <div className="pointer-events-auto flex flex-col items-center gap-2 bg-[#121110]/95 rounded-2xl px-5 py-3.5 text-center max-w-[85%] border border-rose-500/30 shadow-2xl">
            <span className="text-rose-400 text-xs font-mono break-words">{hlsError}</span>
          </div>
        ) : isBuffering ? (
          <div className="p-3 bg-black/60 rounded-full border border-white/15 shadow-xl backdrop-blur-md">
            <Loader2 className="w-7 h-7 text-[#FF7A00] animate-spin" />
          </div>
        ) : (
          (showControls || !isPlaying) && !doubleTapSide && (
            <>
              {/* Mobile View: YouTube Trio (-10s, Play/Pause, +10s) */}
              {isMobileView ? (
                <div className="flex items-center gap-4 sm:gap-14 pointer-events-auto select-none">
                  {/* Skip -10s */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const cur = video.current?.currentTime || 0;
                      commitSeek(Math.max(0, cur - seekStep));
                      showToast?.(`-${seekStep} วินาที`);
                      resetControlsTimer?.();
                    }}
                    className="w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-black/55 hover:bg-black/80 active:scale-90 border border-white/15 text-white flex flex-col items-center justify-center transition shadow-xl backdrop-blur-xs cursor-pointer"
                    title={`ย้อนหลัง ${seekStep} วินาที`}
                  >
                    <RotateCcw className="w-4.5 h-4.5 sm:w-5.5 sm:h-5.5" />
                    <span className="text-[8px] sm:text-[9px] font-mono font-bold leading-none -mt-0.5">10</span>
                  </button>

                  {/* Big Center Play/Pause */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/65 hover:bg-[#FF7A00] active:scale-95 border border-white/25 text-white flex items-center justify-center transition-all duration-150 shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur-xs cursor-pointer"
                    title={isPlaying ? 'หยุดชั่วคราว' : 'เล่น'}
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6 sm:w-7 sm:h-7 fill-white" />
                    ) : (
                      <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-white ml-0.5" />
                    )}
                  </button>

                  {/* Skip +10s */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const cur = video.current?.currentTime || 0;
                      commitSeek(Math.min(duration, cur + seekStep));
                      showToast?.(`+${seekStep} วินาที`);
                      resetControlsTimer?.();
                    }}
                    className="w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-black/55 hover:bg-black/80 active:scale-90 border border-white/15 text-white flex flex-col items-center justify-center transition shadow-xl backdrop-blur-xs cursor-pointer"
                    title={`ไปข้างหน้า ${seekStep} วินาที`}
                  >
                    <RotateCw className="w-4.5 h-4.5 sm:w-5.5 sm:h-5.5" />
                    <span className="text-[8px] sm:text-[9px] font-mono font-bold leading-none -mt-0.5">10</span>
                  </button>
                </div>
              ) : (
                /* Desktop View: Clean center while playing; Play button when paused */
                !isPlaying && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                    className="pointer-events-auto w-16 h-16 rounded-full bg-black/70 hover:bg-[#FF7A00] hover:scale-110 active:scale-95 border border-white/25 text-white flex items-center justify-center transition-all duration-200 shadow-2xl backdrop-blur-xs cursor-pointer group"
                    title="เล่น (k)"
                  >
                    <Play className="w-7 h-7 fill-white ml-0.5 group-hover:scale-105 transition-transform" />
                  </button>
                )
              )}
            </>
          )
        )}
      </div>
    </>
  );
}
