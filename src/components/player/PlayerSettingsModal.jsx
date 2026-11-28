'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getVisibleQualityLevels, supportsHdrDisplay } from '@/lib/playerQuality.mjs';
import {
  animate, AnimatePresence, motion, useDragControls, useMotionValue, useReducedMotion, useTransform,
} from 'framer-motion';
import {
  ChevronRight, Check, ArrowLeft, X, Sliders, Gauge, Maximize2, RotateCcw, Layers, Headphones, Volume2, VolumeX, PictureInPicture2
} from 'lucide-react';
import AmbientModeIcon from '../icons/AmbientModeIcon';
import CcSubtitleIcon from '../icons/CcSubtitleIcon';
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_FONT_FAMILIES,
  SUBTITLE_COLORS,
  SUBTITLE_FONT_SIZES,
  SUBTITLE_OPACITIES,
  SUBTITLE_FONT_OPACITIES,
  SUBTITLE_EDGE_STYLES,
} from './playerUtils';

const SHEET_SPRING = { type: 'spring', stiffness: 440, damping: 36, mass: 0.85 };
const MENU_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] };

const MENU_PANEL_VARIANTS = {
  enter: (dir) => ({ opacity: 0, x: dir > 0 ? 18 : -18 }),
  center: { opacity: 1, x: 0 },
  exit: (dir) => ({ opacity: 0, x: dir > 0 ? -18 : 18 }),
};

function getMenuDepth(tab) {
  if (tab === 'main') return 0;
  if (tab === 'subtitle_options') return 2;
  if (String(tab).startsWith('subtitle_opt_')) return 3;
  return 1;
}

function getPanelMotionProps(slideDir, reduceMotion) {
  return {
    custom: slideDir,
    variants: MENU_PANEL_VARIANTS,
    initial: reduceMotion ? false : 'enter',
    animate: 'center',
    exit: reduceMotion ? undefined : 'exit',
    transition: reduceMotion ? { duration: 0 } : MENU_TRANSITION,
  };
}

function AnimatedMenuBody({
  tab,
  slideDir = 1,
  reduceMotion = false,
  className = 'overflow-hidden',
  children,
}) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const [height, setHeight] = useState(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      if (content.offsetHeight > 0) setHeight(content.offsetHeight);
    };
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [tab]);

  return (
    <motion.div
      ref={scrollRef}
      initial={false}
      animate={{ height: height ?? 'auto' }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      <div ref={contentRef} className="relative">
        <AnimatePresence mode="popLayout" initial={false} custom={slideDir}>
          {children}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

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
  ambientMode = true,
  setAmbientMode,
  isCcActive = false,
  setIsCcActive,
  hasSubtitles = false,
  subtitleStyle = DEFAULT_SUBTITLE_STYLE,
  setSubtitleStyle,
  subtitleTracks = [],
  selectedSubTrackId = 'th',
  setSelectedSubTrackId,
  activeSubTrack = null,
  versions = [],
  activeVersion = null,
  onSelectVersion = null,
  isSwitchingVersion = false,
  hiResAudio = null,
  isHiResActive = false,
  hiResStatus = 'idle',
  onSelectAudioMode = null,
  audioChannels = null,
  audioLayout = null,
  isMuted = false,
  volume = 1,
  toggleMute = null,
  togglePiP = null,
}) {
  const [mounted, setMounted] = useState(false);
  const [isClientSmall, setIsClientSmall] = useState(false);
  const [portalTarget, setPortalTarget] = useState(null);
  const mobileDragControls = useDragControls();
  const sheetY = useMotionValue(0);
  const dragScrimOpacity = useTransform(sheetY, (offset) =>
    typeof offset === 'number' ? 1 - Math.min(0.75, Math.max(0, offset) / 350) : 1
  );
  const reduceMotion = useReducedMotion();

  // YouTube-style quality list: one clean entry per resolution height
  // - HDR-capable display -> prefer HDR when both HDR & SDR exist at the same height
  // - SDR display -> prefer SDR when both exist (still shows single-variant tiers like legacy HDR-only or in-progress SDR)
  const visibleLevels = getVisibleQualityLevels(levels, supportsHdrDisplay());

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

  // Hide & lock main page scrollbar while Settings menu is open (body-only so <html class="h-full"> NEVER jumps scrollTop to 0!)
  useEffect(() => {
    if (!showSettingsMenu || typeof window === 'undefined' || typeof document === 'undefined') return;
    const html = document.documentElement;
    const body = document.body;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - html.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = prevBodyOverflow;
      body.style.paddingRight = prevBodyPaddingRight;
    };
  }, [showSettingsMenu]);

  const isMobile = isMobileView || isClientSmall;

  // Helpers for displaying current subtitle option labels
  const s = { ...DEFAULT_SUBTITLE_STYLE, ...subtitleStyle };
  const getFontLabel = (id) => SUBTITLE_FONT_FAMILIES.find((f) => f.id === id)?.label || 'Sans-Serif แบบปรับไปตามเนื้อที่ที่มี';
  const getColorLabel = (id) => SUBTITLE_COLORS.find((c) => c.id === id)?.label || 'สีขาว';
  const getEdgeLabel = (id) => SUBTITLE_EDGE_STYLES.find((e) => e.id === id)?.label || 'ไม่มี';

  const updateSubStyle = (patch) => {
    setSubtitleStyle?.((prev) => ({
      ...DEFAULT_SUBTITLE_STYLE,
      ...prev,
      ...patch,
    }));
    resetControlsTimer?.();
  };

  const handleResetSubStyle = () => {
    setSubtitleStyle?.(DEFAULT_SUBTITLE_STYLE);
    showToast?.('รีเซ็ตรูปแบบคำบรรยายเป็นค่าเริ่มต้นแล้ว');
    resetControlsTimer?.();
  };

  // Sub-option metadata for sub-pickers (subtitle_opt_*)
  const SUB_OPT_CONFIG = {
    subtitle_opt_fontFamily: {
      title: 'ชุดแบบอักษร',
      key: 'fontFamily',
      options: SUBTITLE_FONT_FAMILIES.map((f) => ({ value: f.id, label: f.label })),
    },
    subtitle_opt_fontColor: {
      title: 'สีแบบอักษร',
      key: 'fontColor',
      options: SUBTITLE_COLORS.map((c) => ({ value: c.id, label: c.label, hex: c.hex })),
    },
    subtitle_opt_fontSize: {
      title: 'ขนาดตัวอักษร',
      key: 'fontSize',
      options: SUBTITLE_FONT_SIZES.map((sz) => ({ value: sz, label: `${sz}%` })),
    },
    subtitle_opt_bgColor: {
      title: 'สีพื้นหลัง',
      key: 'bgColor',
      options: SUBTITLE_COLORS.map((c) => ({ value: c.id, label: c.label, hex: c.hex })),
    },
    subtitle_opt_bgOpacity: {
      title: 'ความทึบแสงของพื้นหลัง',
      key: 'bgOpacity',
      options: SUBTITLE_OPACITIES.map((op) => ({ value: op, label: `${op}%` })),
    },
    subtitle_opt_windowColor: {
      title: 'สีหน้าต่าง',
      key: 'windowColor',
      options: SUBTITLE_COLORS.map((c) => ({ value: c.id, label: c.label, hex: c.hex })),
    },
    subtitle_opt_windowOpacity: {
      title: 'ความทึบแสงของหน้าต่าง',
      key: 'windowOpacity',
      options: SUBTITLE_OPACITIES.map((op) => ({ value: op, label: `${op}%` })),
    },
    subtitle_opt_fontOpacity: {
      title: 'ความทึบแสงของตัวอักษร',
      key: 'fontOpacity',
      options: SUBTITLE_FONT_OPACITIES.map((op) => ({ value: op, label: `${op}%` })),
    },
    subtitle_opt_charEdgeStyle: {
      title: 'รูปแบบขอบตัวอักษร',
      key: 'charEdgeStyle',
      options: SUBTITLE_EDGE_STYLES.map((e) => ({ value: e.id, label: e.label })),
    },
  };

  const activeSubOpt = SUB_OPT_CONFIG[activeMenuTab] || null;

  const SUBTITLE_OPTION_ROWS = [
    { tab: 'subtitle_opt_fontFamily', label: 'ชุดแบบอักษร', valueLabel: getFontLabel(s.fontFamily) },
    { tab: 'subtitle_opt_fontColor', label: 'สีแบบอักษร', valueLabel: getColorLabel(s.fontColor) },
    { tab: 'subtitle_opt_fontSize', label: 'ขนาดตัวอักษร', valueLabel: `${s.fontSize}%` },
    { tab: 'subtitle_opt_bgColor', label: 'สีพื้นหลัง', valueLabel: getColorLabel(s.bgColor) },
    { tab: 'subtitle_opt_bgOpacity', label: 'ความทึบแสงของพื้นหลัง', valueLabel: `${s.bgOpacity}%` },
    { tab: 'subtitle_opt_windowColor', label: 'สีหน้าต่าง', valueLabel: getColorLabel(s.windowColor) },
    { tab: 'subtitle_opt_windowOpacity', label: 'ความทึบแสงของหน้าต่าง', valueLabel: `${s.windowOpacity}%` },
    { tab: 'subtitle_opt_fontOpacity', label: 'ความทึบแสงของตัวอักษร', valueLabel: `${s.fontOpacity}%` },
    { tab: 'subtitle_opt_charEdgeStyle', label: 'รูปแบบขอบตัวอักษร', valueLabel: getEdgeLabel(s.charEdgeStyle) },
  ];

  const handleBackNavigation = () => {
    if (activeSubOpt) {
      setActiveMenuTab?.('subtitle_options');
    } else if (activeMenuTab === 'subtitle_options') {
      setActiveMenuTab?.('subtitles');
    } else {
      setActiveMenuTab?.('main');
    }
  };

  const playableVersions = Array.isArray(versions)
    ? versions.filter((v) => !v?.status || ['READY', 'COMPLETED'].includes(String(v.status).toUpperCase()))
    : [];
  const hasMultipleVersions = playableVersions.length > 1;
  const activeVersionBadgeOrLabel = activeVersion?.badge || activeVersion?.label || 'ปกติ';

  const [navState, setNavState] = useState(() => ({ tab: activeMenuTab, dir: 1 }));
  if (navState.tab !== activeMenuTab) {
    const nextDepth = getMenuDepth(activeMenuTab);
    const prevDepth = getMenuDepth(navState.tab);
    setNavState({
      tab: activeMenuTab,
      dir: nextDepth >= prevDepth ? 1 : -1,
    });
  }
  const slideDir = navState.dir;
  const panelMotionProps = getPanelMotionProps(slideDir, reduceMotion);

  const hasHiResAudio = Boolean(hiResAudio?.url);
  const hiResFormatLabel = hiResAudio?.format === 'flac' ? 'FLAC' : 'WAV';
  const hiResPlaybackStatus = hiResStatus === 'loading' ? 'กำลังบัฟเฟอร์' : hiResStatus === 'error' ? 'โหลดเสียงไม่ได้' : '';
  const hiResQualityLabel = `Hi-Res ${hiResFormatLabel}${hiResPlaybackStatus ? ` · ${hiResPlaybackStatus}` : ''}`;
  const hiResRateKhz = hiResAudio?.sampleRate
    ? (hiResAudio.sampleRate / 1000).toFixed(hiResAudio.sampleRate % 1000 === 0 ? 0 : 1)
    : '48';
  const hiResSizeMb = hiResAudio?.bytes > 0 ? `${(hiResAudio.bytes / (1024 * 1024)).toFixed(1)} MB` : '';
  const channelShortLabel = (() => {
    const ch = hiResAudio?.channels ?? audioChannels;
    const lay = String(hiResAudio?.layout || audioLayout || '').toLowerCase();
    if (ch >= 7 || lay.includes('7.1')) return '7.1 Surround';
    if ((ch >= 3 && ch <= 6) || lay.includes('5.1')) return '5.1 Surround';
    if (ch === 1 || lay === 'mono') return '1.0 Mono';
    return '2.0 Stereo';
  })();

  const getHeaderTitle = () => {
    if (activeSubOpt) return activeSubOpt.title;
    if (activeMenuTab === 'subtitle_options') return 'ตัวเลือก';
    if (activeMenuTab === 'subtitles') return 'คำบรรยาย';
    if (activeMenuTab === 'quality') return 'คุณภาพของวิดีโอ';
    if (activeMenuTab === 'audio') return 'คุณภาพเสียง';
    if (activeMenuTab === 'speed') return 'ความเร็วในการเล่น';
    if (activeMenuTab === 'aspect') return 'สัดส่วนภาพ';
    if (activeMenuTab === 'version') return 'เวอร์ชันวิดีโอ';
    return 'การตั้งค่า';
  };

  // ==========================================
  // 📱 MOBILE BOTTOM SHEET (YOUTUBE NATIVE STYLE)
  // ==========================================
  if (isMobile) {
    if (!mounted || !portalTarget) return null;

    const closeSheet = () => setShowSettingsMenu?.(false);
    const startSheetDrag = (event) => {
      if (event.target.closest('button')) return;
      mobileDragControls.start(event);
    };
    const finishSheetDrag = (event, { offset, velocity }) => {
      const height = settingsMenuRef?.current?.offsetHeight || 360;
      const distance = Math.max(0, sheetY.get());
      const dismissDistance = Math.min(120, height * 0.28);
      const isDownwardFlick = offset.y > 12 && velocity.y > 500;
      if (event.type !== 'pointercancel' && (distance > dismissDistance || isDownwardFlick)) {
        closeSheet();
      } else {
        animate(sheetY, 0, reduceMotion ? { duration: 0 } : SHEET_SPRING);
      }
    };

    return createPortal(
      <AnimatePresence>
        {showSettingsMenu && (
          <div
            className={`${isFullscreen ? 'absolute' : 'fixed'} inset-0 z-[9999] flex flex-col justify-end overflow-hidden overscroll-none`}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
              className="absolute inset-0 touch-none"
              aria-hidden="true"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={closeSheet}
            >
              <motion.div className="absolute inset-0 bg-black/60" style={{ opacity: dragScrimOpacity }} />
            </motion.div>

            <motion.div
              ref={settingsMenuRef}
              role="dialog"
              aria-modal="true"
              aria-label={getHeaderTitle()}
              style={{ y: sheetY }}
              initial={{ y: reduceMotion ? 0 : '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%', transition: { duration: reduceMotion ? 0 : 0.18, ease: [0.32, 0.72, 0, 1] } }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              drag="y"
              dragControls={mobileDragControls}
              dragListener={false}
              dragMomentum={false}
              dragConstraints={{ top: 0 }}
              dragElastic={0}
              onDragEnd={finishSheetDrag}
              className="relative z-10 mx-auto flex max-h-[calc(100%_-_max(0.5rem,env(safe-area-inset-top)))] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border-t border-white/15 bg-[#181818] pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[#F1F1F1] shadow-xl select-none will-change-transform"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                aria-hidden="true"
                onPointerDown={startSheetDrag}
                className="flex h-7 shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
              >
                <div className="h-1 w-9 rounded-full bg-white/30" />
              </div>

              {/* Sheet Header */}
              <div
                onPointerDown={startSheetDrag}
                className="flex shrink-0 touch-none items-center justify-between border-b border-white/10 px-4 pb-2"
              >
                <div className="flex items-center gap-2">
                  {activeMenuTab !== 'main' && (
                    <button
                      type="button"
                      onClick={handleBackNavigation}
                      className="p-1 -ml-1 rounded-full hover:bg-white/10 active:bg-white/20 text-white cursor-pointer"
                      title="ย้อนกลับ"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <span className="text-[15px] font-bold text-white tracking-tight">
                    {getHeaderTitle()}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {activeMenuTab === 'subtitles' && (
                    <button
                      type="button"
                      onClick={() => setActiveMenuTab?.('subtitle_options')}
                      className="text-xs px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 font-medium cursor-pointer"
                    >
                      ตัวเลือก
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closeSheet}
                    className="p-1 rounded-full hover:bg-white/10 active:bg-white/20 text-zinc-400 hover:text-white cursor-pointer"
                    title="ปิด"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Animated Tab Body */}
              <AnimatedMenuBody
                tab={activeMenuTab}
                slideDir={slideDir}
                reduceMotion={reduceMotion}
                className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain touch-pan-y"
              >
                {/* Tab: Main Menu */}
                {activeMenuTab === 'main' && (
                  <motion.div
                    key="main"
                    custom={slideDir}
                    variants={MENU_PANEL_VARIANTS}
                    initial={reduceMotion ? false : 'enter'}
                    animate="center"
                    exit={reduceMotion ? undefined : 'exit'}
                    transition={reduceMotion ? { duration: 0 } : MENU_TRANSITION}
                    className="flex flex-col py-1"
                  >
                    {/* Version Switcher (Top priority when multi-version) */}
                    {hasMultipleVersions && (
                      <button
                        type="button"
                        onClick={() => setActiveMenuTab?.('version')}
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 transition cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5">
                          <Layers className="w-5 h-5 text-zinc-300 shrink-0" />
                          <span className="text-[14px] text-zinc-200 font-medium">เวอร์ชันวิดีโอ</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-zinc-400 max-w-[52%]">
                          <span className="text-[13px] text-[#FF7A00] font-semibold truncate">
                            {isSwitchingVersion ? 'กำลังสลับ...' : (activeVersion?.label || activeVersionBadgeOrLabel)}
                          </span>
                          {!isSwitchingVersion && activeVersion?.badge && (
                            <span className="text-[9.5px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FF7A00] text-white shrink-0">
                              {activeVersion.badge}
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                        </div>
                      </button>
                    )}

                    {/* Quality */}
                    <button
                      type="button"
                      disabled={levels.length <= 1}
                      onClick={() => setActiveMenuTab?.('quality')}
                      className={`w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 transition disabled:opacity-50 cursor-pointer ${
                        hasMultipleVersions ? 'border-t border-white/5' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <Sliders className="w-5 h-5 text-zinc-300 shrink-0" />
                        <span className="text-[14px] text-zinc-200 font-medium">คุณภาพ</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <span className="text-[13px] text-[#FF7A00] font-semibold font-mono">
                          {currentLevelIndex === -1 ? `อัตโนมัติ (${activeLevelLabel})` : activeLevelLabel}
                        </span>
                        {levels.length > 1 && <ChevronRight className="w-4 h-4 text-zinc-400" />}
                      </div>
                    </button>

                    {/* Audio Quality (Hi-Res Lossless WAV / FLAC Switcher — Mobile) */}
                    {hasHiResAudio && (
                      <button
                        type="button"
                        onClick={() => setActiveMenuTab?.('audio')}
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 transition border-t border-white/5 cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5">
                          <Headphones className={`w-5 h-5 shrink-0 ${isHiResActive ? 'text-amber-400' : 'text-zinc-300'}`} />
                          <span className="text-[14px] text-zinc-200 font-medium">คุณภาพเสียง</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-zinc-400">
                          {isHiResActive ? (
                            <span className="text-right text-[12px] font-bold px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/40 font-mono">
                              {hiResQualityLabel}
                            </span>
                          ) : (
                            <span className="text-[13px] text-zinc-300 font-medium">มาตรฐาน (AAC)</span>
                          )}
                          <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                        </div>
                      </button>
                    )}

                    {/* Subtitles (CC) */}
                    <button
                      type="button"
                      onClick={() => setActiveMenuTab?.('subtitles')}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 transition border-t border-white/5 cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5">
                        <CcSubtitleIcon active={false} className="w-5 h-5 text-zinc-300 shrink-0" />
                        <span className="text-[14px] text-zinc-200 font-medium">คำบรรยาย</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <span className="text-[13px] text-[#FF7A00] font-semibold">
                          {isCcActive && hasSubtitles ? (activeSubTrack?.label || 'ไทย (สร้างอัตโนมัติ)') : 'ปิด'}
                        </span>
                        <ChevronRight className="w-4 h-4 text-zinc-400" />
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

                    {/* Ambient Mode Toggle */}
                    <button
                      type="button"
                      onClick={() => {
                        const nextVal = !ambientMode;
                        setAmbientMode?.(nextVal);
                        showToast?.(nextVal ? 'เปิดโหมด Ambient แล้ว' : 'ปิดโหมด Ambient แล้ว');
                      }}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 transition border-t border-white/5 cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5">
                        <AmbientModeIcon className="w-5 h-5 text-[#FF7A00] shrink-0" />
                        <span className="text-[14px] text-zinc-200 font-medium">โหมด Ambient</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] text-zinc-400">
                          {ambientMode ? 'เปิด' : 'ปิด'}
                        </span>
                        <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${ambientMode ? 'bg-[#FF7A00]' : 'bg-white/20'}`}>
                          <div className={`w-4 h-4 rounded-full bg-white transition-transform ${ambientMode ? 'translate-x-4' : 'translate-x-0'}`} />
                        </div>
                      </div>
                    </button>

                    {/* Mute / Unmute Toggle (Moved here on Mobile to keep video player ultra-clean!) */}
                    {toggleMute && (
                      <button
                        type="button"
                        onClick={() => toggleMute()}
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 transition border-t border-white/5 cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5">
                          {isMuted || volume === 0 ? (
                            <VolumeX className="w-5 h-5 text-[#FF7A00] shrink-0" />
                          ) : (
                            <Volume2 className="w-5 h-5 text-zinc-300 shrink-0" />
                          )}
                          <span className="text-[14px] text-zinc-200 font-medium">เสียง</span>
                        </div>
                        <span className={`text-[13px] font-semibold ${isMuted || volume === 0 ? 'text-[#FF7A00]' : 'text-zinc-400'}`}>
                          {isMuted || volume === 0 ? 'ปิดเสียง' : 'เปิดเสียง'}
                        </span>
                      </button>
                    )}

                    {/* OS Picture-in-Picture (Moved here on Mobile to keep video player ultra-clean!) */}
                    {togglePiP && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowSettingsMenu?.(false);
                          togglePiP();
                        }}
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 transition border-t border-white/5 cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5">
                          <PictureInPicture2 className="w-5 h-5 text-zinc-300 shrink-0" />
                          <span className="text-[14px] text-zinc-200 font-medium">หน้าต่างลอยทับแอปอื่น (PiP)</span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-400" />
                      </button>
                    )}
                  </motion.div>
                )}

                {/* Tab: Subtitles Track Selector */}
                {activeMenuTab === 'subtitles' && (
                  <motion.div
                    key="subtitles"
                    {...panelMotionProps}
                    className="flex flex-col py-1"
                  >
                    {/* Off */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsCcActive?.(false);
                        showToast?.('ปิดคำบรรยาย');
                        setShowSettingsMenu?.(false);
                        resetControlsTimer?.();
                      }}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer"
                    >
                      <span className={`text-[14px] ${!isCcActive ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                        ปิด
                      </span>
                      {!isCcActive && <Check className="w-5 h-5 text-[#FF7A00] shrink-0" />}
                    </button>

                    {/* Subtitle Tracks (Dynamic: Thai AI + Original Language) */}
                    {subtitleTracks.length > 0 ? (
                      subtitleTracks.map((track) => {
                        const isTrackActive = isCcActive && (selectedSubTrackId === track.id || (subtitleTracks.length === 1 && isCcActive));
                        return (
                          <button
                            key={track.id}
                            type="button"
                            onClick={() => {
                              setSelectedSubTrackId?.(track.id);
                              setIsCcActive?.(true);
                              showToast?.(`เปิดคำบรรยาย: ${track.label}`);
                              setShowSettingsMenu?.(false);
                              resetControlsTimer?.();
                            }}
                            className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer border-t border-white/5"
                          >
                            <div className="flex flex-col">
                              <span className={`text-[14px] ${isTrackActive ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                                {track.label}
                              </span>
                              {track.isOriginal && track.lang !== 'th' && (
                                <span className="text-[11px] text-zinc-400">ภาษาต้นฉบับของวิดีโอ (ถอดเสียง AI)</span>
                              )}
                              {track.isAutoTranslate && (
                                <span className="text-[11px] text-zinc-400">แปลภาษาไทยอัตโนมัติ</span>
                              )}
                            </div>
                            {isTrackActive && <Check className="w-5 h-5 text-[#FF7A00] shrink-0" />}
                          </button>
                        );
                      })
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="w-full flex items-center justify-between px-5 py-3.5 text-left border-t border-white/5 opacity-40"
                      >
                        <div className="flex flex-col">
                          <span className="text-[14px] text-zinc-400">
                            ไทย (สร้างอัตโนมัติ)
                          </span>
                          <span className="text-[11px] text-zinc-500">วิดีโอนี้ยังไม่มีคำบรรยายในระบบ</span>
                        </div>
                      </button>
                    )}

                    {/* Customize Subtitle Style Row */}
                    <button
                      type="button"
                      onClick={() => setActiveMenuTab?.('subtitle_options')}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer border-t border-white/10"
                    >
                      <span className="text-[14px] text-zinc-200 font-medium">
                        ตัวเลือกคำบรรยาย (ปรับแต่งรูปแบบตัวอักษร)
                      </span>
                      <ChevronRight className="w-4 h-4 text-zinc-400" />
                    </button>
                  </motion.div>
                )}

                {/* Tab: Subtitle Style Options (< ตัวเลือก) */}
                {activeMenuTab === 'subtitle_options' && (
                  <motion.div
                    key="subtitle_options"
                    {...panelMotionProps}
                    className="flex flex-col py-1"
                  >
                    {SUBTITLE_OPTION_ROWS.map((row) => (
                      <button
                        key={row.tab}
                        type="button"
                        onClick={() => setActiveMenuTab?.(row.tab)}
                        className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer border-t border-white/5 first:border-t-0"
                      >
                        <span className="text-[13.5px] text-zinc-200">{row.label}</span>
                        <div className="flex items-center gap-1.5 text-zinc-300 max-w-[55%]">
                          <span className="text-[13px] truncate">{row.valueLabel}</span>
                          <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                        </div>
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={handleResetSubStyle}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer border-t border-white/10 text-zinc-300 hover:text-white"
                    >
                      <span className="text-[13.5px] flex items-center gap-2">
                        <RotateCcw className="w-4 h-4" />
                        รีเซ็ต
                      </span>
                    </button>
                  </motion.div>
                )}

                {/* Tab: Specific Subtitle Option Value Picker (subtitle_opt_*) */}
                {activeSubOpt && (
                  <motion.div
                    key={activeMenuTab}
                    {...panelMotionProps}
                    className="flex flex-col py-1"
                  >
                    {activeSubOpt.options.map((opt) => {
                      const isSelected = s[activeSubOpt.key] === opt.value;
                      return (
                        <button
                          key={String(opt.value)}
                          type="button"
                          onClick={() => {
                            updateSubStyle({ [activeSubOpt.key]: opt.value });
                            setActiveMenuTab?.('subtitle_options');
                          }}
                          className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer border-t border-white/5 first:border-t-0"
                        >
                          <div className="flex items-center gap-2.5">
                            {opt.hex && (
                              <span
                                className="w-3.5 h-3.5 rounded-full border border-white/30 shrink-0"
                                style={{ backgroundColor: opt.hex }}
                              />
                            )}
                            <span className={`text-[13.5px] ${isSelected ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                              {opt.label}
                            </span>
                          </div>
                          {isSelected && <Check className="w-4.5 h-4.5 text-[#FF7A00] shrink-0" />}
                        </button>
                      );
                    })}
                  </motion.div>
                )}

                {/* Tab: Quality Submenu */}
                {activeMenuTab === 'quality' && (
                  <motion.div
                    key="quality"
                    {...panelMotionProps}
                    className="flex flex-col py-1"
                  >
                    {visibleLevels.map((lvl) => {
                        const isSelected = currentLevelIndex === lvl.index;
                        return (
                          <button
                            key={lvl.index}
                            type="button"
                            onClick={() => {
                              handleSelectQuality?.(lvl.index);
                              setShowSettingsMenu?.(false);
                            }}
                            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition font-mono cursor-pointer border-t border-white/5 first:border-t-0"
                          >
                            <span className={`text-[14px] flex items-center gap-1.5 ${isSelected ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                              <span>{lvl.label}</span>
                              {lvl.badge && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-white/10 dark:bg-white/15 text-zinc-300 font-sans leading-none">
                                  {lvl.badge}
                                </span>
                              )}
                            </span>
                            {isSelected && <Check className="w-5 h-5 text-[#FF7A00] shrink-0" />}
                          </button>
                        );
                      })}

                    <button
                      type="button"
                      onClick={() => {
                        handleSelectQuality?.(-1);
                        setShowSettingsMenu?.(false);
                      }}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer border-t border-white/5"
                    >
                      <div className="flex flex-col">
                        <span className={`text-[14px] ${currentLevelIndex === -1 ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                          อัตโนมัติ
                        </span>
                        <span className="text-[11.5px] text-zinc-400 mt-0.5">
                          ปรับความละเอียดตามความเร็วเน็ตเวิร์ก {currentLevelIndex === -1 && `• ปัจจุบัน (${activeLevelLabel})`}
                        </span>
                      </div>
                      {currentLevelIndex === -1 && <Check className="w-5 h-5 text-[#FF7A00] shrink-0" />}
                    </button>
                  </motion.div>
                )}

                {/* Tab: Audio Quality Submenu (Mobile) */}
                {activeMenuTab === 'audio' && hasHiResAudio && (
                  <motion.div
                    key="audio"
                    {...panelMotionProps}
                    className="flex flex-col py-1"
                  >
                    <button
                      type="button"
                      aria-pressed={isHiResActive}
                      onClick={() => {
                        onSelectAudioMode?.('hires');
                        setShowSettingsMenu?.(false);
                      }}
                      className="w-full flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer"
                    >
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[14px] ${isHiResActive ? 'text-amber-300 font-bold' : 'text-zinc-200 font-medium'}`}>
                            Hi-Res Lossless
                          </span>
                          <span className="text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/40 font-mono">
                            {hiResFormatLabel}
                          </span>
                        </div>
                        <span className="text-[11.5px] text-zinc-400 mt-0.5 font-mono">
                          {hiResAudio.format === 'flac' ? 'FLAC' : 'PCM WAV'} {hiResAudio.bits}-bit / {hiResRateKhz} kHz • {channelShortLabel}{hiResSizeMb ? ` • ${hiResSizeMb}` : ''}
                        </span>
                      </div>
                      {isHiResActive && <Check className="w-5 h-5 text-amber-400 shrink-0" />}
                    </button>

                    <button
                      type="button"
                      aria-pressed={!isHiResActive}
                      onClick={() => {
                        onSelectAudioMode?.('standard');
                        setShowSettingsMenu?.(false);
                      }}
                      className="w-full flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer border-t border-white/5"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className={`text-[14px] ${!isHiResActive ? 'text-[#FF7A00] font-bold' : 'text-zinc-200 font-medium'}`}>
                          มาตรฐาน (AAC)
                        </span>
                        <span className="text-[11.5px] text-zinc-400 mt-0.5">
                          48 kHz • {channelShortLabel} • โหลดไวและประหยัดเน็ต
                        </span>
                      </div>
                      {!isHiResActive && <Check className="w-5 h-5 text-[#FF7A00] shrink-0" />}
                    </button>
                  </motion.div>
                )}

                {/* Tab: Playback Speed Submenu */}
                {activeMenuTab === 'speed' && (
                  <motion.div
                    key="speed"
                    {...panelMotionProps}
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
                    {...panelMotionProps}
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

                {/* Tab: Version Submenu (Mobile) */}
                {activeMenuTab === 'version' && hasMultipleVersions && (
                  <motion.div
                    key="version"
                    {...panelMotionProps}
                    className="flex flex-col py-1"
                  >
                    {playableVersions.map((ver) => {
                      const isSelected = activeVersion?.id
                        ? ver.id === activeVersion.id
                        : ver.versionKey === activeVersion?.versionKey;
                      const metaParts = [ver.aspectLabel, ver.resolution].filter(Boolean);
                      return (
                        <button
                          key={ver.id ?? ver.versionKey}
                          type="button"
                          disabled={isSwitchingVersion}
                          onClick={() => {
                            if (!isSelected) {
                              onSelectVersion?.(ver);
                              showToast?.(`สลับเป็นเวอร์ชัน: ${ver.label || ver.badge || 'ปกติ'}`);
                            }
                            setShowSettingsMenu?.(false);
                            resetControlsTimer?.();
                          }}
                          className="w-full flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-white/10 active:bg-white/15 text-left transition cursor-pointer border-t border-white/5 first:border-t-0 disabled:opacity-60"
                        >
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[14px] ${isSelected ? 'text-[#FF7A00] font-bold' : 'text-zinc-200 font-medium'}`}>
                                {ver.label || 'เวอร์ชัน'}
                              </span>
                              {ver.badge && (
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                  isSelected
                                    ? 'bg-[#FF7A00]/20 text-[#FF7A00] border border-[#FF7A00]/40'
                                    : 'bg-white/10 text-zinc-300 border border-white/10'
                                }`}>
                                  {ver.badge}
                                </span>
                              )}
                            </div>
                            {(metaParts.length > 0 || ver.description) && (
                              <span className="text-[11.5px] text-zinc-400 mt-0.5 line-clamp-2">
                                {[metaParts.join(' • '), ver.description].filter(Boolean).join(' — ')}
                              </span>
                            )}
                          </div>
                          {isSelected && <Check className="w-5 h-5 text-[#FF7A00] shrink-0" />}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatedMenuBody>
            </motion.div>
          </div>
        )}
      </AnimatePresence>,
      portalTarget
    );
  }

  // ==========================================
  // 💻 DESKTOP FLOATING POPUP (YOUTUBE STYLE)
  // ==========================================
  const isWideSubtitlePanel =
    activeMenuTab === 'subtitle_options' || Boolean(activeSubOpt);

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
          } bg-black/65 border border-white/15 rounded-2xl py-2 ${
            isWideSubtitlePanel ? 'w-[420px] sm:w-[460px]' : 'w-[330px] sm:w-[350px]'
          } text-zinc-200 z-40 shadow-[0_16px_40px_rgba(0,0,0,0.65)] backdrop-blur-md overflow-hidden select-none will-change-transform transition-[width] duration-150`}
          onClick={(e) => e.stopPropagation()}
        >
          <AnimatedMenuBody tab={activeMenuTab} slideDir={slideDir} reduceMotion={reduceMotion}>
          {/* Tab: Main Menu */}
          {activeMenuTab === 'main' && (
            <motion.div
              key="main"
              {...panelMotionProps}
              className="flex flex-col w-full"
            >
              {/* Version Switcher Item (Top priority when multi-version) */}
              {hasMultipleVersions && (
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('version')}
                  className="w-full flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-white/10 transition cursor-pointer group"
                >
                  <div className="flex items-center gap-3.5 shrink-0">
                    <Layers className="w-4.5 h-4.5 text-zinc-400 group-hover:text-zinc-200 transition shrink-0" />
                    <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">เวอร์ชันวิดีโอ</span>
                  </div>
                  <div className="flex items-center gap-1.5 max-w-[175px]">
                    <span className="text-[13px] text-[#FF7A00] font-semibold truncate">
                      {isSwitchingVersion ? 'กำลังสลับ...' : (activeVersion?.label || activeVersionBadgeOrLabel)}
                    </span>
                    {!isSwitchingVersion && activeVersion?.badge && (
                      <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FF7A00] text-white shrink-0">
                        {activeVersion.badge}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                  </div>
                </button>
              )}

              {/* Quality Item */}
              <button
                type="button"
                disabled={levels.length <= 1}
                onClick={() => setActiveMenuTab?.('quality')}
                className={`w-full flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-white/10 transition disabled:opacity-50 cursor-pointer group ${
                  hasMultipleVersions ? 'border-t border-white/5' : ''
                }`}
              >
                <div className="flex items-center gap-3.5 shrink-0">
                  <Sliders className="w-4.5 h-4.5 text-zinc-400 group-hover:text-zinc-200 transition shrink-0" />
                  <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">คุณภาพ</span>
                </div>
                <div className="flex items-center gap-2 font-mono min-w-0">
                  <span className="text-[13px] text-[#FF7A00] font-semibold truncate max-w-[160px] text-right whitespace-nowrap">
                    {currentLevelIndex === -1 ? `อัตโนมัติ (${activeLevelLabel})` : activeLevelLabel}
                  </span>
                  {levels.length > 1 && <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />}
                </div>
              </button>

              {/* Audio Quality Item (Hi-Res Lossless WAV / FLAC — Desktop) */}
              {hasHiResAudio && (
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('audio')}
                  className="w-full flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer group"
                >
                  <div className="flex items-center gap-3.5 shrink-0">
                    <Headphones className={`w-4.5 h-4.5 transition shrink-0 ${isHiResActive ? 'text-amber-400' : 'text-zinc-400 group-hover:text-zinc-200'}`} />
                    <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">คุณภาพเสียง</span>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isHiResActive ? (
                      <span className="text-right text-[11.5px] font-bold px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/40 font-mono">
                        {hiResQualityLabel}
                      </span>
                    ) : (
                      <span className="text-[13px] text-zinc-300 font-medium whitespace-nowrap">มาตรฐาน (AAC)</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                  </div>
                </button>
              )}

              {/* Subtitles (CC) Item */}
              <button
                type="button"
                onClick={() => setActiveMenuTab?.('subtitles')}
                className="w-full flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer group"
              >
                <div className="flex items-center gap-3.5 shrink-0">
                  <CcSubtitleIcon
                    active={false}
                    className="w-4.5 h-4.5 text-zinc-400 group-hover:text-zinc-200 transition shrink-0"
                  />
                  <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">คำบรรยาย</span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[13px] text-[#FF7A00] font-semibold truncate max-w-[160px] text-right whitespace-nowrap">
                    {isCcActive && hasSubtitles ? (activeSubTrack?.label || 'ไทย (สร้างอัตโนมัติ)') : 'ปิด'}
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </div>
              </button>

              {/* Speed Item */}
              <button
                type="button"
                onClick={() => setActiveMenuTab?.('speed')}
                className="w-full flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer group"
              >
                <div className="flex items-center gap-3.5 shrink-0">
                  <Gauge className="w-4.5 h-4.5 text-zinc-400 group-hover:text-zinc-200 transition shrink-0" />
                  <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">ความเร็ว</span>
                </div>
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-[13px] text-[#FF7A00] font-semibold whitespace-nowrap">
                    {playbackRate === 1 ? 'ปกติ' : `${playbackRate}x`}
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </div>
              </button>

              {/* Aspect Ratio Item */}
              <button
                type="button"
                onClick={() => setActiveMenuTab?.('aspect')}
                className="w-full flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer group"
              >
                <div className="flex items-center gap-3.5 shrink-0">
                  <Maximize2 className="w-4.5 h-4.5 text-zinc-400 group-hover:text-zinc-200 transition shrink-0" />
                  <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">สัดส่วนวิดีโอ</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-[#FF7A00] font-semibold whitespace-nowrap">
                    {aspectMode === 'crop' ? 'ตัดขอบดำ' : aspectMode === 'fill' ? 'เต็มจอ' : 'พอดี'}
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </div>
              </button>

              {/* Ambient Mode Toggle */}
              <button
                type="button"
                onClick={() => {
                  const nextVal = !ambientMode;
                  setAmbientMode?.(nextVal);
                  showToast?.(nextVal ? 'เปิดโหมด Ambient แล้ว' : 'ปิดโหมด Ambient แล้ว');
                }}
                className="w-full flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer group"
              >
                <div className="flex items-center gap-3.5 shrink-0">
                  <AmbientModeIcon className="w-5 h-5 text-zinc-400 group-hover:text-white transition shrink-0" />
                  <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">โหมด Ambient</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[12.5px] text-zinc-400 font-medium whitespace-nowrap">
                    {ambientMode ? 'เปิด' : 'ปิด'}
                  </span>
                  <div className={`w-8 h-4.5 rounded-full transition-colors flex items-center px-0.5 ${ambientMode ? 'bg-[#FF7A00]' : 'bg-white/20'}`}>
                    <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${ambientMode ? 'translate-x-3.5' : 'translate-x-0'}`} />
                  </div>
                </div>
              </button>
            </motion.div>
          )}

          {/* Tab: Subtitles Track Selector (with top-right "ตัวเลือก" button like YouTube) */}
          {activeMenuTab === 'subtitles' && (
            <motion.div key="subtitles" {...panelMotionProps} className="flex flex-col w-full">
              <div className="px-2 py-1.5 border-b border-white/10 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('main')}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition cursor-pointer group text-left"
                >
                  <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-200 group-hover:text-white">
                    คำบรรยาย
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('subtitle_options')}
                  className="px-2.5 py-1 mr-1 rounded-lg text-[12px] font-medium text-zinc-300 hover:text-white hover:bg-white/15 transition cursor-pointer"
                >
                  ตัวเลือก
                </button>
              </div>

              <div className="py-1">
                {/* ปิด */}
                <button
                  type="button"
                  onClick={() => {
                    setIsCcActive?.(false);
                    showToast?.('ปิดคำบรรยาย');
                    setShowSettingsMenu?.(false);
                    resetControlsTimer?.();
                  }}
                  className="w-full flex items-center justify-between px-4.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer"
                >
                  <span className={`text-[13.5px] ${!isCcActive ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                    ปิด
                  </span>
                  {!isCcActive && <Check className="w-4.5 h-4.5 text-[#FF7A00] shrink-0" />}
                </button>

                {/* Subtitle Tracks (Dynamic: Thai AI + Original Language) */}
                {subtitleTracks.length > 0 ? (
                  subtitleTracks.map((track) => {
                    const isTrackActive = isCcActive && (selectedSubTrackId === track.id || (subtitleTracks.length === 1 && isCcActive));
                    return (
                      <button
                        key={track.id}
                        type="button"
                        onClick={() => {
                          setSelectedSubTrackId?.(track.id);
                          setIsCcActive?.(true);
                          showToast?.(`เปิดคำบรรยาย: ${track.label}`);
                          setShowSettingsMenu?.(false);
                          resetControlsTimer?.();
                        }}
                        className="w-full flex items-center justify-between px-4.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5"
                      >
                        <div className="flex flex-col">
                          <span className={`text-[13.5px] ${isTrackActive ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                            {track.label}
                          </span>
                          {track.isOriginal && track.lang !== 'th' && (
                            <span className="text-[11px] text-zinc-400">ภาษาต้นฉบับของวิดีโอ (ถอดเสียง AI)</span>
                          )}
                          {track.isAutoTranslate && (
                            <span className="text-[11px] text-zinc-400">แปลภาษาไทยอัตโนมัติ</span>
                          )}
                        </div>
                        {isTrackActive && <Check className="w-4.5 h-4.5 text-[#FF7A00] shrink-0" />}
                      </button>
                    );
                  })
                ) : (
                  <button
                    type="button"
                    disabled
                    className="w-full flex items-center justify-between px-4.5 py-2.5 text-left border-t border-white/5 opacity-40 cursor-not-allowed"
                  >
                    <div className="flex flex-col">
                      <span className="text-[13.5px] text-zinc-400">
                        ไทย (สร้างอัตโนมัติ)
                      </span>
                      <span className="text-[11px] text-zinc-500">วิดีโอนี้ยังไม่มีคำบรรยายในระบบ</span>
                    </div>
                  </button>
                )}

                {/* ตัวเลือกคำบรรยาย */}
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('subtitle_options')}
                  className="w-full flex items-center justify-between px-4.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/10"
                >
                  <span className="text-[13px] text-zinc-300 font-medium">
                    ตัวเลือกคำบรรยาย (ปรับแต่งรูปแบบ)
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
            </motion.div>
          )}

          {/* Tab: YouTube Subtitle Options (< ตัวเลือก) */}
          {activeMenuTab === 'subtitle_options' && (
            <motion.div key="subtitle_options" {...panelMotionProps} className="flex flex-col w-full">
              <div className="px-2 py-1.5 border-b border-white/10 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('subtitles')}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition cursor-pointer group text-left"
                >
                  <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-200 group-hover:text-white">
                    ตัวเลือก
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleResetSubStyle}
                  className="px-2.5 py-1 mr-1 rounded-lg text-[11.5px] text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer flex items-center gap-1"
                  title="รีเซ็ตเป็นค่าเริ่มต้น"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>รีเซ็ต</span>
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto py-1">
                {SUBTITLE_OPTION_ROWS.map((row) => (
                  <button
                    key={row.tab}
                    type="button"
                    onClick={() => setActiveMenuTab?.(row.tab)}
                    className="w-full flex items-center justify-between px-4.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5 first:border-t-0"
                  >
                    <span className="text-[13.5px] text-zinc-100">{row.label}</span>
                    <div className="flex items-center gap-1.5 text-zinc-200 max-w-[58%]">
                      <span className="text-[13px] truncate">{row.valueLabel}</span>
                      <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Tab: Specific Subtitle Property Picker (subtitle_opt_*) */}
          {activeSubOpt && (
            <motion.div key={activeMenuTab} {...panelMotionProps} className="flex flex-col w-full">
              <div className="px-2 py-1.5 border-b border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('subtitle_options')}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition cursor-pointer group text-left"
                >
                  <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-200 group-hover:text-white">
                    {activeSubOpt.title}
                  </span>
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto py-1">
                {activeSubOpt.options.map((opt) => {
                  const isSelected = s[activeSubOpt.key] === opt.value;
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => {
                        updateSubStyle({ [activeSubOpt.key]: opt.value });
                        setActiveMenuTab?.('subtitle_options');
                      }}
                      className="w-full flex items-center justify-between px-4.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5 first:border-t-0"
                    >
                      <div className="flex items-center gap-2.5">
                        {opt.hex && (
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-white/30 shrink-0"
                            style={{ backgroundColor: opt.hex }}
                          />
                        )}
                        <span className={`text-[13.5px] ${isSelected ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                          {opt.label}
                        </span>
                      </div>
                      {isSelected && <Check className="w-4.5 h-4.5 text-[#FF7A00] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* Tab: Quality Submenu */}
          {activeMenuTab === 'quality' && (
            <motion.div key="quality" {...panelMotionProps} className="flex flex-col w-full">
              <div className="px-2 py-1.5 border-b border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('main')}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition cursor-pointer group text-left"
                >
                  <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-200 group-hover:text-white">
                    เลือกระดับความละเอียด
                  </span>
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto py-1">
                {visibleLevels.map((lvl) => {
                    const isSelected = currentLevelIndex === lvl.index;
                    return (
                      <button
                        key={lvl.index}
                        type="button"
                        onClick={() => handleSelectQuality?.(lvl.index)}
                        className="w-full flex items-center justify-between px-4.5 py-2.5 hover:bg-white/10 text-left transition font-mono cursor-pointer border-t border-white/5 first:border-t-0"
                      >
                        <span className={`flex items-center gap-2 text-[13.5px] ${isSelected ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                          <span>{lvl.label}</span>
                          {lvl.badge && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-white/15 text-zinc-200 font-sans leading-none border border-white/10 shadow-xs">
                              {lvl.badge}
                            </span>
                          )}
                        </span>
                        {isSelected && <Check className="w-4.5 h-4.5 text-[#FF7A00] shrink-0" />}
                      </button>
                    );
                  })}

                <button
                  type="button"
                  onClick={() => handleSelectQuality?.(-1)}
                  className="w-full flex items-center justify-between px-4.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5"
                >
                  <div className="flex flex-col">
                    <span className={`text-[13.5px] ${currentLevelIndex === -1 ? 'text-[#FF7A00] font-bold' : 'text-zinc-200 font-medium'}`}>
                      อัตโนมัติ
                    </span>
                    {currentLevelIndex === -1 && activeLevelLabel && (
                      <span className="text-[11px] text-zinc-400 font-mono mt-0.5">
                        ปัจจุบัน: {activeLevelLabel}
                      </span>
                    )}
                  </div>
                  {currentLevelIndex === -1 && <Check className="w-4.5 h-4.5 text-[#FF7A00] shrink-0" />}
                </button>
              </div>
            </motion.div>
          )}

          {/* Tab: Audio Quality Submenu (Desktop) */}
          {activeMenuTab === 'audio' && hasHiResAudio && (
            <motion.div key="audio" {...panelMotionProps} className="flex flex-col w-full">
              <div className="px-2 py-1.5 border-b border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('main')}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition cursor-pointer group text-left"
                >
                  <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-200 group-hover:text-white">
                    เลือกคุณภาพเสียง
                  </span>
                </button>
              </div>
              <div className="py-1">
                <button
                  type="button"
                  aria-pressed={isHiResActive}
                  onClick={() => {
                    onSelectAudioMode?.('hires');
                    setShowSettingsMenu?.(false);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[13.5px] ${isHiResActive ? 'text-amber-300 font-bold' : 'text-zinc-200 font-medium'}`}>
                        Hi-Res Lossless
                      </span>
                      <span className="text-[9.5px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/40 font-mono">
                        {hiResFormatLabel}
                      </span>
                    </div>
                    <span className="text-[11px] text-zinc-400 mt-0.5 font-mono">
                      {hiResAudio.format === 'flac' ? 'FLAC' : 'PCM WAV'} {hiResAudio.bits}-bit / {hiResRateKhz} kHz • {channelShortLabel}{hiResSizeMb ? ` • ${hiResSizeMb}` : ''}
                    </span>
                  </div>
                  {isHiResActive && <Check className="w-4.5 h-4.5 text-amber-400 shrink-0" />}
                </button>

                <button
                  type="button"
                  aria-pressed={!isHiResActive}
                  onClick={() => {
                    onSelectAudioMode?.('standard');
                    setShowSettingsMenu?.(false);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5"
                >
                  <div className="flex flex-col min-w-0">
                    <span className={`text-[13.5px] ${!isHiResActive ? 'text-[#FF7A00] font-bold' : 'text-zinc-200 font-medium'}`}>
                      มาตรฐาน (AAC)
                    </span>
                    <span className="text-[11px] text-zinc-400 mt-0.5">
                      48 kHz • {channelShortLabel} • โหลดไวและประหยัดเน็ต
                    </span>
                  </div>
                  {!isHiResActive && <Check className="w-4.5 h-4.5 text-[#FF7A00] shrink-0" />}
                </button>
              </div>
            </motion.div>
          )}

          {/* Tab: Playback Speed Submenu */}
          {activeMenuTab === 'speed' && (
            <motion.div key="speed" {...panelMotionProps} className="flex flex-col w-full">
              <div className="px-2 py-1.5 border-b border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('main')}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition cursor-pointer group text-left"
                >
                  <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-200 group-hover:text-white">
                    เลือกความเร็วการเล่น
                  </span>
                </button>
              </div>
              <div className="py-1">
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
                    className="w-full flex items-center justify-between px-4.5 py-2.5 hover:bg-white/10 text-left transition font-mono cursor-pointer border-t border-white/5 first:border-t-0"
                  >
                    <span className={`text-[13.5px] ${playbackRate === rate ? 'text-[#FF7A00] font-bold' : 'text-zinc-200'}`}>
                      {rate === 1 ? 'ปกติ (1x)' : `${rate}x`}
                    </span>
                    {playbackRate === rate && <Check className="w-4.5 h-4.5 text-[#FF7A00] shrink-0" />}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Tab: Aspect Ratio Submenu */}
          {activeMenuTab === 'aspect' && (
            <motion.div key="aspect" {...panelMotionProps} className="flex flex-col w-full">
              <div className="px-2 py-1.5 border-b border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('main')}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition cursor-pointer group text-left"
                >
                  <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-200 group-hover:text-white">
                    เลือกสัดส่วนภาพ
                  </span>
                </button>
              </div>
              <div className="py-1">
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
                    className="w-full flex items-center justify-between px-4.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5 first:border-t-0"
                  >
                    <div className="flex flex-col">
                      <span className={`text-[13.5px] ${aspectMode === item.key ? 'text-[#FF7A00] font-bold' : 'text-zinc-200 font-medium'}`}>
                        {item.label}
                      </span>
                      <span className="text-[11px] text-zinc-400 mt-0.5">{item.desc}</span>
                    </div>
                    {aspectMode === item.key && <Check className="w-4.5 h-4.5 text-[#FF7A00] shrink-0" />}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Tab: Version Submenu (Desktop) */}
          {activeMenuTab === 'version' && hasMultipleVersions && (
            <motion.div key="version" {...panelMotionProps} className="flex flex-col w-full">
              <div className="px-2 py-1.5 border-b border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveMenuTab?.('main')}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-zinc-300 hover:text-white hover:bg-white/10 transition cursor-pointer group text-left"
                >
                  <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-200 group-hover:text-white">
                    เลือกเวอร์ชันวิดีโอ
                  </span>
                </button>
              </div>
              <div className="py-1 max-h-[280px] overflow-y-auto">
                {playableVersions.map((ver) => {
                  const isSelected = activeVersion?.id
                    ? ver.id === activeVersion.id
                    : ver.versionKey === activeVersion?.versionKey;
                  const metaParts = [ver.aspectLabel, ver.resolution].filter(Boolean);
                  return (
                    <button
                      key={ver.id ?? ver.versionKey}
                      type="button"
                      disabled={isSwitchingVersion}
                      onClick={() => {
                        if (!isSelected) {
                          onSelectVersion?.(ver);
                          showToast?.(`สลับเป็นเวอร์ชัน: ${ver.label || ver.badge || 'ปกติ'}`);
                        }
                        setShowSettingsMenu?.(false);
                        resetControlsTimer?.();
                      }}
                      className="w-full flex items-center justify-between gap-3 px-4.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5 first:border-t-0 disabled:opacity-60"
                    >
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[13.5px] ${isSelected ? 'text-[#FF7A00] font-bold' : 'text-zinc-200 font-medium'}`}>
                            {ver.label || 'เวอร์ชัน'}
                          </span>
                          {ver.badge && (
                            <span className={`text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              isSelected
                                ? 'bg-[#FF7A00]/20 text-[#FF7A00] border border-[#FF7A00]/40'
                                : 'bg-white/10 text-zinc-300 border border-white/10'
                            }`}>
                              {ver.badge}
                            </span>
                          )}
                        </div>
                        {(metaParts.length > 0 || ver.description) && (
                          <span className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">
                            {[metaParts.join(' • '), ver.description].filter(Boolean).join(' — ')}
                          </span>
                        )}
                      </div>
                      {isSelected && <Check className="w-4.5 h-4.5 text-[#FF7A00] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
          </AnimatedMenuBody>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
