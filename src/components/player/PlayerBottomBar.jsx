'use client';

import React from 'react';
import {
  Play, Pause, Volume2, VolumeX, Volume1, ThumbsUp, ThumbsDown,
  MessageSquare, Share2, MoreHorizontal, Subtitles, Settings,
  PictureInPicture2, Crop, Scan, Expand, Minimize, Maximize, Plus
} from 'lucide-react';
import PlayerScrubber from './PlayerScrubber';

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
  const is4K = activeLevelLabel?.includes?.('4K') || false;
  const isHD = activeLevelLabel?.includes?.('1080') || activeLevelLabel?.includes?.('720') || activeLevelLabel?.includes?.('HD') || false;

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 px-4 sm:px-6 pb-3 pt-8 bg-gradient-to-t from-black/95 via-black/40 to-transparent flex flex-col gap-2 z-30 transition-all duration-200 ${
        showControls || !isPlaying || isScrubbing
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
        <div className="flex items-center justify-between text-white text-xs pt-1 px-1 sm:px-2 select-none">
          {/* Left Controls: Play/Pause, Volume + Hover Slider, Time Display */}
          <div className="flex items-center gap-2 sm:gap-3.5">
            {/* Play/Pause */}
            <button
              type="button"
              onClick={togglePlay}
              className="active:scale-90 transition cursor-pointer p-1.5 rounded-lg hover:bg-white/15"
              title={isPlaying ? 'หยุดชั่วคราว (k)' : 'เล่น (k)'}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
            </button>

            {/* YouTube Expandable Volume Slider */}
            <div
              className="flex items-center group/vol relative"
              onMouseEnter={() => setShowVolumeSlider?.(true)}
              onMouseLeave={() => setShowVolumeSlider?.(false)}
            >
              <button
                type="button"
                onClick={toggleMute}
                className="cursor-pointer p-1.5 rounded-lg hover:bg-white/15 transition"
                title={isMuted ? 'เปิดเสียง (m)' : 'ปิดเสียง (m)'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5 fill-white text-white" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-5 h-5 fill-white text-white" />
                ) : (
                  <Volume2 className="w-5 h-5 fill-white text-white" />
                )}
              </button>

              <div
                className={`overflow-hidden transition-all duration-200 flex items-center ${
                  showVolumeSlider ? 'w-20 sm:w-24 opacity-100 ml-1' : 'w-0 opacity-0 pointer-events-none'
                }`}
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-full h-1 bg-white/30 rounded-full cursor-pointer accent-white appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white"
                />
              </div>
            </div>

            {/* Time Display */}
            <span ref={timeDisplayRef} className="font-mono text-xs text-zinc-200 select-none font-medium ml-1">
              {activeTimeDisplay}
            </span>
          </div>

          {/* Right Controls: Desktop Fullscreen vs Desktop Windowed */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* On PC Fullscreen: Like, Dislike, Comment, Share, More */}
            {isFullscreen && (
              <div className="flex items-center gap-1 sm:gap-2 mr-2 border-r border-white/15 pr-2">
                <button
                  type="button"
                  onClick={() => {
                    const next = !isLiked;
                    setIsLiked(next);
                    if (next && isDisliked) setIsDisliked(false);
                    showToast?.(next ? 'ถูกใจวิดีโอแล้ว' : 'ยกเลิกการถูกใจ');
                  }}
                  className={`p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${
                    isLiked ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
                  }`}
                  title="ถูกใจ"
                >
                  <ThumbsUp className="w-4.5 h-4.5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !isDisliked;
                    setIsDisliked(next);
                    if (next && isLiked) setIsLiked(false);
                    showToast?.(next ? 'ไม่ชอบวิดีโอ' : 'ยกเลิก');
                  }}
                  className={`p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${
                    isDisliked ? 'text-zinc-400 bg-white/15' : 'text-zinc-200 hover:text-white'
                  }`}
                  title="ไม่ชอบ"
                >
                  <ThumbsDown className="w-4.5 h-4.5" />
                </button>

                <button
                  type="button"
                  onClick={() => showToast?.('ส่วนความคิดเห็น')}
                  className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                  title="ความคิดเห็น"
                >
                  <MessageSquare className="w-4.5 h-4.5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      navigator.clipboard.writeText(window.location.href);
                      showToast?.('คัดลอกลิงก์วิดีโอแล้ว');
                    }
                  }}
                  className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                  title="แชร์วิดีโอ"
                >
                  <Share2 className="w-4.5 h-4.5" />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setContextMenu?.({ x: rect.left, y: Math.max(10, rect.top - 180) });
                  }}
                  className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                  title="เพิ่มเติม"
                >
                  <MoreHorizontal className="w-4.5 h-4.5" />
                </button>
              </div>
            )}

            {/* Autoplay Switch */}
            <button
              type="button"
              onClick={() => {
                const next = !isAutoplay;
                setIsAutoplay(next);
                showToast?.(next ? 'เปิดการเล่นอัตโนมัติ' : 'ปิดการเล่นอัตโนมัติ');
              }}
              className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors cursor-pointer mr-1 ${
                isAutoplay ? 'bg-white' : 'bg-white/30'
              }`}
              title={isAutoplay ? 'การเล่นอัตโนมัติเปิดอยู่' : 'การเล่นอัตโนมัติปิดอยู่'}
            >
              <span
                className={`inline-flex items-center justify-center h-3 w-3 transform rounded-full transition-transform ${
                  isAutoplay ? 'translate-x-4 bg-black' : 'translate-x-1 bg-white'
                }`}
              >
                {isAutoplay ? (
                  <Play className="w-1.5 h-1.5 fill-current text-white" />
                ) : (
                  <Pause className="w-1.5 h-1.5 fill-current text-black" />
                )}
              </span>
            </button>

            {/* CC (Subtitles) */}
            <button
              type="button"
              onClick={() => {
                setIsCcActive(!isCcActive);
                showToast?.(isCcActive ? 'ปิดคำบรรยาย' : 'ยังไม่มีไฟล์คำบรรยาย (CC)');
              }}
              className={`p-1.5 rounded-lg hover:bg-white/15 transition cursor-pointer ${
                isCcActive ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
              }`}
              title="คำบรรยาย (c)"
            >
              <Subtitles className="w-4.5 h-4.5" />
            </button>

            {/* Settings Gear */}
            <button
              type="button"
              data-settings-btn="true"
              onClick={() => {
                setSettingsPlacement?.('bottom');
                setShowSettingsMenu(!showSettingsMenu);
                setActiveMenuTab?.('main');
              }}
              title="การตั้งค่าเครื่องเล่น"
              className={`relative p-1.5 rounded-lg transition cursor-pointer ${
                showSettingsMenu ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white hover:bg-white/15'
              }`}
            >
              <Settings className="w-4.5 h-4.5" />
              {is4K ? (
                <span className="absolute -top-1 -right-1 bg-red-600 text-white font-extrabold text-[7px] leading-tight px-1 py-0.5 rounded shadow pointer-events-none">
                  4K
                </span>
              ) : isHD ? (
                <span className="absolute -top-1 -right-1 bg-red-600 text-white font-extrabold text-[7px] leading-tight px-0.5 py-0.5 rounded shadow pointer-events-none">
                  HD
                </span>
              ) : null}
            </button>

            {/* Miniplayer (PiP) */}
            {!isFullscreen && (
              <button
                type="button"
                onClick={togglePiP}
                title="เล่นแบบหน้าต่างลอย (PiP)"
                className="p-1.5 rounded-lg text-zinc-200 hover:text-white hover:bg-white/15 transition cursor-pointer"
              >
                <PictureInPicture2 className="w-4.5 h-4.5" />
              </button>
            )}

            {/* Aspect Ratio */}
            <button
              type="button"
              onClick={cycleAspectMode}
              title={`สัดส่วน: ${aspectMode.toUpperCase()} (คลิกเพื่อเปลี่ยน)`}
              className={`px-2 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 font-mono uppercase text-[11px] font-semibold ${
                aspectMode !== 'fit' ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white hover:bg-white/15'
              }`}
            >
              {aspectMode === 'crop' ? <Crop className="w-4 h-4" /> : aspectMode === 'fill' ? <Scan className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
              <span>{aspectMode}</span>
            </button>

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'ออกจากเต็มจอ (f)' : 'เต็มจอ (f)'}
              className="p-1.5 rounded-lg text-white hover:bg-white/15 transition cursor-pointer active:scale-90"
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      ) : isFullscreen ? (
        /* ============================================================ */
        /* MOBILE FULLSCREEN BOTTOM BAR                                 */
        /* ============================================================ */
        <div className="flex items-center justify-between text-white text-xs pt-1 px-1">
          {/* Left Action Buttons */}
          <div className="flex items-center gap-1.5">
            <span ref={timeDisplayRef} className="font-mono text-xs text-zinc-200 font-medium mr-1 select-none">
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
              className={`p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${
                isLiked ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
              }`}
              title="ถูกใจ"
            >
              <ThumbsUp className="w-4.5 h-4.5" />
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
              className={`p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${
                isDisliked ? 'text-zinc-400 bg-white/15' : 'text-zinc-200 hover:text-white'
              }`}
              title="ไม่ชอบ"
            >
              <ThumbsDown className="w-4.5 h-4.5" />
            </button>

            {/* Comments */}
            <button
              type="button"
              onClick={() => showToast?.('ส่วนความคิดเห็น')}
              className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
              title="ความคิดเห็น"
            >
              <MessageSquare className="w-4.5 h-4.5" />
            </button>

            {/* Save */}
            <button
              type="button"
              onClick={() => {
                const next = !isSaved;
                setIsSaved(next);
                showToast?.(next ? 'บันทึกในเพลย์ลิสต์แล้ว' : 'นำออกจากเพลย์ลิสต์');
              }}
              className={`p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${
                isSaved ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
              }`}
              title="บันทึกในเพลย์ลิสต์"
            >
              <Plus className="w-4.5 h-4.5" />
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
              className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
              title="แชร์วิดีโอ"
            >
              <Share2 className="w-4.5 h-4.5" />
            </button>

            {/* More */}
            <button
              type="button"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenu?.({ x: rect.left, y: Math.max(10, rect.top - 180) });
              }}
              className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
              title="เพิ่มเติม"
            >
              <MoreHorizontal className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Right: Aspect ratio + Exit Fullscreen */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cycleAspectMode}
              title={`สัดส่วน: ${aspectMode.toUpperCase()}`}
              className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-mono uppercase text-[11px] font-semibold transition active:scale-90 cursor-pointer flex items-center gap-1"
            >
              {aspectMode === 'crop' ? <Crop className="w-4 h-4" /> : aspectMode === 'fill' ? <Scan className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
              <span>{aspectMode}</span>
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              title="ออกจากเต็มจอ"
              className="p-1.5 rounded-lg text-white hover:bg-white/15 transition active:scale-90 cursor-pointer"
            >
              <Minimize className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        /* ============================================================ */
        /* MOBILE PORTRAIT BOTTOM BAR                                   */
        /* ============================================================ */
        <div className="flex items-center justify-between text-white text-xs pt-0.5">
          <span ref={timeDisplayRef} className="font-mono text-xs text-zinc-300 font-medium select-none">
            {activeTimeDisplay}
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cycleAspectMode}
              title={`สัดส่วน: ${aspectMode.toUpperCase()}`}
              className={`p-1.5 rounded-lg transition active:scale-90 flex items-center gap-1 text-[11px] cursor-pointer ${
                aspectMode !== 'fit' ? 'text-[#FF7A00] bg-white/10 font-bold' : 'text-zinc-200'
              }`}
            >
              {aspectMode === 'crop' ? <Crop className="w-4 h-4" /> : aspectMode === 'fill' ? <Scan className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              title="เต็มจอ"
              className="p-1.5 rounded-lg text-white hover:bg-white/15 transition active:scale-90 cursor-pointer"
            >
              <Maximize className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
