'use client';

import React, { useEffect, useRef } from 'react';
import { ModemConfig } from '@/types/acoustic';
import { getFskFrequencies, formatFrequency } from '@/lib/dsp/constants';

interface SpectrogramCanvasProps {
  analyserNode: AnalyserNode | null;
  config: ModemConfig;
  activeFrequency?: number;
  isTransmitting?: boolean;
}

export const SpectrogramCanvas: React.FC<SpectrogramCanvasProps> = ({
  analyserNode,
  config,
  activeFrequency,
  isTransmitting = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);

  // Offscreen canvas to hold the scrolling waterfall history
  const waterfallCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create offscreen buffer if not present
    if (!waterfallCanvasRef.current) {
      waterfallCanvasRef.current = document.createElement('canvas');
    }
    const wfCanvas = waterfallCanvasRef.current;
    const wfCtx = wfCanvas.getContext('2d');

    const sampleRate = config.sampleRate || 48000;
    const fftSize = analyserNode ? analyserNode.fftSize : 2048;
    const binCount = fftSize / 2;
    const freqData = new Uint8Array(binCount);
    const timeData = new Uint8Array(fftSize);

    // Thermal color map generator: Black -> Blue -> Cyan -> Emerald -> Amber -> White
    const colorMap: string[] = [];
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      let r = 0;
      let g = 0;
      let b = 0;

      if (v < 0.2) {
        // Black to Deep Navy Blue
        b = Math.floor(v * 5 * 180);
      } else if (v < 0.45) {
        // Deep Blue to Cyan
        const t = (v - 0.2) / 0.25;
        b = 180 + Math.floor(t * 75);
        g = Math.floor(t * 210);
      } else if (v < 0.7) {
        // Cyan to Emerald Green
        const t = (v - 0.45) / 0.25;
        b = Math.floor((1 - t) * 255);
        g = 210 + Math.floor(t * 45);
        r = Math.floor(t * 120);
      } else if (v < 0.9) {
        // Green to Bright Amber/Orange
        const t = (v - 0.7) / 0.2;
        r = 120 + Math.floor(t * 135);
        g = 255 - Math.floor(t * 90);
        b = 0;
      } else {
        // Orange to White
        const t = (v - 0.9) / 0.1;
        r = 255;
        g = 165 + Math.floor(t * 90);
        b = Math.floor(t * 255);
      }
      colorMap.push(`rgb(${r},${g},${b})`);
    }

    const fskFrequencies = getFskFrequencies(config);

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      if (width === 0 || height === 0) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // Sync offscreen waterfall canvas size
      if (wfCanvas.width !== width || wfCanvas.height !== Math.floor(height * 0.65)) {
        wfCanvas.width = width;
        wfCanvas.height = Math.floor(height * 0.65);
      }

      const wfHeight = wfCanvas.height;
      const oscHeight = height - wfHeight;

      // Read audio data from analyser node
      if (analyserNode) {
        analyserNode.getByteFrequencyData(freqData);
        analyserNode.getByteTimeDomainData(timeData);
      } else {
        freqData.fill(0);
        timeData.fill(128);
      }

      // 1. SCROLL WATERFALL DOWNWARDS BY 1 PIXEL
      if (wfCtx) {
        wfCtx.drawImage(wfCanvas, 0, 0, width, wfHeight - 1, 0, 1, width, wfHeight - 1);

        // Draw new 1-pixel scan line at the top
        // Frequency axis maps from 1000 Hz to 22000 Hz horizontally
        const minFreq = 1000;
        const maxFreq = 22000;
        const hzPerBin = sampleRate / fftSize;

        for (let x = 0; x < width; x++) {
          const freq = minFreq + (x / width) * (maxFreq - minFreq);
          const bin = Math.min(binCount - 1, Math.max(0, Math.floor(freq / hzPerBin)));
          const intensity = freqData[bin];
          wfCtx.fillStyle = colorMap[intensity];
          wfCtx.fillRect(x, 0, 1, 1);
        }
      }

      // 2. DRAW COMPOSITE CANVAS
      ctx.fillStyle = '#07090E';
      ctx.fillRect(0, 0, width, height);

      // Draw scrolling waterfall
      ctx.drawImage(wfCanvas, 0, 0);

      // Draw 16-FSK Frequency Lane Markers
      const minFreq = 1000;
      const maxFreq = 22000;

      for (let i = 0; i < fskFrequencies.length; i++) {
        const freq = fskFrequencies[i];
        const x = ((freq - minFreq) / (maxFreq - minFreq)) * width;

        const isHit = activeFrequency && Math.abs(activeFrequency - freq) < 50;

        ctx.strokeStyle = isHit ? 'rgba(6, 182, 212, 0.9)' : 'rgba(71, 85, 105, 0.35)';
        ctx.lineWidth = isHit ? 2 : 1;
        ctx.setLineDash(isHit ? [] : [3, 4]);

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, wfHeight);
        ctx.stroke();

        // Symbol label at the top of the lane
        if (i % 2 === 0 || isHit) {
          ctx.fillStyle = isHit ? '#22d3ee' : '#64748b';
          ctx.font = '9px monospace';
          ctx.fillText(`0x${i.toString(16).toUpperCase()}`, x - 7, 12);
        }
      }
      ctx.setLineDash([]);

      // 3. DRAW SPECTRUM / OSCILLOSCOPE IN BOTTOM HALF
      ctx.fillStyle = '#0A0D14';
      ctx.fillRect(0, wfHeight, width, oscHeight);

      // Separator line
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, wfHeight);
      ctx.lineTo(width, wfHeight);
      ctx.stroke();

      // Oscilloscope waveform trace
      ctx.strokeStyle = isTransmitting ? '#06b6d4' : '#10b981';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      const sliceWidth = width / fftSize;
      let curX = 0;
      for (let i = 0; i < fftSize; i++) {
        const v = timeData[i] / 128.0; // 0..2
        const y = wfHeight + (v * oscHeight) / 2;

        if (i === 0) {
          ctx.moveTo(curX, y);
        } else {
          ctx.lineTo(curX, y);
        }
        curX += sliceWidth;
      }
      ctx.stroke();

      // Labels
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.fillText('WATERFALL SPECTROGRAM (1.0 kHz - 22.0 kHz)', 10, 24);
      ctx.fillText(
        `BAND: ${config.band.toUpperCase()} | BASE: ${formatFrequency(config.baseFrequency)} | STEP: ${config.deltaFrequency} Hz`,
        10,
        wfHeight - 8
      );
      ctx.fillText('TIME DOMAIN OSCILLOSCOPE (48.0 kHz PCM)', 10, wfHeight + 16);

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [analyserNode, config, activeFrequency, isTransmitting]);

  // Handle Canvas Resizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return (
    <div className="relative w-full h-72 rounded-2xl overflow-hidden border border-surface-border bg-slate-950 shadow-inner">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};
