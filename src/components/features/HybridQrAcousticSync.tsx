'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  QrCode,
  Camera,
  Radio,
  Check,
  RotateCcw,
  Volume2,
  X,
  Sparkles,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import { DrawablySketchBadge } from '@/components/ui/DrawablySketchBadge';

interface HybridQrAcousticSyncProps {
  currentPayload: string;
  onScannedToken: (token: string) => void;
  onEmitChirpBeacon?: () => void;
}

export const HybridQrAcousticSync: React.FC<HybridQrAcousticSyncProps> = ({
  currentPayload,
  onScannedToken,
  onEmitChirpBeacon,
}) => {
  const [mode, setMode] = useState<'SHOW_QR' | 'SCAN_CAMERA'>('SHOW_QR');
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Play pairing chime on scan success
  const playPairingChime = () => {
    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08); // E5
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16); // G5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } catch {}
  };

  const stopCamera = useCallback(() => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Frame processing loop with jsQR
  const scanVideoFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        playPairingChime();
        setScanResult(code.data);
        stopCamera();
        onScannedToken(code.data);
        return;
      }
    }

    animationFrameIdRef.current = requestAnimationFrame(scanVideoFrame);
  }, [onScannedToken, stopCamera]);

  const startCamera = async () => {
    setCameraError(null);
    setScanResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        animationFrameIdRef.current = requestAnimationFrame(scanVideoFrame);
      }
    } catch (err) {
      setCameraError(`Caméra non disponible : ${(err as Error).message}`);
    }
  };

  useEffect(() => {
    if (mode === 'SCAN_CAMERA') {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div className="w-full glass-panel rounded-2xl p-5 sm:p-6 flex flex-col gap-5 text-[#E4E4E7]">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500/20 via-purple-500/10 to-transparent border border-violet-500/30 flex items-center justify-center text-violet-400 shadow-lg shadow-violet-500/10">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold font-mono tracking-tight text-white">
                Synchronisation QR & Son
              </h3>
              <DrawablySketchBadge text="HYBRIDE" accent="sky" />
            </div>
            <p className="text-xs text-neutral-400">
              Appairage optique par QR Code haute densité synchronisé par bip acoustique
            </p>
          </div>
        </div>

        {/* Bascule Générer vs Scanner */}
        <div className="grid grid-cols-2 gap-1.5 bg-[#08090F] p-1.5 rounded-xl border border-white/[0.08]">
          <button
            type="button"
            onClick={() => {
              setMode('SHOW_QR');
              setScanResult(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg font-mono text-xs transition-all ${
              mode === 'SHOW_QR'
                ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white font-bold shadow-md shadow-violet-500/20'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Mon QR Code</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('SCAN_CAMERA');
              setScanResult(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg font-mono text-xs transition-all ${
              mode === 'SCAN_CAMERA'
                ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white font-bold shadow-md shadow-violet-500/20'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Scanner Caméra</span>
          </button>
        </div>
      </div>

      {/* Mode 1: Afficher le QR Code dynamique */}
      {mode === 'SHOW_QR' && (
        <div className="flex flex-col items-center justify-center gap-4 py-4">
          <div className="p-4 bg-white rounded-2xl shadow-[0_0_40px_rgba(139,92,246,0.2)] border-4 border-violet-500/30">
            <QRCodeSVG
              value={currentPayload || 'SOUNDDROP_AIRGAP_INIT'}
              size={180}
              level="M"
              includeMargin={false}
            />
          </div>

          <p className="font-mono text-xs text-neutral-300 text-center max-w-sm">
            Présentez ce QR Code à l'autre appareil pour établir la liaison hors-ligne instantanément.
          </p>

          {onEmitChirpBeacon && (
            <button
              type="button"
              onClick={onEmitChirpBeacon}
              className="flex items-center gap-2 py-2 px-3.5 rounded-xl font-mono text-xs font-semibold bg-white/[0.06] hover:bg-white/[0.1] text-violet-300 border border-violet-500/30 transition-all"
            >
              <Volume2 className="w-4 h-4 text-violet-400" />
              <span>Émettre un bip acoustique d'annonce</span>
            </button>
          )}
        </div>
      )}

      {/* Mode 2: Scanner Caméra */}
      {mode === 'SCAN_CAMERA' && (
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="relative w-full max-w-sm aspect-square rounded-2xl overflow-hidden bg-black border-2 border-violet-500/50 shadow-2xl">
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Viseur optique animé */}
            <div className="absolute inset-8 border-2 border-dashed border-violet-400/70 rounded-xl pointer-events-none flex items-center justify-center">
              <span className="w-full h-0.5 bg-violet-400/80 animate-pulse shadow-[0_0_12px_rgba(167,139,250,0.8)]" />
            </div>
          </div>

          {cameraError && (
            <p className="text-xs font-mono text-red-400 text-center">
              {cameraError}
            </p>
          )}

          {scanResult && (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs font-mono text-emerald-400">
              <Check className="w-4 h-4" />
              <span>QR Code capté : {scanResult.slice(0, 24)}...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
