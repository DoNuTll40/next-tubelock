'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

gsap.registerPlugin(useGSAP);

export default function DoubleTapArrows({ side }) {
  const containerRef = useRef(null);

  useGSAP(
    () => {
      const isLeft = side === 'left';
      const arrows = containerRef.current?.children;
      if (!arrows || arrows.length === 0) return;

      // Initial state
      gsap.set(arrows, { opacity: 0.25, x: 0, scale: 0.95 });

      // Staggered rippling wave in seek direction
      const tl = gsap.timeline({ repeat: -1 });
      tl.to(arrows, {
        opacity: 1,
        scale: 1.25,
        x: isLeft ? -5 : 5,
        duration: 0.22,
        stagger: {
          each: 0.09,
          from: isLeft ? 'end' : 'start', // Left: Right-to-Left, Right: Left-to-Right
        },
        ease: 'power2.out',
      }).to(
        arrows,
        {
          opacity: 0.25,
          scale: 0.95,
          x: isLeft ? -9 : 9,
          duration: 0.18,
          stagger: {
            each: 0.09,
            from: isLeft ? 'end' : 'start',
          },
          ease: 'power2.in',
        },
        '-=0.1'
      ).set(arrows, { x: 0 });

      return () => {
        tl.kill();
      };
    },
    { dependencies: [side], scope: containerRef }
  );

  return (
    <div ref={containerRef} className="flex items-center gap-0.5">
      {side === 'left' ? (
        <>
          <ChevronLeft className="w-6 h-6 text-[#FF7A00]" />
          <ChevronLeft className="w-6 h-6 text-white" />
          <ChevronLeft className="w-6 h-6 text-white/50" />
        </>
      ) : (
        <>
          <ChevronRight className="w-6 h-6 text-white/50" />
          <ChevronRight className="w-6 h-6 text-white" />
          <ChevronRight className="w-6 h-6 text-[#FF7A00]" />
        </>
      )}
    </div>
  );
}
