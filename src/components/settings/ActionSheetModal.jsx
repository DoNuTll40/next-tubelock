'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';

export default function ActionSheetModal({ sheet, onClose }) {
  if (!sheet) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center select-none">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/50 backdrop-blur-xs"
        />

        {/* Modal Container */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 50, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="relative z-10 w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl border border-[#EFECE6] p-5 pb-8 sm:pb-6 flex flex-col gap-2 shadow-2xl"
        >
          {/* Mobile Handle Bar */}
          <div className="w-10 h-1 bg-[#E0DDD5] rounded-full mx-auto mb-2 sm:hidden" />

          {/* Title */}
          <h3 className="text-sm font-bold text-[#212529] px-2 pb-2 border-b border-[#F5F2EB]">
            {sheet.title}
          </h3>

          {/* Options */}
          <div className="flex flex-col py-1 max-h-[50vh] overflow-y-auto">
            {sheet.options.map((opt) => {
              const isSelected = String(sheet.current) === String(opt.value);
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => {
                    sheet.onSelect(opt.value);
                    onClose();
                  }}
                  className="flex items-center justify-between p-3.5 hover:bg-[#FBF9F5] active:bg-[#F5F2EB] rounded-xl transition text-left cursor-pointer"
                >
                  <span className={`text-xs ${isSelected ? 'font-bold text-[#FF7A00]' : 'text-[#212529]'}`}>
                    {opt.label}
                  </span>
                  {isSelected && <Check className="w-4 h-4 text-[#FF7A00] stroke-[2.5]" />}
                </button>
              );
            })}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
