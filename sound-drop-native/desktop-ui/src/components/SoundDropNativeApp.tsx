'use client';

import React, { useState } from 'react';
import { KineticCanvas } from './KineticCanvas';
import { MetallicBubble } from './MetallicBubble';
import { MicroButton } from './MicroButton';
import { MascotCompanion } from './MascotCompanion';
import { MorphingIcon, MorphIconState } from './MorphingIcon';
import { AcousticPairingTx } from '@/lib/audio/acoustic-pairing';
import { Volume2, VolumeX, ShieldCheck, Cpu } from 'lucide-react';

export const SoundDropNativeApp: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'listening' | 'transmitting' | 'paired'>('idle');
  const [snrDb, setSnrDb] = useState(21.4);
  const [profile, setProfile] = useState<'audible' | 'ultrasonic' | 'whisper'>('audible');

  const handleTriggerEmit = async () => {
    setStatus('transmitting');
    try {
      const tx = new AcousticPairingTx();
      await tx.emitPairingChirp(1);
      setTimeout(async () => {
        setStatus('paired');
        await tx.playConfirmationChord();
      }, 350);
    } catch {
      setStatus('idle');
    }
  };

  const morphState: MorphIconState =
    status === 'paired' ? 'paired' : status === 'transmitting' ? 'transmitting' : 'radar';

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 p-6 select-none">
      {/* Top Header Bar with Koboyo Typography and Hairline Borders */}
      <div className="flex items-center justify-between p-4 rounded-2xl bg-[#0b0e17]/90 hairline-border backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl metalforge-node flex items-center justify-center text-cyan-400">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold koboyo-title uppercase text-slate-100 tracking-wider">
                Sound Drop Native
              </h2>
              <span className="px-2 py-0.5 text-[9px] koboyo-telemetry rounded-full bg-cyan-950 border-[0.5px] border-cyan-800 text-cyan-300">
                Rust Core • C++ SIMD • Go Daemon
              </span>
            </div>
            <p className="text-[11px] koboyo-telemetry text-slate-400">
              Zero-HTML/JS PHY layer • Hairline & Metalforge Desktop Architecture
            </p>
          </div>
        </div>

        {/* Profile Switcher Micro-Buttons */}
        <div className="flex items-center gap-2">
          {(['audible', 'ultrasonic', 'whisper'] as const).map((p) => (
            <MicroButton
              key={p}
              label={p.toUpperCase()}
              variant={profile === p ? 'primary' : 'secondary'}
              onClick={() => setProfile(p)}
            />
          ))}
        </div>
      </div>

      {/* Main Kinetic Canvas Stage */}
      <KineticCanvas isBroadcasting={status === 'transmitting'} isPaired={status === 'paired'}>
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Central Metallic Node */}
          <MetallicBubble
            label={status === 'paired' ? 'ACOUSTICALLY PAIRED' : 'CLICK TO EMIT'}
            subLabel={
              status === 'transmitting'
                ? 'Synthesizing LFM Dual-Chirp...'
                : status === 'paired'
                ? `Node #1 • ${snrDb} dB SNR`
                : '16-FSK Acoustic Proximity'
            }
            status={status}
            onClick={handleTriggerEmit}
          >
            <MorphingIcon state={morphState} className="w-10 h-10 mb-2" />
          </MetallicBubble>

          {/* Interactive Page-Mascot placed in bottom-right corner */}
          <div className="absolute bottom-4 right-6 z-20">
            <MascotCompanion status={status} snrDb={snrDb} />
          </div>

          {/* Bottom-left Native Architecture Telemetry Pill */}
          <div className="absolute bottom-4 left-6 z-20 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/80 border-[0.5px] border-white/10 text-[10px] koboyo-telemetry text-slate-300 backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>48,000 Hz PCM • SIMD AVX2 • Non-Coherent 16-FSK</span>
          </div>
        </div>
      </KineticCanvas>

      {/* Action Footer */}
      <div className="flex items-center justify-between p-4 rounded-2xl bg-[#0b0e17]/80 hairline-border">
        <div className="flex items-center gap-2 text-xs koboyo-telemetry text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Multi-Tier Native Stack: Rust + C++ + Go + Python + Ruby + R</span>
        </div>

        <div className="flex items-center gap-3">
          <MicroButton
            label={status === 'transmitting' ? 'Stop Transmission' : 'Reset Radar'}
            variant="secondary"
            onClick={() => setStatus('idle')}
          />
          <MicroButton
            label="Emit Proximity Ping"
            variant="primary"
            onClick={handleTriggerEmit}
          />
        </div>
      </div>
    </div>
  );
};
