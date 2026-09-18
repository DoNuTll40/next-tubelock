'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

/**
 * Reusable Custom Select / Dropdown Component
 * Matches TubeLock Warm Palette (#FBF9F5, #FF7A00, #212529)
 * Supports Smart Auto-Flipping (upward / downward) to avoid viewport/card clipping
 */
export default function Select({
  options = [],
  value,
  onChange,
  placeholder = 'เลือกตัวเลือก...',
  className = '',
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Smart flip: check space below vs above when opening
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 250 && rect.top > 250) {
        setOpenUpward(true);
      } else {
        setOpenUpward(false);
      }
    }
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleSelect = (val) => {
    onChange?.(val);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative inline-block text-left select-none ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`flex items-center justify-between gap-2.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
          disabled
            ? 'opacity-50 cursor-not-allowed bg-[#EFECE6] border-transparent text-[#8C857B]'
            : isOpen
            ? 'bg-white border-[#FF7A00] ring-3 ring-[#FF7A00]/15 text-[#212529] shadow-xs'
            : 'bg-[#FBF9F5] hover:bg-white border-[#E5DFD5] hover:border-[#D5CFC5] text-[#212529] shadow-2xs'
        }`}
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[#8C857B] transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180 text-[#FF7A00]' : ''
          }`}
        />
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div
          role="listbox"
          className={`absolute right-0 min-w-[230px] max-w-[340px] w-max bg-white rounded-2xl border border-[#E5DFD5] shadow-2xl py-1.5 z-50 focus:outline-none animate-fadeIn ${
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          <div className="max-h-64 overflow-y-auto py-0.5 px-1 space-y-0.5">
            {options.map((opt) => {
              const isSelected = opt.value === value;
              const Icon = opt.icon;

              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt.value)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-xs text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#FFF4EB] text-[#FF7A00] font-bold'
                      : 'text-[#212529] hover:bg-[#F7F4EE] hover:text-[#FF7A00]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {Icon && (
                      <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#FF7A00]' : 'text-[#8C857B]'}`} />
                    )}
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{opt.label}</span>
                      {opt.desc && (
                        <span className="text-[10px] text-[#8C857B] font-normal truncate mt-0.5">
                          {opt.desc}
                        </span>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-[#FF7A00] shrink-0 stroke-[2.5]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Export as Dropdown alias
export { Select as Dropdown };
