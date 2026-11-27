'use client';

import { useEffect, useImperativeHandle, useRef } from 'react';
import { motion, useMotionValue } from 'framer-motion';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function LightboxZoom({ ref, children, onChange, onGestureStart }) {
  const host = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const tap = useRef(null);
  const lastTouch = useRef(-Infinity);
  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  function apply(nextScale, nextX = x.get(), nextY = y.get()) {
    const element = host.current;
    if (!element) return;
    const image = element.querySelector('img');
    const width = element.clientWidth;
    const height = element.clientHeight;
    const imageStyle = image && getComputedStyle(image);
    const availableWidth = width - (parseFloat(imageStyle?.paddingLeft) || 0) - (parseFloat(imageStyle?.paddingRight) || 0);
    const ratio = image?.naturalWidth / image?.naturalHeight || width / height;
    const fitWidth = Math.min(availableWidth, height * ratio);
    const fitHeight = fitWidth / ratio;
    const boundedScale = image ? clamp(nextScale, 1, 5) : 1;
    const limitX = Math.max(0, (fitWidth * boundedScale - width) / 2);
    const limitY = Math.max(0, (fitHeight * boundedScale - height) / 2);
    scale.set(boundedScale);
    x.set(clamp(nextX, -limitX, limitX));
    y.set(clamp(nextY, -limitY, limitY));
    onChange?.(boundedScale);
  }

  function zoomTo(value, clientX, clientY) {
    const bounds = host.current.getBoundingClientRect();
    const focalX = clientX === undefined ? 0 : clientX - bounds.left - bounds.width / 2;
    const focalY = clientY === undefined ? 0 : clientY - bounds.top - bounds.height / 2;
    const nextScale = clamp(value, 1, 5);
    const factor = nextScale / scale.get();
    apply(nextScale, focalX - (focalX - x.get()) * factor, focalY - (focalY - y.get()) * factor);
  }

  useImperativeHandle(ref, () => ({
    zoom: (factor) => zoomTo(scale.get() * factor),
    reset: () => apply(1, 0, 0),
    pan: (dx, dy) => apply(scale.get(), x.get() + dx, y.get() + dy),
  }));

  useEffect(() => {
    const element = host.current;
    const wheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onGestureStart?.();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      zoomTo(scale.get() * Math.exp(-clamp(delta, -100, 100) * 0.003), event.clientX, event.clientY);
    };
    const observer = new ResizeObserver(() => apply(scale.get()));
    observer.observe(element);
    element.addEventListener('wheel', wheel, { passive: false });
    onChange?.(1);
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
    };
    // Handlers read live motion values and the mounted image geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointerDown(event) {
    if (event.button !== 0) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size >= 2) {
      event.stopPropagation();
      onGestureStart?.();
      tap.current = null;
      const [first, second] = [...pointers.current.values()];
      gesture.current = {
        pinch: true,
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        scale: scale.get(), x: x.get(), y: y.get(),
        centerX: (first.x + second.x) / 2,
        centerY: (first.y + second.y) / 2,
      };
    } else {
      gesture.current = { ...point, panX: x.get(), panY: y.get(), moved: false, consumed: scale.get() > 1, time: event.timeStamp };
      if (scale.get() <= 1) return;
      event.stopPropagation();
    }
  }

  function pointerMove(event) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    if (current.pinch && pointers.current.size >= 2) {
      event.stopPropagation();
      const [first, second] = [...pointers.current.values()];
      const nextScale = clamp(current.scale * Math.hypot(second.x - first.x, second.y - first.y) / current.distance, 1, 5);
      const bounds = host.current.getBoundingClientRect();
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      const factor = nextScale / current.scale;
      apply(nextScale,
        centerX - bounds.left - bounds.width / 2 - (current.centerX - bounds.left - bounds.width / 2 - current.x) * factor,
        centerY - bounds.top - bounds.height / 2 - (current.centerY - bounds.top - bounds.height / 2 - current.y) * factor);
      return;
    }
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.hypot(dx, dy) > 8) current.moved = true;
    if (current.consumed) {
      event.stopPropagation();
      apply(scale.get(), current.panX + dx, current.panY + dy);
    }
  }

  function pointerEnd(event) {
    if (!pointers.current.has(event.pointerId)) return;
    if (event.pointerType === 'touch') lastTouch.current = event.timeStamp;
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (!current) return;
    if (current.pinch || current.consumed) event.stopPropagation();
    if (pointers.current.size) {
      const point = [...pointers.current.values()][0];
      gesture.current = { ...point, panX: x.get(), panY: y.get(), moved: true, consumed: true };
      return;
    }
    gesture.current = null;
    if (event.type !== 'pointerup' || current.pinch || current.moved || event.pointerType !== 'touch' || event.timeStamp - current.time > 300) return;
    const last = tap.current;
    if (last && event.timeStamp - last.time < 300 && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 30) {
      tap.current = null;
      onGestureStart?.();
      zoomTo(scale.get() > 1 ? 1 : 2.5, event.clientX, event.clientY);
    } else {
      tap.current = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    }
  }

  return (
    <div ref={host} data-lightbox-zoom="" className="pointer-events-auto absolute inset-0 touch-none"
      onLoadCapture={() => apply(scale.get())}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd}
      onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
      onDoubleClick={(event) => {
        if (event.nativeEvent.pointerType === 'touch' || event.timeStamp - lastTouch.current < 600) return;
        onGestureStart?.();
        zoomTo(scale.get() > 1 ? 1 : 2.5, event.clientX, event.clientY);
      }}
    >
      <motion.div className="pointer-events-none absolute inset-0" style={{ scale, x, y }}>{children}</motion.div>
    </div>
  );
}
