'use client';

import React, { useState, useEffect, useRef } from 'react';
import { startCapture, CaptureHandle, AudioCaptureError } from '@/lib/audio/capture';
import { rmsDbfs, evaluateNoiseLevel, NoiseStatus } from '@/lib/audio/rms';
import { playSamples } from '@/lib/audio/playback';
import { Mic, Volume2, ShieldAlert, CheckCircle, RefreshCw } from 'lucide-react';

export default function AudioDebugPage() {
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [baseLatency, setBaseLatency] = useState<number | null>(null);
  const [outputLatency, setOutputLatency] = useState<number | null>(null);
  const [appliedSettings, setAppliedSettings] = useState<MediaTrackSettings | null>(null);
  const [rmsDb, setRmsDb] = useState<number>(-120);
  const [peakDb, setPeakDb] = useState<number>(-120);
  const [noiseStatus, setNoiseStatus] = useState<NoiseStatus | null>(null);
  const [clippingDetected, setClippingDetected] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<{ msg: string; advice: string } | null>(null);

  const captureHandleRef = useRef<CaptureHandle | null>(null);

  const stopCapture = () => {
    if (captureHandleRef.current) {
      captureHandleRef.current.stop();
      captureHandleRef.current = null;
    }
    setIsCapturing(false);
  };

  const startLiveCapture = async () => {
    setErrorMessage(null);
    stopCapture();

    try {
      const handle = await startCapture((samples, sr) => {
        setSampleRate(sr);
        const currentRms = rmsDbfs(samples);
        setRmsDb(currentRms);
        setNoiseStatus(evaluateNoiseLevel(currentRms));

        // Détection de crête et d'écrêtage
        let peak = 0;
        for (let i = 0; i < samples.length; i++) {
          const abs = Math.abs(samples[i]);
          if (abs > peak) peak = abs;
        }
        const currentPeakDb = 20 * Math.log10(Math.max(peak, 1e-9));
        setPeakDb((prev) => Math.max(prev * 0.95, currentPeakDb));

        if (peak >= 0.999) {
          setClippingDetected(true);
        }
      });

      captureHandleRef.current = handle;
      setIsCapturing(true);
      setSampleRate(handle.ctx.sampleRate);
      setBaseLatency(handle.ctx.baseLatency ?? null);
      setOutputLatency((handle.ctx as unknown as { outputLatency?: number }).outputLatency ?? null);
      setAppliedSettings(handle.applied);
    } catch (err) {
      if (err instanceof AudioCaptureError) {
        setErrorMessage({ msg: err.userMessage, advice: err.actionAdvice });
      } else {
        setErrorMessage({
          msg: 'Erreur inattendue d’accès au micro',
          advice: String(err),
        });
      }
    }
  };

  const handleTestTone = async () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: 48000 });
      const durationSec = 0.5;
      const n = Math.round(durationSec * ctx.sampleRate);
      const tone = new Float32Array(n);
      const freq = 1800; // 1.8 kHz audible

      for (let i = 0; i < n; i++) {
        tone[i] = 0.4 * Math.sin((2 * Math.PI * freq * i) / ctx.sampleRate);
      }

      await playSamples(ctx, tone, { volume: 0.5 });
      await ctx.close();
    } catch (err) {
      console.error('Erreur tonalité de test:', err);
    }
  };

  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#07070A] text-[#F4F4F6] font-mono p-4 sm:p-8 flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <div className="border-b border-white/10 pb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Mic className="w-5 h-5 text-orange-400" />
              <span>Diagnostic Audio Électro-Acoustique</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1 font-sans">
              Page technique de test pour inspecter l’AudioContext, les latences et le bruit ambiant.
            </p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
            /debug/audio
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => (isCapturing ? stopCapture() : void startLiveCapture())}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-2 ${
              isCapturing
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-extrabold'
            }`}
          >
            <Mic className="w-4 h-4" />
            <span>{isCapturing ? 'Arrêter la Capture' : 'Démarrer l’Écoute Micro'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleTestTone()}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase bg-zinc-800 hover:bg-zinc-700 text-white border border-white/10 transition-colors flex items-center gap-2"
          >
            <Volume2 className="w-4 h-4 text-cyan-400" />
            <span>Jouer Tonalité 1.8 kHz (500 ms)</span>
          </button>
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-1">
            <div className="flex items-center gap-2 text-rose-300 text-xs font-bold">
              <ShieldAlert className="w-4 h-4" />
              <span>{errorMessage.msg}</span>
            </div>
            <p className="text-[11px] text-rose-200/80 font-sans">{errorMessage.advice}</p>
          </div>
        )}

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: AudioContext & Pipeline */}
          <div className="p-4 rounded-2xl bg-[#0D0D14] border border-white/10 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-orange-400 border-b border-white/5 pb-2">
              1. Contexte Audio & Latence
            </h2>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">Fréquence d’échantillonnage :</span>
                <span className="font-bold text-white">
                  {sampleRate ? `${sampleRate} Hz` : 'En attente...'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Latence de base (baseLatency) :</span>
                <span className="text-white">
                  {baseLatency !== null ? `${(baseLatency * 1000).toFixed(2)} ms` : 'N/D'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Latence de sortie (outputLatency) :</span>
                <span className="text-white">
                  {outputLatency !== null ? `${(outputLatency * 1000).toFixed(2)} ms` : 'N/D'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Moteur AudioWorklet :</span>
                <span className="text-emerald-400 font-bold">capture-processor (2048 buf)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Protection Anti-Larsen :</span>
                <span className="text-emerald-400 font-bold">Garantie (Pas de destination)</span>
              </div>
            </div>
          </div>

          {/* Card 2: Micro Traitements Appliqués */}
          <div className="p-4 rounded-2xl bg-[#0D0D14] border border-white/10 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-cyan-400 border-b border-white/5 pb-2">
              2. Paramètres Matériels Microphone
            </h2>
            {appliedSettings ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Suppression de bruit (noiseSuppression) :</span>
                  <span className={appliedSettings.noiseSuppression ? 'text-amber-400' : 'text-emerald-400 font-bold'}>
                    {String(appliedSettings.noiseSuppression ?? false)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Annulation d’écho (echoCancellation) :</span>
                  <span className={appliedSettings.echoCancellation ? 'text-amber-400' : 'text-emerald-400 font-bold'}>
                    {String(appliedSettings.echoCancellation ?? false)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Gain automatique (autoGainControl) :</span>
                  <span className={appliedSettings.autoGainControl ? 'text-amber-400' : 'text-emerald-400 font-bold'}>
                    {String(appliedSettings.autoGainControl ?? false)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Canaux demandés :</span>
                  <span className="text-white">{appliedSettings.channelCount ?? 1} (Mono)</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-zinc-500 italic py-4 text-center">
                Démarrez l’écoute pour inspecter les réglages du pilote.
              </div>
            )}
          </div>
        </div>

        {/* Card 3: RMS Levels & Environment Analysis */}
        <div className="p-4 rounded-2xl bg-[#0D0D14] border border-white/10 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400 border-b border-white/5 pb-2">
            3. Analyse du Bruit Ambiant & Niveaux RMS
          </h2>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-400">Niveau RMS Instantané :</span>
                <span className="font-bold text-white">{rmsDb.toFixed(1)} dBFS</span>
              </div>
              <div className="h-3 w-full bg-zinc-900 rounded-full overflow-hidden border border-white/10 relative">
                <div
                  className={`h-full transition-all duration-75 ${
                    rmsDb > -35 ? 'bg-rose-500' : rmsDb > -50 ? 'bg-amber-400' : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, ((rmsDb + 100) / 100) * 100))}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-400">Niveau Crête (Peak) :</span>
                <span className="font-bold text-white">{peakDb.toFixed(1)} dBFS</span>
              </div>
              <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden border border-white/10">
                <div
                  className="h-full bg-cyan-400 transition-all duration-100"
                  style={{ width: `${Math.min(100, Math.max(0, ((peakDb + 100) / 100) * 100))}%` }}
                />
              </div>
            </div>

            {clippingDetected && (
              <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs flex items-center justify-between">
                <span>Attention : Écrêtage audio détecté (amplitude &ge; 1.0).</span>
                <button
                  type="button"
                  onClick={() => setClippingDetected(false)}
                  className="underline text-[10px] text-amber-200"
                >
                  Réinitialiser
                </button>
              </div>
            )}

            {noiseStatus && (
              <div
                className={`p-3 rounded-xl border text-xs space-y-1 ${
                  noiseStatus.environment === 'calm'
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                    : noiseStatus.environment === 'noisy'
                    ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                    : 'bg-rose-950/30 border-rose-500/30 text-rose-200'
                }`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>{noiseStatus.label}</span>
                </div>
                <p className="text-[11px] font-sans opacity-90">{noiseStatus.actionAdvice}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
