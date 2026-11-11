'use client';

import React from 'react';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { TransferProgress, FileMetadata } from '@/lib/webrtc/DataChannelManager';
import { formatBytes, formatSpeed, calculateEta } from '@/lib/utils/formatters';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

interface TransferMonitorProps {
  progress: TransferProgress;
  metadata?: FileMetadata | null;
  mode: 'upload' | 'download';
  isChecksumVerified?: boolean | null;
}

export const TransferMonitor: React.FC<TransferMonitorProps> = ({
  progress,
  metadata,
  mode,
  isChecksumVerified,
}) => {
  const percent =
    progress.totalBytes > 0
      ? (progress.bytesTransferred / progress.totalBytes) * 100
      : 0;

  const eta = calculateEta(progress.bytesTransferred, progress.totalBytes, progress.speedBps);

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <ProgressRing
        progress={percent}
        size={132}
        strokeWidth={7}
        subLabel={mode === 'upload' ? 'TX STREAM' : 'RX STREAM'}
      />

      {metadata && (
        <div className="w-full text-center">
          <div className="truncate text-[14px] font-medium text-[#F4F4F6]">
            {metadata.fileName}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-[#8E8E98]">
            {formatBytes(progress.bytesTransferred)} / {formatBytes(progress.totalBytes)}
          </div>
        </div>
      )}

      {/* Clean 3-Column Monospace Telemetry Strip */}
      <div className="w-full grid grid-cols-3 divide-x divide-white/[0.06] rounded-xl bg-[#141418] border border-white/[0.07] py-2.5 text-center font-mono">
        <div>
          <span className="block text-[9px] uppercase tracking-widest text-[#71717A]">
            SPEED
          </span>
          <span className="mt-0.5 block text-xs font-semibold text-[#F4F4F6]">
            {formatSpeed(progress.speedBps)}
          </span>
        </div>
        <div>
          <span className="block text-[9px] uppercase tracking-widest text-[#71717A]">
            ETA
          </span>
          <span className="mt-0.5 block text-xs font-semibold text-[#F4F4F6]">
            {eta}
          </span>
        </div>
        <div>
          <span className="block text-[9px] uppercase tracking-widest text-[#71717A]">
            BLOCKS
          </span>
          <span className="mt-0.5 block text-xs font-semibold text-[#F4F4F6]">
            {progress.currentChunk}/{progress.totalChunks}
          </span>
        </div>
      </div>

      {isChecksumVerified !== null && isChecksumVerified !== undefined && (
        <div
          className={`w-full flex items-center justify-center gap-2 rounded-xl py-2 px-3 font-mono text-[11px] border ${
            isChecksumVerified
              ? 'border-[#10B981]/30 bg-[#10B981]/10 text-[#10B981]'
              : 'border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444]'
          }`}
        >
          {isChecksumVerified ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>SHA-256 WASM VERIFIED</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>SHA-256 MISMATCH</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
