'use client';

import { Play, Pause, RotateCcw, RotateCw, SkipBack, SkipForward } from 'lucide-react';
import DoubleTapArrows from './DoubleTapArrows';

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
  isEnded = false,
  onPlayNext = null,
}) {
  return (
    <>
      {/* Toast — Pure CSS fade-in (zero framer-motion bundle weight on initial /watch load) */}
      {toastMessage && (
        <div
          key={toastMessage}
          className="absolute top-10 left-1/2 -translate-x-1/2 z-40 bg-black/25 backdrop-blur-md text-white px-4 py-1.5 rounded-full border border-white/15 text-xs font-semibold shadow-2xl flex items-center gap-2 pointer-events-none [animation:fadein_0.12s_ease-out]"
        >
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Double Tap Arc */}
      {doubleTapSide && (
        <div
          key={`dt-${doubleTapSide}`}
          className={`absolute top-0 bottom-0 ${doubleTapSide === 'left'
            ? 'left-0 pr-10 pl-5 sm:pr-24 sm:pl-10 rounded-r-full justify-start bg-gradient-to-r'
            : 'right-0 pl-10 pr-5 sm:pl-24 sm:pr-10 rounded-l-full justify-end bg-gradient-to-l'
            } flex items-center pointer-events-none z-30 select-none from-black/60 via-black/20 to-transparent [animation:fadein_0.15s_ease-out]`}
        >
          <div className="flex flex-col items-center gap-1.5 drop-shadow-[0_4px_14px_rgba(0,0,0,0.9)]">
            <DoubleTapArrows side={doubleTapSide} />
            <span className="text-sm sm:text-base font-bold text-white tracking-wide">
              {accumulatedSeconds > 0 ? `+${accumulatedSeconds}` : `${accumulatedSeconds}`} วินาที
            </span>
          </div>
        </div>
      )}

      {/* Center Controls */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
        {hlsError ? (
          <div className="pointer-events-auto flex flex-col items-center gap-2 bg-[#121110]/95 rounded-2xl px-5 py-3.5 text-center max-w-[85%] border border-rose-500/30 shadow-2xl">
            <span className="text-rose-400 text-xs font-mono break-words">{hlsError}</span>
          </div>
        ) : isBuffering ? (
          /* Spinner — SVG CSS spin (GPU compositor), ไม่ใช้ Framer animate rotate */
          <div className="pointer-events-none flex items-center justify-center [animation:fadein_0.15s_ease-out]">
            <svg
              className="w-13 h-13 sm:w-15 sm:h-15 drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] animate-spin"
              style={{ animationDuration: '0.9s' }}
              viewBox="0 0 48 48"
            >
              <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" />
              <circle cx="24" cy="24" r="20" fill="none" stroke="#FF7A00" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="40 126" />
            </svg>
          </div>
        ) : (
          showControls && !doubleTapSide && (
            isMobileView && isEnded ? (
              <div className="flex items-center gap-7 sm:gap-14 [&_button]:pointer-events-auto select-none [animation:fadein_0.15s_ease-out]">
                <button
                  type="button"
                  disabled
                  aria-label="วิดีโอก่อนหน้า"
                  className="w-12 h-12 sm:w-14 sm:h-14 rounded-full text-white/35 flex items-center justify-center cursor-default"
                >
                  <SkipBack className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
                </button>

                <button
                  type="button"
                  aria-label="เล่นซ้ำ"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlay();
                  }}
                  className="w-16 h-16 sm:w-18 sm:h-18 rounded-full bg-black/45 active:bg-white/20 active:scale-90 text-white flex items-center justify-center transition-[transform,background-color] duration-100 cursor-pointer"
                >
                  <RotateCcw className="w-8 h-8 sm:w-9 sm:h-9 text-white" />
                </button>

                <button
                  type="button"
                  disabled={!onPlayNext}
                  aria-label="วิดีโอถัดไป"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayNext?.();
                  }}
                  className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition active:scale-90 ${
                    onPlayNext ? 'text-white active:bg-white/15 cursor-pointer' : 'text-white/35 cursor-default'
                  }`}
                >
                  <SkipForward className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
                </button>
              </div>
            ) : !isEnded ? (
              <>
                {isMobileView ? (
                  /* Mobile Trio — CSS fade-in, active:scale CSS (ไม่ใช้ whileTap Framer บน mobile) */
                  <div className="flex items-center gap-6 sm:gap-14 [&_button]:pointer-events-auto select-none [animation:fadein_0.15s_ease-out]">
                    {/* Skip -10s */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        commitSeek(Math.max(0, (video.current?.currentTime || 0) - seekStep));
                        showToast?.(`-${seekStep} วินาที`);
                        resetControlsTimer?.();
                      }}
                      className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-black/50 active:bg-black/70 active:scale-90 border border-white/15 text-white flex flex-col items-center justify-center transition-[transform,background-color] duration-100 shadow-2xl cursor-pointer"
                    >
                      <RotateCcw className="w-5.5 h-5.5" />
                      <span className="text-[9px] font-mono font-black leading-none mt-0.5 text-zinc-300">10s</span>
                    </button>

                    {/* Center Play/Pause */}
                    <button
                      type="button"
                      aria-label={isPlaying ? 'หยุดชั่วคราว' : 'เล่น'}
                      onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                      className="w-16 h-16 sm:w-18 sm:h-18 rounded-full bg-black/50 active:bg-[#FF7A00] active:scale-90 border border-white/20 text-white flex items-center justify-center transition-[transform,background-color] duration-100 shadow-[0_8px_32px_rgba(0,0,0,0.7)] cursor-pointer"
                    >
                      {isPlaying
                        ? <Pause className="w-7 h-7 sm:w-8 sm:h-8 fill-white" />
                        : <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-white ml-0.5" />}
                    </button>

                    {/* Skip +10s */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        commitSeek(Math.min(duration, (video.current?.currentTime || 0) + seekStep));
                        showToast?.(`+${seekStep} วินาที`);
                        resetControlsTimer?.();
                      }}
                      className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-black/50 active:bg-black/70 active:scale-90 border border-white/15 text-white flex flex-col items-center justify-center transition-[transform,background-color] duration-100 shadow-2xl cursor-pointer"
                    >
                      <RotateCw className="w-5.5 h-5.5" />
                      <span className="text-[9px] font-mono font-black leading-none mt-0.5 text-zinc-300">10s</span>
                    </button>
                  </div>
                ) : (
                  !isPlaying && !isEnded && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                      className="pointer-events-auto w-16 h-16 rounded-full bg-black/25 hover:bg-[#FF7A00] hover:scale-105 active:scale-95 border border-white/20 text-white flex items-center justify-center transition-[transform,background-color] duration-200 shadow-2xl backdrop-blur-md cursor-pointer"
                    >
                      <Play className="w-7 h-7 fill-white ml-0.5" />
                    </button>
                  )
                )}
              </>
            ) : null
          )
        )}
      </div>
    </>
  );
}
