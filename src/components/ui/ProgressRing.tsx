'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';

interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  subLabel?: string;
}

export const ProgressRing: React.FC<ProgressRingProps> = ({
  progress,
  size = 136,
  strokeWidth = 7,
  className,
  subLabel,
}) => {
  const safeProgress = Math.min(100, Math.max(0, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (safeProgress / 100) * circumference;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg width={size} height={size} className="-rotate-90 transform">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.06)"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#FF5500"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="butt"
          fill="transparent"
          className="transition-all duration-200 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center text-center">
        <span className="font-mono text-2xl font-bold tracking-tight text-[#F4F4F6]">
          {Math.round(safeProgress)}%
        </span>
        {subLabel && (
          <span className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-[#8E8E98]">
            {subLabel}
          </span>
        )}
      </div>
    </div>
  );
};
