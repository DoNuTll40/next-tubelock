'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight, Check, ArrowLeft, X, Sliders, Gauge, Maximize2, RotateCcw
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

  const getHeaderTitle = () => {
    if (activeSubOpt) return activeSubOpt.title;
    if (activeMenuTab === 'subtitle_options') return 'ตัวเลือก';
    if (activeMenuTab === 'subtitles') return 'คำบรรยาย';
    if (activeMenuTab === 'quality') return 'คุณภาพของวิดีโอ';
    if (activeMenuTab === 'speed') return 'ความเร็วในการเล่น';
    if (activeMenuTab === 'aspect') return 'สัดส่วนภาพ';
    return 'การตั้งค่า';
  };

  // ==========================================
  // 📱 MOBILE BOTTOM SHEET (YOUTUBE NATIVE STYLE)
  // ==========================================
  if (isMobile) {
    if (!mounted || !portalTarget) return null;

    return createPortal(
      <AnimatePresence>
        {showSettingsMenu && (
          <div
            className={`${isFullscreen ? 'absolute' : 'fixed'} inset-0 z-[9999] flex flex-col justify-end overflow-hidden`}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/65"
              onClick={() => setShowSettingsMenu?.(false)}
            />

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
              className="relative z-10 w-full max-w-lg mx-auto bg-black/45 backdrop-blur-xl text-[#F1F1F1] rounded-t-2xl pb-7 pt-2 shadow-2xl border-t border-white/15 select-none overflow-hidden will-change-transform"
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
                    onClick={() => setShowSettingsMenu?.(false)}
                    className="p-1 rounded-full hover:bg-white/10 active:bg-white/20 text-zinc-400 hover:text-white cursor-pointer"
                    title="ปิด"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
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
                          {currentLevelIndex === -1 ? `อัตโนมัติ (${activeLevelLabel})` : activeLevelLabel}
                        </span>
                        {levels.length > 1 && <ChevronRight className="w-4 h-4 text-zinc-400" />}
                      </div>
                    </button>

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
                  </motion.div>
                )}

                {/* Tab: Subtitles Track Selector */}
                {activeMenuTab === 'subtitles' && (
                  <motion.div
                    key="subtitles"
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.12 }}
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
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col max-h-[58vh] overflow-y-auto py-1"
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
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col max-h-[55vh] overflow-y-auto py-1"
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
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col max-h-[55vh] overflow-y-auto py-1"
                  >
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
          } bg-black/65 border border-white/15 rounded-2xl py-1.5 ${
            isWideSubtitlePanel ? 'w-96 sm:w-[420px]' : 'w-80 sm:w-[325px]'
          } text-zinc-200 z-40 shadow-[0_16px_40px_rgba(0,0,0,0.65)] backdrop-blur-md overflow-hidden select-none will-change-transform transition-[width] duration-150`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Tab: Main Menu */}
          {activeMenuTab === 'main' && (
            <div className="flex flex-col">
              {/* Quality Item */}
              <button
                type="button"
                disabled={levels.length <= 1}
                onClick={() => setActiveMenuTab?.('quality')}
                className="w-full flex items-center justify-between px-4.5 py-3 hover:bg-white/10 transition disabled:opacity-50 cursor-pointer group"
              >
                <div className="flex items-center gap-3 shrink-0">
                  <Sliders className="w-4.5 h-4.5 text-zinc-400 group-hover:text-zinc-200 transition shrink-0" />
                  <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">คุณภาพ</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono min-w-0">
                  <span className="text-[13px] text-[#FF7A00] font-semibold truncate max-w-[155px] text-right whitespace-nowrap">
                    {currentLevelIndex === -1 ? `อัตโนมัติ (${activeLevelLabel})` : activeLevelLabel}
                  </span>
                  {levels.length > 1 && <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />}
                </div>
              </button>

              {/* Subtitles (CC) Item */}
              <button
                type="button"
                onClick={() => setActiveMenuTab?.('subtitles')}
                className="w-full flex items-center justify-between px-4.5 py-3 hover:bg-white/10 transition border-t border-white/5 cursor-pointer group"
              >
                <div className="flex items-center gap-3 shrink-0">
                  <CcSubtitleIcon
                    active={false}
                    className="w-4.5 h-4.5 text-zinc-400 group-hover:text-zinc-200 transition shrink-0"
                  />
                  <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">คำบรรยาย</span>
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[13px] text-[#FF7A00] font-semibold truncate max-w-[155px] text-right whitespace-nowrap">
                    {isCcActive && hasSubtitles ? (activeSubTrack?.label || 'ไทย (สร้างอัตโนมัติ)') : 'ปิด'}
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </div>
              </button>

              {/* Speed Item */}
              <button
                type="button"
                onClick={() => setActiveMenuTab?.('speed')}
                className="w-full flex items-center justify-between px-4.5 py-3 hover:bg-white/10 transition border-t border-white/5 cursor-pointer group"
              >
                <div className="flex items-center gap-3 shrink-0">
                  <Gauge className="w-4.5 h-4.5 text-zinc-400 group-hover:text-zinc-200 transition shrink-0" />
                  <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">ความเร็ว</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono">
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
                className="w-full flex items-center justify-between px-4.5 py-3 hover:bg-white/10 transition border-t border-white/5 cursor-pointer group"
              >
                <div className="flex items-center gap-3 shrink-0">
                  <Maximize2 className="w-4.5 h-4.5 text-zinc-400 group-hover:text-zinc-200 transition shrink-0" />
                  <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">สัดส่วนวิดีโอ</span>
                </div>
                <div className="flex items-center gap-1.5">
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
                className="w-full flex items-center justify-between px-4.5 py-3 hover:bg-white/10 transition border-t border-white/5 cursor-pointer group"
              >
                <div className="flex items-center gap-3 shrink-0">
                  <AmbientModeIcon className="w-5 h-5 text-zinc-400 group-hover:text-white transition shrink-0" />
                  <span className="text-[13.5px] text-zinc-200 font-medium whitespace-nowrap">โหมด Ambient</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] text-zinc-400 font-medium whitespace-nowrap">
                    {ambientMode ? 'เปิด' : 'ปิด'}
                  </span>
                  <div className={`w-8 h-4.5 rounded-full transition-colors flex items-center px-0.5 ${ambientMode ? 'bg-[#FF7A00]' : 'bg-white/20'}`}>
                    <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${ambientMode ? 'translate-x-3.5' : 'translate-x-0'}`} />
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Tab: Subtitles Track Selector (with top-right "ตัวเลือก" button like YouTube) */}
          {activeMenuTab === 'subtitles' && (
            <div className="flex flex-col">
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
            </div>
          )}

          {/* Tab: YouTube Subtitle Options (< ตัวเลือก) */}
          {activeMenuTab === 'subtitle_options' && (
            <div className="flex flex-col">
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
            </div>
          )}

          {/* Tab: Specific Subtitle Property Picker (subtitle_opt_*) */}
          {activeSubOpt && (
            <div className="flex flex-col">
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
            </div>
          )}

          {/* Tab: Quality Submenu */}
          {activeMenuTab === 'quality' && (
            <div className="flex flex-col">
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
                {[...levels]
                  .sort((a, b) => (b.height || 0) - (a.height || 0))
                  .map((lvl) => {
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
            </div>
          )}

          {/* Tab: Playback Speed Submenu */}
          {activeMenuTab === 'speed' && (
            <div className="flex flex-col">
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
            </div>
          )}

          {/* Tab: Aspect Ratio Submenu */}
          {activeMenuTab === 'aspect' && (
            <div className="flex flex-col">
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
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
