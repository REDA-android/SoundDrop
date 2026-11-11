'use client';

import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { DropResult } from '@/types/acoustic';
import { CheckCircle2, Download, Copy, X, FileText, Image as ImageIcon, Sparkles } from 'lucide-react';
import { airdropSynth } from '@/lib/part5-ui-sfx/airdrop-synth';

interface IncomingDropSheetProps {
  drop: DropResult | null;
  onClose: () => void;
}

export const IncomingDropSheet: React.FC<IncomingDropSheetProps> = ({
  drop,
  onClose,
}) => {
  useEffect(() => {
    if (drop) {
      airdropSynth.playSuccessChime();
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#06B6D4', '#10B981', '#38BDF8', '#F59E0B'],
        });
      } catch {
        // Ignore if canvas-confetti canvas not supported
      }
    }
  }, [drop]);

  if (!drop) return null;

  const isImage = drop.mimeType?.startsWith('image/');
  const imageUrl = isImage ? URL.createObjectURL(new Blob([drop.data as unknown as BlobPart], { type: drop.mimeType })) : null;

  const handleCopyText = () => {
    if (drop.text) {
      navigator.clipboard.writeText(drop.text);
      alert('Copied to clipboard!');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([drop.data as unknown as BlobPart], { type: drop.mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = drop.name || 'sound_drop.bin';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-surface border-t sm:border border-cyan-500/50 rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-bold text-slate-100">AirDrop Received via Sound!</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Image Preview if image */}
        {isImage && imageUrl && (
          <div className="relative w-full h-48 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={drop.name} className="w-full h-full object-contain" />
          </div>
        )}

        {/* Text Preview if text */}
        {drop.type === 'text' && drop.text && (
          <div className="max-h-40 overflow-y-auto bg-slate-950 p-3.5 rounded-xl border border-slate-800 font-mono text-xs text-slate-200 whitespace-pre-wrap select-all">
            {drop.text}
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
          <div>
            <span className="text-slate-500">File: </span>
            <span className="text-slate-200 font-semibold">{drop.name}</span>
          </div>
          <div>
            <span className="text-slate-500">Size: </span>
            <span className="text-cyan-400 font-semibold">
              {drop.size < 1024 ? `${drop.size} B` : `${(drop.size / 1024).toFixed(1)} KB`}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          {drop.type === 'text' && (
            <button
              onClick={handleCopyText}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              <Copy className="w-4 h-4" /> Copy Text
            </button>
          )}

          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white shadow-lg shadow-cyan-950/60 transition-all active:scale-95"
          >
            <Download className="w-4 h-4" /> Save / Download
          </button>
        </div>
      </div>
    </div>
  );
};
