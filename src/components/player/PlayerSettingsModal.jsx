'use client';

import React from 'react';
import { ChevronRight, Check } from 'lucide-react';

export default function PlayerSettingsModal({
  showSettingsMenu,
  setShowSettingsMenu,
  settingsMenuRef,
  settingsPlacement = 'bottom',
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
  if (!showSettingsMenu) return null;

  return (
    <div
      ref={settingsMenuRef}
      className={`absolute ${
        settingsPlacement === 'top'
          ? 'top-14 right-3 sm:right-6'
          : 'bottom-18 right-3 sm:right-6'
      } bg-[#18181B]/65 border border-white/15 rounded-2xl py-1.5 w-56 text-xs text-zinc-200 z-40 shadow-2xl overflow-hidden backdrop-blur-md`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Tab: Main Menu */}
      {activeMenuTab === 'main' && (
        <div className="flex flex-col">
          <button
            type="button"
            disabled={levels.length <= 1}
            onClick={() => setActiveMenuTab?.('quality')}
            className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 transition disabled:opacity-50 cursor-pointer"
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
            className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer"
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
            className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer"
          >
            <span className="text-zinc-300">สัดส่วนวิดีโอ</span>
            <span className="text-amber-400 flex items-center gap-1 uppercase font-semibold">
              {aspectMode === 'crop' ? 'ตัดขอบดำ' : aspectMode === 'fill' ? 'เต็มจอ' : 'พอดี'}
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            </span>
          </button>
        </div>
      )}

      {/* Tab: Quality (ABR / Resolutions) */}
      {activeMenuTab === 'quality' && (
        <div className="flex flex-col max-h-56 overflow-y-auto">
          <div className="px-3.5 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
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
            className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer"
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
                  className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition font-mono cursor-pointer"
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

      {/* Tab: Playback Speed */}
      {activeMenuTab === 'speed' && (
        <div>
          <div className="px-3.5 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
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
              className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition font-mono cursor-pointer"
            >
              <span className={playbackRate === rate ? 'text-[#FF7A00] font-semibold' : ''}>
                {rate === 1 ? 'ปกติ (1x)' : `${rate}x`}
              </span>
              {playbackRate === rate && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
            </button>
          ))}
        </div>
      )}

      {/* Tab: Aspect Ratio Mode */}
      {activeMenuTab === 'aspect' && (
        <div>
          <div className="px-3.5 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
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
              className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer"
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
    </div>
  );
}
