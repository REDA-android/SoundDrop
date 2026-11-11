'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface MicroButtonProps {
  label: string;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'metallic' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
}

export const MicroButton: React.FC<MicroButtonProps> = ({
  label,
  icon,
  variant = 'primary',
  onClick,
  disabled = false,
}) => {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setRipples((prev) => [...prev.slice(-2), { id: Date.now(), x, y }]);
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'metallic':
        return 'metalforge-node border-[0.5px] border-white/20 text-slate-100 hover:border-white/40 shadow-md';
      case 'secondary':
        return 'bg-slate-900/80 border-[0.5px] border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-800';
      case 'danger':
        return 'bg-rose-950/80 border-[0.5px] border-rose-500/50 text-rose-300 hover:bg-rose-900';
      case 'primary':
      default:
        return 'bg-gradient-to-r from-cyan-600 to-blue-600 border-[0.5px] border-cyan-400/40 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:brightness-110';
    }
  };

  return (
    <motion.button
      onClick={onClick}
      onPointerDown={handlePointerDown}
      disabled={disabled}
      whileHover={{ scale: 1.025, y: -0.5 }}
      whileTap={{ scale: 0.96, y: 1 }}
      transition={{
        type: 'spring',
        stiffness: 550,
        damping: 28,
        mass: 0.6,
      }}
      className={`relative overflow-hidden flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold select-none cursor-pointer active:shadow-inner ${getVariantStyles()}`}
    >
      {/* Affect UI Micro-Ripple Burst */}
      <AnimatePresence>
        {ripples.map((rip) => (
          <motion.span
            key={rip.id}
            initial={{ scale: 0, opacity: 0.6 }}
            animate={{ scale: 3.5, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            style={{ left: rip.x - 20, top: rip.y - 20 }}
            className="absolute w-10 h-10 rounded-full bg-white/25 pointer-events-none"
          />
        ))}
      </AnimatePresence>

      {icon && <span className="relative z-10">{icon}</span>}
      <span className="relative z-10 koboyo-title tracking-wide">{label}</span>
    </motion.button>
  );
};
