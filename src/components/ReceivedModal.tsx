'use client';

import React, { useState } from 'react';
import { DropResult } from '@/types/acoustic';
import {
  CheckCircle2,
  Copy,
  Check,
  Download,
  FileText,
  File,
  X,
  Sparkles,
} from 'lucide-react';

interface ReceivedModalProps {
  drop: DropResult | null;
  onClose: () => void;
}

export const ReceivedModal: React.FC<ReceivedModalProps> = ({ drop, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!drop) return null;

  const handleCopy = async () => {
    if (drop.text) {
      await navigator.clipboard.writeText(drop.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([drop.data as unknown as BlobPart], { type: drop.mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = drop.name || 'received_sound_drop.bin';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isImage = drop.mimeType.startsWith('image/');
  const imageUrl = isImage ? URL.createObjectURL(new Blob([drop.data as unknown as BlobPart], { type: drop.mimeType })) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-surface border border-cyan-500/50 rounded-2xl p-6 shadow-[0_0_50px_rgba(6,182,212,0.25)] flex flex-col gap-5">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-cyan-950/80 border border-cyan-500/60 text-cyan-400">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100">Sound Drop Received!</h3>
              <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-emerald-950 border border-emerald-800 text-emerald-300">
                CRC-32 Verified
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Payload reconstructed purely via acoustic sound waves
            </p>
          </div>
        </div>

        {/* Drop Metadata */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3.5 flex flex-col gap-2 font-mono text-xs">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-500">Name:</span>
            <span className="font-semibold text-slate-200 truncate max-w-[280px]">
              {drop.name}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-500">Type / MIME:</span>
            <span>{drop.mimeType}</span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-500">Payload Size:</span>
            <span className="text-cyan-400 font-semibold">
              {drop.size < 1024
                ? `${drop.size} bytes`
                : `${(drop.size / 1024).toFixed(2)} KB`}
            </span>
          </div>
        </div>

        {/* Content Preview */}
        {drop.type === 'text' && drop.text && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-400 font-medium">Text Content:</span>
            <div className="max-h-48 overflow-y-auto bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 whitespace-pre-wrap select-all">
              {drop.text}
            </div>
          </div>
        )}

        {isImage && imageUrl && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-400 font-medium">Image Preview:</span>
            <div className="max-h-56 overflow-hidden rounded-xl border border-slate-800 flex items-center justify-center bg-slate-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={drop.name} className="max-h-56 object-contain" />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800/80">
          {drop.type === 'text' && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  Copied to Clipboard
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy Text
                </>
              )}
            </button>
          )}

          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-medium bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white shadow-lg shadow-cyan-950/60 transition-all active:scale-95"
          >
            <Download className="w-4 h-4" />
            Download File
          </button>
        </div>
      </div>
    </div>
  );
};
