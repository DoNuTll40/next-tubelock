'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight, Check, ArrowLeft, X, Sliders, Gauge, Maximize2
} from 'lucide-react';

export default function PlayerSettingsModal({
  showSettingsMenu,
  setShowSettingsMenu,
  settingsMenuRef,
  settingsPlacement = 'bottom',
  isMobileView = false,
  isFullscreen = false,
  activeMenuTab = 'main',
  setActiveMenuTab,
  levels = [],
  currentLevelIndex = -1,
  activeLevelLabel,
  handleSelectQuality,
  playbackRate = 1,
  setPlaybackRate,
  aspectMode = 'fit',
  setAspectMode,
  video,
  showToast,
  resetControlsTimer,
}) {
  const [mounted, setMounted] = useState(false);
  const [isClientSmall, setIsClientSmall] = useState(false);
  const [portalTarget, setPortalTarget] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
      if (typeof window !== 'undefined') {
        setIsClientSmall(window.innerWidth < 768);
      }
      if (typeof document !== 'undefined') {
        const target = isFullscreen ? (document.fullscreenElement || document.body) : document.body;
        setPortalTarget(target);
      }
    }, 0);

    const handleResize = () => {
      if (typeof window !== 'undefined') {
        setIsClientSmall(window.innerWidth < 768);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [isFullscreen]);

  const isMobile = isMobileView || isClientSmall;

  // ==========================================
  // 📱 MOBILE BOTTOM SHEET (YOUTUBE NATIVE STYLE, NO BLUR, 60FPS SPRING)
  // ==========================================
  if (isMobile) {
    if (!mounted || !portalTarget) return null;

    return createPortal(
      <AnimatePresence>
        {showSettingsMenu && (
          <div
            className={`${isFullscreen ? 'absolute' : 'fixed'} inset-0 z-[9999] flex flex-col justify-end overflow-hidden`}
          >
            {/* Crisp Dark Backdrop (No blur, smooth fade) */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/65"
              onClick={() => setShowSettingsMenu?.(false)}
            />

            {/* Bottom Sheet Card with Thumb Drag-to-Dismiss */}
            <motion.div
              ref={settingsMenuRef}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{
                type: 'spring',
                damping: 30,
                stiffness: 350,
                mass: 0.8,
              }}
              drag="y"
              dragConstraints={{ top: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 60 || info.velocity.y > 350) {
                  setShowSettingsMenu?.(false);
                }
              }}
              className="relative z-10 w-full max-w-lg mx-auto bg-[#212121] text-[#F1F1F1] rounded-t-2xl pb-7 pt-2 shadow-2xl border-t border-white/10 select-none overflow-hidden will-change-transform"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag Pill Handle */}
              <div className="w-10 h-1 bg-white/30 rounded-full mx-auto my-1.5 cursor-grab active:cursor-grabbing" />

              {/* Sheet Header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                  {activeMenuTab !== 'main' && (
                    <button
                      type="button"
                      onClick={() => setActiveMenuTab?.('main')}
                      className="p-1 -ml-1 rounded-full hover:bg-white/10 active:bg-white/20 text-white cursor-pointer"
                      title="ย้อนกลับ"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <span className="text-[15px] font-bold text-white tracking-tight">
                    {activeMenuTab === 'quality'
                      ? 'คุณภาพของวิดีโอ'
                      : activeMenuTab === 'speed'
                      ? 'ความเร็วในการเล่น'
                      : activeMenuTab === 'aspect'
                      ? 'สัดส่วนภาพ'
                      : 'การตั้งค่า'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setShowSettingsMenu?.(false)}
                  className="p-1 rounded-full hover:bg-white/10 active:bg-white/20 text-zinc-400 hover:text-white cursor-pointer"
                  title="ปิด"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Animated Tab Body */}
              <AnimatePresence mode="wait">
                {/* Tab: Main Menu */}
                {activeMenuTab === 'main' && (
                  <motion.div
                    key="main"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col py-1"
                  >
                    {/* Quality */}
                    <button
                      type="button"
                      disabled={levels.length <= 1}
                      onClick={() => setActiveMenuTab?.('quality')}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 transition disabled:opacity-50 cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5">
                        <Sliders className="w-5 h-5 text-zinc-300 shrink-0" />
                        <span className="text-[14px] text-zinc-200 font-medium">คุณภาพ</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <span className="text-[13px] text-[#FF7A00] font-semibold font-mono">
                          {currentLevelIndex === -1 ? `Auto (${activeLevelLabel})` : activeLevelLabel}
                        </span>
                        {levels.length > 1 && <ChevronRight className="w-4 h-4 text-zinc-400" />}
                      </div>
                    </button>

                    {/* Speed */}
                    <button
                      type="button"
                      onClick={() => setActiveMenuTab?.('speed')}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 transition border-t border-white/5 cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5">
                        <Gauge className="w-5 h-5 text-zinc-300 shrink-0" />
                        <span className="text-[14px] text-zinc-200 font-medium">ความเร็วในการเล่น</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <span className="text-[13px] text-[#FF7A00] font-semibold font-mono">
                          {playbackRate === 1 ? 'ปกติ' : `${playbackRate}x`}
                        </span>
                        <ChevronRight className="w-4 h-4 text-zinc-400" />
                      </div>
                    </button>

                    {/* Aspect Ratio */}
                    <button
                      type="button"
                      onClick={() => setActiveMenuTab?.('aspect')}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 transition border-t border-white/5 cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5">
                        <Maximize2 className="w-5 h-5 text-zinc-300 shrink-0" />
                        <span className="text-[14px] text-zinc-200 font-medium">สัดส่วนวิดีโอ</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <span className="text-[13px] text-[#FF7A00] font-semibold">
                          {aspectMode === 'crop' ? 'ตัดขอบดำ' : aspectMode === 'fill' ? 'เต็มจอ' : 'พอดี'}
                        </span>
                        <ChevronRight className="w-4 h-4 text-zinc-400" />
                      </div>
                    </button>
                  </motion.div>
                )}

                {/* Tab: Quality Submenu */}
                {activeMenuTab === 'quality' && (
                  <motion.div
                    key="quality"
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col max-h-[55vh] overflow-y-auto py-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectQuality?.(-1);
                        setShowSettingsMenu?.(false);
                      }}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer"
                    >
                      <div className="flex flex-col">
                        <span className={`text-[14px] ${currentLevelIndex === -1 ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                          อัตโนมัติ (แนะนำ)
                        </span>
                        <span className="text-[11.5px] text-zinc-400 mt-0.5">
                          ปรับความละเอียดตามความเร็วเน็ตเวิร์ก {currentLevelIndex === -1 && `• ปัจจุบัน (${activeLevelLabel})`}
                        </span>
                      </div>
                      {currentLevelIndex === -1 && <Check className="w-5 h-5 text-[#FF7A00] shrink-0" />}
                    </button>

                    {[...levels]
                      .sort((a, b) => (b.height || 0) - (a.height || 0))
                      .map((lvl) => {
                        const isSelected = currentLevelIndex === lvl.index;
                        return (
                          <button
                            key={lvl.index}
                            type="button"
                            onClick={() => {
                              handleSelectQuality?.(lvl.index);
                              setShowSettingsMenu?.(false);
                            }}
                            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition font-mono cursor-pointer border-t border-white/5"
                          >
                            <span className={`text-[14px] ${isSelected ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                              {lvl.label}
                            </span>
                            {isSelected && <Check className="w-5 h-5 text-[#FF7A00] shrink-0" />}
                          </button>
                        );
                      })}
                  </motion.div>
                )}

                {/* Tab: Playback Speed Submenu */}
                {activeMenuTab === 'speed' && (
                  <motion.div
                    key="speed"
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col py-1"
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => {
                          if (video?.current) video.current.playbackRate = rate;
                          setPlaybackRate?.(rate);
                          showToast?.(`ความเร็ว: ${rate}x`);
                          setShowSettingsMenu?.(false);
                          resetControlsTimer?.();
                        }}
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition font-mono cursor-pointer border-t border-white/5 first:border-t-0"
                      >
                        <span className={`text-[14px] ${playbackRate === rate ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                          {rate === 1 ? 'ปกติ (1.0x)' : `${rate}x`}
                        </span>
                        {playbackRate === rate && <Check className="w-5 h-5 text-[#FF7A00] shrink-0" />}
                      </button>
                    ))}
                  </motion.div>
                )}

                {/* Tab: Aspect Ratio Submenu */}
                {activeMenuTab === 'aspect' && (
                  <motion.div
                    key="aspect"
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col py-1"
                  >
                    {[
                      { key: 'fit', label: 'พอดีเฟรม (Fit)', desc: 'แสดงตามสัดส่วนจริงของคลิป ไม่ตัดขอบ' },
                      { key: 'crop', label: 'ตัดขอบดำ (Crop)', desc: 'ซูมขยายตัดแถบดำบน-ล่างออก' },
                      { key: 'fill', label: 'ขยายเต็มจอ (Fill)', desc: 'ยืดขยายให้เต็มพื้นที่กล่องเครื่องเล่น' },
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setAspectMode?.(item.key);
                          showToast?.(`สัดส่วน: ${item.label}`);
                          setShowSettingsMenu?.(false);
                          resetControlsTimer?.();
                        }}
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer border-t border-white/5 first:border-t-0"
                      >
                        <div className="flex flex-col">
                          <span className={`text-[14px] ${aspectMode === item.key ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                            {item.label}
                          </span>
                          <span className="text-[11.5px] text-zinc-400 mt-0.5">{item.desc}</span>
                        </div>
                        {aspectMode === item.key && <Check className="w-5 h-5 text-[#FF7A00] shrink-0" />}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}
      </AnimatePresence>,
      portalTarget
    );
  }

  // ==========================================
  // 💻 DESKTOP FLOATING POPUP (SMOOTH SCALE FADE, NO BLUR)
  // ==========================================
  return (
    <AnimatePresence>
      {showSettingsMenu && (
        <motion.div
          ref={settingsMenuRef}
          initial={{ opacity: 0, scale: 0.96, y: settingsPlacement === 'top' ? -6 : 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: settingsPlacement === 'top' ? -6 : 6 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className={`absolute ${
            settingsPlacement === 'top'
              ? 'top-14 right-3 sm:right-6'
              : 'bottom-18 right-3 sm:right-6'
          } bg-[#18181B] border border-white/15 rounded-2xl py-1.5 w-60 text-xs text-zinc-200 z-40 shadow-2xl overflow-hidden select-none will-change-transform`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Tab: Main Menu */}
          {activeMenuTab === 'main' && (
            <div className="flex flex-col">
              <button
                type="button"
                disabled={levels.length <= 1}
                onClick={() => setActiveMenuTab?.('quality')}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10 transition disabled:opacity-50 cursor-pointer"
              >
                <span className="text-zinc-300">คุณภาพ</span>
                <span className="text-[#FF7A00] font-semibold flex items-center gap-1 font-mono">
                  {currentLevelIndex === -1 ? `Auto (${activeLevelLabel})` : activeLevelLabel}
                  {levels.length > 1 && <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveMenuTab?.('speed')}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer"
              >
                <span className="text-zinc-300">ความเร็ว</span>
                <span className="text-[#FF7A00] flex items-center gap-1 font-mono font-semibold">
                  {playbackRate === 1 ? 'ปกติ' : `${playbackRate}x`}
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveMenuTab?.('aspect')}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer"
              >
                <span className="text-zinc-300">สัดส่วนวิดีโอ</span>
                <span className="text-amber-400 flex items-center gap-1 uppercase font-semibold">
                  {aspectMode === 'crop' ? 'ตัดขอบดำ' : aspectMode === 'fill' ? 'เต็มจอ' : 'พอดี'}
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                </span>
              </button>
            </div>
          )}

          {/* Tab: Quality Submenu */}
          {activeMenuTab === 'quality' && (
            <div className="flex flex-col max-h-56 overflow-y-auto">
              <div className="px-4 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
                <span>เลือกระดับความละเอียด</span>
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('main')}
                  className="text-[#FF7A00] font-semibold cursor-pointer"
                >
                  กลับ
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleSelectQuality?.(-1)}
                className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/10 text-left transition cursor-pointer"
              >
                <span className={currentLevelIndex === -1 ? 'text-[#FF7A00] font-semibold' : ''}>
                  Auto {currentLevelIndex === -1 && `(${activeLevelLabel})`}
                </span>
                {currentLevelIndex === -1 && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
              </button>

              {[...levels]
                .sort((a, b) => (b.height || 0) - (a.height || 0))
                .map((lvl) => {
                  const isSelected = currentLevelIndex === lvl.index;
                  return (
                    <button
                      key={lvl.index}
                      type="button"
                      onClick={() => handleSelectQuality?.(lvl.index)}
                      className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/10 text-left transition font-mono cursor-pointer"
                    >
                      <span className={isSelected ? 'text-[#FF7A00] font-semibold' : ''}>
                        {lvl.label}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
                    </button>
                  );
                })}
            </div>
          )}

          {/* Tab: Playback Speed Submenu */}
          {activeMenuTab === 'speed' && (
            <div>
              <div className="px-4 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
                <span>เลือกความเร็วการเล่น</span>
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('main')}
                  className="text-[#FF7A00] font-semibold cursor-pointer"
                >
                  กลับ
                </button>
              </div>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => {
                    if (video?.current) {
                      video.current.playbackRate = rate;
                    }
                    setPlaybackRate?.(rate);
                    showToast?.(`ความเร็ว: ${rate}x`);
                    setShowSettingsMenu?.(false);
                    resetControlsTimer?.();
                  }}
                  className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/10 text-left transition font-mono cursor-pointer"
                >
                  <span className={playbackRate === rate ? 'text-[#FF7A00] font-semibold' : ''}>
                    {rate === 1 ? 'ปกติ (1x)' : `${rate}x`}
                  </span>
                  {playbackRate === rate && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
                </button>
              ))}
            </div>
          )}

          {/* Tab: Aspect Ratio Submenu */}
          {activeMenuTab === 'aspect' && (
            <div>
              <div className="px-4 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
                <span>เลือกสัดส่วนภาพ</span>
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('main')}
                  className="text-[#FF7A00] font-semibold cursor-pointer"
                >
                  กลับ
                </button>
              </div>
              {[
                { key: 'fit', label: 'พอดีเฟรม (Fit)', desc: 'แสดงตามสัดส่วนจริง ไม่ครอป' },
                { key: 'crop', label: 'ตัดขอบดำ (Crop)', desc: 'ซูมตัดแถบดำบน-ล่างออก' },
                { key: 'fill', label: 'ขยายเต็มจอ (Fill)', desc: 'ขยายให้เต็มกล่องเครื่องเล่น' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setAspectMode?.(item.key);
                    showToast?.(`สัดส่วน: ${item.label}`);
                    setShowSettingsMenu?.(false);
                    resetControlsTimer?.();
                  }}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10 text-left transition cursor-pointer"
                >
                  <div className="flex flex-col">
                    <span className={aspectMode === item.key ? 'text-[#FF7A00] font-semibold' : ''}>
                      {item.label}
                    </span>
                    <span className="text-[9px] text-zinc-400">{item.desc}</span>
                  </div>
                  {aspectMode === item.key && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
                </button>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
