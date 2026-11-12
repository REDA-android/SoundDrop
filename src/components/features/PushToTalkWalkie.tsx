'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Radio,
  Mic,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Sparkles,
  Signal,
} from 'lucide-react';
import { DrawablySketchBadge } from '@/components/ui/DrawablySketchBadge';

interface AudioMessage {
  id: string;
  sender: string;
  timestamp: number;
  durationSec: number;
  blobUrl: string;
}

interface PushToTalkWalkieProps {
  onBroadcastAudio?: (blob: Blob, durationSec: number) => void;
  incomingAudios?: AudioMessage[];
}

export const PushToTalkWalkie: React.FC<PushToTalkWalkieProps> = ({
  onBroadcastAudio,
  incomingAudios = [],
}) => {
  const [isPressing, setIsPressing] = useState(false);
  const [channel, setChannel] = useState(1);
  const [statusText, setStatusText] = useState('Canal Prêt • Maintenez pour parler');
  const [messages, setMessages] = useState<AudioMessage[]>([]);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStartTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<number | null>(null);

  // Sync external incoming audio messages
  useEffect(() => {
    if (incomingAudios.length > 0) {
      setMessages((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        const newOnes = incomingAudios.filter((p) => !ids.has(p.id));
        return [...newOnes, ...prev];
      });
    }
  }, [incomingAudios]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // Radio squelch / roger beep
  const playRogerChime = () => {
    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {}
  };

  // Start recording on mouse down / touch start
  const handleStartPushToTalk = async () => {
    if (isPressing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const totalDuration = Math.max(1, Math.round((Date.now() - recordStartTimeRef.current) / 1000));
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });

        playRogerChime();

        if (audioBlob.size > 100) {
          const newMsg: AudioMessage = {
            id: `ptt-${Date.now()}`,
            sender: 'Moi (Émetteur)',
            timestamp: Date.now(),
            durationSec: totalDuration,
            blobUrl: URL.createObjectURL(audioBlob),
          };
          setMessages((prev) => [newMsg, ...prev]);

          if (onBroadcastAudio) {
            onBroadcastAudio(audioBlob, totalDuration);
          }
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      recordStartTimeRef.current = Date.now();
      setIsPressing(true);
      setRecordingSeconds(0);
      setStatusText('ÉMISSION EN COURS... (PARLEZ)');

      timerIntervalRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setStatusText(`Erreur micro : ${(err as Error).message}`);
    }
  };

  // Stop recording on mouse up / touch end
  const handleStopPushToTalk = () => {
    if (!isPressing) return;
    setIsPressing(false);
    setStatusText('Message envoyé (Bip Roger émis)');
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  return (
    <div className="w-full glass-panel rounded-2xl p-5 sm:p-6 flex flex-col gap-5 text-[#E4E4E7]">
      {/* En-tête avec indicateur de fréquence */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-transparent border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/10">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold font-mono tracking-tight text-white">
                Talkie-Walkie P2P Hors-Ligne
              </h3>
              <DrawablySketchBadge text="PUSH-TO-TALK" accent="emerald" />
            </div>
            <p className="text-xs text-neutral-400">
              Communication audio directe micro-à-micro chiffrée sans internet
            </p>
          </div>
        </div>

        {/* Sélecteur de canal radio */}
        <div className="flex items-center gap-2 bg-[#08090F] px-3 py-1.5 rounded-xl border border-white/[0.08] text-xs font-mono">
          <Signal className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-neutral-400">Canal :</span>
          <select
            value={channel}
            onChange={(e) => setChannel(Number(e.target.value))}
            className="bg-transparent text-emerald-400 font-bold focus:outline-none cursor-pointer"
          >
            <option value={1} className="bg-[#0A0A0C]">01 (446.006 MHz)</option>
            <option value={2} className="bg-[#0A0A0C]">02 (446.018 MHz)</option>
            <option value={3} className="bg-[#0A0A0C]">03 (446.031 MHz)</option>
            <option value={4} className="bg-[#0A0A0C]">04 (446.043 MHz)</option>
          </select>
        </div>
      </div>

      {/* Gros bouton tactile Push-To-Talk style amicro.dev */}
      <div className="flex flex-col items-center justify-center gap-4 py-6">
        <button
          type="button"
          onMouseDown={() => void handleStartPushToTalk()}
          onMouseUp={handleStopPushToTalk}
          onTouchStart={() => void handleStartPushToTalk()}
          onTouchEnd={handleStopPushToTalk}
          className={`relative group w-36 h-36 sm:w-40 sm:h-40 rounded-full flex flex-col items-center justify-center gap-2 select-none transition-all duration-150 cursor-pointer ${
            isPressing
              ? 'scale-95 bg-gradient-to-br from-red-500 via-rose-600 to-red-700 text-white shadow-[0_0_50px_rgba(239,68,68,0.5)] border-4 border-red-300'
              : 'bg-gradient-to-br from-emerald-500 via-teal-600 to-emerald-800 text-black shadow-[0_0_35px_rgba(16,185,129,0.3)] border-4 border-emerald-400/50 hover:scale-105'
          }`}
        >
          {/* Ondulation acoustique d'arrière-plan */}
          {isPressing && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-30 pointer-events-none" />
          )}

          <Mic className={`w-8 h-8 sm:w-10 sm:h-10 ${isPressing ? 'animate-bounce text-white' : 'text-black'}`} />
          <span className="font-mono text-xs sm:text-sm font-black tracking-wider uppercase">
            {isPressing ? `${recordingSeconds}s • ÉMET` : 'MAINTENIR'}
          </span>
          <span className="text-[10px] font-mono tracking-tighter opacity-80">
            {isPressing ? 'Relâcher pour Bip' : 'POUR PARLER'}
          </span>
        </button>

        <p className="font-mono text-xs text-neutral-400 text-center">
          {statusText}
        </p>
      </div>

      {/* Messages vocaux récents reçus / émis */}
      <div className="flex flex-col gap-2 pt-2 border-t border-white/[0.06]">
        <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
          <span>Transmissions Vocales ({messages.length})</span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setMessages([])}
              className="text-[11px] text-neutral-500 hover:text-red-400 transition-colors"
            >
              Effacer
            </button>
          )}
        </div>

        {messages.length === 0 ? (
          <p className="text-[11px] font-mono text-neutral-600 text-center py-4">
            Aucun enregistrement radio sur ce canal.
          </p>
        ) : (
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className="flex items-center justify-between p-3 bg-[#08090F] border border-white/[0.06] rounded-xl text-xs font-mono"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <Volume2 className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-white font-bold">{msg.sender}</p>
                    <p className="text-neutral-500 text-[10px]">
                      Durée : {msg.durationSec}s • {new Date(msg.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>

                <audio controls src={msg.blobUrl} className="h-8 max-w-[180px] sm:max-w-[220px]" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
