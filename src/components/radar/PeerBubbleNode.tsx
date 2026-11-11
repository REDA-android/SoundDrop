'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Smartphone, Laptop, Tablet, Monitor, Check, AlertCircle } from 'lucide-react';
import { PeerBubble, DeviceType } from '@/types/sound-drop';
import { airdropSynth } from '@/lib/part5-ui-sfx/airdrop-synth';

interface PeerBubbleNodeProps {
  peer: PeerBubble;
  isSelected: boolean;
  onSelect: (peer: PeerBubble) => void;
  lastSnrDb?: number;
}

export const PeerBubbleNode: React.FC<PeerBubbleNodeProps> = ({
  peer,
  isSelected,
  onSelect,
  lastSnrDb = 20,
}) => {
  const [bounceTrigger, setBounceTrigger] = useState(0);

  // Trigger micro-bounce and haptic vibration on packet progress updates
  useEffect(() => {
    if (peer.progress > 0 && peer.progress < 100) {
      setBounceTrigger((prev) => prev + 1);
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate(15);
        }
      } catch {
        // Ignore if vibration not permitted
      }
    }
  }, [peer.progress]);

  const getDeviceIcon = (type: DeviceType) => {
    switch (type) {
      case 'iphone':
      case 'android':
        return <Smartphone className="w-6 h-6 text-slate-100" />;
      case 'ipad':
        return <Tablet className="w-6 h-6 text-slate-100" />;
      case 'macbook':
        return <Laptop className="w-6 h-6 text-slate-100" />;
      case 'pc':
      default:
        return <Monitor className="w-6 h-6 text-slate-100" />;
    }
  };

  const handleClick = () => {
    airdropSynth.playBubblePop();
    onSelect(peer);
  };

  // SNR Halo Quality Categorization
  // SNR > 18 dB: Emerald green glowing ring ("Optimal Range")
  // 10 dB <= SNR <= 18 dB: Amber pulsing ring ("Medium Range - Echo Detected")
  // SNR < 10 dB: Crimson dashed ring with micro-tooltip ("Move Devices Closer")
  const snr = lastSnrDb !== undefined ? lastSnrDb : peer.distanceRssi / 4.5;

  let haloColor = '#10B981'; // Emerald
  let haloStyle = 'border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.5)]';
  let haloLabel = 'Optimal Range';
  let isDashed = false;

  if (snr < 10) {
    haloColor = '#F43F5E'; // Crimson
    haloStyle = 'border-rose-500 border-dashed animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.6)]';
    haloLabel = 'Move Devices Closer (<10 dB)';
    isDashed = true;
  } else if (snr <= 18) {
    haloColor = '#F59E0B'; // Amber
    haloStyle = 'border-amber-400 animate-pulse shadow-[0_0_15px_rgba(245,158,11,0.5)]';
    haloLabel = 'Medium Range (Echo Detected)';
  }

  // Circular progress metrics
  const radius = peer.radius || 44;
  const stroke = 3;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (peer.progress / 100) * circumference;

  return (
    <motion.div
      onClick={handleClick}
      animate={{
        scale: bounceTrigger ? [1, 1.12, 1] : 1,
      }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      className="relative flex flex-col items-center cursor-pointer select-none group"
      style={{ width: radius * 2 + 24 }}
    >
      {/* Live SNR Signal Halo & Distance Ring */}
      <div
        style={{
          width: radius * 2 + 16,
          height: radius * 2 + 16,
        }}
        className={`absolute rounded-full border-2 transition-all duration-300 pointer-events-none ${haloStyle}`}
      />

      {/* Floating Bubble Circle */}
      <div className="relative flex items-center justify-center">
        {/* SVG Circular Progress Track */}
        <svg
          height={radius * 2}
          width={radius * 2}
          className="absolute inset-0 -rotate-90 transform z-10 pointer-events-none"
        >
          <circle
            stroke="rgba(255, 255, 255, 0.1)"
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          {peer.progress > 0 && (
            <circle
              stroke={peer.status === 'complete' ? '#10B981' : peer.color || '#06B6D4'}
              fill="transparent"
              strokeWidth={stroke + 1}
              strokeDasharray={`${circumference} ${circumference}`}
              style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.15s ease' }}
              strokeLinecap="round"
              r={normalizedRadius}
              cx={radius}
              cy={radius}
            />
          )}
        </svg>

        {/* Central Bubble Surface */}
        <div
          style={{
            width: (radius - stroke) * 2,
            height: (radius - stroke) * 2,
            backgroundColor: peer.blurHashPreview ? 'transparent' : 'rgba(15, 23, 42, 0.9)',
            boxShadow: isSelected
              ? `0 0 30px ${peer.color || '#06B6D4'}, 0 0 10px rgba(6,182,212,0.5)`
              : '0 8px 32px 0 rgba(0, 0, 0, 0.45)',
          }}
          className={`relative rounded-full flex items-center justify-center border-2 transition-all duration-300 backdrop-blur-md overflow-hidden ${
            isSelected
              ? 'border-cyan-300 scale-105'
              : 'border-slate-700/80 hover:border-cyan-500/80'
          }`}
        >
          {/* Progressive BlurHash Background Image Preview if active */}
          {peer.blurHashPreview ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={peer.blurHashPreview}
              alt="Preview"
              className="absolute inset-0 w-full h-full object-cover filter blur-[1px] scale-110"
            />
          ) : (
            <div
              className="absolute inset-0 opacity-25 rounded-full"
              style={{ backgroundColor: peer.color || '#06B6D4' }}
            />
          )}

          {/* Central Device Icon or Success Check */}
          <div className="relative z-10 flex flex-col items-center">
            {peer.status === 'complete' ? (
              <Check className="w-7 h-7 text-emerald-400 animate-bounce" />
            ) : (
              getDeviceIcon(peer.deviceType)
            )}
          </div>
        </div>
      </div>

      {/* Peer Label & SNR Status Tooltip */}
      <div className="mt-2 text-center flex flex-col items-center max-w-[120px]">
        <span
          className={`text-xs font-semibold truncate transition-colors ${
            isSelected ? 'text-cyan-300 font-bold' : 'text-slate-200 group-hover:text-cyan-400'
          }`}
        >
          {peer.name}
        </span>

        {/* SNR Micro-Label */}
        <div className="flex items-center gap-1 mt-0.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: haloColor }}
          />
          <span className="text-[10px] text-slate-400 font-mono">
            {peer.status === 'transmitting' || peer.status === 'receiving'
              ? `${peer.progress}%`
              : peer.status === 'complete'
              ? 'Received'
              : `${snr.toFixed(1)} dB`}
          </span>
        </div>

        {/* Micro-tooltip if weak SNR (< 10 dB) */}
        {isDashed && (
          <span className="text-[9px] text-rose-400 font-mono mt-0.5 whitespace-nowrap bg-rose-950/80 px-1 rounded border border-rose-800/80">
            Move closer
          </span>
        )}
      </div>
    </motion.div>
  );
};
