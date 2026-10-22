'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

export default function FeedSkeleton({ count = 8 }) {
  const containerRef = useRef(null);

  useGSAP(
    () => {
      const cards = containerRef.current?.querySelectorAll('.skeleton-card');
      if (!cards || cards.length === 0) return;

      // Create a coordinated shimmer wave across cards
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.35 });

      cards.forEach((card, idx) => {
        const beams = card.querySelectorAll('.shimmer-wave');
        tl.fromTo(
          beams,
          { xPercent: -100 },
          {
            xPercent: 100,
            duration: 1.15,
            ease: 'power1.inOut',
          },
          idx * 0.1 // Staggers each card by 0.1s for a fluid wave effect
        );
      });

      return () => {
        tl.kill();
      };
    },
    { scope: containerRef }
  );

  return (
    <div
      ref={containerRef}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-x-4 gap-y-6 select-none"
    >
      {Array.from({ length: count }, (_, i) => i + 1).map((i) => (
        <div key={i} className="skeleton-card flex flex-col gap-2.5">
          {/* Thumbnail Skeleton */}
          <div className="relative overflow-hidden aspect-video w-full bg-[#EFECE6] dark:bg-white/10 rounded-2xl">
            <div className="shimmer-wave absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/55 dark:via-white/12 to-transparent pointer-events-none" />
          </div>

          {/* Details (Avatar + Titles) Skeleton */}
          <div className="flex gap-3 pt-1">
            <div className="relative overflow-hidden w-9 h-9 rounded-full bg-[#EFECE6] dark:bg-white/10 shrink-0">
              <div className="shimmer-wave absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/55 dark:via-white/12 to-transparent pointer-events-none" />
            </div>

            <div className="flex-1 space-y-2">
              <div className="relative overflow-hidden h-3.5 w-4/5 bg-[#EFECE6] dark:bg-white/10 rounded">
                <div className="shimmer-wave absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/55 dark:via-white/12 to-transparent pointer-events-none" />
              </div>

              <div className="relative overflow-hidden h-3 w-1/2 bg-[#EFECE6] dark:bg-white/10 rounded">
                <div className="shimmer-wave absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/55 dark:via-white/12 to-transparent pointer-events-none" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
