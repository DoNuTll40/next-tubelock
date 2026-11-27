'use client';

import { useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionTemplate, useMotionValue, useReducedMotion } from 'framer-motion';
import BrowserMediaImage from '@/components/BrowserMediaImage';
import LightboxZoom from './LightboxZoom';

export function LightboxErrorGraphic({ className }) {
  return (
    <svg data-lightbox-error-graphic="" aria-hidden="true" viewBox="0 0 160 112" fill="none" className={className}>
      <rect x="18" y="12" width="116" height="82" rx="10" fill="#181818" stroke="#383838" strokeWidth="2" />
      <circle cx="50" cy="38" r="8" fill="#FF963D" fillOpacity="0.16" stroke="#FF963D" strokeWidth="2" />
      <path d="m28 80 29-29 17 17 16-19 34 31" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m30 22 92 62" stroke="#181818" strokeWidth="9" />
      <path d="m30 22 92 62" stroke="#FF963D" strokeWidth="2" strokeLinecap="round" />
      <circle cx="129" cy="86" r="17" fill="#241B14" stroke="#FF963D" strokeWidth="2" />
      <path d="M129 78v9" stroke="#FF963D" strokeWidth="2" strokeLinecap="round" />
      <circle cx="129" cy="93" r="1.2" fill="#FF963D" />
    </svg>
  );
}

export function LightboxImage({ image, fade = true }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div data-lightbox-error="" role="status" className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-white/70">
        <div data-lightbox-error-panel="" className="flex max-w-full flex-col items-center gap-3 rounded-2xl px-6 py-5">
          <LightboxErrorGraphic className="h-24 w-36 shrink-0" />
          <p className="font-semibold text-white/90">เปิดรูปนี้ไม่สำเร็จ</p>
          <p className="max-w-64 text-xs leading-relaxed text-white/50">ไฟล์อาจไม่พร้อมใช้งาน ลองเปิดใหม่อีกครั้ง</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserMediaImage
      src={image.src}
      alt={image.alt}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className={`h-full min-h-0 w-full min-w-0 object-contain ${fade ? 'motion-safe:[animation:fadein_0.18s_ease-out]' : ''}`}
    />
  );
}

export default function LightboxSlides({ ref, images, index, onSelect, zoomRef, onZoomChange }) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const movingRef = useRef(false);
  const [trip, setTrip] = useState(null);
  const reduceMotion = useReducedMotion();
  const position = useMotionValue(0);
  const x = useMotionTemplate`${position}%`;
  const count = images.length;
  const previous = (index + count - 1) % count;
  const next = (index + 1) % count;

  function moveTo(target, direction = target > index ? 1 : -1) {
    if (movingRef.current || dragRef.current) return;
    zoomRef.current?.reset();
    if (target === index) {
      if (position.get() === 0) return;
      direction = 0;
    }
    if (reduceMotion) {
      position.set(0);
      onSelect(target);
      return;
    }
    movingRef.current = true;
    setTrip({ target, direction });
  }

  useImperativeHandle(ref, () => ({ moveTo }));

  useLayoutEffect(() => {
    if (!trip) {
      // Reset to the center before painting the newly selected frame.
      position.jump(0);
      if (trackRef.current) trackRef.current.style.transform = 'none';
      movingRef.current = false;
      return;
    }

    const playback = animate(position, -trip.direction * 100, {
      type: 'spring',
      stiffness: 340,
      damping: 32,
      mass: 0.7,
      restDelta: 0.1,
      onComplete: () => {
        onSelect(trip.target);
        setTrip(null);
      },
    });

    return () => playback.stop();
  }, [onSelect, position, trip]);

  function beginDrag(event) {
    if (!event.isPrimary || event.button !== 0 || movingRef.current || dragRef.current) return;
    if (!event.target.closest('[data-lightbox-zoom]')) event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedAt: event.timeStamp,
      horizontal: null,
    };
  }

  function moveDrag(event) {
    const drag = dragRef.current;
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.horizontal === null && Math.max(Math.abs(dx), Math.abs(dy)) >= 7) {
      drag.horizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (!drag.horizontal) return;
    const displacement = dx / Math.max(1, event.currentTarget.clientWidth) * 100;
    position.set(Math.max(-100, Math.min(100, displacement)));
  }

  function endDrag(event, cancelled = false) {
    const drag = dragRef.current;
    if (drag?.id !== event.pointerId) return;
    dragRef.current = null;
    const dx = event.clientX - drag.x;
    const distance = Math.abs(dx);
    const width = event.currentTarget.clientWidth;
    const speed = distance / Math.max(1, event.timeStamp - drag.startedAt);
    const advance = !cancelled && drag.horizontal &&
      (distance >= Math.min(100, width * 0.2) || (distance >= 26 && speed >= 0.45));
    if (advance) {
      moveTo(dx < 0 ? next : previous, dx < 0 ? 1 : -1);
    } else {
      moveTo(index);
    }
  }

  const frames = [
    trip?.direction === -1 ? trip.target : previous,
    index,
    trip?.direction === 1 ? trip.target : next,
  ];

  return (
    <div
      className="absolute inset-0 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={(event) => endDrag(event, true)}
      onLostPointerCapture={(event) => endDrag(event, true)}
    >
      <motion.div ref={trackRef} data-lightbox-slides="" className="pointer-events-none absolute inset-0" style={{ x }}>
        {frames.map((frame, slot) => (
          <div
            key={frames.indexOf(frame) === slot ? frame : `${frame}-duplicate`}
            aria-hidden={slot !== 1 || undefined}
            className="absolute inset-y-0 flex w-full items-center justify-center"
            style={{ left: `${(slot - 1) * 100}%` }}
          >
            {slot === 1 ? (
              <LightboxZoom key={images[frame].src} ref={zoomRef} onChange={onZoomChange} onGestureStart={() => {
                dragRef.current = null;
                position.jump(0);
              }}>
                <LightboxImage image={images[frame]} fade={false} />
              </LightboxZoom>
            ) : <LightboxImage key={images[frame].src} image={images[frame]} fade={false} />}
          </div>
        ))}
      </motion.div>
    </div>
  );
}
