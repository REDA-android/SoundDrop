'use client';

import React from 'react';
import { Mic } from 'lucide-react';
import { formatDecibels } from '@/lib/utils/formatters';

interface ReceiverProps {
  isListening: boolean;
  snrDb?: number;
  stateText: string;
  stateCode: number;
}

export const AcousticReceiver: React.FC<AcousticReceiverProps> = ({
  isListening,
  snrDb = 0,
  stateText,
  stateCode,
}) => {
  return (
    <div className="rounded-xl bg-[#141418] border border-white/[0.07] p-3.5 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic
            className={`h-4 w-4 ${
              isListening ? 'text-[#FF5500] animate-pulse' : 'text-[#71717A]'
            }`}
          />
          <span className="font-mono text-[11px] uppercase tracking-wider text-[#F4F4F6]">
            RX DÉCODEUR ACTIF (ÉTAPE {stateCode}/4)
          </span>
        </div>
        <span className="font-mono text-[11px] text-[#8E8E98]">
          SNR <strong className="text-[#F4F4F6]">{formatDecibels(snrDb)}</strong>
        </span>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full bg-[#FF5500] transition-all duration-200"
          style={{ width: `${(Math.min(stateCode, 4) / 4) * 100}%` }}
        />
      </div>

      <p className="text-[12px] text-[#A1A1AA]">{stateText}</p>
    </div>
  );
};

type AcousticReceiverProps = ReceiverProps;
