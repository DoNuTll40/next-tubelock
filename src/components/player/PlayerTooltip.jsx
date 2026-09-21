'use client';

import React, { useState, useRef } from 'react';

/**
 * PlayerTooltip - Translucent frosted-glass tooltip matching TubeLock aesthetic
 * Automatically hides upon clicking the button so it never lingers or blocks modals.
 *
 * @param {string} text - Label describing action (e.g. "เล่น", "คำบรรยาย")
 * @param {string} [hotkey] - Optional keyboard shortcut (e.g. "k", "c", "p", "f", "m")
 * @param {string} [badge] - Optional badge tag (e.g. "เร็วๆ นี้")
 * @param {'top'|'bottom'} [position='top'] - Position relative to button
 * @param {'center'|'left'|'right'} [align='center'] - Alignment relative to button
 * @param {boolean} [disabled=false] - Force hide tooltip (e.g. when menu/modal is open)
 * @param {string} [minWidth] - Optional fixed/min width to prevent layout jump
 * @param {string} [tooltipClassName] - Optional extra class names for tooltip
 * @param {React.ReactNode} children - Button / trigger element
 */
export default function PlayerTooltip({
  text,
  hotkey,
  badge,
  position = 'top',
  align = 'center',
  disabled = false,
  minWidth,
  tooltipClassName = '',
  children,
  className = '',
}) {
  const [isVisible, setIsVisible] = useState(false);
  const isClickedRef = useRef(false);

  if (!text || disabled) return children;

  const handleMouseEnter = () => {
    isClickedRef.current = false;
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    isClickedRef.current = false;
    setIsVisible(false);
  };

  const handleClickCapture = () => {
    isClickedRef.current = true;
    setIsVisible(false);
  };

  const alignClass =
    align === 'left'
      ? 'left-0'
      : align === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2';

  const positionClass = position === 'bottom' ? 'top-full mt-2' : '-top-9.5';

  return (
    <div
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClickCapture={handleClickCapture}
    >
      {children}
      {isVisible && !disabled && (
        <div
          role="tooltip"
          style={minWidth ? { minWidth } : undefined}
          className={`absolute ${positionClass} ${alignClass} pointer-events-none z-50 flex items-center ${
            minWidth ? 'justify-center' : ''
          } gap-1.5 px-2.5 py-1 rounded-lg bg-[#1f1f1f]/75 backdrop-blur-md border border-white/15 text-white text-[11.5px] font-medium tracking-wide shadow-[0_4px_16px_rgba(0,0,0,0.4)] whitespace-nowrap select-none transition-opacity duration-150 ease-out ${tooltipClassName}`}
        >
          <span>{text}</span>
          {hotkey && (
            <kbd className="inline-flex items-center justify-center min-w-[17px] px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase text-white bg-white/10 rounded-[5px] border border-white/30 select-none">
              {hotkey}
            </kbd>
          )}
          {badge && (
            <span className="px-1.5 py-0.5 text-[9.5px] font-semibold text-[#FF7A00] bg-[#FF7A00]/20 rounded border border-[#FF7A00]/30 tracking-tight">
              {badge}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
