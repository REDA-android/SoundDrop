'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Sparkles, CheckCircle2, Send, FileText, Smartphone, Laptop } from 'lucide-react';

interface Props {
  onEmit: () => void;
  status: 'idle' | 'emitting' | 'paired';
  pairedDeviceName?: string;
  queuedPayload?: {
    name?: string;
    type: 'text' | 'file';
    size?: number;
  } | null;
  onSendQueuedPayload?: () => void;
}

export const AcousticBubbleButton: React.FC<Props> = ({
  onEmit,
  status,
  pairedDeviceName,
  queuedPayload,
  onSendQueuedPayload,
}) => {
  const [ripples, setRipples] = useState<number[]>([]);

  const handleClick = () => {
    setRipples((prev) => [...prev.slice(-3), Date.now()]);
    onEmit();
  };

  return (
    <div className="relative flex flex-col items-center justify-center p-8 sm:p-12 select-none w-full max-w-lg mx-auto">
      {/* Background Expanding Sonic Rings & Shockwaves */}
      <div className="relative flex items-center justify-center w-64 h-64">
        <AnimatePresence>
          {ripples.map((id) => (
            <motion.div
              key={id}
              initial={{ scale: 0.7, opacity: 0.9 }}
              animate={{ scale: 3.4, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.4, ease: 'easeOut' }}
              className="absolute w-48 h-48 rounded-full border-2 border-cyan-400/60 bg-gradient-to-r from-cyan-500/15 via-blue-500/10 to-indigo-500/5 pointer-events-none shadow-[0_0_30px_rgba(6,182,212,0.4)]"
            />
          ))}
        </AnimatePresence>

        {/* Ambient Pulsing Radar Ring when emitting */}
        {status === 'emitting' && (
          <motion.div
            animate={{ scale: [1, 1.8, 1], opacity: [0.7, 0, 0.7] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute w-52 h-52 rounded-full border-2 border-cyan-300 pointer-events-none"
          />
        )}

        {/* Central Liquid Bubble Button */}
        <motion.button
          onClick={handleClick}
          whileTap={{ scale: 0.91 }}
          whileHover={{ scale: 1.05 }}
          animate={
            status === 'paired'
              ? { borderColor: '#10B981', scale: [1, 1.06, 1] }
              : status === 'emitting'
              ? { scale: [1, 1.03, 1] }
              : {}
          }
          transition={{ duration: 0.35 }}
          className={`relative z-10 w-48 h-48 sm:w-52 sm:h-52 rounded-full flex flex-col items-center justify-center backdrop-blur-2xl shadow-2xl transition-all duration-500 cursor-pointer ${
            status === 'paired'
              ? 'bg-emerald-500/20 border-2 border-emerald-400 text-emerald-300 shadow-[0_0_50px_rgba(16,185,129,0.4)]'
              : status === 'emitting'
              ? 'bg-gradient-to-br from-cyan-600/30 via-blue-600/20 to-indigo-900/40 border-2 border-cyan-300 text-cyan-200 shadow-[0_0_60px_rgba(6,182,212,0.6)]'
              : 'bg-gradient-to-br from-cyan-500/20 via-blue-600/10 to-indigo-900/30 border-2 border-cyan-400/40 text-cyan-200 shadow-[0_0_40px_rgba(6,182,212,0.3)] hover:border-cyan-400/80'
          }`}
        >
          {status === 'paired' ? (
            <>
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-2 animate-bounce" />
              <span className="text-sm font-bold tracking-wide text-emerald-200 uppercase">
                Acoustically Paired
              </span>
              <span className="text-xs text-emerald-400/80 font-mono mt-0.5">
                {pairedDeviceName || 'Pair Acoustique Détecté'}
              </span>
            </>
          ) : (
            <>
              <Radio
                className={`w-12 h-12 mb-2 ${
                  status === 'emitting' ? 'text-cyan-200 animate-spin' : 'text-cyan-300 animate-pulse'
                }`}
              />
              <span className="text-sm font-bold tracking-wider uppercase text-cyan-100">
                {status === 'emitting' ? 'Emitting Chirp...' : 'Tap to Pair'}
              </span>
              <span className="text-[11px] text-cyan-300/70 mt-1 flex items-center gap-1 font-mono">
                <Sparkles className="w-3 h-3 text-cyan-400" /> Ultrasonic Proximity
              </span>
            </>
          )}
        </motion.button>
      </div>

      {/* Queued payload banner if paired & ready */}
      {status === 'paired' && queuedPayload && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 w-full max-w-sm p-4 rounded-2xl bg-surface/90 border border-emerald-500/50 flex items-center justify-between shadow-xl"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-950 border border-emerald-700/60 flex items-center justify-center text-emerald-400">
              <FileText className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-slate-100 truncate max-w-[170px]">
                {queuedPayload.name || 'Text Message'}
              </span>
              <span className="text-[10px] text-emerald-400 font-mono">
                {queuedPayload.size ? `${(queuedPayload.size / 1024).toFixed(1)} KB` : 'Ready to drop'}
              </span>
            </div>
          </div>

          <button
            onClick={onSendQueuedPayload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold text-xs hover:brightness-110 active:scale-95 transition-all shadow-md"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Drop Now</span>
          </button>
        </motion.div>
      )}

      {/* Instructional helper caption */}
      <p className="text-xs text-slate-400 font-mono text-center mt-6 max-w-xs">
        {status === 'paired'
          ? 'Proximity link locked! Click "Drop Now" or drop files directly onto the target device.'
          : 'Hold your iPhone speaker within 1 meter of your Mac or PC microphone and tap to pair via acoustic waves.'}
      </p>
    </div>
  );
};
