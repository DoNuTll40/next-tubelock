'use client';

import React from 'react';
import {
  Play, Pause, Volume2, VolumeX, Volume1, ThumbsUp, ThumbsDown,
  MessageSquare, Share2, MoreHorizontal, Subtitles, Settings,
  PictureInPicture2, Minimize, Maximize, Plus, RotateCw
} from 'lucide-react';
import PlayerScrubber from './PlayerScrubber';
import PlayerTooltip from './PlayerTooltip';
import { getGearBadge } from '@/lib/videoUtils';

export default function PlayerBottomBar({
  showControls,
  isPlaying,
  isScrubbing,
  isMobileView,
  isFullscreen,
  activeTimeDisplay,
  timeDisplayRef,
  togglePlay,
  toggleMute,
  isMuted,
  volume,
  showVolumeSlider,
  setShowVolumeSlider,
  handleVolumeChange,
  isLiked,
  setIsLiked,
  isDisliked,
  setIsDisliked,
  isSaved,
  setIsSaved,
  isAutoplay,
  setIsAutoplay,
  isCcActive,
  setIsCcActive,
  showSettingsMenu,
  setShowSettingsMenu,
  setSettingsPlacement,
  setActiveMenuTab,
  activeLevelLabel,
  togglePiP,
  aspectMode,
  cycleAspectMode,
  toggleFullscreen,
  toggleOrientation,
  setContextMenu,
  showToast,
  // Scrubber props:
  seekTrackRef,
  scrubPreviewRef,
  scrubThumbSdRef,
  scrubThumbHdRef,
  scrubBadgeRef,
  bufferBarRef,
  progressBarRef,
  scrubberKnobRef,
  isHoveringSeek,
  setIsHoveringSeek,
  previewPercent,
  hoverPercent,
  previewTime,
  hoverTime,
  videoRatio,
  poster,
  initialBufferPct,
  activeScrubPercent,
  handlePointerDown,
  handleSeekMouseMove,
  handlePointerUp,
  calculateScrubPosition,
  latestScrubTimeRef,
  commitSeek,
  setIsScrubbing,
  isScrubbingRef,
}) {
  const gearBadge = getGearBadge(activeLevelLabel);

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 px-2.5 sm:px-6 pb-2 sm:pb-3 pt-6 sm:pt-8 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col gap-0 sm:gap-1.5 sm:gap-0 z-30 transition-all duration-200 ${showControls || !isPlaying || isScrubbing
        ? 'opacity-100 pointer-events-auto translate-y-0'
        : 'opacity-0 pointer-events-none translate-y-1'
        }`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Seekbar with Direct DOM Updates */}
      <PlayerScrubber
        seekTrackRef={seekTrackRef}
        scrubPreviewRef={scrubPreviewRef}
        scrubThumbSdRef={scrubThumbSdRef}
        scrubThumbHdRef={scrubThumbHdRef}
        scrubBadgeRef={scrubBadgeRef}
        bufferBarRef={bufferBarRef}
        progressBarRef={progressBarRef}
        scrubberKnobRef={scrubberKnobRef}
        isScrubbing={isScrubbing}
        isHoveringSeek={isHoveringSeek}
        setIsHoveringSeek={setIsHoveringSeek}
        previewPercent={previewPercent}
        hoverPercent={hoverPercent}
        previewTime={previewTime}
        hoverTime={hoverTime}
        videoRatio={videoRatio}
        poster={poster}
        initialBufferPct={initialBufferPct}
        activeScrubPercent={activeScrubPercent}
        handlePointerDown={handlePointerDown}
        handleSeekMouseMove={handleSeekMouseMove}
        handlePointerUp={handlePointerUp}
        calculateScrubPosition={calculateScrubPosition}
        latestScrubTimeRef={latestScrubTimeRef}
        commitSeek={commitSeek}
        setIsScrubbing={setIsScrubbing}
        isScrubbingRef={isScrubbingRef}
        isMobileView={isMobileView}
      />

      {/* Bottom Bar: Desktop vs Mobile */}
      {!isMobileView ? (
        /* ============================================================ */
        /* PC DESKTOP BOTTOM BAR                                        */
        /* ============================================================ */
        <div className="flex items-center justify-between text-white text-sm pt-1.5 px-1 sm:px-2 select-none">
          {/* Left Controls: Play/Pause, Volume + Hover Slider, Time Display */}
          <div className="flex items-center gap-2.5">
            {/* Play/Pause */}
            <PlayerTooltip
              text={isPlaying ? 'หยุดชั่วคราว' : 'เล่น'}
              hotkey="k"
              align="left"
              minWidth="116px"
            >
              <button
                type="button"
                onClick={togglePlay}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/15 active:scale-90 transition cursor-pointer shrink-0"
              >
                {isPlaying ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white ml-0.5" />}
              </button>
            </PlayerTooltip>

            {/* YouTube Expandable Volume Slider */}
            <div
              className="flex items-center group/vol relative"
              onMouseEnter={() => setShowVolumeSlider?.(true)}
              onMouseLeave={() => setShowVolumeSlider?.(false)}
            >
              <PlayerTooltip text={isMuted || volume === 0 ? 'เปิดเสียง' : 'ปิดเสียง'} hotkey="m" align="center">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/15 transition cursor-pointer shrink-0"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-5.5 h-5.5 fill-white text-white" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-5.5 h-5.5 fill-white text-white" />
                  ) : (
                    <Volume2 className="w-5.5 h-5.5 fill-white text-white" />
                  )}
                </button>
              </PlayerTooltip>

              <div
                className={`overflow-hidden transition-all duration-200 flex items-center ${showVolumeSlider ? 'w-24 sm:w-28 opacity-100 ml-1.5 h-7 bg-white/15 hover:bg-white/20 border border-white/15 backdrop-blur-md px-2.5 rounded-full' : 'w-0 opacity-0 pointer-events-none'
                  }`}
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-full h-1 bg-white/35 rounded-full cursor-pointer accent-white appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white"
                />
              </div>
            </div>

            {/* Time Display */}
            <span
              ref={timeDisplayRef}
              className="h-7 px-2.5 flex items-center justify-center rounded-full bg-white/15 border border-white/15 backdrop-blur-md font-mono text-[12px] sm:text-[12.5px] text-white/95 select-none font-medium ml-1 shadow-xs shrink-0"
            >
              {activeTimeDisplay}
            </span>
          </div>

          {/* Right Controls: Desktop Fullscreen vs Desktop Windowed */}
          <div className="flex items-center gap-1.5">
            {/* On PC Fullscreen: Like, Dislike, Comment, Share, More */}
            {isFullscreen && (
              <div className="flex items-center gap-1.5 mr-2 border-r border-white/15 pr-2.5">
                <PlayerTooltip text="ถูกใจ" align="center">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isLiked;
                      setIsLiked(next);
                      if (next && isDisliked) setIsDisliked(false);
                      showToast?.(next ? 'ถูกใจวิดีโอแล้ว' : 'ยกเลิกการถูกใจ');
                    }}
                    className={`p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${isLiked ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
                      }`}
                  >
                    <ThumbsUp className="w-5 h-5" />
                  </button>
                </PlayerTooltip>

                <PlayerTooltip text="ไม่ชอบ" align="center">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isDisliked;
                      setIsDisliked(next);
                      if (next && isLiked) setIsLiked(false);
                      showToast?.(next ? 'ไม่ชอบวิดีโอ' : 'ยกเลิก');
                    }}
                    className={`p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${isDisliked ? 'text-zinc-400 bg-white/15' : 'text-zinc-200 hover:text-white'
                      }`}
                  >
                    <ThumbsDown className="w-5 h-5" />
                  </button>
                </PlayerTooltip>

                <PlayerTooltip text="ความคิดเห็น" align="center">
                  <button
                    type="button"
                    onClick={() => showToast?.('ส่วนความคิดเห็น')}
                    className="p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                  >
                    <MessageSquare className="w-5 h-5" />
                  </button>
                </PlayerTooltip>

                <PlayerTooltip text="แชร์วิดีโอ" align="center">
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        navigator.clipboard.writeText(window.location.href);
                        showToast?.('คัดลอกลิงก์วิดีโอแล้ว');
                      }
                    }}
                    className="p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                  >
                    <Share2 className="w-5 h-5" />
                  </button>
                </PlayerTooltip>

                <PlayerTooltip text="เพิ่มเติม" align="center">
                  <button
                    type="button"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setContextMenu?.({ x: rect.left, y: Math.max(10, rect.top - 180) });
                    }}
                    className="p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                  >
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                </PlayerTooltip>
              </div>
            )}

            {/* Autoplay Switch (Original Design) */}
            <PlayerTooltip text="เล่นถัดไปอัตโนมัติ" badge="เร็วๆ นี้" align="center" className="mr-1">
              <button
                type="button"
                onClick={() => {
                  showToast?.('เล่นวิดีโอถัดไปอัตโนมัติ (Coming soon)');
                }}
                className="relative inline-flex h-5.5 w-10 items-center rounded-full transition-colors cursor-pointer bg-white/20 hover:bg-white/35"
              >
                <span className="inline-flex items-center justify-center h-4 w-4 transform rounded-full transition-transform translate-x-1 bg-white/90">
                  <Play className="w-2 h-2 fill-current text-zinc-900 ml-0.5" />
                </span>
              </button>
            </PlayerTooltip>

            {/* CC (Subtitles) */}
            <PlayerTooltip text={isCcActive ? 'ปิดคำบรรยาย' : 'คำบรรยาย'} hotkey="c" align="center">
              <button
                type="button"
                onClick={() => {
                  setIsCcActive(!isCcActive);
                  showToast?.(isCcActive ? 'ปิดคำบรรยาย' : 'ยังไม่มีไฟล์คำบรรยาย (CC)');
                }}
                className={`p-2 rounded-xl hover:bg-white/15 transition cursor-pointer ${isCcActive ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
                  }`}
              >
                <Subtitles className="w-5.5 h-5.5" />
              </button>
            </PlayerTooltip>

            {/* Settings Gear */}
            <PlayerTooltip text="การตั้งค่า" align="center" disabled={showSettingsMenu}>
              <button
                type="button"
                data-settings-btn="true"
                onClick={() => {
                  setSettingsPlacement?.('bottom');
                  setShowSettingsMenu(!showSettingsMenu);
                  setActiveMenuTab?.('main');
                }}
                className={`relative p-2 rounded-xl transition cursor-pointer ${showSettingsMenu ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white hover:bg-white/15'
                  }`}
              >
                <Settings className="w-5.5 h-5.5" />
                {gearBadge && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white font-extrabold text-[8px] leading-tight px-1.5 py-0.5 rounded shadow pointer-events-none tracking-tight">
                    {gearBadge}
                  </span>
                )}
              </button>
            </PlayerTooltip>

            {/* Miniplayer (PiP) */}
            {!isFullscreen && (
              <PlayerTooltip text="เล่นแบบหน้าต่างลอย" hotkey="p" align="center">
                <button
                  type="button"
                  onClick={togglePiP}
                  className="p-2 rounded-xl text-zinc-200 hover:text-white hover:bg-white/15 transition cursor-pointer"
                >
                  <PictureInPicture2 className="w-5.5 h-5.5" />
                </button>
              </PlayerTooltip>
            )}

            {/* Fullscreen Toggle */}
            <PlayerTooltip text={isFullscreen ? 'ออกจากเต็มจอ' : 'เต็มจอ'} hotkey="f" align="right">
              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-2 rounded-xl text-white hover:bg-white/15 transition cursor-pointer active:scale-90"
              >
                {isFullscreen ? <Minimize className="w-5.5 h-5.5" /> : <Maximize className="w-5.5 h-5.5" />}
              </button>
            </PlayerTooltip>
          </div>
        </div>
      ) : isFullscreen ? (
        /* ============================================================ */
        /* MOBILE FULLSCREEN BOTTOM BAR                                 */
        /* ============================================================ */
        <div className="flex items-center justify-between text-white text-xs pt-1 px-1">
          {/* Left Action Buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            <span
              ref={timeDisplayRef}
              className="px-2.5 py-1 rounded-full bg-[#1f1f1f]/70 border border-white/15 backdrop-blur-md text-[11.5px] sm:text-xs font-mono font-semibold text-white/95 shadow-sm select-none shrink-0"
            >
              {activeTimeDisplay}
            </span>

            {/* Like */}
            <button
              type="button"
              onClick={() => {
                const next = !isLiked;
                setIsLiked(next);
                if (next && isDisliked) setIsDisliked(false);
                showToast?.(next ? 'ถูกใจวิดีโอแล้ว' : 'ยกเลิกการถูกใจ');
              }}
              className={`p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${isLiked ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
                }`}
              title="ถูกใจ"
            >
              <ThumbsUp className="w-5 h-5" />
            </button>

            {/* Dislike */}
            <button
              type="button"
              onClick={() => {
                const next = !isDisliked;
                setIsDisliked(next);
                if (next && isLiked) setIsLiked(false);
                showToast?.(next ? 'ไม่ชอบวิดีโอ' : 'ยกเลิก');
              }}
              className={`p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${isDisliked ? 'text-zinc-400 bg-white/15' : 'text-zinc-200 hover:text-white'
                }`}
            >
              <ThumbsDown className="w-5 h-5" />
            </button>

            {/* Comments */}
            <button
              type="button"
              onClick={() => showToast?.('ส่วนความคิดเห็น')}
              className="p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
            >
              <MessageSquare className="w-5 h-5" />
            </button>

            {/* Save */}
            <button
              type="button"
              onClick={() => {
                const next = !isSaved;
                setIsSaved(next);
                showToast?.(next ? 'บันทึกในเพลย์ลิสต์แล้ว' : 'นำออกจากเพลย์ลิสต์');
              }}
              className={`p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${isSaved ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
                }`}
            >
              <Plus className="w-5 h-5" />
            </button>

            {/* Share */}
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  navigator.clipboard.writeText(window.location.href);
                  showToast?.('คัดลอกลิงก์วิดีโอแล้ว');
                }
              }}
              className="p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
            >
              <Share2 className="w-5 h-5" />
            </button>

            {/* More */}
            <button
              type="button"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenu?.({ x: rect.left, y: Math.max(10, rect.top - 180) });
              }}
              className="p-2 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>

          {/* Right: Rotate + Exit Fullscreen */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {toggleOrientation && (
              <button
                type="button"
                onClick={toggleOrientation}
                className="p-2 rounded-xl bg-black/40 hover:bg-white/15 border border-white/15 backdrop-blur-md text-white transition active:scale-90 cursor-pointer shadow-xs"
              >
                <RotateCw className="w-5 h-5" />
              </button>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-2 rounded-xl bg-black/40 hover:bg-white/15 border border-white/15 backdrop-blur-md text-white transition active:scale-90 cursor-pointer shadow-xs"
            >
              <Minimize className="w-5.5 h-5.5" />
            </button>
          </div>
        </div>
      ) : (
        /* ============================================================ */
        /* MOBILE PORTRAIT BOTTOM BAR                                   */
        /* ============================================================ */
        <div className="flex items-center justify-between text-white text-xs pt-1">
          <span
            ref={timeDisplayRef}
            className="px-2.5 py-1 rounded-full bg-black/50 border border-white/15 backdrop-blur-md text-[11.5px] sm:text-xs font-mono font-semibold text-white/95 shadow-sm select-none"
          >
            {activeTimeDisplay}
          </span>

          <div className="flex items-center gap-1.5">
            {toggleOrientation && (
              <button
                type="button"
                onClick={toggleOrientation}
                className="p-1.5 rounded-xl bg-black/50 hover:bg-white/15 border border-white/15 backdrop-blur-md text-white transition active:scale-90 cursor-pointer shadow-xs"
                title="หมุนหน้าจอ"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 rounded-xl bg-black/50 hover:bg-white/15 border border-white/15 backdrop-blur-md text-white transition active:scale-90 cursor-pointer shadow-xs"
              title="เต็มจอ"
            >
              <Maximize className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
