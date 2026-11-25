'use client';

import BrowserMediaImage from '@/components/BrowserMediaImage';

export default function PlayerScrubber({
  seekTrackRef,
  scrubPreviewRef,
  scrubThumbSdRef,
  scrubThumbHdRef,
  scrubBadgeRef,
  bufferBarRef,
  hoverBarRef,
  progressBarRef,
  scrubberKnobRef,
  isScrubbing,
  isHoveringSeek,
  setIsHoveringSeek,
  videoRatio = 16 / 9,
  poster,
  handlePointerDown,
  handleSeekMouseMove,
  handlePointerUp,
  isMobileView,
  showSettingsMenu,
  flushBottom = false,
}) {
  // Position, width & preview timestamp are updated 100% via direct DOM refs (zero React re-renders during playback or hover/scrub!)
  const showPreview = (isScrubbing || isHoveringSeek) && !showSettingsMenu;
  const isVertical = videoRatio && videoRatio < 1;

  return (
    <div
      ref={seekTrackRef}
      data-player-seek=""
      onPointerDown={handlePointerDown}
      onPointerMove={handleSeekMouseMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onMouseEnter={(e) => {
        if (!isMobileView && e?.pointerType !== 'touch' && !showSettingsMenu) setIsHoveringSeek?.(true);
      }}
      onMouseLeave={() => setIsHoveringSeek?.(false)}
      className={`relative flex cursor-pointer touch-none group/seek ${
        flushBottom ? 'h-4 items-end py-0' : 'h-6 sm:h-5 items-center py-1'
      }`}
    >
      {/* YouTube-Style Timeline Scrub Preview: Desktop = Thumbnail + Time; Mobile = Crisp Floating Time Badge (full-frame storyboard renders in VideoPlayer!) */}
      <div
        ref={scrubPreviewRef}
        className={`left-0 absolute ${
          flushBottom ? 'bottom-[calc(100%+10px)]' : 'bottom-[calc(100%+14px)]'
        } -translate-x-1/2 flex flex-col items-center pointer-events-none z-50 transition-opacity duration-150 ease-out ${showPreview
          ? (isMobileView ? 'opacity-100 scale-100 translate-y-0' : 'opacity-100 scale-100 translate-y-10 sm:translate-y-2')
          : (isMobileView ? 'opacity-0 scale-95 translate-y-1 pointer-events-none' : 'opacity-0 scale-90 translate-y-10 sm:translate-y-5 pointer-events-none')
          }`}
      >
        {/* Preview Frame Thumbnail Card (Desktop only — Mobile uses full-frame storyboard overlay!) */}
        {!isMobileView && (
          <div
            className={`${isVertical ? 'h-48 sm:h-56 w-auto max-w-[120px]' : 'w-48 sm:w-64 md:w-84 h-auto'
              } rounded-lg overflow-hidden bg-zinc-950 shadow-[0_8px_24px_rgba(0,0,0,0.85)] relative mb-1.5 ring-1 ring-white/75 shrink-0`}
            style={{ aspectRatio: videoRatio || 16 / 9 }}
          >
            {poster && (
              <BrowserMediaImage
                src={poster}
                alt="Thumbnail Preview"
                loading="lazy"
                decoding="async"
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
        )}

        {/* Time Badge (Direct DOM updates only) */}
        <div
          ref={scrubBadgeRef}
          className={
            isMobileView
              ? 'bg-black/85 text-white border border-white/15 px-2.5 py-0.5 rounded-full text-[12px] font-mono font-bold whitespace-nowrap shadow-lg'
              : 'bg-black/25 shadow-lg backdrop-blur-sm text-white border-1 border-white/25 px-2.5 py-0.5 rounded-full text-[14px] font-mono font-bold whitespace-nowrap '
          }
        >
          0:00
        </div>
      </div>

      {/* Progress Background Track */}
      <div
        className={`w-full bg-white/25 overflow-hidden relative pointer-events-none transition-all duration-150 ${
          flushBottom ? 'h-[3px] rounded-none' : 'h-1 group-hover/seek:h-1.5 rounded-full'
        }`}
      >
        {/* Buffer Track (Direct DOM) */}
        <div ref={bufferBarRef} className="absolute left-0 top-0 bottom-0 w-0 bg-white/40" />
        {/* Hover Preview Track (Direct DOM) */}
        <div
          ref={hoverBarRef}
          className={`absolute left-0 top-0 bottom-0 w-0 bg-white/30 transition-opacity duration-75 ${
            isHoveringSeek && !isScrubbing && !showSettingsMenu ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {/* Playback Progress (Direct DOM - TubeLock Orange) */}
        <div ref={progressBarRef} className="absolute left-0 top-0 bottom-0 w-0 bg-[#FF7A00]" />
      </div>

      {/* Scrubber Knob (Direct DOM - TubeLock Orange) */}
      <div
        ref={scrubberKnobRef}
        className={`left-0 absolute -translate-x-1/2 z-50 bg-[#FF7A00] rounded-full shadow-md pointer-events-none transition-transform duration-100 ${
          flushBottom
            ? 'bottom-[1.5px] translate-y-1/2 w-3.5 h-3.5 shadow-[0_0_8px_rgba(255,122,0,0.85)]'
            : 'w-3.5 h-3.5 ring-2 ring-white/90'
        } ${isScrubbing
          ? 'scale-125'
          : showSettingsMenu
            ? 'scale-0'
            : 'scale-100 sm:scale-0 sm:group-hover/seek:scale-100'
          }`}
      />
    </div>
  );
}
