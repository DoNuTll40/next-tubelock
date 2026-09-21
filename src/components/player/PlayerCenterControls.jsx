'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, ChevronLeft, ChevronRight, RotateCcw, RotateCw
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
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-10 left-1/2 -translate-x-1/2 z-40 bg-black/50 backdrop-blur-md text-white px-4 py-1.5 rounded-full border border-white/15 text-xs font-semibold shadow-2xl flex items-center gap-2 pointer-events-none"
          >
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* YouTube-Style Double Tap Arc & Floating Wave Chevrons (Smooth Linear/EaseOut Slide, No Overshoot) */}
      <AnimatePresence>
        {doubleTapSide && (
          <motion.div
            key={`dt-${doubleTapSide}`}
            initial={{ opacity: 0, x: doubleTapSide === 'left' ? -35 : 35 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{
              opacity: 0,
              x: doubleTapSide === 'left' ? -60 : 60,
              transition: { duration: 0.18, ease: 'easeIn' }
            }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute top-0 bottom-0 ${doubleTapSide === 'left'
              ? 'left-0 pr-10 pl-5 sm:pr-24 sm:pl-10 rounded-r-full justify-start'
              : 'right-0 pl-10 pr-5 sm:pl-24 sm:pr-10 rounded-l-full justify-end'
              } flex items-center pointer-events-none z-30 select-none bg-gradient-to-${doubleTapSide === 'left' ? 'r' : 'l'
              } from-black/60 via-black/20 to-transparent`}
          >
            <motion.div className="flex flex-col items-center gap-1.5 drop-shadow-[0_4px_14px_rgba(0,0,0,0.9)]">
              {/* Sequenced Chevron Wave */}
              <div className="flex items-center gap-0.5">
                {doubleTapSide === 'left' ? (
                  <>
                    <motion.div
                      animate={{ opacity: [0.25, 1, 0.25], x: [0, -3, 0] }}
                      transition={{ repeat: Infinity, duration: 0.55, delay: 0.28 }}
                    >
                      <ChevronLeft className="w-6 h-6 text-[#FF7A00]" />
                    </motion.div>
                    <motion.div
                      animate={{ opacity: [0.25, 1, 0.25], x: [0, -3, 0] }}
                      transition={{ repeat: Infinity, duration: 0.55, delay: 0.14 }}
                    >
                      <ChevronLeft className="w-6 h-6 text-white" />
                    </motion.div>
                    <motion.div
                      animate={{ opacity: [0.25, 1, 0.25], x: [0, -3, 0] }}
                      transition={{ repeat: Infinity, duration: 0.55, delay: 0 }}
                    >
                      <ChevronLeft className="w-6 h-6 text-white/50" />
                    </motion.div>
                  </>
                ) : (
                  <>
                    <motion.div
                      animate={{ opacity: [0.25, 1, 0.25], x: [0, 3, 0] }}
                      transition={{ repeat: Infinity, duration: 0.55, delay: 0 }}
                    >
                      <ChevronRight className="w-6 h-6 text-white/50" />
                    </motion.div>
                    <motion.div
                      animate={{ opacity: [0.25, 1, 0.25], x: [0, 3, 0] }}
                      transition={{ repeat: Infinity, duration: 0.55, delay: 0.14 }}
                    >
                      <ChevronRight className="w-6 h-6 text-white" />
                    </motion.div>
                    <motion.div
                      animate={{ opacity: [0.25, 1, 0.25], x: [0, 3, 0] }}
                      transition={{ repeat: Infinity, duration: 0.55, delay: 0.28 }}
                    >
                      <ChevronRight className="w-6 h-6 text-[#FF7A00]" />
                    </motion.div>
                  </>
                )}
              </div>
              <span className="text-sm sm:text-base font-bold text-white tracking-wide">
                {accumulatedSeconds > 0 ? `+${accumulatedSeconds}` : `${accumulatedSeconds}`} วินาที
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Center Controls: Mobile Trio / Pure Minimalist Spinner / Paused Play Button */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
        {hlsError ? (
          <div className="pointer-events-auto flex flex-col items-center gap-2 bg-[#121110]/95 rounded-2xl px-5 py-3.5 text-center max-w-[85%] border border-rose-500/30 shadow-2xl">
            <span className="text-rose-400 text-xs font-mono break-words">{hlsError}</span>
          </div>
        ) : isBuffering ? (
          /* ✨ Crisp Floating Spinner Ring with Soft Drop Shadow (Sharp lines, No blurry glow) */
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none flex items-center justify-center"
          >
            <motion.svg
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
              className="w-13 h-13 sm:w-15 sm:h-15 drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
              viewBox="0 0 48 48"
            >
              {/* Clean Translucent White Track */}
              <circle
                cx="24"
                cy="24"
                r="20"
                fill="none"
                stroke="rgba(255, 255, 255, 0.35)"
                strokeWidth="2.5"
              />

              {/* Crisp TubeLock Orange Arc (Sharp & Solid) */}
              <circle
                cx="24"
                cy="24"
                r="20"
                fill="none"
                stroke="#FF7A00"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="40 126"
              />
            </motion.svg>
          </motion.div>
        ) : (
          (showControls || !isPlaying) && !doubleTapSide && (
            <>
              {/* Mobile View: YouTube Trio (-10s, Play/Pause, +10s) with Framer Motion Micro-Interactions */}
              {isMobileView ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-6 sm:gap-14 pointer-events-auto select-none"
                >
                  {/* Skip -10s */}
                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    whileHover={{ scale: 1.06 }}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const cur = video.current?.currentTime || 0;
                      commitSeek(Math.max(0, cur - seekStep));
                      showToast?.(`-${seekStep} วินาที`);
                      resetControlsTimer?.();
                    }}
                    className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-black/50 hover:bg-black/70 active:bg-black/80 border border-white/15 text-white flex flex-col items-center justify-center transition shadow-2xl backdrop-blur-md cursor-pointer group"
                  >
                    <RotateCcw className="w-5.5 h-5.5 group-hover:-rotate-12 transition-transform duration-150" />
                    <span className="text-[9px] font-mono font-black leading-none mt-0.5 text-zinc-300">10s</span>
                  </motion.button>

                  {/* Big Center Play/Pause */}
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    whileHover={{ scale: 1.06 }}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                    className="w-16 h-16 sm:w-18 sm:h-18 rounded-full bg-black/50 hover:bg-[#FF7A00] border border-white/20 text-white flex items-center justify-center transition shadow-[0_8px_32px_rgba(0,0,0,0.7)] backdrop-blur-md cursor-pointer"
                  >
                    {isPlaying ? (
                      <Pause className="w-7 h-7 sm:w-8 sm:h-8 fill-white" />
                    ) : (
                      <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-white ml-0.5" />
                    )}
                  </motion.button>

                  {/* Skip +10s */}
                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    whileHover={{ scale: 1.06 }}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const cur = video.current?.currentTime || 0;
                      commitSeek(Math.min(duration, cur + seekStep));
                      showToast?.(`+${seekStep} วินาที`);
                      resetControlsTimer?.();
                    }}
                    className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-black/50 hover:bg-black/70 active:bg-black/80 border border-white/15 text-white flex flex-col items-center justify-center transition shadow-2xl backdrop-blur-md cursor-pointer group"
                  >
                    <RotateCw className="w-5.5 h-5.5 group-hover:rotate-12 transition-transform duration-150" />
                    <span className="text-[9px] font-mono font-black leading-none mt-0.5 text-zinc-300">10s</span>
                  </motion.button>
                </motion.div>
              ) : (
                /* Desktop View: Clean center while playing; Play button when paused */
                !isPlaying && (
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    whileHover={{ scale: 1.08 }}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                    className="pointer-events-auto w-16 h-16 rounded-full bg-black/50 hover:bg-[#FF7A00] border border-white/20 text-white flex items-center justify-center transition-all duration-200 shadow-2xl backdrop-blur-md cursor-pointer group"
                  >
                    <Play className="w-7 h-7 fill-white ml-0.5 group-hover:scale-105 transition-transform" />
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
