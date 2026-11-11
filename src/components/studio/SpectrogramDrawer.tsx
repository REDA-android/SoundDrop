'use client';

import React, { useState } from 'react';
import { SpectrogramCanvas } from '../SpectrogramCanvas';
import { ModemConfig } from '@/types/acoustic';
import { Activity, ChevronDown, ChevronUp, Radio } from 'lucide-react';

interface SpectrogramDrawerProps {
  analyserNode: AnalyserNode | null;
  config: ModemConfig;
  activeFrequency?: number;
  isTransmitting?: boolean;
}

export const SpectrogramDrawer: React.FC<SpectrogramDrawerProps> = ({
  analyserNode,
  config,
  activeFrequency,
  isTransmitting,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="bg-surface rounded-2xl border border-surface-border overflow-hidden flex flex-col shadow-xl">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-800/30 transition-colors border-b border-slate-800"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Acoustic Spectrum & Waterfall Analyzer (1.0 kHz - 22.0 kHz)
          </h3>
        </div>

        <button className="text-slate-400 hover:text-slate-200 p-1">
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {isExpanded && (
        <div className="p-4">
          <SpectrogramCanvas
            analyserNode={analyserNode}
            config={config}
            activeFrequency={activeFrequency}
            isTransmitting={isTransmitting}
          />
        </div>
      )}
    </div>
  );
};
