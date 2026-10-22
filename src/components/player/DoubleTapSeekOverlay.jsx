'use client';

import { useRef, useState, useEffect } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

gsap.registerPlugin(useGSAP);

export default function DoubleTapSeekOverlay({ side, accumulatedSeconds }) {
  const [renderedSide, setRenderedSide] = useState(side);
  const containerRef = useRef(null);
  const rippleRef = useRef(null);
  const arrowsContainerRef = useRef(null);
  const textRef = useRef(null);
  const waveTimelineRef = useRef(null);
  const isExitingRef = useRef(false);

  // Sync when side appears or changes
  useEffect(() => {
    if (side) {
      isExitingRef.current = false;
      setRenderedSide(side);
    }
  }, [side]);

  // Handle smooth GSAP exit animation when side becomes null
  useEffect(() => {
    if (!side && renderedSide && !isExitingRef.current) {
      isExitingRef.current = true;
      if (waveTimelineRef.current) {
        waveTimelineRef.current.kill();
      }

      if (containerRef.current) {
        const isLeft = renderedSide === 'left';
        gsap.to(containerRef.current, {
          opacity: 0,
          x: isLeft ? -45 : 45,
          scale: 0.94,
          duration: 0.22,
          ease: 'power2.in',
          onComplete: () => {
            setRenderedSide(null);
            isExitingRef.current = false;
          },
        });
      } else {
        setRenderedSide(null);
        isExitingRef.current = false;
      }
    }
  }, [side, renderedSide]);

  // Main GSAP Enter + Staggered Wave animation
  useGSAP(
    () => {
      if (!renderedSide || isExitingRef.current) return;

      const isLeft = renderedSide === 'left';
      const container = containerRef.current;
      const arrows = arrowsContainerRef.current?.children;

      if (!container) return;

      // 1. Enter container animation
      gsap.killTweensOf(container);
      gsap.fromTo(
        container,
        { opacity: 0, x: isLeft ? -40 : 40, scale: 0.95 },
        { opacity: 1, x: 0, scale: 1, duration: 0.22, ease: 'power3.out' }
      );

      // 2. Staggered Chevrons Wave Loop (Traveling in seek direction)
      if (arrows && arrows.length > 0) {
        if (waveTimelineRef.current) waveTimelineRef.current.kill();

        const tl = gsap.timeline({ repeat: -1 });
        waveTimelineRef.current = tl;

        // Reset arrow initial state
        gsap.set(arrows, { opacity: 0.25, x: 0, scale: 0.9 });

        tl.to(arrows, {
          opacity: 1,
          scale: 1.25,
          x: isLeft ? -7 : 7,
          duration: 0.26,
          stagger: {
            each: 0.1,
            from: isLeft ? 'end' : 'start', // Left: Right-to-Left wave, Right: Left-to-Right wave
          },
          ease: 'power2.out',
        }).to(
          arrows,
          {
            opacity: 0.25,
            scale: 0.9,
            x: isLeft ? -12 : 12,
            duration: 0.22,
            stagger: {
              each: 0.1,
              from: isLeft ? 'end' : 'start',
            },
            ease: 'power2.in',
          },
          '-=0.14'
        ).set(arrows, { x: 0 });
      }
    },
    { dependencies: [renderedSide], scope: containerRef }
  );

  // Trigger pulse & ripple whenever seconds update (subsequent double/triple taps)
  useGSAP(
    () => {
      if (!renderedSide || !accumulatedSeconds || isExitingRef.current) return;

      const ripple = rippleRef.current;
      const text = textRef.current;

      // Water ripple wave expanding from the tapped edge
      if (ripple) {
        gsap.killTweensOf(ripple);
        gsap.fromTo(
          ripple,
          { scale: 0.25, opacity: 0.7 },
          { scale: 1.75, opacity: 0, duration: 0.45, ease: 'power2.out' }
        );
      }

      // Punchy bouncy pop on the +10s / -10s counter
      if (text) {
        gsap.killTweensOf(text);
        gsap.fromTo(
          text,
          { scale: 1.4, y: -4, color: '#FF9E40' },
          { scale: 1, y: 0, color: '#FFFFFF', duration: 0.32, ease: 'back.out(2.4)' }
        );
      }
    },
    { dependencies: [accumulatedSeconds], scope: containerRef }
  );

  if (!renderedSide) return null;

  const isLeft = renderedSide === 'left';
  const formattedSeconds =
    accumulatedSeconds !== 0
      ? accumulatedSeconds > 0
        ? `+${accumulatedSeconds}`
        : `${accumulatedSeconds}`
      : isLeft
      ? '-10'
      : '+10';

  return (
    <div
      ref={containerRef}
      className={`absolute top-0 bottom-0 ${
        isLeft
          ? 'left-0 w-[42%] max-w-[280px] rounded-r-[120px] sm:rounded-r-[150px] justify-start pl-7 sm:pl-16 border-r border-white/10 bg-gradient-to-r from-black/85 via-black/45 to-transparent'
          : 'right-0 w-[42%] max-w-[280px] rounded-l-[120px] sm:rounded-l-[150px] justify-end pr-7 sm:pr-16 border-l border-white/10 bg-gradient-to-l from-black/85 via-black/45 to-transparent'
      } flex items-center pointer-events-none z-30 select-none overflow-hidden backdrop-blur-[1px]`}
    >
      {/* Expanding Water Ripple */}
      <div
        ref={rippleRef}
        className="absolute top-1/2 -translate-y-1/2 w-44 h-44 sm:w-60 sm:h-60 rounded-full bg-white/20 pointer-events-none -z-10"
        style={{
          [isLeft ? 'left' : 'right']: '10%',
          transformOrigin: 'center center',
        }}
      />

      {/* Main Content: Chevrons + Text */}
      <div className="relative z-10 flex flex-col items-center gap-1.5 drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
        {/* Chevron Staggered Wave */}
        <div ref={arrowsContainerRef} className="flex items-center gap-0.5">
          {isLeft ? (
            <>
              <ChevronLeft className="w-6 h-6 sm:w-7 sm:h-7 text-[#FF7A00]" />
              <ChevronLeft className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              <ChevronLeft className="w-6 h-6 sm:w-7 sm:h-7 text-white/70" />
            </>
          ) : (
            <>
              <ChevronRight className="w-6 h-6 sm:w-7 sm:h-7 text-white/70" />
              <ChevronRight className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              <ChevronRight className="w-6 h-6 sm:w-7 sm:h-7 text-[#FF7A00]" />
            </>
          )}
        </div>

        {/* Counter Badge */}
        <div
          ref={textRef}
          className="flex items-center justify-center font-bold text-xs sm:text-sm tracking-wide text-white drop-shadow-md whitespace-nowrap"
        >
          <span>{formattedSeconds} วินาที</span>
        </div>
      </div>
    </div>
  );
}
