'use client';

import React from 'react';
import { motion } from 'framer-motion';

export type MorphIconState = 'radar' | 'transmitting' | 'paired';

interface MorphingIconProps {
  state: MorphIconState;
  className?: string;
}

export const MorphingIcon: React.FC<MorphingIconProps> = ({ state, className = 'w-8 h-8' }) => {
  // Morphicons SVG path coordinates:
  // radar: concentric acoustic arcs
  // transmitting: dual outward sound arrows / radiating rings
  // paired: clean checkmark
  const getPathData = () => {
    switch (state) {
      case 'paired':
        return 'M 5 12 L 10 17 L 19 7';
      case 'transmitting':
        return 'M 4 4 L 12 12 L 4 20 M 12 4 L 20 12 L 12 20';
      case 'radar':
      default:
        return 'M 3 12 A 9 9 0 0 1 21 12 M 7 12 A 5 5 0 0 1 17 12 M 11 12 A 1 1 0 0 1 13 12';
    }
  };

  const getColor = () => {
    switch (state) {
      case 'paired':
        return '#10B981'; // Emerald
      case 'transmitting':
        return '#06B6D4'; // Cyan
      case 'radar':
      default:
        return '#94A3B8'; // Slate
    }
  };

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke={getColor()}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full transition-colors duration-500"
      >
        <motion.path
          d={getPathData()}
          initial={false}
          animate={{ d: getPathData() }}
          transition={{
            duration: 0.45,
            ease: [0.16, 1, 0.3, 1],
          }}
        />
      </svg>
    </div>
  );
};
