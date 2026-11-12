'use client';

import React from 'react';
import { Shield, Sparkles } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-3 py-6 px-4 font-mono text-xs text-neutral-500 border-t border-white/[0.08] mt-8 z-10">
      <div className="flex items-center gap-2">
        <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span className="text-neutral-400">WebRTC DTLS/SCTP</span>
        <span>•</span>
        <span className="text-neutral-400">Modem ggwave WASM</span>
        <span>•</span>
        <span className="text-neutral-400">X25519 E2EE</span>
      </div>
      <div className="flex items-center gap-2 text-neutral-400">
        <Sparkles className="w-3.5 h-3.5 text-amber-400/80" />
        <span>SoundDrop Studio <span className="text-amber-400/90 font-semibold">v5.0 AirGap</span></span>
      </div>
    </footer>
  );
};

