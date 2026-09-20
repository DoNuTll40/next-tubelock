'use client';

import React from 'react';

export default function SettingCard({ title, subtitle, children, className = '' }) {
  return (
    <div className={`bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 shadow-xs relative ${className}`}>
      {(title || subtitle) && (
        <div className="p-4 sm:p-5 border-b border-[#F5F2EB] dark:border-white/10 bg-[#FBF9F5]/40 dark:bg-white/[0.02] rounded-t-2xl">
          {title && <h3 className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1] tracking-tight">{title}</h3>}
          {subtitle && <p className="text-xs text-[#8C857B] dark:text-[#888888] mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div className="divide-y divide-[#F5F2EB] dark:divide-white/10">{children}</div>
    </div>
  );
}
