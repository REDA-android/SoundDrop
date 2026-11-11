'use client';

import React from 'react';
import { PacketGrid } from '../PacketGrid';
import { Packet } from '@/types/acoustic';

interface PacketMatrixGridProps {
  totalPackets: number;
  receivedMap: Map<number, Packet>;
  healedIndices: Set<number>;
}

export const PacketMatrixGrid: React.FC<PacketMatrixGridProps> = ({
  totalPackets,
  receivedMap,
  healedIndices,
}) => {
  return (
    <PacketGrid
      totalPackets={totalPackets}
      receivedMap={receivedMap}
      healedIndices={healedIndices}
    />
  );
};
