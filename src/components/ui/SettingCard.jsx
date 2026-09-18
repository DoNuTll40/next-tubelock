'use client';

import React from 'react';

export default function SettingCard({ title, subtitle, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-[#EFECE6] shadow-xs relative ${className}`}>
      {(title || subtitle) && (
        <div className="p-4 sm:p-5 border-b border-[#F5F2EB] bg-[#FBF9F5]/40 rounded-t-2xl">
          {title && <h3 className="text-sm font-bold text-[#212529] tracking-tight">{title}</h3>}
          {subtitle && <p className="text-xs text-[#8C857B] mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div className="divide-y divide-[#F5F2EB]">{children}</div>
    </div>
  );
}
