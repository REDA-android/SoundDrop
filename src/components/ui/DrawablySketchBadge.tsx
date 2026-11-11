'use client';

import React from 'react';

export interface DrawablySketchBadgeProps {
  text: string;
  accent?: 'orange' | 'emerald' | 'sky';
}

/**
 * Hand-drawn seeded SVG sketch callout badge (`drawably.dev` & `koboyo.com` canvas style)
 */
export const DrawablySketchBadge: React.FC<DrawablySketchBadgeProps> = ({
  text,
  accent = 'orange',
}) => {
  const strokeColor =
    accent === 'emerald' ? '#10B981' : accent === 'sky' ? '#38BDF8' : '#FF6A1F';

  return (
    <span className="relative inline-flex items-center px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider text-[#F4F4F6]">
      <svg
        viewBox="0 0 120 32"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        <path
          d="M 4 5 Q 60 2 115 6 Q 118 16 114 27 Q 58 30 5 26 Q 2 15 6 4"
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="180 4"
          opacity="0.75"
        />
      </svg>
      <span className="relative z-10">{text}</span>
    </span>
  );
};
