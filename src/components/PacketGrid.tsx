'use client';

import React from 'react';
import { Packet, PacketStatus } from '@/types/acoustic';
import { Layers, CheckCircle2, ShieldAlert } from 'lucide-react';

interface PacketGridProps {
  totalPackets: number;
  receivedMap: Map<number, Packet>;
  healedIndices: Set<number>;
  activeReceivingIndex?: number;
}

export const PacketGrid: React.FC<PacketGridProps> = ({
  totalPackets,
  receivedMap,
  healedIndices,
  activeReceivingIndex,
}) => {
  if (totalPackets <= 0) {
    return (
      <div className="bg-surface p-5 rounded-2xl border border-surface-border flex items-center justify-between text-xs text-slate-500 font-mono">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-slate-600" />
          <span>Packet Assembly Matrix (Standby)</span>
        </div>
        <span>No active acoustic transfer in progress</span>
      </div>
    );
  }

  const receivedCount = receivedMap.size;
  const progressPercent = Math.round((receivedCount / totalPackets) * 100);

  // Generate blocks from 0 to totalPackets - 1
  const blocks = Array.from({ length: totalPackets }, (_, idx) => {
    let status: PacketStatus = 'pending';

    if (receivedMap.has(idx)) {
      status = healedIndices.has(idx) ? 'healed' : 'verified';
    } else if (activeReceivingIndex === idx) {
      status = 'receiving';
    }

    return { idx, status };
  });

  return (
    <div className="flex flex-col gap-3.5 bg-surface p-5 rounded-2xl border border-surface-border">
      {/* Header with Counter and Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Packet Matrix: {receivedCount} / {totalPackets} ({progressPercent}%)
          </h4>
        </div>

        {/* Status Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-800 border border-slate-700" />
            <span>Pending</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 animate-pulse" />
            <span>Receiving</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            <span>Verified</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-orange-500" />
            <span>RS Healed</span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
        <div
          style={{ width: `${progressPercent}%` }}
          className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full transition-all duration-200"
        />
      </div>

      {/* Packet Block Matrix Grid */}
      <div className="grid grid-cols-8 sm:grid-cols-12 md:grid-cols-16 gap-1.5 max-h-48 overflow-y-auto p-1">
        {blocks.map(({ idx, status }) => {
          let style = 'bg-slate-900 border-slate-800 text-slate-600';
          if (status === 'receiving') {
            style = 'bg-amber-950/80 border-amber-500 text-amber-300 animate-pulse';
          } else if (status === 'verified') {
            style = 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.3)]';
          } else if (status === 'healed') {
            style = 'bg-orange-950/80 border-orange-500/80 text-orange-300 shadow-[0_0_8px_rgba(249,115,22,0.3)]';
          }

          return (
            <div
              key={idx}
              className={`flex items-center justify-center h-8 rounded-lg border text-xs font-mono font-semibold transition-all ${style}`}
              title={`Packet #${idx}: ${status}`}
            >
              {idx}
            </div>
          );
        })}
      </div>
    </div>
  );
};
