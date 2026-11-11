'use client';

import React from 'react';
import { AcousticBand, TransmissionMode } from '@/types/acoustic';
import {
  Volume2,
  VolumeX,
  Volume1,
  Radio,
  Repeat,
  Repeat1,
  RotateCcw,
  Mic,
  MicOff,
  Sliders,
  Sparkles,
} from 'lucide-react';

interface AcousticSettingsProps {
  currentBand: AcousticBand;
  onBandChange: (band: AcousticBand) => void;
  txMode: TransmissionMode;
  onTxModeChange: (mode: TransmissionMode) => void;
  loopbackActive: boolean;
  onToggleLoopback: (enabled: boolean) => void;
  isListening: boolean;
  onToggleListening: () => void;
}

export const AcousticSettings: React.FC<AcousticSettingsProps> = ({
  currentBand,
  onBandChange,
  txMode,
  onTxModeChange,
  loopbackActive,
  onToggleLoopback,
  isListening,
  onToggleListening,
}) => {
  return (
    <div className="bg-surface p-5 rounded-2xl border border-surface-border flex flex-col gap-5">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-cyan-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Acoustic Modem Tuning & Controls
          </h4>
        </div>

        {/* Global Mic Toggle */}
        <button
          onClick={onToggleListening}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            isListening
              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {isListening ? (
            <>
              <Mic className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              Microphone Active
            </>
          ) : (
            <>
              <MicOff className="w-3.5 h-3.5 text-slate-400" />
              Microphone Muted
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Band Selector */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-400">Frequency Band:</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              onClick={() => onBandChange('audible')}
              className={`flex flex-col items-start p-2.5 rounded-xl border text-xs transition-colors ${
                currentBand === 'audible'
                  ? 'bg-cyan-950/80 border-cyan-500/80 text-cyan-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                Audible Robust
              </div>
              <span className="text-[10px] text-slate-500 font-mono">1.6 – 4.4 kHz (portée à mesurer)</span>
            </button>

            <button
              onClick={() => onBandChange('ultrasonic')}
              className={`flex flex-col items-start p-2.5 rounded-xl border text-xs transition-colors ${
                currentBand === 'ultrasonic'
                  ? 'bg-cyan-950/80 border-cyan-500/80 text-cyan-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <VolumeX className="w-3.5 h-3.5 text-purple-400" />
                Ultrasonic
              </div>
              <span className="text-[10px] text-slate-500 font-mono">17.6 – 20.4 kHz</span>
            </button>

            <button
              onClick={() => onBandChange('whisper')}
              className={`flex flex-col items-start p-2.5 rounded-xl border text-xs transition-colors ${
                currentBand === 'whisper'
                  ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <Volume1 className="w-3.5 h-3.5 text-emerald-400" />
                Whisper Mode
              </div>
              <span className="text-[10px] text-slate-500 font-mono">18.5 – 20.2 kHz (5cm)</span>
            </button>
          </div>
        </div>

        {/* Transmission Strategy */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-400">Transmission Protocol:</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onTxModeChange('broadcast')}
              className={`flex-1 flex flex-col items-start p-2.5 rounded-xl border text-xs transition-colors ${
                txMode === 'broadcast'
                  ? 'bg-cyan-950/80 border-cyan-500/80 text-cyan-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <Repeat1 className="w-3.5 h-3.5 text-cyan-400" />
                Fountain Broadcast
              </div>
              <span className="text-[10px] text-slate-500 font-mono">Continuous one-way loop</span>
            </button>

            <button
              onClick={() => onTxModeChange('handshake')}
              className={`flex-1 flex flex-col items-start p-2.5 rounded-xl border text-xs transition-colors ${
                txMode === 'handshake'
                  ? 'bg-cyan-950/80 border-cyan-500/80 text-cyan-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <Repeat className="w-3.5 h-3.5 text-emerald-400" />
                Acoustic ARQ
              </div>
              <span className="text-[10px] text-slate-500 font-mono">Two-way ACK/NACK chime</span>
            </button>
          </div>
        </div>

        {/* Loopback Self-Test Toggle */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-400">Single-Device Self-Test:</span>
          <button
            onClick={() => onToggleLoopback(!loopbackActive)}
            className={`h-full flex items-center justify-between p-3 rounded-xl border text-xs transition-colors ${
              loopbackActive
                ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-200'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                Loopback Mode
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                Speaker output feeds mic demodulator
              </span>
            </div>
            <span
              className={`px-2 py-0.5 text-[10px] font-mono rounded font-bold ${
                loopbackActive
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {loopbackActive ? 'ACTIVE' : 'OFF'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
