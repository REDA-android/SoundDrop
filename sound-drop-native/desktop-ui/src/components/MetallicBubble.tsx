'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface MetallicBubbleProps {
  label: string;
  subLabel?: string;
  status: 'idle' | 'listening' | 'transmitting' | 'paired';
  onClick?: () => void;
  children?: React.ReactNode;
}

export const MetallicBubble: React.FC<MetallicBubbleProps> = ({
  label,
  subLabel,
  status,
  onClick,
  children,
}) => {
  const isPaired = status === 'paired';
  const isTransmitting = status === 'transmitting';

  return (
    <motion.div
      onClick={onClick}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      className="relative flex flex-col items-center justify-center cursor-pointer select-none group"
    >
      {/* Hairline 0.5px Aura Halo */}
      <div
        className={`absolute w-52 h-52 rounded-full transition-all duration-700 pointer-events-none ${
          isPaired
            ? 'border-[0.5px] border-emerald-400/50 shadow-[0_0_40px_rgba(16,185,129,0.35)]'
            : isTransmitting
            ? 'border-[0.5px] border-cyan-400/60 shadow-[0_0_50px_rgba(6,182,212,0.5)] animate-pulse'
            : 'border-[0.5px] border-white/10 group-hover:border-cyan-400/30'
        }`}
      />

      {/* Metalforge Brushed Titanium Node */}
      <div
        className={`relative z-10 w-44 h-44 rounded-full flex flex-col items-center justify-center p-4 transition-all duration-500 overflow-hidden ${
          isPaired
            ? 'metalforge-node-active border-[0.5px] border-emerald-400/60'
            : isTransmitting
            ? 'bg-gradient-to-tr from-[#0a1420] via-[#112433] to-[#1c3850] border-[0.5px] border-cyan-400/60'
            : 'metalforge-node border-[0.5px] border-white/15'
        }`}
      >
        {/* Specular Top Bevel Reflection Arc */}
        <div className="absolute top-0 inset-x-8 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />

        {/* Dynamic Etched Brushed Radial Highlight */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none rounded-full"
          style={{
            background:
              'radial-gradient(circle at 35% 25%, rgba(255,255,255,0.4) 0%, transparent 60%)',
          }}
        />

        {/* Central Icon / Payload slot */}
        <div className="relative z-10 flex items-center justify-center mb-1">
          {children}
        </div>

        {/* Koboyo Typography Label */}
        <span className="relative z-10 text-xs font-bold koboyo-title uppercase tracking-wider text-slate-100">
          {label}
        </span>
        {subLabel && (
          <span className="relative z-10 text-[10px] koboyo-telemetry text-slate-400 mt-0.5">
            {subLabel}
          </span>
        )}
      </div>
    </motion.div>
  );
};
