'use client';

import React from 'react';
import { WebRTCStats } from '@/lib/webrtc/PeerConnection';

interface PeerCardProps {
  roomId: string;
  role: 'initiator' | 'receiver';
  connectionState: RTCPeerConnectionState;
  stats?: WebRTCStats | null;
}

export const PeerCard: React.FC<PeerCardProps> = ({
  roomId,
  role,
  connectionState,
  stats,
}) => {
  const isConnected = connectionState === 'connected';

  return (
    <div className="flex items-center justify-between rounded-xl bg-[#141418] border border-white/[0.07] px-3.5 py-2.5 font-mono text-[11px]">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            isConnected ? 'bg-[#10B981]' : 'bg-[#F59E0B] animate-pulse'
          }`}
        />
        <span className="text-[#8E8E98]">
          {role === 'initiator' ? 'HOST' : 'PEER'} #{roomId}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[#A1A1AA]">
        {isConnected && stats && (
          <>
            <span>RTT {stats.roundTripTimeMs}ms</span>
            <span className="text-[#52525B]">|</span>
            <span>{stats.activeEngine}</span>
          </>
        )}
        <span
          className={`uppercase font-semibold ${
            isConnected ? 'text-[#10B981]' : 'text-[#F59E0B]'
          }`}
        >
          {connectionState}
        </span>
      </div>
    </div>
  );
};
