'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import {
  ExternalLink,
  Film,
  ListVideo,
  Loader2,
  LockKeyhole,
  MoreVertical,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  X,
} from 'lucide-react';
import { PlaylistVisibility } from './PlaylistCard';
import { extractDominantColor } from '@/lib/colorExtractor';
import { useVideoWatchProgress } from '@/lib/useVideoWatchProgress';
import { usePosterPreference } from '@/lib/usePosterPreference';
import { formatVideoDuration } from '@/lib/videoEditorUtils';
import { isMatureVideo, RESTRICTED_POSTER } from '@/lib/videoUtils';

const desktopQuery = '(min-width: 1024px)';
const getDesktop = () => window.matchMedia(desktopQuery).matches;
const getServerDesktop = () => false;
const subscribeDesktop = (onChange) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const subscribeNoop = () => () => {};
const getClientFlag = () => true;
const getServerClientFlag = () => false;

const loopLabels = {
  none: 'ปิดการเล่นวน',
  all: 'เล่นวนทั้งเพลย์ลิสต์',
  one: 'เล่นวนคลิปนี้',
};

const MATURE_PLAYLIST_COLOR = {
  darkBg: 'hsla(28, 85%, 58%, 0.18)',
  lightBg: 'hsla(28, 85%, 38%, 0.09)',
  headerDarkBg: 'hsla(28, 85%, 58%, 0.10)',
  headerLightBg: 'hsla(28, 85%, 38%, 0.05)',
  accentDark: '#FF9E40',
  accentLight: '#9E4700',
  borderDark: 'hsla(28, 85%, 58%, 0.28)',
  borderLight: 'hsla(28, 85%, 42%, 0.20)',
};

// Material Design 3 motion tokens:
// - Emphasized decelerate (enter / snap-back): cubic-bezier(0.05, 0.7, 0.1, 1)
// - Emphasized accelerate (exit / dismiss):   cubic-bezier(0.3, 0, 0.8, 0.15)
const M3_SHEET_ENTER = 'duration-[380ms] ease-[cubic-bezier(0.05,0.7,0.1,1)]';
const M3_SHEET_EXIT = 'duration-[240ms] ease-[cubic-bezier(0.3,0,0.8,0.15)]';

const panelClass = 'yt-playlist-panel overflow-hidden rounded-2xl border bg-white text-[#212529] shadow-xs dark:bg-[#181818] dark:text-[#F1F1F1]';
const iconButtonClass = 'grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-[#6C655D] hover:bg-black/5 dark:text-[#AAAAAA] dark:hover:bg-white/10';
const morphLineTransition = 'transform 380ms cubic-bezier(0.34, 1.45, 0.64, 1), stroke-dasharray 320ms cubic-bezier(0.4, 0, 0.2, 1), stroke-dashoffset 320ms cubic-bezier(0.4, 0, 0.2, 1)';

function getVideoThumb(video, allow18Plus = false) {
  if (!video) return null;
  if (isMatureVideo(video)) {
    return allow18Plus && video.id ? `/api/videos/${video.id}/poster` : RESTRICTED_POSTER;
  }
  return video.thumbnail_url || (video.id ? `/streams/stream_vid_${video.id}/poster.jpg` : null);
}

/**
 * Kinetic SVG toggle icon that morphs smoothly between:
 * - expanded = true  -> X (collapse / close)
 * - expanded = false -> ChevronDown (direction='down') or ChevronUp (direction='up')
 * Both shapes share two straight strokes of exact lengths 17 and 8.5, so
 * stroke-dasharray + symmetric +/-90deg swivel produces a crisp, zero-distortion morph.
 */
function PlaylistToggleIcon({ expanded, direction = 'down', pulseKey }) {
  const commonStyle = {
    transformBox: 'view-box',
    transformOrigin: '12px 12px',
    strokeDasharray: expanded ? '17 17' : '8.5 17',
    strokeDashoffset: expanded ? 0 : -4.25,
    transition: morphLineTransition,
  };

  const arm1Collapsed = direction === 'up'
    ? 'translate(-3px, -0.5px) rotate(135deg)'
    : 'translate(3px, 0.5px) rotate(135deg)';
  const arm2Collapsed = direction === 'up'
    ? 'translate(3px, -0.5px) rotate(-135deg)'
    : 'translate(-3px, 0.5px) rotate(-135deg)';

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="size-5 overflow-visible transition-transform duration-200 group-hover/toggle:scale-110 group-active/toggle:scale-90 motion-reduce:transition-none"
    >
      {pulseKey > 0 && (
        <circle
          key={pulseKey}
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="1.5"
          className="yt-playlist-accent animate-playlist-ring pointer-events-none"
        />
      )}
      <line
        x1="3.5"
        y1="12"
        x2="20.5"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        className="motion-reduce:transition-none"
        style={{
          ...commonStyle,
          transform: expanded ? 'translate(0px, 0px) rotate(45deg)' : arm1Collapsed,
        }}
      />
      <line
        x1="3.5"
        y1="12"
        x2="20.5"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        className="motion-reduce:transition-none"
        style={{
          ...commonStyle,
          transform: expanded ? 'translate(0px, 0px) rotate(-45deg)' : arm2Collapsed,
        }}
      />
    </svg>
  );
}

function PlaylistRow({ video, index, active, rowRef, onSelect, onColorExtracted }) {
  const { progressPct } = useVideoWatchProgress(video);
  const imgRef = useRef(null);
  const [failedCorsSrc, setFailedCorsSrc] = useState(null);
  const [rowColor, setRowColor] = useState(null);

  const videoId = video.id;
  const mature = isMatureVideo(video);
  const allow18Plus = usePosterPreference(mature);
  const isMasked = mature && !allow18Plus;
  const thumbnail = getVideoThumb(video, allow18Plus);
  const duration = Number(video.duration);
  const canSample = Boolean(!isMasked && thumbnail && failedCorsSrc !== thumbnail);

  const sampleColor = useCallback((el, notifyParent = false) => {
    if (isMasked) return;
    const target = el || imgRef.current;
    if (!target || !target.complete || !target.naturalWidth) return;
    const extracted = extractDominantColor(target);
    if (!extracted) return;
    setRowColor((prev) => (prev === extracted ? prev : extracted));
    if (notifyParent && videoId) {
      onColorExtracted?.(videoId, extracted);
    }
  }, [isMasked, videoId, onColorExtracted]);

  // Eagerly extract color for the currently playing video (even if image is cached or sheet starts closed)
  useEffect(() => {
    if (!active || !canSample) return;
    const raf = requestAnimationFrame(() => {
      sampleColor(imgRef.current, true);
    });
    return () => cancelAnimationFrame(raf);
  }, [active, canSample, thumbnail, sampleColor]);

  const effectiveRowColor = isMasked ? MATURE_PLAYLIST_COLOR : rowColor;
  const rowHoverStyle = !active && effectiveRowColor ? {
    '--hover-tint-dark': effectiveRowColor.darkBg,
    '--hover-tint-light': effectiveRowColor.lightBg,
  } : undefined;

  return (
    <li ref={rowRef}>
      <button
        type="button"
        onClick={() => {
          sampleColor(imgRef.current, true);
          onSelect(index);
        }}
        onMouseEnter={() => sampleColor(imgRef.current, active)}
        onFocus={() => sampleColor(imgRef.current, active)}
        aria-current={active ? 'true' : undefined}
        style={rowHoverStyle}
        className={`flex w-full cursor-pointer items-center gap-2.5 border-l-2 px-2.5 py-2 text-left ${active
            ? 'yt-playlist-active-row'
            : 'border-transparent yt-card-hover'
          }`}
      >
        <span className="grid w-6 shrink-0 place-items-center font-mono text-xs text-[#6C655D] dark:text-[#AAAAAA]">
          {active ? (
            <>
              <span className="sr-only">{index + 1}</span>
              <Play className="yt-playlist-accent size-3.5 fill-current" aria-hidden="true" />
            </>
          ) : index + 1}
        </span>
        <span className="relative grid aspect-video w-[100px] shrink-0 place-items-center overflow-hidden rounded-lg bg-[#222222] text-white">
          {thumbnail ? (
            <Image
              ref={imgRef}
              key={canSample ? `sample-${thumbnail}` : `display-${thumbnail}`}
              src={thumbnail}
              alt=""
              fill
              unoptimized
              loading={active ? 'eager' : 'lazy'}
              crossOrigin={canSample ? 'anonymous' : undefined}
              onLoad={active && canSample ? (e) => sampleColor(e.currentTarget, true) : undefined}
              onError={canSample ? () => setFailedCorsSrc(thumbnail) : undefined}
              className="object-cover"
            />
          ) : (
            <Film className="size-5 text-white/60" aria-hidden="true" />
          )}
          {isMasked && (
            <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-black/80 px-1 py-0.5 text-[9px] font-semibold">
              <LockKeyhole className="size-2.5" aria-hidden="true" />18+
            </span>
          )}
          {duration > 0 && (
            <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 font-mono text-[10px] font-semibold">
              {formatVideoDuration(duration)}
            </span>
          )}
          {progressPct > 0 && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-black/40" aria-hidden="true">
              <span className="block h-full bg-[#FF7A00]" style={{ width: `${progressPct}%` }} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-xs font-semibold leading-snug text-[#212529] dark:text-[#F1F1F1]">
            {video.title}
          </span>
          {video.author_name && (
            <span className="mt-1 block truncate text-[11px] text-[#6C655D] dark:text-[#AAAAAA]">{video.author_name}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function buildThemeVars(theme, useFullHeader) {
  if (!theme) return undefined;
  return {
    '--pl-active-dark': theme.darkBg,
    '--pl-active-light': theme.lightBg,
    '--pl-header-dark': useFullHeader ? theme.darkBg : theme.headerDarkBg,
    '--pl-header-light': useFullHeader ? theme.lightBg : theme.headerLightBg,
    '--pl-accent-dark': theme.accentDark,
    '--pl-accent-light': theme.accentLight,
    '--pl-border-dark': theme.borderDark,
    '--pl-border-light': theme.borderLight,
  };
}

export default function WatchPlaylistPanel({
  state,
  nextVideo,
  playerHeight = 0,
  onSelect,
  onToggleShuffle,
  onCycleLoop,
  onClose,
}) {
  const listId = useId();
  const listRef = useRef(null);
  const activeRowRef = useRef(null);
  const menuBtnRef = useRef(null);
  const menuRef = useRef(null);
  const sheetRef = useRef(null);
  const scrimRef = useRef(null);
  const barRef = useRef(null);

  // Imperative 1:1 drag state refs (zero React re-renders per pointer frame)
  const sheetDragRef = useRef({
    active: false,
    pointerId: null,
    startY: 0,
    lastY: 0,
    lastTime: 0,
    velocityY: 0,
    offsetY: 0,
  });
  const listPullRef = useRef({
    watching: false,
    dragging: false,
    startX: 0,
    startY: 0,
    lastY: 0,
    lastTime: 0,
    velocityY: 0,
    offsetY: 0,
  });
  const barDragRef = useRef({
    active: false,
    pointerId: null,
    startY: 0,
    lastY: 0,
    lastTime: 0,
    velocityY: 0,
    moved: false,
    suppressClick: false,
    offsetY: 0,
  });
  const dragResetTimerRef = useRef(null);

  const isClient = useSyncExternalStore(subscribeNoop, getClientFlag, getServerClientFlag);
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktop, getServerDesktop);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isGrabbingHandle, setIsGrabbingHandle] = useState(false);
  const [togglePulse, setTogglePulse] = useState(0);
  const [loopPulse, setLoopPulse] = useState(0);
  const [shufflePulse, setShufflePulse] = useState(0);
  const [menuPos, setMenuPos] = useState(null);
  const [extractedColors, setExtractedColors] = useState({});

  const expanded = desktop ? desktopOpen : mobileOpen;
  const showMenu = Boolean(menuPos) && expanded;
  const playlist = state?.playlist;
  const items = state?.items;
  const index = state?.currentIndex ?? -1;
  const activeVideo = index >= 0 && items ? items[index] : null;
  const activeIsMature = isMatureVideo(activeVideo);
  const allow18PlusActive = usePosterPreference(activeIsMature);
  const activeIsMasked = activeIsMature && !allow18PlusActive;

  const handleColorExtracted = useCallback((videoId, color) => {
    if (!videoId || !color) return;
    setExtractedColors((prev) => (prev[videoId] === color ? prev : { ...prev, [videoId]: color }));
  }, []);

  const clearImperativeSheetStyles = useCallback(() => {
    if (dragResetTimerRef.current) {
      window.clearTimeout(dragResetTimerRef.current);
      dragResetTimerRef.current = null;
    }
    const sheet = sheetRef.current;
    const scrim = scrimRef.current;
    if (sheet) {
      sheet.style.transition = '';
      sheet.style.transform = '';
    }
    if (scrim) {
      scrim.style.transition = '';
      scrim.style.opacity = '';
    }
  }, []);

  const setExpandedState = useCallback((nextOpen) => {
    setMenuPos(null);
    setIsGrabbingHandle(false);
    clearImperativeSheetStyles();
    setTogglePulse((c) => c + 1);
    if (desktop) setDesktopOpen(nextOpen);
    else setMobileOpen(nextOpen);
  }, [desktop, clearImperativeSheetStyles]);

  const toggleExpanded = useCallback(() => {
    setExpandedState(!expanded);
  }, [expanded, setExpandedState]);

  const handleCycleLoop = () => {
    setLoopPulse((c) => c + 1);
    onCycleLoop?.();
  };

  const handleToggleShuffle = () => {
    setShufflePulse((c) => c + 1);
    onToggleShuffle?.();
  };

  const handleToggleMenu = () => {
    if (showMenu) {
      setMenuPos(null);
      return;
    }
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({
      top: rect.bottom + 6,
      right: Math.max(12, window.innerWidth - rect.right),
    });
  };

  // =========================================================================
  // M3 Interactive Sheet Drag Physics (imperative 1:1 DOM updates, touch + mouse)
  // =========================================================================
  const applySheetDragOffset = useCallback((rawDeltaY) => {
    const sheet = sheetRef.current;
    const scrim = scrimRef.current;
    if (!sheet) return 0;

    // 1:1 tracking downward; subtle damped M3 overscroll resistance upward
    const offsetY = rawDeltaY >= 0
      ? rawDeltaY
      : -Math.min(12, Math.pow(Math.abs(rawDeltaY), 0.55) * 1.35);

    sheet.style.transition = 'none';
    sheet.style.transform = `translate3d(0, ${offsetY}px, 0)`;

    if (scrim) {
      const sheetHeight = Math.max(200, sheet.offsetHeight || 400);
      const ratio = offsetY > 0 ? Math.max(0, 1 - offsetY / sheetHeight) : 1;
      scrim.style.transition = 'none';
      scrim.style.opacity = String(ratio);
    }

    return offsetY;
  }, []);

  const finishSheetDrag = useCallback((offsetY, velocityY) => {
    const sheet = sheetRef.current;
    const scrim = scrimRef.current;
    setIsGrabbingHandle(false);

    if (dragResetTimerRef.current) {
      window.clearTimeout(dragResetTimerRef.current);
      dragResetTimerRef.current = null;
    }

    const sheetHeight = Math.max(200, sheet?.offsetHeight || 400);
    // Dismiss if dragged >= 28% of sheet height (min 88px) OR quick downward flick
    const shouldDismiss = offsetY > Math.max(88, sheetHeight * 0.28)
      || (offsetY > 24 && velocityY > 0.45);

    if (shouldDismiss) {
      // M3 Emphasized Accelerate exit directly from current dragged offsetY -> 100%
      if (sheet) {
        sheet.style.transition = 'transform 240ms cubic-bezier(0.3, 0, 0.8, 0.15)';
        sheet.style.transform = 'translate3d(0, 100%, 0)';
      }
      if (scrim) {
        scrim.style.transition = 'opacity 200ms cubic-bezier(0.3, 0, 0.8, 0.15)';
        scrim.style.opacity = '0';
      }
      setMenuPos(null);
      setTogglePulse((c) => c + 1);
      setMobileOpen(false);
      dragResetTimerRef.current = window.setTimeout(() => {
        dragResetTimerRef.current = null;
        if (!sheetDragRef.current.active && !listPullRef.current.dragging) {
          clearImperativeSheetStyles();
        }
      }, 260);
    } else {
      // M3 Emphasized Decelerate snap-back to resting open position
      if (sheet) {
        sheet.style.transition = 'transform 300ms cubic-bezier(0.05, 0.7, 0.1, 1)';
        sheet.style.transform = 'translate3d(0, 0, 0)';
      }
      if (scrim) {
        scrim.style.transition = 'opacity 250ms cubic-bezier(0.05, 0.7, 0.1, 1)';
        scrim.style.opacity = '1';
      }
      dragResetTimerRef.current = window.setTimeout(() => {
        dragResetTimerRef.current = null;
        if (!sheetDragRef.current.active && !listPullRef.current.dragging) {
          clearImperativeSheetStyles();
        }
      }, 320);
    }
  }, [clearImperativeSheetStyles]);

  // Header & M3 Drag Handle: PointerEvents (works identically for touch + mouse!)
  const handleSheetPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('a, button')) return;
    const now = performance.now();
    sheetDragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      lastTime: now,
      velocityY: 0,
      offsetY: 0,
    };
    setIsGrabbingHandle(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported
    }
  };

  const handleSheetPointerMove = (e) => {
    const drag = sheetDragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastTime);
    const instantV = (e.clientY - drag.lastY) / dt;
    drag.velocityY = drag.velocityY * 0.4 + instantV * 0.6;
    drag.lastY = e.clientY;
    drag.lastTime = now;
    drag.offsetY = applySheetDragOffset(e.clientY - drag.startY);
  };

  const handleSheetPointerEnd = (e) => {
    const drag = sheetDragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    drag.active = false;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }
    finishSheetDrag(drag.offsetY, drag.velocityY);
  };

  // Scrollable <ol>: M3 nested pull-to-dismiss when scrolled to top (scrollTop === 0)
  const handleListTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const list = listRef.current;
    if (!list || list.scrollTop > 1) {
      listPullRef.current.watching = false;
      return;
    }
    const touch = e.touches[0];
    listPullRef.current = {
      watching: true,
      dragging: false,
      startX: touch.clientX,
      startY: touch.clientY,
      lastY: touch.clientY,
      lastTime: performance.now(),
      velocityY: 0,
      offsetY: 0,
    };
  };

  const handleListTouchMove = (e) => {
    const pull = listPullRef.current;
    if (!pull.watching || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - pull.startX;
    const deltaY = touch.clientY - pull.startY;

    if (!pull.dragging) {
      // Only take over gesture when clearly pulling downward while still at scrollTop === 0
      if (deltaY < 0 || Math.abs(deltaX) > Math.abs(deltaY) || (listRef.current?.scrollTop ?? 0) > 1) {
        pull.watching = false;
        return;
      }
      if (deltaY < 8) return;
      pull.dragging = true;
      pull.startY = touch.clientY;
      setIsGrabbingHandle(true);
    }

    const now = performance.now();
    const dt = Math.max(1, now - pull.lastTime);
    const instantV = (touch.clientY - pull.lastY) / dt;
    pull.velocityY = pull.velocityY * 0.4 + instantV * 0.6;
    pull.lastY = touch.clientY;
    pull.lastTime = now;
    pull.offsetY = applySheetDragOffset(Math.max(0, touch.clientY - pull.startY));
  };

  const handleListTouchEnd = () => {
    const pull = listPullRef.current;
    const wasDragging = pull.dragging;
    const { offsetY, velocityY } = pull;
    pull.watching = false;
    pull.dragging = false;
    if (wasDragging) {
      finishSheetDrag(offsetY, velocityY);
    }
  };

  // Collapsed Floating Bar: smooth PointerEvents pull-up (touch + mouse!)
  const handleBarPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const now = performance.now();
    barDragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      lastTime: now,
      velocityY: 0,
      moved: false,
      suppressClick: false,
      offsetY: 0,
    };
  };

  const handleBarPointerMove = (e) => {
    const drag = barDragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    const deltaY = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaY) > 6) {
      drag.moved = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
    if (!drag.moved) return;

    const now = performance.now();
    const dt = Math.max(1, now - drag.lastTime);
    drag.velocityY = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastTime = now;

    // Gentle upward pull feedback while swiping up on the bar
    const clamped = deltaY < 0
      ? Math.max(-28, deltaY * 0.55)
      : Math.min(6, deltaY * 0.2);
    drag.offsetY = deltaY;
    if (barRef.current) {
      barRef.current.style.transition = 'none';
      barRef.current.style.transform = `translate3d(0, ${clamped}px, 0)`;
    }
  };

  const handleBarPointerEnd = (e) => {
    const drag = barDragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    drag.active = false;
    drag.suppressClick = drag.moved;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    if (barRef.current) {
      barRef.current.style.transition = '';
      barRef.current.style.transform = '';
    }
    if (drag.moved && (drag.offsetY < -22 || drag.velocityY < -0.35)) {
      setExpandedState(true);
    }
    if (drag.moved) {
      window.setTimeout(() => {
        barDragRef.current.suppressClick = false;
      }, 0);
    }
  };

  const handleBarOpenClick = () => {
    if (barDragRef.current.suppressClick) return;
    setExpandedState(true);
  };

  // Clean up pending snap-back/exit timer on unmount
  useEffect(() => () => {
    if (dragResetTimerRef.current) {
      window.clearTimeout(dragResetTimerRef.current);
      dragResetTimerRef.current = null;
    }
  }, []);

  // Close overflow menu on outside tap / Escape / scroll
  useEffect(() => {
    if (!showMenu) return;
    const handleOutside = (event) => {
      if (
        menuRef.current?.contains(event.target)
        || menuBtnRef.current?.contains(event.target)
      ) return;
      setMenuPos(null);
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setMenuPos(null);
    };
    const handleDismiss = () => setMenuPos(null);

    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [showMenu]);

  // Mobile Bottom Sheet: lock background page scroll & allow Escape to close
  useEffect(() => {
    if (desktop || !mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKey = (event) => {
      if (event.key === 'Escape') {
        setMenuPos(null);
        setIsGrabbingHandle(false);
        clearImperativeSheetStyles();
        setTogglePulse((c) => c + 1);
        setMobileOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [desktop, mobileOpen, clearImperativeSheetStyles]);

  // Auto-scroll active row into view inside the playlist container
  useEffect(() => {
    if (!expanded) return;

    const scrollActiveIntoView = () => {
      const list = listRef.current;
      const row = activeRowRef.current;
      if (!list || !row) return;

      const listRect = list.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      if (listRect.height < rowRect.height) return;
      if (rowRect.top < listRect.top) list.scrollTop += rowRect.top - listRect.top;
      else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
    };

    scrollActiveIntoView();
    const timer = window.setTimeout(scrollActiveIntoView, 380);
    return () => window.clearTimeout(timer);
  }, [desktop, expanded, index, items]);

  if (!state) return null;

  if (state.isLoading) {
    if (desktop) {
      return (
        <section aria-label="เพลย์ลิสต์" className={`${panelClass} flex items-center justify-between gap-2 px-3.5 py-2`}>
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin text-[#FF7A00]" aria-hidden="true" />
            กำลังโหลดเพลย์ลิสต์…
          </p>
          <button type="button" onClick={onClose} aria-label="ปิดแผงเพลย์ลิสต์" className={iconButtonClass}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </section>
      );
    }
    if (!isClient) return null;
    return createPortal(
      <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-[640px]">
        <section aria-label="เพลย์ลิสต์" className="yt-playlist-panel flex items-center justify-between gap-2 overflow-hidden rounded-xl border bg-white px-3.5 py-2.5 text-[#212529] shadow-[0_8px_24px_rgba(0,0,0,0.22)] dark:bg-[#181818] dark:text-[#F1F1F1] dark:shadow-[0_8px_28px_rgba(0,0,0,0.5)]">
          <p role="status" className="flex items-center gap-2 text-xs font-medium">
            <Loader2 className="size-4 animate-spin text-[#FF7A00]" aria-hidden="true" />
            กำลังโหลดเพลย์ลิสต์…
          </p>
          <button type="button" onClick={onClose} aria-label="ปิดแผงเพลย์ลิสต์" className={iconButtonClass}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </section>
      </div>,
      document.body,
    );
  }

  if (!playlist || !items?.length) return null;

  const detailHref = `/playlist/${encodeURIComponent(playlist.route_key ?? state.listKey)}`;
  const counter = `${Math.max(0, index + 1)} / ${items.length}`;
  const loopMode = state.loopMode ?? 'none';
  const loopLabel = loopLabels[loopMode];
  const LoopIcon = loopMode === 'one' ? Repeat1 : Repeat;
  const activeClass = `${iconButtonClass} yt-playlist-active-btn`;

  const activeTheme = activeVideo
    ? (activeIsMasked
      ? MATURE_PLAYLIST_COLOR
      : (extractedColors[activeVideo.id] ?? (activeIsMature ? MATURE_PLAYLIST_COLOR : null)))
    : null;

  const desktopThemeStyle = buildThemeVars(activeTheme, !expanded);
  const mobileBarThemeStyle = buildThemeVars(activeTheme, true);
  const mobileSheetThemeStyle = {
    ...buildThemeVars(activeTheme, false),
    '--sheet-player-h': playerHeight ? `${playerHeight}px` : '56.25vw',
  };
  const activeThumb = getVideoThumb(activeVideo, allow18PlusActive);

  const toolbarRow = (
    <div className="yt-playlist-header flex items-center gap-1 px-2.5 pb-2">
      <button
        type="button"
        aria-label={`เปลี่ยนโหมดวนซ้ำ (${loopLabel})`}
        aria-pressed={loopMode !== 'none'}
        title={loopLabel}
        onClick={handleCycleLoop}
        className={`${activeClass} transition-transform active:scale-90`}
      >
        <LoopIcon
          key={loopPulse}
          className={`size-[18px] ${loopPulse > 0 ? 'animate-playlist-spin' : ''}`}
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        aria-label="สุ่มเล่น"
        aria-pressed={state.isShuffled}
        title="สุ่มเล่น"
        onClick={handleToggleShuffle}
        className={`${activeClass} transition-transform active:scale-90`}
      >
        <Shuffle
          key={shufflePulse}
          className={`size-[18px] ${shufflePulse > 0 ? 'animate-playlist-pop' : ''}`}
          aria-hidden="true"
        />
      </button>
      <button
        ref={menuBtnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={showMenu}
        aria-label="ตัวเลือกเพลย์ลิสต์เพิ่มเติม"
        title="ตัวเลือกเพิ่มเติม"
        onClick={handleToggleMenu}
        className={`${iconButtonClass} ml-auto transition-transform active:scale-90`}
      >
        <MoreVertical className="size-[18px]" aria-hidden="true" />
      </button>
    </div>
  );

  const overflowMenuPortal = showMenu && menuPos && isClient && createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ top: menuPos.top, right: menuPos.right }}
      className="fixed z-[110] min-w-[196px] overflow-hidden rounded-xl border border-[#EFECE6] bg-white p-1 text-sm text-[#212529] shadow-xl animate-fadeIn dark:border-white/10 dark:bg-[#222222] dark:text-[#F1F1F1]"
    >
      <Link
        href={detailHref}
        prefetch={false}
        role="menuitem"
        onClick={() => setMenuPos(null)}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition hover:bg-[#F4F0E8] dark:hover:bg-white/10"
      >
        <ExternalLink className="size-4 text-[#6C655D] dark:text-[#AAAAAA]" aria-hidden="true" />
        <span>ดูทั้งเพลย์ลิสต์</span>
      </Link>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setMenuPos(null);
          onClose?.();
        }}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
      >
        <X className="size-4" aria-hidden="true" />
        <span>ออกจากคิวเพลย์ลิสต์</span>
      </button>
    </div>,
    document.body,
  );

  // =========================================================================
  // DESKTOP: Inline sidebar card with kinetic X <-> ChevronDown morph
  // =========================================================================
  if (desktop) {
    return (
      <section
        aria-label={`เพลย์ลิสต์ ${playlist.title}`}
        style={desktopThemeStyle}
        className={panelClass}
      >
        <div className={`yt-playlist-header flex items-center justify-between gap-2 px-3.5 ${expanded ? 'pt-3 pb-2' : 'py-2.5'}`}>
          {expanded ? (
            <div className="min-w-0 flex-1 animate-fadeIn">
              <h2>
                <Link href={detailHref} prefetch={false} className="block truncate text-base font-bold hover:underline">
                  {playlist.title}
                </Link>
              </h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[#6C655D] dark:text-[#AAAAAA]">
                <PlaylistVisibility visibility={playlist.visibility} />
                {playlist.owner_name && (
                  <>
                    <span aria-hidden="true">•</span>
                    <span className="truncate">{playlist.owner_name}</span>
                  </>
                )}
                <span aria-hidden="true">•</span>
                <span className="font-mono">{counter}</span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              aria-expanded={false}
              aria-controls={listId}
              onClick={toggleExpanded}
              className="min-w-0 flex-1 cursor-pointer rounded-xl py-0.5 text-left transition hover:opacity-90 animate-fadeIn"
            >
              <span className="block truncate text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
                {nextVideo ? `ถัดไป: ${nextVideo.title}` : 'สิ้นสุดเพลย์ลิสต์'}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[#6C655D] dark:text-[#AAAAAA]">
                <span className="truncate">{playlist.title}</span>
                <span aria-hidden="true">•</span>
                <span className="yt-playlist-accent shrink-0 font-mono font-semibold">{counter}</span>
              </span>
            </button>
          )}

          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-label={expanded ? 'ย่อเพลย์ลิสต์' : 'ขยายเพลย์ลิสต์'}
            title={expanded ? 'ย่อเพลย์ลิสต์' : 'ขยายเพลย์ลิสต์'}
            onClick={toggleExpanded}
            className={`${iconButtonClass} yt-playlist-toggle-btn group/toggle relative transition-colors`}
          >
            <PlaylistToggleIcon expanded={expanded} direction="down" pulseKey={togglePulse} />
          </button>
        </div>

        <div
          id={listId}
          aria-hidden={!expanded}
          inert={!expanded}
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
        >
          <div className="min-h-0 overflow-hidden">
            {toolbarRow}
            <ol ref={listRef} className="max-h-[420px] overflow-y-auto overscroll-contain border-t border-[#EFECE6] dark:border-white/10">
              {items.map((video, position) => (
                <PlaylistRow
                  key={video.item_id ?? video.id}
                  video={video}
                  index={position}
                  active={position === index}
                  rowRef={position === index ? activeRowRef : null}
                  onSelect={onSelect}
                  onColorExtracted={handleColorExtracted}
                />
              ))}
            </ol>
          </div>
        </div>
        {overflowMenuPortal}
      </section>
    );
  }

  // =========================================================================
  // MOBILE / TABLET (< lg): Material Design 3 Bottom Sheet + Floating Bar
  // Spec reference: https://m3.material.io/components/bottom-sheets/overview
  // =========================================================================
  if (!isClient) return null;

  return (
    <>
      {createPortal(
        <>
          {/* 1. Floating Bottom Bar (collapsed state — solid M3 surface, no backdrop blur) */}
          <div
            ref={barRef}
            aria-hidden={expanded}
            inert={expanded}
            style={mobileBarThemeStyle}
            onPointerDown={handleBarPointerDown}
            onPointerMove={handleBarPointerMove}
            onPointerUp={handleBarPointerEnd}
            onPointerCancel={handleBarPointerEnd}
            className={`fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-[640px] touch-none select-none transition-[transform,opacity] motion-reduce:transition-none ${expanded ? `pointer-events-none translate-y-full opacity-0 ${M3_SHEET_EXIT}` : `translate-y-0 opacity-100 ${M3_SHEET_ENTER}`}`}
          >
            <div className="yt-playlist-panel overflow-hidden rounded-xl border bg-white shadow-[0_6px_20px_rgba(0,0,0,0.18)] dark:bg-[#181818] dark:shadow-[0_8px_24px_rgba(0,0,0,0.48)]">
              <div className="yt-playlist-header relative">
                {/* M3 Drag Handle cue: 32px x 4px, 40% on-surface-variant */}
                <div className="flex justify-center pt-2" aria-hidden="true">
                  <span className="h-1 w-8 rounded-full bg-[#6C655D]/40 dark:bg-[#CAC4D0]/40" />
                </div>
                <div className="flex items-center gap-2.5 px-3 pt-1 pb-2.5">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={listId}
                    onClick={handleBarOpenClick}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                  >
                    <span className="relative grid h-10 aspect-video shrink-0 place-items-center overflow-hidden rounded-sm bg-[#222222] text-white ring-1 ring-black/10 dark:ring-white/10">
                      {activeThumb ? (
                        <Image
                          src={activeThumb}
                          alt=""
                          fill
                          unoptimized
                          crossOrigin={!activeIsMasked ? 'anonymous' : undefined}
                          onLoad={!activeIsMasked && activeVideo?.id ? (e) => {
                            const color = extractDominantColor(e.currentTarget);
                            if (color) handleColorExtracted(activeVideo.id, color);
                          } : undefined}
                          className="object-cover"
                        />
                      ) : (
                        <ListVideo className="size-4 text-white/70" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold leading-tight text-[#212529] dark:text-[#F1F1F1]">
                        {nextVideo ? `ถัดไป: ${nextVideo.title}` : 'สิ้นสุดเพลย์ลิสต์'}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#6C655D] dark:text-[#AAAAAA]">
                        <span className="truncate">{playlist.title}</span>
                        <span aria-hidden="true">•</span>
                        <span className="yt-playlist-accent shrink-0 font-mono font-semibold">{counter}</span>
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={listId}
                    aria-label="เปิดแผงเพลย์ลิสต์"
                    title="เปิดเพลย์ลิสต์"
                    onClick={handleBarOpenClick}
                    className={`${iconButtonClass} yt-playlist-toggle-btn group/toggle relative transition-colors`}
                  >
                    <PlaylistToggleIcon expanded={expanded} direction="up" pulseKey={togglePulse} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 2. M3 Scrim: flat 32% dark scrim (NO blur), starts below sticky player on phone */}
          <div
            ref={scrimRef}
            aria-hidden="true"
            onClick={() => setExpandedState(false)}
            style={{ '--sheet-player-h': playerHeight ? `${playerHeight}px` : '56.25vw' }}
            className={`fixed inset-x-0 top-[var(--sheet-player-h)] bottom-0 z-40 bg-black/32 transition-opacity md:top-0 motion-reduce:transition-none ${expanded ? 'opacity-100 duration-300 ease-out' : 'pointer-events-none opacity-0 duration-200 ease-in'}`}
          />

          {/* 3. Material Design 3 Bottom Sheet (max-w 640dp, crisp 12px top radius, 1:1 pointer+touch drag) */}
          <section
            ref={sheetRef}
            id={listId}
            role="dialog"
            aria-modal="false"
            aria-label={`เพลย์ลิสต์ ${playlist.title}`}
            aria-hidden={!expanded}
            inert={!expanded}
            style={{
              ...mobileSheetThemeStyle,
              height: 'clamp(240px, calc(100dvh - var(--sheet-player-h, 56.25vw)), 84dvh)',
            }}
            className={`yt-playlist-panel fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[640px] flex-col overflow-hidden rounded-t-xl border-x-0 border-t bg-white text-[#212529] shadow-[0_-6px_28px_rgba(0,0,0,0.28)] transition-transform sm:border-x dark:bg-[#181818] dark:text-[#F1F1F1] dark:shadow-[0_-8px_32px_rgba(0,0,0,0.55)] motion-reduce:transition-none ${expanded ? `translate-y-0 ${M3_SHEET_ENTER}` : `translate-y-full ${M3_SHEET_EXIT}`}`}
          >
            {/* M3 Drag Handle + Header (PointerEvents: smooth 1:1 drag for touch & mouse) */}
            <div
              onPointerDown={handleSheetPointerDown}
              onPointerMove={handleSheetPointerMove}
              onPointerUp={handleSheetPointerEnd}
              onPointerCancel={handleSheetPointerEnd}
              className="yt-playlist-header shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
            >
              {/* M3 Drag Handle: 32x4px pill inside generous touch target, widens subtly while grabbed */}
              <div className="flex justify-center pt-3 pb-1.5" aria-hidden="true">
                <span
                  className={`h-1 rounded-full transition-[width,background-color] duration-150 ${isGrabbingHandle
                      ? 'w-10 bg-[#6C655D]/65 dark:bg-[#CAC4D0]/70'
                      : 'w-8 bg-[#6C655D]/40 dark:bg-[#CAC4D0]/40'
                    }`}
                />
              </div>

              <div className="flex items-center justify-between gap-2 px-3.5 pt-0.5 pb-2">
                <div className="min-w-0 flex-1">
                  <h2>
                    <Link
                      href={detailHref}
                      prefetch={false}
                      onClick={() => setExpandedState(false)}
                      className="block truncate text-base font-bold hover:underline"
                    >
                      {playlist.title}
                    </Link>
                  </h2>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[#6C655D] dark:text-[#AAAAAA]">
                    <PlaylistVisibility visibility={playlist.visibility} />
                    {playlist.owner_name && (
                      <>
                        <span aria-hidden="true">•</span>
                        <span className="truncate">{playlist.owner_name}</span>
                      </>
                    )}
                    <span aria-hidden="true">•</span>
                    <span className="font-mono">{counter}</span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={listId}
                  aria-label="ย่อแผงเพลย์ลิสต์"
                  title="ย่อเพลย์ลิสต์"
                  onClick={() => setExpandedState(false)}
                  className={`${iconButtonClass} yt-playlist-toggle-btn group/toggle relative transition-colors`}
                >
                  <PlaylistToggleIcon expanded={expanded} direction="up" pulseKey={togglePulse} />
                </button>
              </div>
            </div>

            <div className="shrink-0">{toolbarRow}</div>

            <ol
              ref={listRef}
              onTouchStart={handleListTouchStart}
              onTouchMove={handleListTouchMove}
              onTouchEnd={handleListTouchEnd}
              onTouchCancel={handleListTouchEnd}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-[#EFECE6] pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-white/10"
            >
              {items.map((video, position) => (
                <PlaylistRow
                  key={video.item_id ?? video.id}
                  video={video}
                  index={position}
                  active={position === index}
                  rowRef={position === index ? activeRowRef : null}
                  onSelect={onSelect}
                  onColorExtracted={handleColorExtracted}
                />
              ))}
            </ol>
          </section>
        </>,
        document.body,
      )}
      {overflowMenuPortal}
    </>
  );
}
