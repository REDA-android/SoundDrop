'use client';

import React from 'react';
import { SlidersHorizontal, ShieldCheck, Sparkles, Radio } from 'lucide-react';
import { MorphIcon } from '@/components/ui/MorphIcon';

interface HeaderProps {
  status: string;
  mode?: 'IDLE' | 'TRANSMITTING' | 'RECEIVING' | 'TRANSFERRING' | 'COMPLETED' | 'ERROR';
  snrDb?: number;
  isP2PConnected: boolean;
  isAcousticActive: boolean;
  onToggleSettings?: () => void;
  isSettingsOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  mode = 'IDLE',
  snrDb = 0,
  isP2PConnected,
  isAcousticActive,
  onToggleSettings,
  isSettingsOpen,
}) => {
  return (
    <header className="w-full max-w-5xl rounded-2xl bg-[#0F1117]/85 backdrop-blur-2xl border border-white/[0.08] shadow-[0_12px_36px_-10px_rgba(0,0,0,0.65)] py-2.5 px-3 sm:px-4 z-20 flex flex-wrap items-center justify-between gap-3 transition-all duration-300">
      {/* Brand & Identity */}
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF6A1F]/20 via-[#161822] to-[#0D0E15] border border-[#FF6A1F]/30 shadow-[0_0_24px_rgba(255,106,31,0.22)] text-[#FF6A1F] transition-transform duration-300 hover:scale-105"
        >
          <MorphIcon
            state={isP2PConnected ? 'CHECK' : isAcousticActive ? 'WAVE' : 'RADAR'}
            size={22}
          />
          {isAcousticActive && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF6A1F] opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#FF6A1F]" />
            </span>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
              <span>SoundDrop</span>
              <span className="text-xs font-medium text-slate-400 font-mono">Studio</span>
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium tracking-wide bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-amber-400 border border-amber-500/25 flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-amber-400" />
              <span>v5.0 AirGap</span>
            </span>
          </div>
          <p className="font-mono text-[11px] text-slate-400 hidden sm:flex items-center gap-1.5">
            <Radio className="w-3 h-3 text-[#FF6A1F]" />
            <span>Transfert acoustique sans-fil & WebRTC crypté</span>
          </p>
        </div>
      </div>

      {/* Controls & Status Badges */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
        {/* Live Status Pill */}
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 font-mono text-xs tracking-wide transition-all duration-300 ${
            isP2PConnected
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
              : isAcousticActive
              ? 'bg-orange-950/40 border-orange-500/40 text-orange-300 shadow-[0_0_20px_rgba(255,106,31,0.25)]'
              : 'bg-[#151722]/80 border-white/[0.08] text-slate-300'
          }`}
        >
          <span className="relative flex h-2 w-2">
            {(isP2PConnected || isAcousticActive) && (
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isP2PConnected ? 'bg-emerald-400' : 'bg-orange-500'
                }`}
              />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isP2PConnected
                  ? 'bg-emerald-400'
                  : isAcousticActive
                  ? 'bg-orange-500'
                  : 'bg-slate-400'
              }`}
            />
          </span>
          <span className="font-semibold text-[11px] uppercase">
            {isP2PConnected ? 'PAIR CONNECTÉ' : isAcousticActive ? 'SIGNAL ACTIF' : status}
          </span>
        </div>

        {/* Security Shield Badge */}
        <div className="hidden md:flex items-center gap-1.5 rounded-xl bg-[#151722]/80 border border-white/[0.08] px-2.5 py-1.5 font-mono text-xs text-slate-300">
          <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[11px]">E2EE • X25519</span>
        </div>

        {/* DSP Settings Trigger Button */}
        {onToggleSettings && (
          <button
            type="button"
            onClick={onToggleSettings}
            aria-expanded={Boolean(isSettingsOpen)}
            aria-controls="dsp-settings-drawer"
            aria-label="Paramètres DSP et Réseau WebRTC"
            className={`flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all duration-200 active:scale-95 cursor-pointer ${
              isSettingsOpen
                ? 'bg-gradient-to-r from-[#FF6A1F] to-[#E04800] border-[#FF6A1F] text-white font-semibold shadow-[0_0_20px_rgba(255,106,31,0.4)]'
                : 'bg-[#151722]/80 border-white/[0.08] text-slate-300 hover:text-white hover:border-white/20 hover:bg-[#1C2030]'
            }`}
          >
            <SlidersHorizontal
              aria-hidden="true"
              className={`h-3.5 w-3.5 transition-transform duration-300 ${
                isSettingsOpen ? 'rotate-90 text-white' : 'text-slate-400'
              }`}
            />
            <span className="hidden sm:inline">Options DSP</span>
          </button>
        )}
      </div>
    </header>
  );
};
