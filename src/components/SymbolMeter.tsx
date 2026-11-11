'use client';

import React from 'react';
import { Telemetry, ModemConfig } from '@/types/acoustic';
import { getFskFrequencies, formatFrequency } from '@/lib/dsp/constants';
import { Activity, ShieldCheck, Zap } from 'lucide-react';

interface SymbolMeterProps {
  telemetry: Telemetry | null;
  config: ModemConfig;
}

export const SymbolMeter: React.FC<SymbolMeterProps> = ({ telemetry, config }) => {
  const fskFrequencies = getFskFrequencies(config);

  const energies = telemetry?.goertzelEnergies || new Array(16).fill(0);
  const detectedSymbol = telemetry?.detectedSymbol ?? null;
  const snrDb = telemetry?.snrDb ?? 0;
  const confidence = telemetry?.confidence ?? 0;

  // Find max energy among 16 bins for normalized height scaling
  const maxEnergy = Math.max(1e-6, ...energies);

  return (
    <div className="flex flex-col gap-4 bg-surface p-5 rounded-2xl border border-surface-border">
      {/* Header with SNR & Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Goertzel 16-FSK Constellation & SNR Meter
          </h4>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">SNR:</span>
            <span
              className={`font-semibold ${
                snrDb >= 15
                  ? 'text-emerald-400'
                  : snrDb >= 9
                  ? 'text-cyan-400'
                  : snrDb > 4
                  ? 'text-amber-400'
                  : 'text-slate-500'
              }`}
            >
              {snrDb > 0 ? `+${snrDb.toFixed(1)}` : snrDb.toFixed(1)} dB
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Confidence:</span>
            <span className="text-slate-300 font-semibold">
              {Math.round(confidence * 100)}%
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Active Symbol:</span>
            <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 font-bold">
              {detectedSymbol !== null
                ? `0x${detectedSymbol.toString(16).toUpperCase()}`
                : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* 16 Goertzel Vertical Energy Bars */}
      <div className="grid grid-cols-16 gap-1.5 h-28 items-end pt-2">
        {energies.map((energy, idx) => {
          const normalized = Math.min(1.0, Math.max(0.04, energy / maxEnergy));
          const isPeak = detectedSymbol === idx;
          const freq = fskFrequencies[idx];

          return (
            <div key={idx} className="flex flex-col items-center h-full justify-end group relative">
              {/* Tooltip on Hover */}
              <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 border border-slate-700 text-[10px] text-slate-200 px-2 py-1 rounded shadow-lg pointer-events-none z-20 whitespace-nowrap font-mono">
                0x{idx.toString(16).toUpperCase()} ({formatFrequency(freq)})
              </div>

              {/* Bar Fill Container */}
              <div className="w-full bg-slate-900/80 rounded-t border-t border-x border-slate-800 h-full flex flex-col justify-end overflow-hidden p-0.5">
                <div
                  style={{ height: `${normalized * 100}%` }}
                  className={`w-full rounded-t transition-all duration-75 ${
                    isPeak
                      ? 'bg-gradient-to-t from-cyan-500 to-emerald-400 shadow-[0_0_12px_rgba(6,182,212,0.8)]'
                      : 'bg-slate-700/60'
                  }`}
                />
              </div>

              {/* Hex Label below */}
              <span
                className={`mt-1.5 text-[10px] font-mono font-medium transition-colors ${
                  isPeak ? 'text-cyan-300 font-bold' : 'text-slate-500'
                }`}
              >
                {idx.toString(16).toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Diagnostics / Recovery Counter Strip */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80 font-mono">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-cyan-400" />
          <span>Frames Decoded: {telemetry?.framesDecoded || 0}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Reed-Solomon Healed: {telemetry?.fecCorrections || 0}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-rose-400">CRC Rejections: {telemetry?.crcErrors || 0}</span>
        </div>
      </div>
    </div>
  );
};
