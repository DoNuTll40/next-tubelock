'use client';

import React from 'react';

export default function SettingRow({
  title,
  description,
  children,
  onClick,
  isClickable = false,
  className = '',
}) {
  return (
    <div
      onClick={onClick}
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 transition-colors ${
        isClickable ? 'cursor-pointer hover:bg-zinc-50 active:bg-zinc-100' : ''
      } ${className}`}
    >
      <div className="flex flex-col pr-2">
        <span className="text-xs sm:text-sm font-semibold text-[#212529]">{title}</span>
        {description && (
          <span className="text-[11px] text-[#8C857B] mt-0.5 leading-relaxed">{description}</span>
        )}
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
}
