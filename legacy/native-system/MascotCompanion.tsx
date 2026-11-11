'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface MascotCompanionProps {
  status: 'idle' | 'listening' | 'transmitting' | 'paired';
  snrDb?: number;
}

export const MascotCompanion: React.FC<MascotCompanionProps> = ({ status, snrDb = 0 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 });

  // Page-Mascot: Eye pupil tracking relative to cursor
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;
      const angle = Math.atan2(dy, dx);
      const dist = Math.min(4.5, Math.hypot(dx, dy) / 25);

      setPupilOffset({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const isTransmitting = status === 'transmitting';
  const isListening = status === 'listening';
  const isPaired = status === 'paired';

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col items-center select-none p-2"
    >
      {/* Acoustic Mascot Body Container */}
      <motion.div
        animate={
          isTransmitting
            ? { y: [0, -4, 0], scale: [1, 1.05, 1] }
            : isPaired
            ? { y: [0, -8, 0], rotate: [-2, 2, -2] }
            : { y: [0, -2, 0] }
        }
        transition={{
          duration: isTransmitting ? 0.35 : 2.4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        className="relative w-20 h-20 flex items-center justify-center"
      >
        {/* Antenna / Acoustic Receiver Node */}
        <div className="absolute -top-3 flex flex-col items-center">
          <motion.div
            animate={
              isListening || isTransmitting
                ? { scale: [1, 1.6, 1], backgroundColor: ['#06b6d4', '#10b981', '#06b6d4'] }
                : { scale: 1 }
            }
            transition={{ duration: 1.2, repeat: Infinity }}
            className={`w-3 h-3 rounded-full border border-white/20 shadow-md ${
              isPaired
                ? 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.8)]'
                : 'bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)]'
            }`}
          />
          <div className="w-[1.5px] h-3 bg-slate-600" />
        </div>

        {/* Mascot Face Plate */}
        <div
          className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center border-[0.5px] shadow-xl backdrop-blur-md transition-colors duration-500 ${
            isPaired
              ? 'bg-gradient-to-b from-emerald-950/90 to-slate-900 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
              : isTransmitting
              ? 'bg-gradient-to-b from-cyan-950/90 to-slate-900 border-cyan-400/60 shadow-[0_0_20px_rgba(6,182,212,0.4)]'
              : 'bg-gradient-to-b from-slate-900/90 to-[#0b0e17] border-white/10'
          }`}
        >
          {/* Eyes Container */}
          <div className="flex items-center gap-3 mt-1">
            {/* Left Eye */}
            <div className="relative w-3.5 h-4.5 bg-slate-950 rounded-full border-[0.5px] border-cyan-500/40 overflow-hidden flex items-center justify-center">
              <motion.div
                animate={{ x: pupilOffset.x, y: pupilOffset.y }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className={`w-2 h-2 rounded-full ${isPaired ? 'bg-emerald-300' : 'bg-cyan-300'}`}
              />
            </div>

            {/* Right Eye */}
            <div className="relative w-3.5 h-4.5 bg-slate-950 rounded-full border-[0.5px] border-cyan-500/40 overflow-hidden flex items-center justify-center">
              <motion.div
                animate={{ x: pupilOffset.x, y: pupilOffset.y }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className={`w-2 h-2 rounded-full ${isPaired ? 'bg-emerald-300' : 'bg-cyan-300'}`}
              />
            </div>
          </div>

          {/* Dynamic Mouth / Acoustic Speaker Grille */}
          <div className="mt-2 flex items-center gap-0.5">
            {[0, 1, 2].map((idx) => (
              <motion.div
                key={idx}
                animate={
                  isTransmitting
                    ? { height: [3, 8, 3] }
                    : isListening
                    ? { height: [2, 5, 2] }
                    : { height: 2 }
                }
                transition={{ duration: 0.3, repeat: Infinity, delay: idx * 0.1 }}
                className={`w-1 rounded-full ${
                  isPaired ? 'bg-emerald-400' : isTransmitting ? 'bg-cyan-400' : 'bg-slate-600'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Emitted Sound Waves when Transmitting */}
        {isTransmitting && (
          <>
            {[0, 0.4].map((delay, i) => (
              <motion.div
                key={i}
                initial={{ scale: 0.8, opacity: 0.8 }}
                animate={{ scale: 2.2, opacity: 0 }}
                transition={{ duration: 1.2, repeat: Infinity, delay, ease: 'easeOut' }}
                className="absolute inset-0 rounded-2xl border border-cyan-400/60 pointer-events-none"
              />
            ))}
          </>
        )}
      </motion.div>

      {/* Mascot Status Badge */}
      <span className="mt-1 px-2 py-0.5 rounded-full text-[9px] koboyo-telemetry border-[0.5px] border-white/10 bg-slate-900/80 text-slate-300">
        {isTransmitting
          ? 'EMITTING CHIRP'
          : isPaired
          ? `PAIRED (${snrDb.toFixed(1)}dB)`
          : isListening
          ? 'LISTENING'
          : 'RADAR IDLE'}
      </span>
    </div>
  );
};
