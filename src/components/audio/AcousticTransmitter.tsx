'use client';

import React from 'react';
import { Volume2, RotateCw } from 'lucide-react';
import { formatFrequency } from '@/lib/utils/formatters';

interface TransmitterProps {
  isEmitting: boolean;
  roomId: string;
  currentBit?: number;
  totalBits?: number;
  currentFreq?: number;
  onReemit?: () => void;
}

export const AcousticTransmitter: React.FC<TransmitterProps> = ({
  isEmitting,
  currentBit = 0,
  totalBits = 0,
  currentFreq,
  onReemit,
}) => {
  return (
    <div className="flex items-center justify-between rounded-xl bg-[#141418] border border-white/[0.07] px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <Volume2
          className={`h-4 w-4 ${
            isEmitting ? 'text-[#FF5500] animate-pulse' : 'text-[#71717A]'
          }`}
        />
        <div className="font-mono text-[11px] text-[#A1A1AA]">
          {isEmitting ? (
            <span>
              TX ACTIVE •{' '}
              <strong className="text-[#F4F4F6]">
                {currentFreq ? formatFrequency(currentFreq) : 'SYNC'}
              </strong>{' '}
              ({currentBit}/{totalBits || 48})
            </span>
          ) : (
            <span>AUTO-CHIRP EN VEILLE (CYCLE 6S)</span>
          )}
        </div>
      </div>

      {onReemit && (
        <button
          type="button"
          onClick={onReemit}
          disabled={isEmitting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#F4F4F6] transition-colors"
        >
          <RotateCw className={`h-3 w-3 ${isEmitting ? 'animate-spin' : ''}`} />
          <span>Chirp</span>
        </button>
      )}
    </div>
  );
};
