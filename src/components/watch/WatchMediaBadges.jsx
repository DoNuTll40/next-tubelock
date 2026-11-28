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

const DOLBY_TOP_LOCKUP_PATH = [
  // Double-D symbol (same 180-unit cap height as 'Dolby')
  'M0 0H27A90 90 0 0 1 27 180H0Z',
  'M258 0H231A90 90 0 0 0 231 180H258Z',
  // 'D'
  'M312 0H376A90 90 0 0 1 376 180H312ZM339 26V154H374A64 64 0 0 0 374 26Z',
  // 'o'
  'M482.5 118A62.5 62.5 0 1 1 607.5 118A62.5 62.5 0 1 1 482.5 118ZM507.5 118A37.5 37.5 0 1 0 582.5 118A37.5 37.5 0 1 0 507.5 118Z',
  // 'l'
  'M626 0H653V180H626Z',
  // 'b'
  'M676 0H703V66.6A62.5 62.5 0 1 1 703 169.4V180H676ZM702 118A37.5 37.5 0 1 0 777 118A37.5 37.5 0 1 0 702 118Z',
  // 'y' with official curved descender hook
  'M801.5 56.5H831.5L866.5 135L902 56.5H931.5L859 219C851 232 838 236 821.5 235C814 234.5 808.5 232 806 228.5L816 204.5C820 206.8 825.5 207.5 831 205.5C836.5 203.5 841 198 845.5 188L852.5 172.5Z',
].join('');

const DOLBY_VISION_BOTTOM_PATH = [
  // V
  'M232 269H246.5L273.5 344L300.5 269H315L279.8 363H267.2Z',
  // I
  'M344 269H357.5V363H344Z',
  // S
  'M416 267.5C427.5 267.5 436.8 271.2 443.2 278.2L434.2 287.2C429.2 282 423 279.4 415.2 279.4C405.6 279.4 399.5 284.2 399.5 291.6C399.5 299 405.2 302.8 418 307.6C434.2 313.8 444.5 320.8 444.5 336.5C444.5 353 431.8 364 413.5 364C399.8 364 389.5 359.2 383.5 351.5L393.2 342.5C398.2 348.6 405.2 352.2 413.8 352.2C424.5 352.2 431.2 346.4 431.2 337.5C431.2 328.8 425 324.6 411.5 319.4C396 313.4 386.5 306.6 386.5 292.2C386.5 277.4 398.6 267.5 416 267.5Z',
  // I
  'M476 269H489.5V363H476Z',
  // O
  'M522 316A48 48 0 1 1 618 316A48 48 0 1 1 522 316ZM535.5 316A34.5 34.5 0 1 0 604.5 316A34.5 34.5 0 1 0 535.5 316Z',
  // N
  'M648 269H660.8L714.5 340.5V269H728V363H715.2L661.5 291.5V363H648Z',
].join('');

const DOLBY_ATMOS_BOTTOM_PATH = [
  // A
  'M354 269H366.8L406.8 363H392.4L383 340.5H337.8L328.4 363H314ZM342.8 328.5H378L360.4 285.2Z',
  // T
  'M414 269H481V281.5H454.2V363H440.8V281.5H414Z',
  // M
  'M504 269H518.5L556 339.2L593.5 269H608V363H594.8V294L561.2 356.5H550.8L517.2 294V363H504Z',
  // O
  'M632 316A48 48 0 1 1 728 316A48 48 0 1 1 632 316ZM645.5 316A34.5 34.5 0 1 0 714.5 316A34.5 34.5 0 1 0 645.5 316Z',
  // S
  'M778 267.5C789.5 267.5 798.8 271.2 805.2 278.2L796.2 287.2C791.2 282 785 279.4 777.2 279.4C767.6 279.4 761.5 284.2 761.5 291.6C761.5 299 767.2 302.8 780 307.6C796.2 313.8 806.5 320.8 806.5 336.5C806.5 353 793.8 364 775.5 364C761.8 364 751.5 359.2 745.5 351.5L755.2 342.5C760.2 348.6 767.2 352.2 775.8 352.2C786.5 352.2 793.2 346.4 793.2 337.5C793.2 328.8 787 324.6 773.5 319.4C758 313.4 748.5 306.6 748.5 292.2C748.5 277.4 760.6 267.5 778 267.5Z',
].join('');

function DolbyBrandLogo({ sublabel }) {
  const bottomPath = String(sublabel || '').toUpperCase() === 'ATMOS'
    ? DOLBY_ATMOS_BOTTOM_PATH
    : DOLBY_VISION_BOTTOM_PATH;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 932 372"
      className="h-[18px] w-auto shrink-0 fill-current"
    >
      <path fillRule="evenodd" clipRule="evenodd" d={DOLBY_TOP_LOCKUP_PATH} />
      <path fillRule="evenodd" clipRule="evenodd" d={bottomPath} opacity="0.94" />
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
          className={`inline-flex items-center justify-center h-[26px] px-2 rounded-[5px] border shadow-2xs select-none ${toneClass} ${mutedDeviceClass}`}
        >
          <DolbyBrandLogo sublabel={badge.sublabel} />
          <span className="sr-only">Dolby {badge.sublabel}</span>
        </span>
      ) : badge.kind === 'bolt' ? (
        <span
          className={`inline-flex items-center justify-center h-[26px] w-[26px] rounded-[5px] border shadow-2xs select-none ${toneClass}`}
        >
          <Zap aria-hidden="true" className="w-3.5 h-3.5 fill-current" />
        </span>
      ) : (
        <span
          className={`inline-flex items-center justify-center h-[26px] px-2 rounded-[5px] border text-[10.5px] font-extrabold tracking-wide leading-none shadow-2xs select-none ${toneClass} ${mutedDeviceClass}`}
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
