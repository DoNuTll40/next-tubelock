'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Play, Pause, ChevronLeft, ChevronRight, RotateCcw, RotateCw } from 'lucide-react';

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
      {/* Toast — Framer OK ทั้ง mobile/desktop เพราะ mount/unmount ครั้งเดียว */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.12 }}
            className="absolute top-10 left-1/2 -translate-x-1/2 z-40 bg-black/25 backdrop-blur-md text-white px-4 py-1.5 rounded-full border border-white/15 text-xs font-semibold shadow-2xl flex items-center gap-2 pointer-events-none"
          >
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Double Tap Arc — slide in/out only, chevron wave ย้ายเป็น CSS keyframe (ไม่ blocking JS thread) */}
      <AnimatePresence>
        {doubleTapSide && (
          <motion.div
            key={`dt-${doubleTapSide}`}
            initial={{ opacity: 0, x: doubleTapSide === 'left' ? -30 : 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{
              opacity: 0,
              x: doubleTapSide === 'left' ? -50 : 50,
              transition: { duration: 0.15, ease: 'easeIn' },
            }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute top-0 bottom-0 ${doubleTapSide === 'left'
              ? 'left-0 pr-10 pl-5 sm:pr-24 sm:pl-10 rounded-r-full justify-start'
              : 'right-0 pl-10 pr-5 sm:pl-24 sm:pr-10 rounded-l-full justify-end'
              } flex items-center pointer-events-none z-30 select-none bg-gradient-to-${doubleTapSide === 'left' ? 'r' : 'l'
              } from-black/60 via-black/20 to-transparent`}
          >
            <div className="flex flex-col items-center gap-1.5 drop-shadow-[0_4px_14px_rgba(0,0,0,0.9)]">
              {/* Chevron wave — CSS keyframe แทน Framer repeat (ไม่กิน JS thread) */}
              <div className="flex items-center gap-0.5">
                {doubleTapSide === 'left' ? (
                  <>
                    <ChevronLeft className="w-6 h-6 text-[#FF7A00] [animation:chevwave_0.55s_ease-in-out_0.28s_infinite]" />
                    <ChevronLeft className="w-6 h-6 text-white    [animation:chevwave_0.55s_ease-in-out_0.14s_infinite]" />
                    <ChevronLeft className="w-6 h-6 text-white/50  [animation:chevwave_0.55s_ease-in-out_0s_infinite]" />
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-6 h-6 text-white/50  [animation:chevwave_0.55s_ease-in-out_0s_infinite]" />
                    <ChevronRight className="w-6 h-6 text-white    [animation:chevwave_0.55s_ease-in-out_0.14s_infinite]" />
                    <ChevronRight className="w-6 h-6 text-[#FF7A00] [animation:chevwave_0.55s_ease-in-out_0.28s_infinite]" />
                  </>
                )}
              </div>
              <span className="text-sm sm:text-base font-bold text-white tracking-wide">
                {accumulatedSeconds > 0 ? `+${accumulatedSeconds}` : `${accumulatedSeconds}`} วินาที
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
          (showControls || !isPlaying) && !doubleTapSide && (
            <>
              {isMobileView ? (
                /* Mobile Trio — CSS fade-in, active:scale CSS (ไม่ใช้ whileTap Framer บน mobile) */
                <div className="flex items-center gap-6 sm:gap-14 pointer-events-auto select-none [animation:fadein_0.15s_ease-out]">
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
                /* Desktop — Framer whileHover/whileTap ปกติ (desktop มี CPU สำรอง) */
                !isPlaying && (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                    className="pointer-events-auto w-16 h-16 rounded-full bg-black/25 hover:bg-[#FF7A00] border border-white/20 text-white flex items-center justify-center transition-colors duration-200 shadow-2xl backdrop-blur-md cursor-pointer"
                  >
                    <Play className="w-7 h-7 fill-white ml-0.5" />
                  </motion.button>
                )
              )}
            </>
          )
        )}
      </div>
    </>
  );
}
