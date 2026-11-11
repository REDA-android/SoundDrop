'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface AcousticRippleWaveProps {
  isBroadcasting: boolean;
  isReceiving: boolean;
  targetCoords?: { x: number; y: number } | null;
  packetProgress?: number; // 0 to 100
}

export const AcousticRippleWave: React.FC<AcousticRippleWaveProps> = ({
  isBroadcasting,
  isReceiving,
  targetCoords,
  packetProgress = 0,
}) => {
  // Compute cubic-bezier control points from center (0,0) to targetCoords (tx, ty)
  const tx = targetCoords?.x || 0;
  const ty = targetCoords?.y || 0;

  // Control points curving sideways like a liquid magnetic acoustic wave
  const c1x = tx * 0.25 - ty * 0.25;
  const c1y = ty * 0.25 + tx * 0.25;
  const c2x = tx * 0.75 + ty * 0.15;
  const c2y = ty * 0.75 - tx * 0.15;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-center justify-center">
      {/* Concentric Ambient Radar Circles */}
      <div className="absolute w-[280px] h-[280px] rounded-full border border-slate-800/60" />
      <div className="absolute w-[440px] h-[440px] rounded-full border border-slate-800/40" />
      <div className="absolute w-[600px] h-[600px] rounded-full border border-slate-800/20" />

      {/* Broadcasting Dynamic Expanding Rings */}
      {isBroadcasting && (
        <>
          {[0, 0.4, 0.8, 1.2].map((delay, i) => (
            <motion.div
              key={`tx-${i}`}
              initial={{ scale: 0.2, opacity: 0.9 }}
              animate={{ scale: 2.3, opacity: 0 }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                delay,
                ease: 'easeOut',
              }}
              className="absolute w-48 h-48 rounded-full border-2 border-cyan-400/80 shadow-[0_0_25px_rgba(6,182,212,0.5)]"
            />
          ))}
        </>
      )}

      {/* Receiving Inward Ultrasonic Radar Sweeper */}
      {isReceiving && !isBroadcasting && (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
          className="absolute w-[440px] h-[440px] rounded-full border border-emerald-500/20"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(16, 185, 129, 0.18) 60deg, transparent 90deg)',
          }}
        />
      )}

      {/* Liquid Magnetic Cubic-Bezier Tether & Packet Stream */}
      {targetCoords && (
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ overflow: 'visible' }}
        >
          <defs>
            {/* Linear Gradient for Liquid Tether */}
            <linearGradient id="tetherGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#10B981" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.9" />
            </linearGradient>

            {/* Glowing filter for traveling data orbs */}
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* SVG Group Centered at (50%, 50%) via CSS transform for broad iOS/Safari support */}
          <g style={{ transform: 'translate(50%, 50%)' }}>
            {/* Liquid Curved Cubic-Bezier Path */}
            <path
              d={`M 0 0 C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`}
              fill="none"
              stroke="url(#tetherGradient)"
              strokeWidth="2.5"
              strokeDasharray={isBroadcasting ? '8 6' : '4 4'}
              className={isBroadcasting ? 'animate-pulse' : 'opacity-40'}
            />

            {/* Glowing Traveling Data Orbs along Tether during transmission */}
            {isBroadcasting && (
              <>
                {[0, 0.33, 0.66].map((delayRatio, idx) => (
                  <motion.circle
                    key={`orb-${idx}`}
                    r="5"
                    fill="#22D3EE"
                    filter="url(#glow)"
                    initial={{ offsetDistance: '0%' }}
                    animate={{
                      cx: [0, c1x, c2x, tx],
                      cy: [0, c1y, c2y, ty],
                      scale: [0.8, 1.4, 0.9],
                      opacity: [0.2, 1, 0.8],
                    }}
                    transition={{
                      duration: 1.2,
                      repeat: Infinity,
                      delay: delayRatio * 1.2,
                      ease: 'easeInOut',
                    }}
                  />
                ))}
              </>
            )}
          </g>
        </svg>
      )}
    </div>
  );
};
