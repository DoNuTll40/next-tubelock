'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

const spring = { type: 'spring', stiffness: 420, damping: 38, mass: 0.8 };

export default function LightboxDock({ enabled, open, onToggle, controlsId, className, caption, children }) {
  const footerRef = useRef(null);
  const contentRef = useRef(null);
  const [size, setSize] = useState({ width: 640, height: 64 });
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    if (!enabled) return;
    const footer = footerRef.current;
    const content = contentRef.current;
    const stage = footer.parentElement.querySelector('[data-lightbox-stage]');
    const strip = content.querySelector('[data-lightbox-filmstrip]');
    const measure = () => {
      const reserve = parseFloat(getComputedStyle(footer).getPropertyValue('--gallery-filmstrip-reserve')) || 0;
      const buttons = [...(strip?.querySelectorAll('button') || [])];
      const gap = strip ? parseFloat(getComputedStyle(strip).columnGap) || 0 : 0;
      const padding = getComputedStyle(content);
      // Ignore the filmstrip's dynamic scroll padding used to center end thumbnails.
      const stripInset = parseFloat(getComputedStyle(footer).getPropertyValue('--gallery-filmstrip-inset')) || 0;
      const naturalWidth = buttons.reduce((total, button) => total + button.offsetWidth, 0)
        + gap * Math.max(0, buttons.length - 1) + stripInset
        + (parseFloat(padding.paddingLeft) || 0) + (parseFloat(padding.paddingRight) || 0);
      const width = Math.ceil(Math.min(Math.max(44, naturalWidth), 640, Math.max(44, stage.clientWidth - reserve)));
      const height = Math.ceil(content.getBoundingClientRect().height);
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    let frame;
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(stage);
    observer.observe(content);
    const observeThumbnails = () => {
      strip?.querySelectorAll('button').forEach(button => observer.observe(button));
      scheduleMeasure();
    };
    const mutations = new MutationObserver(observeThumbnails);
    if (strip) mutations.observe(strip, { childList: true });
    observeThumbnails();
    content.addEventListener('load', scheduleMeasure, true);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      content.removeEventListener('load', scheduleMeasure, true);
    };
  }, [enabled]);

  if (!enabled) return <footer className={className}>{caption}{children}</footer>;

  const transition = reduceMotion ? { duration: 0 } : spring;
  return (
    <motion.footer
      ref={footerRef}
      data-lightbox-animated-dock=""
      data-filmstrip-open={open}
      initial={false}
      animate={{ width: open ? size.width : 44, height: open ? size.height + 32 : 32 }}
      transition={transition}
      className={className}
    >
      <motion.button
        type="button"
        data-lightbox-filmstrip-toggle=""
        aria-label={open ? 'ซ่อนภาพย่อ' : 'แสดงภาพย่อ'}
        aria-expanded={open}
        aria-controls={controlsId}
        onClick={onToggle}
        whileTap={reduceMotion ? undefined : { scale: 0.92 }}
        className="grid w-11 cursor-pointer place-items-center text-white/80 hover:text-white focus-visible:outline-2 focus-visible:outline-[#FF963D]"
      >
        <motion.span initial={false} animate={{ rotate: open ? 0 : 180 }} transition={transition}>
          <ChevronDown aria-hidden="true" className="size-4" />
        </motion.span>
      </motion.button>
      <motion.div
        ref={contentRef}
        data-lightbox-dock-content=""
        inert={!open}
        aria-hidden={!open}
        style={{ width: size.width }}
        initial={false}
        animate={open ? 'shown' : 'hidden'}
        variants={{ hidden: { opacity: 0, y: reduceMotion ? 0 : 8 }, shown: { opacity: 1, y: 0 } }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.18, delay: open ? 0.06 : 0, staggerChildren: 0.018 }}
      >
        {caption}
        {children}
      </motion.div>
    </motion.footer>
  );
}
