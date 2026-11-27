'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import RichDescription from '@/components/watch/RichDescription';

const PREVIEW_HEIGHT = 240;

export default function UploadDescriptionPreview({ document, albums }) {
  const [expanded, setExpanded] = useState(false);
  const [collapsedHeight, setCollapsedHeight] = useState(null);
  const content = useRef(null);
  const viewport = useRef(null);
  const id = useId();
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const element = content.current;
    const measure = () => {
      if (!element.clientWidth) return;
      const blocks = [...element.firstElementChild.children];
      const groups = [...element.querySelectorAll('[data-rich-preview-album]')];
      const crossing = groups.find(group => group.offsetTop < PREVIEW_HEIGHT && group.offsetTop + group.offsetHeight > PREVIEW_HEIGHT);
      // Keep an album at the start of the description visible even if it is tall.
      const limit = crossing ? (crossing.offsetTop < 32 ? crossing.offsetTop + crossing.offsetHeight : crossing.offsetTop) : PREVIEW_HEIGHT;
      const last = blocks.findLast(block => block.offsetTop < limit && (block.tagName !== 'P' || block.textContent.trim()));
      const cutoff = element.offsetHeight > limit + 1 ? Math.min(limit, last ? last.offsetTop + last.offsetHeight : limit) : null;
      setCollapsedHeight(cutoff);
      for (const block of [...blocks, ...groups]) {
        block.inert = !expanded && cutoff !== null && block.offsetTop >= cutoff;
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [document, albums, expanded]);

  return <div data-upload-collapse="">
    <div ref={viewport} id={id} data-upload-collapse-viewport="" style={{ height: expanded ? undefined : collapsedHeight ?? undefined }} onFocusCapture={event => {
      if (!expanded && event.target.getBoundingClientRect().bottom > viewport.current.getBoundingClientRect().bottom + 1) setExpanded(true);
    }}>
      <div ref={content} data-upload-collapse-content=""><RichDescription document={document} albums={albums} expanded /></div>
    </div>
    {collapsedHeight !== null && <button type="button" data-upload-expand="" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? 'แสดงน้อยลง' : 'ดูทั้งหมด'}<motion.span initial={false} animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }}><ChevronDown size={14} aria-hidden="true" /></motion.span></button>}
  </div>;
}
