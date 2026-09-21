'use client';

import { formatTime } from './playerUtils';

export default function PlayerScrubber({
  seekTrackRef,
  scrubPreviewRef,
  scrubThumbSdRef,
  scrubThumbHdRef,
  scrubBadgeRef,
  bufferBarRef,
  progressBarRef,
  scrubberKnobRef,
  isScrubbing,
  isHoveringSeek,
  setIsHoveringSeek,
  previewPercent,
  hoverPercent,
  previewTime,
  hoverTime,
  videoRatio = 16 / 9,
  poster,
  initialBufferPct = 0,
  activeScrubPercent = 0,
  handlePointerDown,
  handleSeekMouseMove,
  handlePointerUp,
  isMobileView,
}) {
  // ตำแหน่งและเวลาของ preview: scrubbing > hovering > ค้างที่ตำแหน่ง seek ล่าสุด
  const previewLeft = Math.max(10, Math.min(
    isScrubbing ? previewPercent : isHoveringSeek ? hoverPercent : previewPercent,
    90
  ));
  const previewDisplayTime = isScrubbing ? previewTime : isHoveringSeek ? hoverTime : previewTime;
  const isVertical = videoRatio && videoRatio < 1;

  return (
    <div
      ref={seekTrackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handleSeekMouseMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onMouseEnter={(e) => {
        if (!isMobileView && e?.pointerType !== 'touch') setIsHoveringSeek?.(true);
      }}
      onMouseLeave={() => setIsHoveringSeek?.(false)}
      className="relative flex items-center h-6 sm:h-5 cursor-pointer touch-none group/seek py-1"
    >
      {/* YouTube-Style Timeline Thumbnail Scrub Preview Window */}
      <div
        ref={scrubPreviewRef}
        className={`absolute bottom-[calc(100%+14px)] -translate-x-1/2 flex flex-col items-center pointer-events-none z-40 transition-opacity duration-150 ease-out ${
          isScrubbing || isHoveringSeek
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-90 translate-y-2'
        }`}
        style={{ left: `${previewLeft}%` }}
      >
        {/* Preview Frame Thumbnail Card */}
        <div
          className={`${
            isVertical ? 'h-36 sm:h-44 w-auto max-w-[120px]' : 'w-28 sm:w-44 md:w-52 h-auto'
          } rounded-xl overflow-hidden border-2 border-white/60 bg-zinc-950 shadow-[0_8px_30px_rgba(0,0,0,0.9)] relative mb-1.5 ring-1 ring-black/80 shrink-0`}
          style={{ aspectRatio: videoRatio || 16 / 9 }}
        >
          {poster && (
            <img
              src={poster}
              alt="Thumbnail Preview"
              className="absolute inset-0 w-full h-full object-cover opacity-75"
            />
          )}
          {/* Tier 1: Fast SD Sprite Sheet */}
          <div ref={scrubThumbSdRef} className="absolute inset-0 w-full h-full bg-no-repeat z-10 opacity-0" />
          {/* Tier 2: Sharp HD Sprite Sheet */}
          <div ref={scrubThumbHdRef} className="absolute inset-0 w-full h-full bg-no-repeat z-20 opacity-0 transition-opacity duration-200" />
          {/* Vignette */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10 pointer-events-none z-20" />
        </div>

        {/* Time Badge */}
        <div
          ref={scrubBadgeRef}
          className="bg-black/60 text-white border border-white/20 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold shadow-xl whitespace-nowrap backdrop-blur-md"
        >
          {formatTime(previewDisplayTime)}
        </div>
      </div>

      {/* Progress Background Track */}
      <div className="w-full h-1 group-hover/seek:h-1.5 bg-white/20 rounded-full overflow-hidden relative pointer-events-none transition-all duration-150">
        {/* Buffer Track (Direct DOM) */}
        <div ref={bufferBarRef} className="absolute left-0 top-0 bottom-0 bg-white/40" style={{ width: `${initialBufferPct}%` }} />
        {/* Hover Preview Track */}
        {isHoveringSeek && !isScrubbing && (
          <div className="absolute left-0 top-0 bottom-0 bg-white/30" style={{ width: `${hoverPercent}%` }} />
        )}
        {/* Playback Progress (Direct DOM - TubeLock Orange) */}
        <div ref={progressBarRef} className="absolute left-0 top-0 bottom-0 bg-[#FF7A00]" style={{ width: `${activeScrubPercent}%` }} />
      </div>

      {/* Scrubber Knob (Direct DOM - TubeLock Orange) */}
      <div
        ref={scrubberKnobRef}
        className={`absolute -translate-x-1/2 w-3.5 h-3.5 bg-[#FF7A00] ring-2 ring-white/90 rounded-full shadow-md pointer-events-none transition-transform duration-100 ${
          isScrubbing ? 'scale-125' : 'scale-100 sm:scale-0 sm:group-hover/seek:scale-100'
        }`}
        style={{ left: `${activeScrubPercent}%` }}
      />
    </div>
  );
}
