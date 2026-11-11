'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface KineticCanvasProps {
  isBroadcasting: boolean;
  isPaired: boolean;
  children?: React.ReactNode;
}

export const KineticCanvas: React.FC<KineticCanvasProps> = ({
  isBroadcasting,
  isPaired,
  children,
}) => {
  return (
    <div className="relative w-full h-[480px] rounded-3xl overflow-hidden hairline-border bg-[#07090e] flex items-center justify-center select-none shadow-2xl">
      {/* Kinetics Colorion: Multi-phase Morphing Mesh Gradient */}
      <motion.div
        animate={
          isPaired
            ? {
                background: [
                  'radial-gradient(circle at 30% 40%, rgba(16,185,129,0.22) 0%, transparent 60%), radial-gradient(circle at 70% 60%, rgba(6,182,212,0.25) 0%, transparent 60%)',
                  'radial-gradient(circle at 60% 30%, rgba(6,182,212,0.25) 0%, transparent 60%), radial-gradient(circle at 40% 70%, rgba(16,185,129,0.22) 0%, transparent 60%)',
                  'radial-gradient(circle at 30% 40%, rgba(16,185,129,0.22) 0%, transparent 60%), radial-gradient(circle at 70% 60%, rgba(6,182,212,0.25) 0%, transparent 60%)',
                ],
              }
            : isBroadcasting
            ? {
                background: [
                  'radial-gradient(circle at 50% 50%, rgba(6,182,212,0.3) 0%, transparent 70%), radial-gradient(circle at 20% 80%, rgba(37,99,235,0.2) 0%, transparent 50%)',
                  'radial-gradient(circle at 50% 50%, rgba(37,99,235,0.3) 0%, transparent 70%), radial-gradient(circle at 80% 20%, rgba(6,182,212,0.2) 0%, transparent 50%)',
                ],
              }
            : {
                background:
                  'radial-gradient(circle at 50% 50%, rgba(15,23,42,0.6) 0%, transparent 70%)',
              }
        }
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute inset-0 pointer-events-none"
      />

      {/* Drawably Dynamic Hand-Drawn Vector Wave Arcs */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
        <path
          d="M 120 240 Q 240 160 360 240 T 600 240"
          fill="none"
          stroke={isPaired ? '#10b981' : isBroadcasting ? '#06b6d4' : '#334155'}
          strokeWidth="1.5"
          className="drawably-accent"
        />
        <path
          d="M 80 280 Q 200 360 320 280 T 560 280"
          fill="none"
          stroke={isPaired ? '#10b981' : isBroadcasting ? '#06b6d4' : '#1e293b'}
          strokeWidth="1"
          className="drawably-accent"
        />
      </svg>

      {/* Foreground Child Content */}
      <div className="relative z-10 w-full h-full flex items-center justify-center">
        {children}
      </div>
    </div>
  );
};
