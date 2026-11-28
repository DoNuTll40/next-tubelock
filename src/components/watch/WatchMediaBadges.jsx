'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { Zap } from 'lucide-react';
import { extractContentAdvisory, extractWatchMediaCapabilities } from '@/lib/mediaBadges.mjs';
import { supportsHdrDisplay } from '@/lib/playerQuality.mjs';

const subscribeNoop = () => () => {};
const getServerDeviceSnapshot = () => false;
const getClientDeviceSnapshot = () => true;

const TONE_CLASSES = {
  dolby: 'bg-[#23272F] text-white border-white/15 dark:bg-[#2B3038] dark:border-white/15',
  orange: 'bg-[#FF7A00]/15 text-[#D96500] border-[#FF7A00]/35 dark:bg-[#FF7A00]/20 dark:text-[#FF9E40] dark:border-[#FF7A00]/40',
  cyan: 'bg-sky-500/15 text-sky-700 border-sky-500/35 dark:bg-sky-400/15 dark:text-sky-300 dark:border-sky-400/35',
  amber: 'bg-amber-500/15 text-amber-800 border-amber-500/35 dark:bg-amber-400/20 dark:text-amber-300 dark:border-amber-400/40',
  rose: 'bg-rose-500/15 text-rose-600 border-rose-500/35 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/40',
  slate: 'bg-[#2B3038]/10 text-[#2B3038] border-black/12 dark:bg-[#2B3038] dark:text-zinc-100 dark:border-white/15',
};

function DolbyDoubleDIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 18 12"
      className="w-[14px] h-[10px] shrink-0 fill-current"
    >
      <path d="M0 1h3.6C6.4 1 8.4 3.1 8.4 6S6.4 11 3.6 11H0V1zm18 0h-3.6C11.6 1 9.6 3.1 9.6 6s2 5 4.8 5H18V1z" />
    </svg>
  );
}

function MediaBadgePill({ badge }) {
  const toneClass = TONE_CLASSES[badge.tone] || TONE_CLASSES.slate;
  const mutedDeviceClass = badge.unsupportedOnDevice ? 'opacity-80' : '';

  return (
    <span
      tabIndex={0}
      aria-label={badge.tooltip}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
      className="relative inline-flex items-center group/badge focus:outline-none"
    >
      {badge.kind === 'dolby' ? (
        <span
          className={`inline-flex items-center gap-1.5 h-[23px] px-2 rounded-[5px] border shadow-2xs select-none ${toneClass} ${mutedDeviceClass}`}
        >
          <DolbyDoubleDIcon />
          <span className="flex flex-col leading-none">
            <span className="text-[8.5px] font-bold tracking-tight leading-[0.95]">Dolby</span>
            <span className="text-[6.5px] font-extrabold tracking-[0.14em] uppercase text-zinc-200 leading-[0.95]">
              {badge.sublabel}
            </span>
          </span>
        </span>
      ) : badge.kind === 'bolt' ? (
        <span
          className={`inline-flex items-center justify-center h-[23px] w-[23px] rounded-[5px] border shadow-2xs select-none ${toneClass}`}
        >
          <Zap aria-hidden="true" className="w-3.5 h-3.5 fill-current" />
        </span>
      ) : (
        <span
          className={`inline-flex items-center justify-center h-[23px] px-2 rounded-[5px] border text-[10.5px] font-extrabold tracking-wide leading-none shadow-2xs select-none ${toneClass} ${mutedDeviceClass}`}
        >
          {badge.label}
        </span>
      )}

      {badge.tooltip && (
        <span
          role="tooltip"
          className="pointer-events-none invisible opacity-0 group-hover/badge:visible group-hover/badge:opacity-100 group-focus-visible/badge:visible group-focus-visible/badge:opacity-100 transition-all duration-150 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-max max-w-[230px] sm:max-w-[270px] rounded-lg bg-[#16181D] text-zinc-100 border border-white/15 px-2.5 py-1.5 text-[11px] font-medium leading-snug shadow-xl whitespace-normal text-center"
        >
          {badge.tooltip}
          <span
            aria-hidden="true"
            className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#16181D]"
          />
        </span>
      )}
    </span>
  );
}

export function WatchHeaderBadges({
  video,
  activeVersion = null,
  streamMeta = null,
  fallbackResBadge = 'HD',
}) {
  const isClient = useSyncExternalStore(
    subscribeNoop,
    getClientDeviceSnapshot,
    getServerDeviceSnapshot
  );

  const deviceSupport = useMemo(() => {
    if (!isClient || typeof window === 'undefined') return null;
    const hdr = supportsHdrDisplay();
    const mse = window.MediaSource;
    return {
      hdr,
      dolbyVision: (codec) => Boolean(hdr && mse?.isTypeSupported?.(`video/mp4;codecs="${codec}"`)),
      atmos: (videoCodec) => Boolean(
        mse?.isTypeSupported?.(`video/mp4;codecs="${videoCodec || 'hvc1.2.4.L150.B0'},ec-3"`)
      ),
    };
  }, [isClient]);

  const { badges } = useMemo(
    () => extractWatchMediaCapabilities(video, { activeVersion, streamMeta, deviceSupport }),
    [video, activeVersion, streamMeta, deviceSupport]
  );

  const advisory = useMemo(() => extractContentAdvisory(video), [video]);

  const displayBadges = badges.length > 0
    ? badges
    : [{
        id: 'fallback-res',
        kind: 'text',
        label: fallbackResBadge || 'HD',
        tone: 'orange',
        tooltip: `ความละเอียด ${fallbackResBadge || 'HD'}`,
      }];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {advisory.headerBadge && (
        <MediaBadgePill
          badge={{
            id: `rating-${advisory.headerBadge.code}`,
            kind: 'text',
            label: advisory.headerBadge.label,
            tone: advisory.headerBadge.tone,
            tooltip: advisory.headerBadge.tooltip,
          }}
        />
      )}
      {advisory.hasFlashingWarning && (
        <MediaBadgePill
          badge={{
            id: 'flashing-bolt',
            kind: 'bolt',
            tone: 'amber',
            tooltip: advisory.flashingTooltip,
          }}
        />
      )}
      {displayBadges.map((badge) => (
        <MediaBadgePill key={badge.id} badge={badge} />
      ))}
    </div>
  );
}

export function WatchContentAdvisory({ video }) {
  const advisory = useMemo(() => extractContentAdvisory(video), [video]);
  if (!advisory.shouldShowExpanded) return null;

  return (
    <div className="flex flex-col gap-2 pb-2.5 border-b border-black/5 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-1.5 select-none">
        <MediaBadgePill
          badge={{
            id: `advisory-rating-${advisory.ratingBadge.code}`,
            kind: 'text',
            label: advisory.ratingBadge.label,
            tone: advisory.ratingBadge.tone,
            tooltip: advisory.ratingBadge.tooltip,
          }}
        />
        {advisory.hasFlashingWarning && (
          <MediaBadgePill
            badge={{
              id: 'advisory-flashing-bolt',
              kind: 'bolt',
              tone: 'amber',
              tooltip: advisory.flashingTooltip,
            }}
          />
        )}
      </div>
      {advisory.descriptorText && (
        <p className="text-[12.5px] leading-relaxed text-[#4B5563] dark:text-zinc-300 font-medium">
          {advisory.descriptorText}
        </p>
      )}
    </div>
  );
}
