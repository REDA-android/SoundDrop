'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Smartphone, Volume2, Volume1 } from 'lucide-react';
import { PeerBubble, AcousticTelemetry } from '@/types/sound-drop';
import { AcousticBand } from '@/types/acoustic';
import { PeerBubbleNode } from './PeerBubbleNode';
import { AcousticRippleWave } from './AcousticRippleWave';
import { airdropSynth } from '@/lib/part5-ui-sfx/airdrop-synth';

interface AirDropBubbleRadarProps {
  peers: PeerBubble[];
  selectedPeerId: string | null;
  onSelectPeer: (peer: PeerBubble) => void;
  isTransmitting: boolean;
  isListening: boolean;
  onDropPayloadOnPeer?: (peer: PeerBubble) => void;
  currentBand: AcousticBand;
  onBandChange: (band: AcousticBand) => void;
  telemetry?: AcousticTelemetry | null;
  onBroadcastDiscoveryPing?: () => void;
}

export const AirDropBubbleRadar: React.FC<AirDropBubbleRadarProps> = ({
  peers,
  selectedPeerId,
  onSelectPeer,
  isTransmitting,
  isListening,
  onDropPayloadOnPeer,
  currentBand,
  onBandChange,
  telemetry,
  onBroadcastDiscoveryPing,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bubblePositions, setBubblePositions] = useState<{ [id: string]: { x: number; y: number } }>({});

  // Radial distribution of discovered peer bubbles
  useEffect(() => {
    const N = peers.length;
    if (N === 0) return;

    const baseRadius = 140; // Distance from center
    const newPositions: { [id: string]: { x: number; y: number } } = {};

    peers.forEach((peer, i) => {
      // Golden angle distribution around radar center
      const angle = (i * (2 * Math.PI)) / Math.max(1, N) - Math.PI / 2;
      const r = baseRadius + (i % 2 === 1 ? 35 : -15);
      newPositions[peer.id] = {
        x: Math.round(r * Math.cos(angle)),
        y: Math.round(r * Math.sin(angle)),
      };
    });

    setBubblePositions(newPositions);
  }, [peers]);

  const selectedPeer = peers.find((p) => p.id === selectedPeerId);
  const targetCoords = selectedPeer ? bubblePositions[selectedPeer.id] || null : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[460px] rounded-3xl bg-[#090C15] border border-surface-border overflow-hidden flex items-center justify-center select-none shadow-2xl"
    >
      {/* Background Expanding Sonic Radar Rings */}
      <AcousticRippleWave
        isBroadcasting={isTransmitting}
        isReceiving={isListening}
        targetCoords={targetCoords}
        packetProgress={selectedPeer?.progress || 0}
      />

      {/* Floating Peer Bubbles Container */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <AnimatePresence>
          {peers.map((peer) => {
            const pos = bubblePositions[peer.id] || { x: peer.x, y: peer.y };

            return (
              <motion.div
                key={peer.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                  x: pos.x,
                  y: pos.y,
                  scale: 1,
                  opacity: 1,
                }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{
                  type: 'spring',
                  stiffness: 120,
                  damping: 14,
                }}
                className="absolute pointer-events-auto"
              >
                <PeerBubbleNode
                  peer={peer}
                  isSelected={selectedPeerId === peer.id}
                  onSelect={(p) => {
                    onSelectPeer(p);
                    onDropPayloadOnPeer?.(p);
                  }}
                  lastSnrDb={telemetry?.snrDb}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Central User Node ("My Device") */}
      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          whileHover={{ scale: 1.05 }}
          className={`relative flex items-center justify-center w-20 h-20 rounded-full bg-slate-900 border-2 transition-all duration-300 backdrop-blur-xl shadow-2xl ${
            isTransmitting
              ? 'border-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.6)]'
              : isListening
              ? 'border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
              : 'border-slate-700'
          }`}
        >
          {isTransmitting ? (
            <Volume2 className="w-8 h-8 text-cyan-400 animate-bounce" />
          ) : isListening ? (
            <Radio className="w-8 h-8 text-emerald-400 animate-pulse" />
          ) : (
            <Smartphone className="w-8 h-8 text-slate-300" />
          )}

          {/* Active status pulse dot */}
          <span
            className={`absolute top-1 right-1 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${
              isTransmitting
                ? 'bg-cyan-400 animate-ping'
                : isListening
                ? 'bg-emerald-400 animate-pulse'
                : 'bg-slate-500'
            }`}
          />
        </motion.div>

        <span className="mt-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
          My Device
        </span>
        <span className="text-[10px] text-slate-400 font-mono">
          {isTransmitting
            ? 'Beaming Sound...'
            : isListening
            ? 'Listening for Drops'
            : 'Acoustic Standby'}
        </span>
      </div>

      {/* Radar Top Badge */}
      <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs font-mono text-slate-300 backdrop-blur-md">
        <Radio className="w-3.5 h-3.5 text-cyan-400" />
        <span>AIRDROP RADAR: {peers.length} NEARBY</span>
      </div>

      {/* Top Right Controls: Whisper Mode Toggle + Real Acoustic Beacon Ping */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          onClick={() => {
            const nextBand = currentBand === 'whisper' ? 'audible' : 'whisper';
            onBandChange(nextBand);
            airdropSynth.playBubblePop();
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono transition-all backdrop-blur-md shadow-lg active:scale-95 ${
            currentBand === 'whisper'
              ? 'bg-emerald-950/90 border-emerald-500 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.4)]'
              : 'bg-slate-900/80 hover:bg-slate-800 border-slate-800 text-slate-300'
          }`}
        >
          <Volume1 className={`w-3.5 h-3.5 ${currentBand === 'whisper' ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
          <span>Whisper Mode {currentBand === 'whisper' ? 'ON' : '(Ear-to-Mic)'}</span>
        </button>

        <button
          onClick={() => {
            airdropSynth.playRadarPing();
            onBroadcastDiscoveryPing?.();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 font-medium transition-colors shadow-lg active:scale-95"
        >
          <Radio className="w-3.5 h-3.5 text-cyan-400" />
          <span>Emit Beacon Ping</span>
        </button>
      </div>

      {/* Whisper Mode Interactive Ear-to-Mic Alignment Guide */}
      <AnimatePresence>
        {currentBand === 'whisper' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center justify-center gap-3 px-4 py-2 rounded-2xl bg-emerald-950/90 border border-emerald-500/60 shadow-[0_0_25px_rgba(16,185,129,0.3)] backdrop-blur-md"
          >
            <div className="flex items-center gap-1.5 text-xs text-emerald-200 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="font-bold">Ultrasonic Whisper (18.5–20.2 kHz)</span>
              <span className="text-emerald-400/80">•</span>
              <span>Hold Speaker 3–5 cm from target Mic for silent transfer</span>
            </div>
            <div className="px-2 py-0.5 rounded bg-emerald-900/80 border border-emerald-700/60 text-[10px] font-mono text-emerald-300 font-semibold">
              Gain: 0.2 (Anti-Distortion)
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty State Banner if no peers active */}
      {peers.length === 0 && (
        <div className="absolute bottom-6 px-4 py-2 rounded-xl bg-slate-950/80 border border-slate-800/80 text-center text-xs text-slate-400 max-w-sm backdrop-blur-md">
          0 appareils détectés (État Vide). Activez le microphone ou cliquez sur &quot;Emit Beacon Ping&quot; / &quot;Run Self-Test&quot; pour détecter un nœud acoustique réel.
        </div>
      )}
    </div>
  );
};
