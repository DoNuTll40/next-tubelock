'use client';

import React from 'react';

/**
 * Exact YouTube-style Subtitles (CC) Icon:
 * - active=false (OFF): Outlined rounded box with 2 rows of caption dashes inside
 * - active=true (ON): Solid white filled rounded box with the 2 rows of caption dashes cut out
 */
export default function CcSubtitleIcon({ active = false, className = 'w-5.5 h-5.5' }) {
  if (active) {
    // Solid white rounded box with evenodd cutout dashes (exact match to YouTube active CC icon)
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M5 4C3.34315 4 2 5.34315 2 7V17C2 18.6569 3.34315 20 5 20H19C20.6569 20 22 18.6569 22 17V7C22 5.34315 20.6569 4 19 4H5ZM6 11C6 10.4477 6.44772 10 7 10H9C9.55228 10 10 10.4477 10 11C10 11.5523 9.55228 12 9 12H7C6.44772 12 6 11.5523 6 11ZM12 10C11.4477 10 11 10.4477 11 11C11 11.5523 11.4477 12 12 12H17C17.5523 12 18 11.5523 18 11C18 10.4477 17.5523 10 17 10H12ZM7 14C6.44772 14 6 14.4477 6 15C6 15.5523 6.44772 16 7 16H12C12.5523 16 13 15.5523 13 15C13 14.4477 12.5523 14 12 14H7ZM14 15C14 14.4477 14.4477 14 15 14H17C17.5523 14 18 14.4477 18 15C18 15.5523 17.5523 16 17 16H15C14.4477 16 14 15.5523 14 15Z"
        />
      </svg>
    );
  }

  // Outlined white rounded box with 2 rows of caption dashes inside (exact match to YouTube inactive CC icon)
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M6.5 11H9" />
      <path d="M12 11H17.5" />
      <path d="M6.5 15H12" />
      <path d="M15 15H17.5" />
    </svg>
  );
}
