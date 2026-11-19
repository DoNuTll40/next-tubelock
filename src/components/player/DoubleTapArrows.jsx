'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function DoubleTapArrows({ side }) {
  const isLeft = side === 'left';
  const animName = isLeft ? 'dt-arrow-left' : 'dt-arrow-right';
  const delays = isLeft ? ['180ms', '90ms', '0ms'] : ['0ms', '90ms', '180ms'];
  const Icon = isLeft ? ChevronLeft : ChevronRight;
  const colorClasses = isLeft
    ? ['text-[#FF7A00]', 'text-white', 'text-white/50']
    : ['text-white/50', 'text-white', 'text-[#FF7A00]'];

  return (
    <div className="flex items-center gap-0.5">
      {delays.map((delay, idx) => (
        <Icon
          key={idx}
          className={`w-6 h-6 ${colorClasses[idx]}`}
          style={{
            animation: `${animName} 0.65s ease-in-out infinite`,
            animationDelay: delay,
            willChange: 'transform, opacity',
          }}
        />
      ))}
    </div>
  );
}
