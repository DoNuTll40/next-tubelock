'use client';

import React from 'react';

export default function SegmentedControl({ options = [], value, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 p-1 bg-[#FBF9F5] border border-[#EFECE6] rounded-xl select-none">
      {options.map((opt) => {
        const isSelected = String(value) === String(opt.value);
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${
              isSelected
                ? 'bg-[#FF7A00] text-white shadow-xs'
                : 'text-[#212529] hover:bg-white/80'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
