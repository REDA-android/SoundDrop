'use client';

import React from 'react';
import { SlidersHorizontal, ShieldCheck } from 'lucide-react';
import { PageMascot } from '@/components/ui/PageMascot';
import { MorphIcon } from '@/components/ui/MorphIcon';
import { DrawablySketchBadge } from '@/components/ui/DrawablySketchBadge';

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
    <header className="w-full max-w-5xl flex flex-wrap items-center justify-between gap-3 py-3 px-2 z-10">
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-[#181820] border border-white/15 shadow-inner text-[#FF6A1F]"
        >
          <MorphIcon
            state={isP2PConnected ? 'CHECK' : isAcousticActive ? 'WAVE' : 'RADAR'}
            size={20}
          />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-[#F4F4F6]">
              SoundDrop Studio
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-orange-500/10 text-orange-400 border border-orange-500/30">
              version web
            </span>
          </div>
          <p className="font-mono text-[11px] text-[#A1A1AA] hidden sm:block">
            Transfert de données par ondes sonores & WebRTC
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {/* Interactive Cursor-Tracking Mascot (nilbuild/page-mascot) */}
        <PageMascot mode={mode} snrDb={snrDb} isConnected={isP2PConnected} />

        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-xl bg-[#14141A] border border-white/15 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-[#E4E4E7]"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              isP2PConnected
                ? 'bg-[#10B981]'
                : isAcousticActive
                ? 'bg-[#FF5500] animate-ping'
                : 'bg-[#A1A1AA]'
            }`}
          />
          <span>{isP2PConnected ? 'LIEN P2P ACTIF' : status}</span>
        </div>

        <div className="hidden lg:flex items-center gap-1.5 rounded-xl bg-[#14141A] border border-white/10 px-3 py-1.5 font-mono text-xs text-[#A1A1AA]">
          <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-[#10B981]" />
          <span>DTLS / SHA-256</span>
        </div>

        {onToggleSettings && (
          <button
            type="button"
            onClick={onToggleSettings}
            aria-expanded={Boolean(isSettingsOpen)}
            aria-controls="dsp-settings-drawer"
            aria-label="Paramètres DSP et Réseau WebRTC"
            className={`flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-95 ${
              isSettingsOpen
                ? 'bg-[#FF5500] border-[#FF5500] text-white font-semibold'
                : 'bg-[#14141A] border-white/15 text-[#D4D4D8] hover:text-white hover:border-white/30'
            }`}
          >
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Paramètres DSP</span>
          </button>
        )}
      </div>
    </header>
  );
};
