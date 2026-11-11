'use client';

import React from 'react';

export type MorphIconState =
  | 'SEND'
  | 'CHECK'
  | 'MIC'
  | 'WAVE'
  | 'FOLDER'
  | 'ZIP'
  | 'LOCK'
  | 'RADAR';

export interface MorphIconProps {
  state: MorphIconState;
  size?: number;
  className?: string;
}

const MORPH_PATHS: Record<MorphIconState, { d1: string; d2: string }> = {
  SEND: {
    d1: 'M 5 19 L 19 5',
    d2: 'M 9 5 L 19 5 L 19 15',
  },
  CHECK: {
    d1: 'M 4 12.5 L 9.5 18',
    d2: 'M 9.5 18 L 20 6.5',
  },
  MIC: {
    d1: 'M 12 3 L 12 14 M 9 6 L 15 6',
    d2: 'M 6 11 C 6 15.5 18 15.5 18 11 M 12 16 L 12 21',
  },
  WAVE: {
    d1: 'M 3 12 L 7 6 L 11 18 L 15 5',
    d2: 'M 15 5 L 18 16 L 21 12',
  },
  FOLDER: {
    d1: 'M 3 7 L 9 7 L 11 9 L 21 9 L 21 19 L 3 19 Z',
    d2: 'M 3 12 L 21 12',
  },
  ZIP: {
    d1: 'M 4 4 L 20 4 L 20 20 L 4 20 Z',
    d2: 'M 12 4 L 12 16 M 10 8 L 14 8 M 10 12 L 14 12',
  },
  LOCK: {
    d1: 'M 6 11 L 18 11 L 18 20 L 6 20 Z',
    d2: 'M 8 11 L 8 7 C 8 4.5 16 4.5 16 7 L 16 11',
  },
  RADAR: {
    d1: 'M 12 12 m -8 0 a 8 8 0 1 0 16 0 a 8 8 0 1 0 -16 0',
    d2: 'M 12 12 L 18 6',
  },
};

/**
 * Spring-Physics SVG Path Morphing Icon (`morphicons.com` & `kinetics.colorion.co`)
 * Smoothly transitions stroke geometry using spring cubic-bezier physics.
 */
export const MorphIcon: React.FC<MorphIconProps> = ({
  state,
  size = 18,
  className = '',
}) => {
  const paths = MORPH_PATHS[state] || MORPH_PATHS.SEND;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${className}`}
    >
      <path
        d={paths.d1}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
      />
      <path
        d={paths.d2}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
      />
    </svg>
  );
};
