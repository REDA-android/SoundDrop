'use client';

import React from 'react';
import { ShieldCheck, ShieldAlert, Check, X } from 'lucide-react';

export interface SasVerificationModalProps {
  isOpen: boolean;
  sasCode: string; // 6 chiffres (ex: "749201")
  remoteDeviceName?: string;
  onConfirmMatch: () => void;
  onRejectMismatch: () => void;
}

export const SasVerificationModal: React.FC<SasVerificationModalProps> = ({
  isOpen,
  sasCode,
  remoteDeviceName = 'Appareil distant',
  onConfirmMatch,
  onRejectMismatch,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sas-modal-title"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 font-mono select-none"
    >
      <div className="w-full max-w-sm rounded-3xl bg-[#0E0E15] border border-white/20 p-6 space-y-5 shadow-2xl text-center">
        {/* Header Icon */}
        <div className="mx-auto w-12 h-12 rounded-2xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400">
          <ShieldCheck className="w-6 h-6" />
        </div>

        <div className="space-y-1.5">
          <h2 id="sas-modal-title" className="text-sm font-bold text-white uppercase tracking-wider">
            Vérification de Proximité (SAS)
          </h2>
          <p className="text-xs text-zinc-400 font-sans leading-relaxed">
            Comparez le code court affiché sur les deux écrans pour bloquer toute tentative d’interception (MITM) :
          </p>
        </div>

        {/* 6-Digit Big Monospace Code Display */}
        <div className="p-4 rounded-2xl bg-[#07070A] border border-orange-500/40">
          <span className="text-3xl sm:text-4xl font-extrabold tracking-[0.3em] text-[#FF7A33]">
            {sasCode}
          </span>
          <span className="block text-[10px] text-zinc-500 mt-1 uppercase tracking-widest">
            {remoteDeviceName}
          </span>
        </div>

        <p className="text-[11px] text-zinc-400 font-sans">
          Les deux écrans affichent-ils exactement les mêmes 6 chiffres ?
        </p>

        {/* Two Buttons: Identiques vs Différents */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={onRejectMismatch}
            className="px-4 py-2.5 rounded-xl border border-rose-500/40 bg-rose-950/20 hover:bg-rose-950/40 text-rose-300 font-bold text-xs uppercase flex items-center justify-center gap-1.5 transition-colors"
          >
            <X className="w-4 h-4" />
            <span>Différents</span>
          </button>

          <button
            type="button"
            onClick={onConfirmMatch}
            className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs uppercase flex items-center justify-center gap-1.5 transition-colors shadow-lg shadow-emerald-500/20"
          >
            <Check className="w-4 h-4" />
            <span>Identiques</span>
          </button>
        </div>
      </div>
    </div>
  );
};
