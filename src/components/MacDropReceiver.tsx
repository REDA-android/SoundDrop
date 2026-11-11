'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Laptop,
  Smartphone,
  Radio,
  CheckCircle2,
  Download,
  FileText,
  Sparkles,
  Volume2,
  Mic,
  MicOff,
  ExternalLink,
} from 'lucide-react';
import { AcousticPairingRx } from '@/lib/audio/acoustic-pairing';
import { DropResult } from '@/types/acoustic';

interface Props {
  onPairingRecognized?: (sessionId: number) => void;
  lastReceivedDrop?: DropResult | null;
  onClearDrop?: () => void;
}

export const MacDropReceiver: React.FC<Props> = ({
  onPairingRecognized,
  lastReceivedDrop,
  onClearDrop,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [pairedSessionId, setPairedSessionId] = useState<number | null>(null);
  const [pairedDevice, setPairedDevice] = useState<string | null>(null);
  const [lastSnr, setLastSnr] = useState<number>(0);
  const [audioEnergies, setAudioEnergies] = useState<number[]>(new Array(16).fill(0));
  const [showConfirmationRing, setShowConfirmationRing] = useState(false);

  const rxRef = useRef<AcousticPairingRx | null>(null);

  useEffect(() => {
    const rx = new AcousticPairingRx();
    rxRef.current = rx;

    return () => {
      rx.stop();
    };
  }, []);

  const handleToggleListen = async () => {
    const rx = rxRef.current;
    if (!rx) return;

    if (isListening) {
      rx.stop();
      setIsListening(false);
    } else {
      try {
        await rx.startListening(
          async (sessionId, snrDb) => {
            setPairedSessionId(sessionId);
            setPairedDevice(`Nœud Acoustique #${sessionId}`);
            setLastSnr(snrDb);
            setShowConfirmationRing(true);

            // Play receiver glassy confirmation chord (C5 -> G5 -> D6)
            await rx.playConfirmationChord();
            onPairingRecognized?.(sessionId);

            setTimeout(() => {
              setShowConfirmationRing(false);
            }, 3000);
          },
          (energies) => {
            // Sample 16 points across frequency spectrum for visualization
            const step = Math.floor(energies.length / 16);
            const sampled: number[] = [];
            for (let i = 0; i < 16; i++) {
              // Normalize -80dB to -20dB into 0..100%
              const db = energies[i * step] || -80;
              const norm = Math.max(0, Math.min(100, ((db + 80) / 60) * 100));
              sampled.push(norm);
            }
            setAudioEnergies(sampled);
          }
        );
        setIsListening(true);
      } catch (err) {
        console.error('Receiver microphone activation error:', err);
        alert('Microphone access is required to detect acoustic proximity drops.');
      }
    }
  };

  return (
    <div className="relative w-full max-w-4xl mx-auto flex flex-col items-center select-none">
      {/* Top Header Card */}
      <div className="w-full flex items-center justify-between p-4 rounded-2xl bg-surface/90 border border-surface-border mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center text-cyan-400">
            <Laptop className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
                Mac / PC Receiver Radar
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-900 border border-slate-700 text-slate-300">
                Acoustic Listener
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Detects dual-tone acoustic chirps and auto-connects
            </p>
          </div>
        </div>

        <button
          onClick={handleToggleListen}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-lg active:scale-95 ${
            isListening
              ? 'bg-emerald-950 text-emerald-300 border border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
              : 'bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800'
          }`}
        >
          {isListening ? (
            <>
              <Mic className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span>Listening for Drops...</span>
            </>
          ) : (
            <>
              <MicOff className="w-4 h-4 text-slate-400" />
              <span>Activate Receiver Mic</span>
            </>
          )}
        </button>
      </div>

      {/* Main Receiving Radar Canvas */}
      <div className="relative w-full h-[400px] rounded-3xl bg-[#080B14] border border-surface-border overflow-hidden flex items-center justify-center shadow-2xl">
        {/* Concentric Ambient Radar Circles */}
        <div className="absolute w-[260px] h-[260px] rounded-full border border-slate-800/80" />
        <div className="absolute w-[420px] h-[420px] rounded-full border border-slate-800/50" />
        <div className="absolute w-[580px] h-[580px] rounded-full border border-slate-800/25" />

        {/* Ambient Spectrum Bars at Bottom of Radar */}
        {isListening && (
          <div className="absolute bottom-4 inset-x-8 flex items-end justify-center gap-1.5 h-12 opacity-50">
            {audioEnergies.map((val, idx) => (
              <div
                key={idx}
                style={{ height: `${Math.max(6, val)}%` }}
                className="flex-1 bg-gradient-to-t from-cyan-600 to-emerald-400 rounded-t-sm transition-all duration-75"
              />
            ))}
          </div>
        )}

        {/* Expanding Emerald & Cyan Ripple upon Acoustic Pairing Recognition */}
        <AnimatePresence>
          {showConfirmationRing && (
            <>
              {[0, 0.3, 0.6].map((delay, i) => (
                <motion.div
                  key={`confirm-ring-${i}`}
                  initial={{ scale: 0.3, opacity: 1 }}
                  animate={{ scale: 2.8, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.6, delay, ease: 'easeOut' }}
                  className="absolute w-64 h-64 rounded-full border-2 border-emerald-400 bg-gradient-to-tr from-emerald-500/20 to-cyan-500/10 pointer-events-none shadow-[0_0_50px_rgba(16,185,129,0.6)]"
                />
              ))}
            </>
          )}
        </AnimatePresence>

        {/* Central Receiver Node */}
        <motion.div
          animate={
            pairedSessionId
              ? { scale: [1, 1.08, 1], borderColor: '#10B981' }
              : isListening
              ? { scale: [1, 1.02, 1] }
              : {}
          }
          transition={{ duration: 0.4 }}
          className={`relative z-10 flex flex-col items-center justify-center w-36 h-36 rounded-full border-2 backdrop-blur-xl transition-all duration-500 shadow-2xl ${
            pairedSessionId
              ? 'bg-emerald-950/80 border-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.5)]'
              : isListening
              ? 'bg-slate-900/90 border-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.4)]'
              : 'bg-slate-950/80 border-slate-700'
          }`}
        >
          {pairedSessionId ? (
            <>
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-1 animate-bounce" />
              <span className="text-xs font-bold text-emerald-200 uppercase tracking-wider">
                Paired!
              </span>
              <span className="text-[10px] text-emerald-400/80 font-mono">
                {lastSnr.toFixed(1)} dB SNR
              </span>
            </>
          ) : isListening ? (
            <>
              <Radio className="w-10 h-10 text-cyan-300 mb-1 animate-pulse" />
              <span className="text-xs font-bold text-cyan-100 uppercase tracking-wider">
                Listening
              </span>
              <span className="text-[10px] text-cyan-400/70 font-mono">
                Waiting for Chirp
              </span>
            </>
          ) : (
            <>
              <Laptop className="w-10 h-10 text-slate-400 mb-1" />
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Standby
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Mic Inactive</span>
            </>
          )}
        </motion.div>

        {/* Floating detected Phone Bubble */}
        <AnimatePresence>
          {pairedDevice && (
            <motion.div
              initial={{ scale: 0, opacity: 0, x: -160, y: -80 }}
              animate={{ scale: 1, opacity: 1, x: -110, y: -60 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 140, damping: 15 }}
              className="absolute z-20 flex flex-col items-center"
            >
              <div className="w-16 h-16 rounded-full bg-cyan-950/90 border-2 border-cyan-400 flex items-center justify-center text-cyan-300 shadow-[0_0_25px_rgba(6,182,212,0.6)]">
                <Smartphone className="w-7 h-7" />
              </div>
              <span className="text-xs font-bold text-cyan-300 mt-1">{pairedDevice}</span>
              <span className="text-[9px] text-slate-400 font-mono">Acoustically Connected</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Incoming Received Drop Card Drawer */}
      <AnimatePresence>
        {lastReceivedDrop && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="w-full mt-6 p-6 rounded-3xl bg-surface/95 border-2 border-emerald-500/60 shadow-[0_0_50px_rgba(16,185,129,0.3)] flex flex-col sm:flex-row items-center justify-between gap-4"
          >
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-950 border border-emerald-600 flex items-center justify-center text-emerald-400 shadow-lg">
                <FileText className="w-7 h-7" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700">
                    AIRDROP COMPLETE
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    {new Date(lastReceivedDrop.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <h4 className="text-base font-bold text-slate-100 mt-1">
                  {lastReceivedDrop.name || 'Acoustic Drop Payload'}
                </h4>
                <p className="text-xs text-slate-400 font-mono">
                  {lastReceivedDrop.type === 'text'
                    ? `Text: "${lastReceivedDrop.text?.slice(0, 40)}..."`
                    : `Size: ${(lastReceivedDrop.size / 1024).toFixed(1)} KB • MIME: ${lastReceivedDrop.mimeType}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {lastReceivedDrop.type === 'file' && lastReceivedDrop.data && (
                <a
                  href={URL.createObjectURL(new Blob([lastReceivedDrop.data as unknown as BlobPart], { type: lastReceivedDrop.mimeType }))}
                  download={lastReceivedDrop.name || 'sound-drop-file'}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold text-xs hover:brightness-110 active:scale-95 transition-all shadow-lg"
                >
                  <Download className="w-4 h-4" />
                  <span>Save to Mac</span>
                </a>
              )}
              {lastReceivedDrop.type === 'text' && lastReceivedDrop.text && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(lastReceivedDrop.text || '');
                    alert('Copied to clipboard!');
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-bold text-xs hover:brightness-110 active:scale-95 transition-all shadow-lg"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Copy Text</span>
                </button>
              )}
              <button
                onClick={onClearDrop}
                className="px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
