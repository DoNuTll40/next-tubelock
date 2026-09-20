'use client';

import React from 'react';
import { motion } from 'framer-motion';

export default function Switch({ checked, onChange, disabled = false, id }) {
  return (
    <div
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={`w-11 h-6 flex items-center rounded-full p-0.5 cursor-pointer transition-colors duration-200 select-none ${
        disabled ? 'opacity-40 cursor-not-allowed' : ''
      } ${checked ? 'bg-[#FF7A00]' : 'bg-[#E5E0D8] dark:bg-white/20'}`}
    >
      <motion.div
        layout
        className="w-5 h-5 bg-white rounded-full shadow-md pointer-events-none"
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </div>
  );
}
