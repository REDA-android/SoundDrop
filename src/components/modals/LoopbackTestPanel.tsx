'use client';

import React, { useState } from 'react';
import { RotateCcw, Volume2, Mic, CheckCircle2, AlertCircle, Play, Sparkles } from 'lucide-react';
import { airdropSynth } from '@/lib/part5-ui-sfx/airdrop-synth';

interface LoopbackTestPanelProps {
  onRunTest: () => Promise<void>;
  isTransmitting: boolean;
  isListening: boolean;
  loopbackActive: boolean;
  onToggleLoopback: (enabled: boolean) => void;
  lastTestSuccess?: boolean | null;
}

export const LoopbackTestPanel: React.FC<LoopbackTestPanelProps> = ({
  onRunTest,
  isTransmitting,
  isListening,
  loopbackActive,
  onToggleLoopback,
  lastTestSuccess,
}) => {
  const [isRunning, setIsRunning] = useState(false);

  const handleStartTest = async () => {
    setIsRunning(true);
    airdropSynth.playRadarPing();
    try {
      await onRunTest();
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="bg-surface p-5 rounded-2xl border border-surface-border flex flex-col gap-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-emerald-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Acoustic Loopback Self-Test & Calibration
          </h4>
        </div>

        <button
          onClick={() => onToggleLoopback(!loopbackActive)}
          className={`px-2.5 py-1 text-[11px] font-mono rounded-lg border transition-colors ${
            loopbackActive
              ? 'bg-emerald-950 border-emerald-600 text-emerald-300 font-bold'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          LOOPBACK: {loopbackActive ? 'ENABLED' : 'DISABLED'}
        </button>
      </div>

      <p className="text-xs text-slate-400">
        Tests the entire TX-to-RX pipeline on this device (Speaker &rarr; Mic / Audio Bus). Synthesizes an acoustic test beacon and verifies Goertzel decoding, RS(80,64) FEC healing, and CRC-32 integrity in real time.
      </p>

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          {lastTestSuccess === true && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4" /> Loopback Calibration Verified
            </div>
          )}
          {lastTestSuccess === false && (
            <div className="flex items-center gap-1.5 text-xs text-rose-400 font-medium">
              <AlertCircle className="w-4 h-4" /> Noise/Acoustic Clipping Detected
            </div>
          )}
        </div>

        <button
          onClick={handleStartTest}
          disabled={isRunning || isTransmitting}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-lg transition-all active:scale-95 disabled:opacity-40"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          {isRunning || isTransmitting ? 'Testing Acoustics...' : 'Run Self-Test'}
        </button>
      </div>
    </div>
  );
};
