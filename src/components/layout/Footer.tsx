'use client';

import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full max-w-5xl flex flex-wrap items-center justify-between gap-2 py-4 px-2 font-mono text-xs text-[#A1A1AA] border-t border-white/10 mt-6 z-10">
      <span>WebRTC DTLS/SCTP • Modem Acoustique ggwave (WASM)</span>
      <span>SoundDrop Studio — Version Web</span>
    </footer>
  );
};
