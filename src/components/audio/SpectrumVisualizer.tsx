'use client';

import React, { useEffect, useRef } from 'react';
import { DSP_CONFIG, ACOUSTIC_BANDS, AcousticBandMode } from '@/lib/audio/dsp-constants';
import { formatFrequency, formatDecibels } from '@/lib/utils/formatters';

interface SpectrumProps {
  isActive: boolean;
  spectralData?: Float32Array | null;
  timeDomainData?: Float32Array | null;
  dominantFreq?: number;
  snrDb?: number;
  sampleRate?: number;
  bandMode?: AcousticBandMode;
  statusLabel?: string;
}

export const SpectrumVisualizer: React.FC<SpectrumProps> = ({
  isActive,
  spectralData,
  timeDomainData,
  dominantFreq,
  snrDb = 0,
  sampleRate = DSP_CONFIG.SAMPLE_RATE,
  bandMode = 'AUDIBLE',
  statusLabel = 'READY',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wavesurferRef = useRef<any>(null);
  const phaseRef = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;
    const initWaveSurfer = async () => {
      if (!waveContainerRef.current || wavesurferRef.current) return;
      try {
        const WaveSurferModule = (await import('wavesurfer.js')).default;
        if (!isMounted || !waveContainerRef.current) return;
        wavesurferRef.current = WaveSurferModule.create({
          container: waveContainerRef.current,
          waveColor: '#FF5500',
          progressColor: '#FF5500',
          cursorColor: 'transparent',
          height: 22,
          barWidth: 2,
          barGap: 2,
          barRadius: 1,
          interact: false,
          normalize: true,
        });
      } catch {
        // Fallback handled by canvas
      }
    };

    void initWaveSurfer();

    return () => {
      isMounted = false;
      if (wavesurferRef.current) {
        try {
          wavesurferRef.current.destroy();
        } catch {
          // Ignored
        }
        wavesurferRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (wavesurferRef.current && timeDomainData && isActive) {
      try {
        const downsampled: number[] = [];
        const step = Math.max(1, Math.floor(timeDomainData.length / 80));
        for (let i = 0; i < timeDomainData.length; i += step) {
          downsampled.push(Math.min(1, Math.abs(timeDomainData[i]) * 3.5));
        }
        wavesurferRef.current.load('', [downsampled], 1);
      } catch {
        // Ignored
      }
    }
  }, [timeDomainData, isActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const band = ACOUSTIC_BANDS[bandMode];

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Pure Recessed OLED Black
      ctx.fillStyle = '#070709';
      ctx.fillRect(0, 0, width, height);

      const minFreq = band.VIS_MIN_FREQ;
      const maxFreq = band.VIS_MAX_FREQ;
      const freqRange = maxFreq - minFreq;

      const getXForFreq = (f: number) => {
        return ((f - minFreq) / freqRange) * width;
      };

      // Subtle calibration tick marks at bottom
      const markers =
        bandMode === 'ULTRASONIC'
          ? [17000, 18000, 19000, 20000]
          : [1500, 2000, 2500, 3000, 3500];

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      markers.forEach((freq) => {
        const x = getXForFreq(freq);
        ctx.beginPath();
        ctx.moveTo(x, height - 8);
        ctx.lineTo(x, height);
        ctx.stroke();

        ctx.fillStyle = '#52525B';
        ctx.font = '9px var(--font-mono), monospace';
        ctx.fillText(`${(freq / 1000).toFixed(1)}k`, x + 3, height - 3);
      });

      // Carrier Reference Hairlines
      const channels = [
        band.PREAMBLE_FREQ_1,
        band.PREAMBLE_FREQ_2,
        band.BIT_0_FREQ,
        band.BIT_1_FREQ,
      ];
      channels.forEach((f) => {
        const x = getXForFreq(f);
        ctx.fillStyle = 'rgba(255, 85, 0, 0.14)';
        ctx.fillRect(x, 0, 1, height - 12);
      });

      if (spectralData && spectralData.length > 0 && isActive) {
        // Discrete Precision Bar Analyzer (Teenage Engineering / RME style)
        const numBars = 64;
        const barWidth = Math.floor(width / numBars) - 2;
        const binSize = sampleRate / DSP_CONFIG.FFT_SIZE;

        for (let i = 0; i < numBars; i++) {
          const barFreq = minFreq + (i / numBars) * freqRange;
          const bin = Math.min(
            spectralData.length - 1,
            Math.max(0, Math.round(barFreq / binSize))
          );
          const db = spectralData[bin] ?? -120;
          const normalized = Math.max(0.04, Math.min(1, (db + 108) / 76));
          const barHeight = normalized * (height - 20);
          const x = i * (barWidth + 2) + 2;
          const y = height - 14 - barHeight;

          ctx.fillStyle = normalized > 0.55 ? '#FF5500' : '#E4E4E7';
          ctx.fillRect(x, y, barWidth, barHeight);
        }
      } else if (isActive) {
        // Active Transmit Sine Synthesis Wave
        ctx.lineWidth = 1.75;
        ctx.strokeStyle = '#FF5500';
        ctx.beginPath();

        const step = width / 120;
        phaseRef.current += 0.11;

        for (let i = 0; i <= 120; i++) {
          const x = i * step;
          const envelope = Math.sin((i / 120) * Math.PI);
          const y =
            (height - 12) / 2 +
            Math.sin(phaseRef.current + i * 0.28) * 16 * envelope;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.stroke();
      } else {
        // Standby Precision Horizon Line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, (height - 12) / 2);
        ctx.lineTo(width, (height - 12) / 2);
        ctx.stroke();
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isActive, spectralData, dominantFreq, sampleRate, bandMode]);

  return (
    <div className="oled-screen rounded-2xl p-3.5 flex flex-col gap-2">
      {/* Top OLED Telemetry Strip */}
      <div className="flex items-center justify-between font-mono text-[10px] tracking-wider uppercase">
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isActive ? 'bg-[#FF5500] animate-pulse' : 'bg-[#52525B]'
            }`}
          />
          <span className="text-[#D4D4D8] font-semibold">{statusLabel}</span>
          <span className="text-[#52525B]">•</span>
          <span className="text-[#8E8E98]">
            {bandMode === 'AUDIBLE' ? 'BAND 1.8-3.6KHZ' : 'ULTRA 17.5-20KHZ'}
          </span>
        </div>

        <div className="text-[#8E8E98]">
          {dominantFreq && isActive ? (
            <span className="text-[#FF5500] font-semibold">
              {formatFrequency(dominantFreq)} ({formatDecibels(snrDb)})
            </span>
          ) : (
            <span>FS {Math.round(sampleRate / 1000)}KHZ</span>
          )}
        </div>
      </div>

      {/* Main Spectrum Canvas */}
      <canvas
        ref={canvasRef}
        width={520}
        height={76}
        className="w-full rounded-lg bg-[#070709]"
      />

      {/* WaveSurfer Time-Domain Sub-Track (only visible when active) */}
      <div
        ref={waveContainerRef}
        className={`w-full overflow-hidden transition-all duration-200 ${
          isActive && timeDomainData ? 'h-5 opacity-90' : 'h-0 opacity-0'
        }`}
      />
    </div>
  );
};
