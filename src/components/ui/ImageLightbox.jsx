'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Images, Maximize, Minimize, ZoomIn, ZoomOut, X } from 'lucide-react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import BrowserMediaImage from '@/components/BrowserMediaImage';
import LightboxSlides, { LightboxErrorGraphic, LightboxImage } from './LightboxSlides';
import LightboxZoom from './LightboxZoom';
import LightboxDock from './LightboxDock';
import LightboxInfo from './LightboxInfo';
import styles from './ImageLightbox.module.css';

const controlClass = 'grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF963D] sm:size-11';

function revealThumbnail(filmstripRef, reduceMotion) {
  return requestAnimationFrame(() => {
    const strip = filmstripRef.current;
    const thumbnail = strip?.querySelector('[aria-current="true"]');
    if (!thumbnail?.isConnected || strip.closest('[inert]')) return;
    const buttons = [...strip.querySelectorAll('button')];
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const contentWidth = buttons.reduce((width, button) => width + button.offsetWidth, 0) + gap * (buttons.length - 1);
    const overflow = contentWidth > strip.clientWidth;
    strip.style.paddingLeft = overflow ? `${Math.max(0, (strip.clientWidth - buttons[0].offsetWidth) / 2)}px` : '';
    strip.style.paddingRight = overflow ? `${Math.max(0, (strip.clientWidth - buttons.at(-1).offsetWidth) / 2)}px` : '';
    const bounds = strip.getBoundingClientRect();
    const target = thumbnail.getBoundingClientRect();
    const offset = (target.left + target.right - bounds.left - bounds.right) / 2;
    if (Math.abs(offset) > 1) strip.scrollBy({ left: offset, behavior: reduceMotion ? 'instant' : 'smooth' });
  });
}

function LightboxThumbnail({ src }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span data-lightbox-thumbnail-error="" role="img" aria-label="โหลดภาพย่อไม่สำเร็จ" title="โหลดภาพย่อไม่สำเร็จ" className="grid aspect-[4/3] h-full shrink-0 place-items-center border border-white/10 bg-[#181818]">
        <LightboxErrorGraphic className="h-7 w-10" />
      </span>
    );
  }

  return <BrowserMediaImage src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} className="h-full w-full object-cover opacity-90" />;
}

export default function ImageLightbox({ images, title, startIndex = 0, onClose, className = '', slideNavigation = false }) {
  const dialogRef = useRef(null);
  const filmstripRef = useRef(null);
  const swipeStart = useRef(null);
  const slidesRef = useRef(null);
  const zoomRef = useRef(null);
  const ownsFullscreen = useRef(false);
  const titleId = useId();
  const [index, setIndex] = useState(startIndex);
  const [expanded, setExpanded] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [filmstripOpen, setFilmstripOpen] = useState(true);
  const filmstripId = useId();
  const reduceMotion = useReducedMotion();
  const dockTransition = reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 32, mass: 0.8 };
  const count = images.length;
  const activeIndex = Math.min(index, count - 1);
  const hasMultiple = count > 1;
  const useSlides = slideNavigation && hasMultiple;
  const image = images[activeIndex];
  const hasCaption = typeof image.alt === 'string' && image.alt.trim().length > 0;
  const showDock = hasMultiple || (hasCaption && (!slideNavigation || zoom <= 1));

  useEffect(() => {
    if (!slideNavigation) return;
    const dialog = dialogRef.current;
    const stage = dialog.querySelector('[data-lightbox-stage]');
    const measureImage = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      const toolbarRatio = window.matchMedia('(min-width: 640px)').matches ? 3 / 2 : 4 / 3;
      const toolbarWidth = Math.min(width, height * toolbarRatio);
      dialog.style.setProperty('--photo-left', `${stage.offsetLeft + (width - toolbarWidth) / 2}px`);
      dialog.style.setProperty('--photo-top', `${stage.offsetTop}px`);
      dialog.style.setProperty('--photo-width', `${toolbarWidth}px`);
      dialog.dataset.compactToolbar = String(toolbarWidth < 420);
    };
    let measureFrame;
    const scheduleMeasure = () => {
      cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(measureImage);
    };
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(stage);
    scheduleMeasure();
    return () => {
      cancelAnimationFrame(measureFrame);
      observer.disconnect();
    };
  }, [expanded, slideNavigation]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const syncFullscreen = () => {
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      setExpanded(ownsFullscreen.current && fullscreenElement === document.documentElement);
      if (!fullscreenElement) ownsFullscreen.current = false;
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen);
      if (ownsFullscreen.current && (document.fullscreenElement || document.webkitFullscreenElement) === document.documentElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        Promise.resolve(exit?.call(document)).catch(() => {});
      }
    };
  }, []);

  const toggleFullscreen = async () => {
    setFullscreenError('');
    try {
      if (expanded) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        await exit.call(document);
        return;
      }
      const root = document.documentElement;
      const request = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!request) {
        setFullscreenError('เบราว์เซอร์นี้ยังไม่รองรับการเปิดภาพเต็มจอ');
        return;
      }
      ownsFullscreen.current = true;
      await request.call(root);
    } catch {
      ownsFullscreen.current = expanded;
      setFullscreenError('เปิดเต็มจอไม่สำเร็จ ลองกดอีกครั้ง');
    }
  };

  useEffect(() => {
    if (slideNavigation && !filmstripOpen) return;
    const frame = revealThumbnail(filmstripRef, reduceMotion);
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, filmstripOpen, reduceMotion, slideNavigation]);

  useEffect(() => {
    const strip = filmstripRef.current;
    if (!strip) return;
    let frame;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = revealThumbnail(filmstripRef, reduceMotion);
    });
    observer.observe(strip);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [hasMultiple, reduceMotion]);

  const step = (direction) => {
    if (slidesRef.current) {
      slidesRef.current.moveTo((activeIndex + direction + count) % count, direction);
      return;
    }
    setIndex((current) => (Math.min(current, count - 1) + direction + count) % count);
  };

  const goTo = (target) => {
    if (slidesRef.current) slidesRef.current.moveTo(target);
    else setIndex(target);
  };

  const handleKeyDown = (event) => {
    event.stopPropagation();
    if (slideNavigation) {
      const zoomKeys = {
        '+': () => zoomRef.current?.zoom(1.25),
        '=': () => zoomRef.current?.zoom(1.25),
        '-': () => zoomRef.current?.zoom(0.8),
        '0': () => zoomRef.current?.reset(),
      };
      if (zoomKeys[event.key]) {
        event.preventDefault();
        zoomKeys[event.key]();
        return;
      }
      if (zoom > 1 && event.key.startsWith('Arrow')) {
        const pan = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
        event.preventDefault();
        zoomRef.current?.pan(...pan[event.key]);
        return;
      }
    }
    if (!hasMultiple) return;

    switch (event.key) {
      case 'ArrowLeft':
        step(-1);
        break;
      case 'ArrowRight':
        step(1);
        break;
      case 'Home':
        goTo(0);
        break;
      case 'End':
        goTo(count - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      data-expanded={expanded || undefined}
      data-zoomed={zoom > 1 || undefined}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
      onKeyDown={handleKeyDown}
      className={`select-none m-auto h-dvh max-h-none w-full max-w-none overflow-hidden overscroll-contain bg-[#101010] p-0 text-white backdrop:bg-black/80 sm:h-[min(90dvh,50rem)] sm:w-[calc(100%_-_2rem)] sm:max-w-6xl sm:rounded-2xl sm:border sm:border-white/15 sm:shadow-2xl ${slideNavigation ? styles.lightbox : ''} ${className}`}
    >
      <div data-lightbox-layout="" className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        {fullscreenError && <p role="status" className="absolute bottom-28 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-lg bg-black/85 px-3 py-2 text-center text-xs text-white">{fullscreenError}</p>}
        <header className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 sm:px-5 sm:pt-2.5">
          <div data-lightbox-heading="" className="flex min-w-0 items-center gap-3">
            {slideNavigation && <Images data-lightbox-album-icon="" aria-hidden="true" className="size-5 shrink-0" />}
            <h2 id={titleId} className="truncate text-sm font-bold sm:text-base">{title}</h2>
            {slideNavigation && (
              <span data-lightbox-header-count="" aria-live="polite" aria-atomic="true" className="shrink-0 text-xs text-white/60 tabular-nums">
                <span className="sr-only">รูปที่ </span>{activeIndex + 1} / {count}
              </span>
            )}
          </div>
          <div data-lightbox-actions="" className="flex shrink-0 items-center gap-1">
            {slideNavigation && (
              <>
                <button type="button" className={`${controlClass} disabled:opacity-30`} aria-label="ซูมออก" title="ซูมออก (-)" disabled={zoom <= 1} onClick={() => zoomRef.current?.zoom(0.8)}><ZoomOut aria-hidden="true" className="size-5" /></button>
                <button type="button" data-lightbox-zoom-reset="" className="min-h-11 min-w-11 cursor-pointer text-xs text-white/65 tabular-nums focus-visible:outline-2 focus-visible:outline-[#FF963D]" aria-label="คืนขนาดพอดีจอ" title="คืนขนาดพอดีจอ (0)" onClick={() => zoomRef.current?.reset()}>{Math.round(zoom * 100)}%</button>
                <button type="button" className={`${controlClass} disabled:opacity-30`} aria-label="ซูมเข้า" title="ซูมเข้า (+)" disabled={zoom >= 5} onClick={() => zoomRef.current?.zoom(1.25)}><ZoomIn aria-hidden="true" className="size-5" /></button>
              </>
            )}
            {slideNavigation && (
              <button type="button" className={controlClass} aria-label={expanded ? 'ออกจากเต็มจอ' : 'ขยายเต็มจอ'} title={expanded ? 'ออกจากเต็มจอ' : 'ขยายเต็มจอ'} aria-pressed={expanded} onClick={toggleFullscreen}>
                {expanded ? <Minimize aria-hidden="true" className="size-5" /> : <Maximize aria-hidden="true" className="size-5" />}
              </button>
            )}
            <button type="button" className={controlClass} aria-label="ปิดรูปภาพ" title="ปิดรูปภาพ (Esc)" onClick={() => dialogRef.current?.close()}>
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
        </header>

        <div
          data-lightbox-stage=""
          className="relative flex min-h-0 min-w-0 touch-pan-y items-center justify-center bg-black"
          onTouchStart={(event) => {
            if (useSlides) return;
            if (event.touches.length !== 1) {
              swipeStart.current = null;
              return;
            }
            const { clientX, clientY } = event.touches[0];
            swipeStart.current = { clientX, clientY };
          }}
          onTouchCancel={() => { swipeStart.current = null; }}
          onTouchEnd={(event) => {
            if (useSlides) return;
            const start = swipeStart.current;
            swipeStart.current = null;
            if (!hasMultiple || !start || !event.changedTouches.length) return;
            const { clientX, clientY } = event.changedTouches[0];
            const dx = clientX - start.clientX;
            const dy = clientY - start.clientY;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.25) {
              step(dx > 0 ? -1 : 1);
            }
          }}
        >
          {useSlides
            ? <LightboxSlides ref={slidesRef} images={images} index={activeIndex} onSelect={setIndex} zoomRef={zoomRef} onZoomChange={setZoom} />
            : slideNavigation ? <LightboxZoom key={image.src} ref={zoomRef} onChange={setZoom}><LightboxImage image={image} /></LightboxZoom>
              : <LightboxImage key={image.src} image={image} />}
          {hasMultiple && (
            <>
              <button type="button" aria-label="รูปก่อนหน้า" onClick={() => step(-1)}
                className={`absolute left-2 top-1/2 -translate-y-1/2 backdrop-blur-sm sm:left-5 ${controlClass}`}>
                <ChevronLeft aria-hidden="true" className="size-5" />
              </button>
              <button type="button" aria-label="รูปถัดไป" onClick={() => step(1)}
                className={`absolute right-2 top-1/2 -translate-y-1/2 backdrop-blur-sm sm:right-5 ${controlClass}`}>
                <ChevronRight aria-hidden="true" className="size-5" />
              </button>
            </>
          )}
        </div>

        {showDock && <LightboxDock enabled={slideNavigation && hasMultiple} open={filmstripOpen} onToggle={() => setFilmstripOpen((open) => !open)} controlsId={filmstripId} className="min-w-0 border-t border-white/10 px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-2.5" caption={hasCaption || !slideNavigation ?
          <div data-lightbox-caption="" className="flex min-h-5 items-start justify-between gap-3 text-sm">
            <p className="line-clamp-2 break-words text-white/90">{image.alt}</p>
            <span aria-live="polite" aria-atomic="true" className="shrink-0 text-xs font-semibold text-white/65 tabular-nums">
              <span className="sr-only">รูปที่ </span>{activeIndex + 1} / {count}
            </span>
          </div>
        : null}>
          {hasMultiple && (
            <LayoutGroup id={filmstripId}>
            <motion.div ref={filmstripRef} layoutScroll onLoadCapture={() => revealThumbnail(filmstripRef, reduceMotion)} id={filmstripId} data-lightbox-filmstrip="" role="group" aria-label="เลือกรูปภาพ" className="mt-2 flex gap-1 overflow-x-auto overscroll-x-contain py-1 no-scrollbar">
              {images.map(({ src, alt }, itemIndex) => (
                <motion.button
                  key={`${src}-${itemIndex}`}
                  type="button"
                  aria-label={alt ? `รูปที่ ${itemIndex + 1} ${alt}` : `รูปที่ ${itemIndex + 1}`}
                  aria-current={activeIndex === itemIndex ? 'true' : undefined}
                  onClick={() => goTo(itemIndex)}
                  variants={{ hidden: { opacity: 0, y: reduceMotion ? 0 : 10 }, shown: { opacity: activeIndex === itemIndex ? 1 : 0.65, y: 0 } }}
                  transition={dockTransition}
                  whileHover={{ opacity: 1 }}
                  className={`h-10 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-white/10 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF963D] sm:h-12 sm:w-20 ${activeIndex === itemIndex ? 'ring-2 ring-inset ring-[#FF963D]' : 'opacity-65 hover:opacity-100'
                    }`}
                >
                  <LightboxThumbnail key={src} src={src} />
                  {slideNavigation && activeIndex === itemIndex && (
                    <motion.span data-lightbox-thumbnail-indicator="" layoutId="selected-thumbnail" initial={false} transition={dockTransition} aria-hidden="true" />
                  )}
                </motion.button>
              ))}
            </motion.div>
            </LayoutGroup>
          )}
        </LightboxDock>}
        {slideNavigation && <LightboxInfo image={image} />}
      </div>
    </dialog>, portalTarget
  );
}
