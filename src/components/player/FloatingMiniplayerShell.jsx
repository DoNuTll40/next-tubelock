'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pause, Play, X } from 'lucide-react';

const CORNER_STORAGE_KEY = 'tubelock_miniplayer_corner';
const WIDTH_STORAGE_KEY = 'tubelock_miniplayer_width';
const VALID_CORNERS = new Set(['bottom-right', 'bottom-left', 'top-right', 'top-left']);

const DEFAULT_CARD_WIDTH = 400;
const MIN_CARD_WIDTH = 260;
const MAX_CARD_WIDTH = 680;
const EDGE_MARGIN = 16;

function readSavedCorner() {
  if (typeof window === 'undefined') return 'bottom-right';
  try {
    const saved = localStorage.getItem(CORNER_STORAGE_KEY);
    return VALID_CORNERS.has(saved) ? saved : 'bottom-right';
  } catch {
    return 'bottom-right';
  }
}

function readSavedWidth() {
  if (typeof window === 'undefined') return DEFAULT_CARD_WIDTH;
  try {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_CARD_WIDTH && saved <= MAX_CARD_WIDTH) {
      return Math.round(saved);
    }
    return DEFAULT_CARD_WIDTH;
  } catch {
    return DEFAULT_CARD_WIDTH;
  }
}

function clampCardWidth(rawW, ratio = 16 / 9, infoBarH = 64) {
  if (typeof window === 'undefined') {
    return Math.round(Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, rawW)));
  }
  const maxByViewportW = Math.max(MIN_CARD_WIDTH, window.innerWidth - EDGE_MARGIN * 2);
  const maxByViewportH = Math.max(
    MIN_CARD_WIDTH,
    (window.innerHeight - EDGE_MARGIN * 2 - infoBarH) * ratio
  );
  const maxW = Math.min(MAX_CARD_WIDTH, maxByViewportW, maxByViewportH);
  return Math.round(Math.min(maxW, Math.max(MIN_CARD_WIDTH, rawW)));
}

const MOBILE_SIDE_MARGIN = 12;
const MOBILE_TOP_MARGIN = 14;
const MOBILE_BOTTOM_MARGIN = 86;

function getMobileCardWidth() {
  if (typeof window === 'undefined') return 192;
  return Math.min(200, Math.max(164, Math.round(window.innerWidth * 0.48)));
}

function getCornerCoords(corner, cardW, cardH, mobile = false) {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sideMargin = mobile ? MOBILE_SIDE_MARGIN : EDGE_MARGIN;
  const topMargin = mobile ? MOBILE_TOP_MARGIN : EDGE_MARGIN;
  const bottomMargin = mobile ? MOBILE_BOTTOM_MARGIN : EDGE_MARGIN;
  const w = cardW || (mobile ? getMobileCardWidth() : DEFAULT_CARD_WIDTH);
  const h = cardH || (mobile ? 112 : 288);

  const isLeft = corner.endsWith('left');
  const isTop = corner.startsWith('top');
  const x = isLeft ? sideMargin : Math.max(sideMargin, vw - w - sideMargin);
  const y = isTop ? topMargin : Math.max(topMargin, vh - h - bottomMargin);
  return { x, y };
}

/**
 * FloatingMiniplayerShell (YouTube-grade 60fps Pixel-Transform Drag & 4-Corner Magnetic Snap)
 * - Desktop (>= 768px): Drag smoothly from ANYWHERE on the card (video or info bar) with zero-teleport GPU transform gliding.
 * - Mobile (< 768px): Compact bottom horizontal mini bar (YouTube Mobile style).
 */
export default function FloatingMiniplayerShell({
  isOpen,
  hostEl,
  reparentHost,
  videoRef,
  aspectRatio = 16 / 9,
  consumeLaunchRect = null,
  title = '',
  channelName = 'TubeLock',
  onExpand,
  onClose,
}) {
  const slotRef = useRef(null);
  const cardRef = useRef(null);
  const mobileProgressBarRef = useRef(null);
  const dragStateRef = useRef(null);
  const resizeStateRef = useRef(null);
  const cornerRef = useRef('bottom-right');
  const widthRef = useRef(DEFAULT_CARD_WIDTH);
  const posRef = useRef({ x: 0, y: 0 });
  const suppressNextClickRef = useRef(false);

  const [isMobile, setIsMobile] = useState(false);
  const [cardWidth, setCardWidth] = useState(DEFAULT_CARD_WIDTH);
  const [pos, setPos] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);

  const safeRatio =
    Number.isFinite(aspectRatio) && aspectRatio > 0
      ? Math.min(2.45, Math.max(1.0, aspectRatio))
      : 16 / 9;

  // Hydrate saved desktop width on client after mount (zero SSR hydration mismatch)
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      const savedW = clampCardWidth(readSavedWidth(), safeRatio);
      widthRef.current = savedW;
      setCardWidth(savedW);
    });
    return () => cancelAnimationFrame(rafId);
  }, [safeRatio]);

  useEffect(() => {
    widthRef.current = cardWidth;
  }, [cardWidth]);

  const snapToCorner = useCallback((targetCorner, save = false) => {
    cornerRef.current = targetCorner;
    const mobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const rect = cardRef.current?.getBoundingClientRect();
    const fallbackW = mobile ? getMobileCardWidth() : widthRef.current;
    const fallbackH = mobile ? Math.round(fallbackW / safeRatio) : 288;
    const next = getCornerCoords(targetCorner, rect?.width || fallbackW, rect?.height || fallbackH, mobile);
    posRef.current = next;
    setPos(next);
    if (save) {
      try {
        localStorage.setItem(CORNER_STORAGE_KEY, targetCorner);
      } catch (_) { }
    }
  }, [safeRatio]);

  // Measure viewport & keep snapped corner + width clamped on resize (Desktop & Mobile)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncViewport = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (isOpen) {
        if (!mobile) {
          const clampedW = clampCardWidth(widthRef.current, safeRatio);
          if (clampedW !== widthRef.current) {
            widthRef.current = clampedW;
            setCardWidth(clampedW);
          }
        }
        const rect = cardRef.current?.getBoundingClientRect();
        const fallbackW = mobile ? getMobileCardWidth() : widthRef.current;
        const fallbackH = mobile ? Math.round(fallbackW / safeRatio) : 288;
        const next = getCornerCoords(cornerRef.current, rect?.width || fallbackW, rect?.height || fallbackH, mobile);
        posRef.current = next;
        setPos(next);
      }
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, [isOpen, safeRatio]);

  // Initialize saved corner when Miniplayer opens (Desktop & Mobile) + 60fps FLIP Shared-Element Glide!
  useLayoutEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const mobile = window.innerWidth < 768;
    const launch = consumeLaunchRect ? consumeLaunchRect() : null;

    const targetCorner = launch?.corner && VALID_CORNERS.has(launch.corner)
      ? launch.corner
      : readSavedCorner();
    if (launch?.corner && VALID_CORNERS.has(launch.corner)) {
      try {
        localStorage.setItem(CORNER_STORAGE_KEY, targetCorner);
      } catch (_) { }
    }

    const fallbackW = mobile ? getMobileCardWidth() : clampCardWidth(widthRef.current, safeRatio);
    const fallbackH = mobile ? Math.round(fallbackW / safeRatio) : fallbackW / safeRatio + 64;
    cornerRef.current = targetCorner;

    const card = cardRef.current;
    const rect = card?.getBoundingClientRect();
    const cardW = rect?.width || fallbackW;
    const cardH = rect?.height || fallbackH;
    const next = getCornerCoords(targetCorner, cardW, cardH, mobile);
    posRef.current = next;

    if (!launch?.rect || !card) {
      setPos(next);
      return;
    }

    // FLIP Frame 0 (before paint): lock card onto exact finger-release rect with ZERO React re-render until glide ends!
    const startScale = Math.max(0.45, Math.min(2.2, launch.rect.width / Math.max(1, cardW)));
    card.style.transition = 'none';
    card.style.transformOrigin = 'top left';
    card.style.transform = `translate3d(${launch.rect.left}px, ${launch.rect.top}px, 0) scale(${startScale.toFixed(4)})`;
    card.style.opacity = '1';
    void card.offsetWidth;

    let cleanTimer = null;
    const rafId = requestAnimationFrame(() => {
      if (!cardRef.current) return;
      cardRef.current.style.transition = 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)';
      cardRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(1)`;
      cleanTimer = setTimeout(() => {
        if (!cardRef.current) return;
        cardRef.current.style.transition = '';
        cardRef.current.style.transformOrigin = '';
        setPos(next);
      }, 355);
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (cleanTimer) clearTimeout(cleanTimer);
      if (card) {
        card.style.transition = '';
        card.style.transformOrigin = '';
      }
    };
  }, [isOpen, isMobile, safeRatio, consumeLaunchRect]);

  // Track live play/pause state + progress bar for Mobile floating miniplayer
  useEffect(() => {
    if (!isOpen) return;
    const v = videoRef?.current;
    if (!v) return;
    const syncPlayState = () => setIsPlaying(!v.paused && !v.ended);
    const syncProgress = () => {
      if (!mobileProgressBarRef.current) return;
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const pct = dur > 0 ? Math.min(100, Math.max(0, (v.currentTime / dur) * 100)) : 0;
      mobileProgressBarRef.current.style.width = `${pct}%`;
    };
    syncPlayState();
    syncProgress();
    const rafId = requestAnimationFrame(syncProgress);
    v.addEventListener('play', syncPlayState);
    v.addEventListener('playing', syncPlayState);
    v.addEventListener('pause', syncPlayState);
    v.addEventListener('ended', syncPlayState);
    v.addEventListener('timeupdate', syncProgress);
    v.addEventListener('playing', syncProgress);
    v.addEventListener('pause', syncProgress);
    v.addEventListener('seeking', syncProgress);
    v.addEventListener('seeked', syncProgress);
    v.addEventListener('loadedmetadata', syncProgress);
    return () => {
      cancelAnimationFrame(rafId);
      v.removeEventListener('play', syncPlayState);
      v.removeEventListener('playing', syncPlayState);
      v.removeEventListener('pause', syncPlayState);
      v.removeEventListener('ended', syncPlayState);
      v.removeEventListener('timeupdate', syncProgress);
      v.removeEventListener('playing', syncProgress);
      v.removeEventListener('pause', syncProgress);
      v.removeEventListener('seeking', syncProgress);
      v.removeEventListener('seeked', syncProgress);
      v.removeEventListener('loadedmetadata', syncProgress);
    };
  }, [isOpen, videoRef, isMobile]);

  // Keep snapped corner aligned whenever card size changes (Desktop & Mobile)
  useEffect(() => {
    if (!isOpen || typeof ResizeObserver === 'undefined') return;
    const card = cardRef.current;
    if (!card) return;
    const ro = new ResizeObserver(() => {
      if (dragStateRef.current || resizeStateRef.current) return;
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const mobile = window.innerWidth < 768;
      const next = getCornerCoords(cornerRef.current, rect.width, rect.height, mobile);
      if (
        Math.abs((posRef.current?.x ?? -1) - next.x) > 0.5 ||
        Math.abs((posRef.current?.y ?? -1) - next.y) > 0.5
      ) {
        posRef.current = next;
        setPos(next);
      }
    });
    ro.observe(card);
    return () => ro.disconnect();
  }, [isOpen, isMobile]);

  // Reparent singleton #movie_player into the active miniplayer slot (Desktop or Mobile)
  useLayoutEffect(() => {
    if (!isOpen || !hostEl || !slotRef.current) return;
    reparentHost(slotRef.current, hostEl);
  }, [isOpen, hostEl, reparentHost, isMobile]);

  const handleTogglePlayMobile = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const v = videoRef?.current || document.querySelector('#movie_player video');
    if (!v) return;
    if (v.paused || v.ended) {
      setIsPlaying(true);
      v.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  // Silky 60fps Drag-from-Anywhere using NATIVE DOM listeners (works across React Portal boundary on BOTH Desktop & Mobile!)
  useEffect(() => {
    if (!isOpen) return;
    const card = cardRef.current;
    if (!card) return;

    const handlePointerDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button, [data-mini-scrubber="true"], [data-mini-resize="true"]')) return;

      const rect = card.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const originX = posRef.current?.x ?? rect.left;
      const originY = posRef.current?.y ?? rect.top;

      dragStateRef.current = {
        startX,
        startY,
        originX,
        originY,
        width: rect.width,
        height: rect.height,
        moved: false,
        lastX: originX,
        lastY: originY,
        vx: 0,
        vy: 0,
        lastTime: performance.now(),
      };

      const onPointerMove = (moveEvt) => {
        const st = dragStateRef.current;
        if (!st) return;
        const dx = moveEvt.clientX - st.startX;
        const dy = moveEvt.clientY - st.startY;
        if (!st.moved && Math.hypot(dx, dy) < 6) return;

        if (!st.moved) {
          st.moved = true;
          suppressNextClickRef.current = true;
          setIsDragging(true);
        }

        const mobile = window.innerWidth < 768;
        const sideM = mobile ? MOBILE_SIDE_MARGIN : EDGE_MARGIN;
        const topM = mobile ? MOBILE_TOP_MARGIN : EDGE_MARGIN;
        const bottomM = mobile ? MOBILE_BOTTOM_MARGIN : EDGE_MARGIN;
        const maxX = Math.max(sideM, window.innerWidth - st.width - sideM);
        const maxY = Math.max(topM, window.innerHeight - st.height - bottomM);
        const clampedX = Math.min(maxX, Math.max(sideM, st.originX + dx));
        const clampedY = Math.min(maxY, Math.max(topM, st.originY + dy));

        const now = performance.now();
        const dt = Math.max(1, now - st.lastTime);
        st.vx = (clampedX - st.lastX) / dt;
        st.vy = (clampedY - st.lastY) / dt;
        st.lastX = clampedX;
        st.lastY = clampedY;
        st.lastTime = now;

        posRef.current = { x: clampedX, y: clampedY };
        card.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0) scale(${mobile ? 1.03 : 1.015})`;
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        const st = dragStateRef.current;
        dragStateRef.current = null;
        if (!st || !st.moved) return;

        const projectedCenterX = st.lastX + st.width / 2 + st.vx * 140;
        const projectedCenterY = st.lastY + st.height / 2 + st.vy * 140;
        const horiz = projectedCenterX < window.innerWidth / 2 ? 'left' : 'right';
        const vert = projectedCenterY < window.innerHeight / 2 ? 'top' : 'bottom';
        const nextCorner = `${vert}-${horiz}`;

        setIsDragging(false);
        setPos({ x: st.lastX, y: st.lastY });
        requestAnimationFrame(() => {
          snapToCorner(nextCorner, true);
        });
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 80);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };

    const handleClickCapture = (e) => {
      if (suppressNextClickRef.current) {
        e.stopPropagation();
        e.preventDefault();
        suppressNextClickRef.current = false;
      }
    };

    card.addEventListener('pointerdown', handlePointerDown);
    card.addEventListener('click', handleClickCapture, true);
    return () => {
      card.removeEventListener('pointerdown', handlePointerDown);
      card.removeEventListener('click', handleClickCapture, true);
    };
  }, [isOpen, isMobile, snapToCorner]);

  if (!isOpen) return null;

  // ============================================
  // MOBILE: YouTube-Style Floating Rounded PiP Card (4-Corner Touch Drag + Tap to Expand)
  // ============================================
  if (isMobile) {
    const mobileEffectivePos = pos || { x: MOBILE_SIDE_MARGIN, y: MOBILE_TOP_MARGIN };
    return (
      <div
        ref={cardRef}
        id="movie_player_mini_dock"
        role="region"
        aria-label="Miniplayer"
        onClick={(e) => {
          if (e.target.closest('button')) return;
          onExpand?.();
        }}
        className={`fixed top-0 left-0 z-[85] rounded-xl bg-black ring-1 ring-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.85)] overflow-hidden select-none touch-none will-change-transform cursor-pointer ${
          isDragging
            ? 'shadow-[0_22px_56px_rgba(0,0,0,0.92)]'
            : 'transition-transform duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
        }`}
        style={{
          width: 'min(200px, 48vw)',
          transform: `translate3d(${mobileEffectivePos.x}px, ${mobileEffectivePos.y}px, 0) scale(${isDragging ? 1.03 : 1})`,
          opacity: pos ? 1 : 0,
        }}
      >
        {/* Dynamic-Aspect Live Video Slot (pointer-events-none so taps hit cardRef & expand cleanly across React Portal!) */}
        <div
          ref={slotRef}
          className="relative z-10 w-full bg-black overflow-hidden pointer-events-none"
          style={{ aspectRatio: String(safeRatio) }}
        />

        {/* Top-Left Pause/Play + Top-Right Close (hides cleanly while dragging, exact YouTube Mobile behavior!) */}
        <div
          className={`absolute top-0 inset-x-0 z-30 flex items-center justify-between px-1 pt-1 pb-4 bg-gradient-to-b from-black/70 via-black/25 to-transparent pointer-events-none transition-opacity duration-150 ${
            isDragging ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={handleTogglePlayMobile}
            className="pointer-events-auto p-2 rounded-full text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.95)] active:scale-90 transition cursor-pointer focus:outline-none"
            aria-label={isPlaying ? 'หยุดชั่วคราว' : 'เล่นต่อ'}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
          </button>
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose?.();
            }}
            className="pointer-events-auto p-2 rounded-full text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.95)] active:scale-90 transition cursor-pointer focus:outline-none"
            aria-label="ปิด Miniplayer"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Flush Bottom Orange Progress Bar */}
        <div className="absolute bottom-0 inset-x-0 z-20 h-[3px] bg-white/30 pointer-events-none">
          <div
            ref={mobileProgressBarRef}
            className="h-full bg-[#FF7A00] transition-[width] duration-150 linear"
            style={{ width: '0%' }}
          />
        </div>
      </div>
    );
  }

  // ============================================
  // DESKTOP: YouTube-Style 60fps Draggable + Resizable 4-Corner Magnetic Card
  // ============================================
  const handleStartResize = (e) => {
    if (e.button !== 0) return;
    const dir = e.currentTarget?.dataset?.resizeDir;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();

    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const startPosX = posRef.current?.x ?? rect.left;
    const startPosY = posRef.current?.y ?? rect.top;
    const rightEdge = startPosX + startWidth;
    const bottomEdge = startPosY + startHeight;
    const infoBarH = Math.max(48, startHeight - startWidth / safeRatio);

    resizeStateRef.current = { dir, startWidth, lastWidth: startWidth };
    suppressNextClickRef.current = true;
    setIsResizing(true);

    const onPointerMove = (moveEvt) => {
      const dx = moveEvt.clientX - startX;
      const dy = moveEvt.clientY - startY;

      let rawWidth;
      if (dir === 'w' || dir === 'e') {
        rawWidth = startWidth + (dir === 'w' ? -dx : dx);
      } else {
        const dxSigned = dir.includes('w') ? -dx : dx;
        const dySigned = (dir.includes('n') ? -dy : dy) * safeRatio;
        rawWidth = startWidth + (Math.abs(dxSigned) >= Math.abs(dySigned) ? dxSigned : dySigned);
      }

      const nextWidth = clampCardWidth(rawWidth, safeRatio, infoBarH);
      const nextHeight = nextWidth / safeRatio + infoBarH;

      const anchorRight = dir.includes('w') || cornerRef.current.endsWith('right');
      const anchorBottom = dir.includes('n') || cornerRef.current.startsWith('bottom');

      const nextX = anchorRight
        ? Math.max(EDGE_MARGIN, rightEdge - nextWidth)
        : Math.min(window.innerWidth - nextWidth - EDGE_MARGIN, startPosX);
      const nextY = anchorBottom
        ? Math.max(EDGE_MARGIN, bottomEdge - nextHeight)
        : Math.min(window.innerHeight - nextHeight - EDGE_MARGIN, startPosY);

      widthRef.current = nextWidth;
      posRef.current = { x: nextX, y: nextY };
      if (resizeStateRef.current) {
        resizeStateRef.current.lastWidth = nextWidth;
      }

      card.style.width = `${nextWidth}px`;
      card.style.transform = `translate3d(${nextX}px, ${nextY}px, 0)`;
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      const finalWidth = resizeStateRef.current?.lastWidth || widthRef.current;
      resizeStateRef.current = null;
      widthRef.current = finalWidth;
      setCardWidth(finalWidth);
      setIsResizing(false);

      try {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(finalWidth));
      } catch (_) { }

      requestAnimationFrame(() => {
        snapToCorner(cornerRef.current, false);
      });
      setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 80);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const handleResetWidth = (e) => {
    e.stopPropagation();
    const resetW = clampCardWidth(DEFAULT_CARD_WIDTH, safeRatio);
    widthRef.current = resetW;
    setCardWidth(resetW);
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(resetW));
    } catch (_) { }
    requestAnimationFrame(() => {
      snapToCorner(cornerRef.current, false);
    });
  };

  const effectivePos = pos || { x: EDGE_MARGIN, y: EDGE_MARGIN };

  return (
    <div
      ref={cardRef}
      id="movie_player_mini_dock"
      role="region"
      aria-label="Miniplayer"
      className={`fixed top-0 left-0 z-[85] rounded-xl bg-[#212121] shadow-[0_18px_52px_rgba(0,0,0,0.78)] overflow-hidden select-none will-change-transform ${isDragging
        ? 'cursor-grabbing shadow-[0_26px_76px_rgba(0,0,0,0.92)]'
        : isResizing
          ? 'shadow-[0_22px_64px_rgba(0,0,0,0.88)]'
          : 'transition-transform duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
        }`}
      style={{
        width: `${cardWidth}px`,
        transform: `translate3d(${effectivePos.x}px, ${effectivePos.y}px, 0) scale(${isDragging ? 1.015 : 1})`,
        opacity: pos ? 1 : 0,
      }}
    >
      {/* YouTube-Style Invisible Edge & Corner Resize Handles (double-click any handle to reset to 400px) */}
      <div
        data-mini-resize="true"
        data-resize-dir="nw"
        onPointerDown={handleStartResize}
        onDoubleClick={handleResetWidth}
        className="absolute top-0 left-0 z-[60] w-3.5 h-3.5 cursor-nwse-resize"
      />
      <div
        data-mini-resize="true"
        data-resize-dir="ne"
        onPointerDown={handleStartResize}
        onDoubleClick={handleResetWidth}
        className="absolute top-0 right-0 z-[60] w-3.5 h-3.5 cursor-nesw-resize"
      />
      <div
        data-mini-resize="true"
        data-resize-dir="sw"
        onPointerDown={handleStartResize}
        onDoubleClick={handleResetWidth}
        className="absolute bottom-0 left-0 z-[60] w-3.5 h-3.5 cursor-nesw-resize"
      />
      <div
        data-mini-resize="true"
        data-resize-dir="se"
        onPointerDown={handleStartResize}
        onDoubleClick={handleResetWidth}
        className="absolute bottom-0 right-0 z-[60] w-3.5 h-3.5 cursor-nwse-resize"
      />
      <div
        data-mini-resize="true"
        data-resize-dir="w"
        onPointerDown={handleStartResize}
        onDoubleClick={handleResetWidth}
        className="absolute top-3.5 bottom-3.5 left-0 z-[55] w-1.5 cursor-ew-resize"
      />
      <div
        data-mini-resize="true"
        data-resize-dir="e"
        onPointerDown={handleStartResize}
        onDoubleClick={handleResetWidth}
        className="absolute top-3.5 bottom-3.5 right-0 z-[55] w-1.5 cursor-ew-resize"
      />

      {/* Dynamic-Aspect Live Video Slot (adapts to 21:9, 16:9, 4:3, 1:1 with zero black bars; overflow-visible + z-20 for flush scrubber knob) */}
      <div
        ref={slotRef}
        className="relative z-20 w-full bg-black overflow-visible"
        style={{ aspectRatio: String(safeRatio) }}
      />

      {/* Clean YouTube-Style Bottom Info Bar (Title + Channel only, click to expand, drag anywhere to move) */}
      <div
        onClick={() => onExpand?.()}
        title="คลิกเพื่อกลับหน้าดูเต็ม (i) • ลากเพื่อย้ายมุมหน้าจอ"
        className={`relative z-10 px-4 py-3 bg-[#212121] hover:bg-[#2a2a2a] transition-colors ${isDragging ? 'cursor-grabbing' : 'cursor-pointer'
          }`}
      >
        <p className="text-[13.5px] font-semibold text-white truncate leading-snug">
          {title || 'กำลังเล่นวิดีโอ'}
        </p>
        <p className="text-[12px] text-zinc-400 truncate leading-tight mt-0.5">
          {channelName || 'TubeLock'}
        </p>
      </div>
    </div>
  );
}
