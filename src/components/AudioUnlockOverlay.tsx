'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Volume2, ShieldCheck, Sparkles, ArrowRight } from 'lucide-react';
import { airdropSynth } from '@/lib/part5-ui-sfx/airdrop-synth';

interface AudioUnlockOverlayProps {
  onUnlock: () => Promise<void>;
  isUnlocked: boolean;
}

export const AudioUnlockOverlay: React.FC<AudioUnlockOverlayProps> = ({
  onUnlock,
  isUnlocked,
}) => {
  const [isUnlocking, setIsUnlocking] = useState(false);

  if (isUnlocked) return null;

  const handleActivate = async () => {
    setIsUnlocking(true);
    try {
      airdropSynth.playRadarPing();
      await onUnlock();
    } catch (err) {
      console.warn('Audio unlock warning:', err);
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.35, ease: 'easeInOut' }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#07090E]/95 backdrop-blur-2xl select-none"
      >
        <div className="relative max-w-md w-full bg-surface/90 border border-cyan-500/40 rounded-3xl p-8 shadow-[0_0_80px_rgba(6,182,212,0.25)] flex flex-col items-center text-center gap-6">
          {/* Animated Pulsating Sonic Core Button */}
          <div className="relative flex items-center justify-center">
            {/* Concentric expanding ripples */}
            <motion.div
              animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute w-28 h-28 rounded-full border-2 border-cyan-400/60"
            />
            <motion.div
              animate={{ scale: [1, 2.4, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: 0.5, ease: 'easeInOut' }}
              className="absolute w-28 h-28 rounded-full border border-cyan-400/30"
            />

            {/* Core Interactive Touch Target */}
            <motion.button
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              onClick={handleActivate}
              disabled={isUnlocking}
              className="relative z-10 w-28 h-28 rounded-full bg-gradient-to-tr from-cyan-600 via-cyan-500 to-emerald-400 p-1 shadow-[0_0_35px_rgba(6,182,212,0.8)] active:shadow-[0_0_50px_rgba(16,185,129,0.9)] flex items-center justify-center cursor-pointer transition-transform"
            >
              <div className="w-full h-full rounded-full bg-[#07090E]/90 flex flex-col items-center justify-center gap-1">
                <Radio className="w-9 h-9 text-cyan-300 animate-pulse" />
                <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-cyan-200">
                  ACTIVATE
                </span>
              </div>
            </motion.button>
          </div>

          {/* Heading & iOS Explanation */}
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-black text-slate-100 tracking-wide">
              Tap to Activate Acoustic Radar
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
              Mobile and desktop browsers require a single touch gesture to unlock raw audio hardware (Microphone & Speaker) with zero noise suppression.
            </p>
          </div>

          {/* Feature Guarantee Pills */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1 font-mono text-[11px] text-slate-400">
            <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
              Raw 48 kHz WebAudio
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              100% Offline
            </span>
          </div>

          {/* Action Button */}
          <button
            onClick={handleActivate}
            disabled={isUnlocking}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-cyan-600 to-emerald-500 hover:from-cyan-500 hover:to-emerald-400 text-white font-semibold text-sm shadow-lg shadow-cyan-950/80 active:scale-[0.98] transition-all"
          >
            <span>{isUnlocking ? 'Unlocking Audio Engine...' : 'Initialize Acoustic AirDrop'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
