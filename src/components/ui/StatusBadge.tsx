'use client';

import React from 'react';
import { byId, Status } from '@/lib/capabilities';

export interface StatusBadgeProps {
  capabilityId: string;
  className?: string;
  showExplanation?: boolean;
}

const STATUS_CONFIG: Record<
  Status,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  real: {
    label: 'Réel',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  experimental: {
    label: 'Expérimental',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    dot: 'bg-amber-400',
  },
  planned: {
    label: 'Prévu',
    bg: 'bg-zinc-500/10',
    text: 'text-zinc-400',
    border: 'border-zinc-500/30',
    dot: 'bg-zinc-400',
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  capabilityId,
  className = '',
  showExplanation = false,
}) => {
  const cap = byId(capabilityId);
  if (!cap) {
    console.warn(`[StatusBadge] Capacité inconnue: "${capabilityId}"`);
    return null;
  }

  const cfg = STATUS_CONFIG[cap.status];

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border ${cfg.bg} ${cfg.text} ${cfg.border}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        <span>{cfg.label}</span>
      </span>
      {showExplanation && cap.status === 'planned' && (
        <span className="text-[11px] text-zinc-500 italic">Pas encore disponible</span>
      )}
    </span>
  );
};
