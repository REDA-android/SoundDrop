/**
 * Linear Frequency Modulated (LFM) Chirp Generator & Matched Filter Detector
 * Generates acoustic sync preambles and detects them via cross-correlation.
 */

import { ModemConfig } from '@/types/acoustic';
import { applyRaisedCosineEnvelope } from './windowing';

export interface ChirpDetectionResult {
  detected: boolean;
  peakIndex: number;
  correlation: number;
  energy: number;
}

export class ChirpEngine {
  private config: ModemConfig;
  private referenceChirp: Float32Array;
  private refEnergy: number;

  constructor(config: ModemConfig) {
    this.config = config;
    this.referenceChirp = this.synthesizePreambleWaveform();
    this.refEnergy = this.computeBufferEnergy(this.referenceChirp);
  }

  /**
   * Synthesizes the complete preamble:
   * 1. Up-Chirp (250ms)
   * 2. Down-Chirp (250ms)
   * 3. Guard silence (50ms)
   */
  public synthesizePreambleWaveform(): Float32Array {
    const Fs = this.config.sampleRate;
    const chirpDurationSec = this.config.preambleDurationMs / 1000;
    const numChirpSamples = Math.round(chirpDurationSec * Fs);
    const guardSamples = Math.round((this.config.guardDurationMs / 1000) * Fs);

    const f0 = this.config.preambleFStart;
    const f1 = this.config.preambleFEnd;

    // Up-Chirp chirp rate: k = (f1 - f0) / T
    const kUp = (f1 - f0) / chirpDurationSec;
    // Down-Chirp chirp rate: k = (f0 - f1) / T
    const kDown = (f0 - f1) / chirpDurationSec;

    const totalSamples = numChirpSamples * 2 + guardSamples;
    const preamble = new Float32Array(totalSamples);

    // 1. Up-Chirp: phi(t) = 2*pi*(f0*t + 0.5*k*t^2)
    for (let n = 0; n < numChirpSamples; n++) {
      const t = n / Fs;
      const phi = 2 * Math.PI * (f0 * t + 0.5 * kUp * t * t);
      preamble[n] = Math.sin(phi);
    }
    // Envelope fade for up-chirp edges (10ms)
    applyRaisedCosineEnvelope(preamble.subarray(0, numChirpSamples), Math.round(Fs * 0.01));

    // 2. Down-Chirp: sweeps f1 -> f0
    const downOffset = numChirpSamples;
    for (let n = 0; n < numChirpSamples; n++) {
      const t = n / Fs;
      const phi = 2 * Math.PI * (f1 * t + 0.5 * kDown * t * t);
      preamble[downOffset + n] = Math.sin(phi);
    }
    applyRaisedCosineEnvelope(preamble.subarray(downOffset, downOffset + numChirpSamples), Math.round(Fs * 0.01));

    // 3. Guard interval: silence
    preamble.subarray(downOffset + numChirpSamples).fill(0.0);

    return preamble;
  }

  public getReferencePreamble(): Float32Array {
    return this.referenceChirp;
  }

  /**
   * Fast normalized cross-correlation matched filter against incoming sliding window.
   * @param incoming Stream buffer
   * @param threshold Cross-correlation threshold (0.35 - 0.6)
   */
  public detectPreamble(
    incoming: Float32Array,
    threshold = 0.40
  ): ChirpDetectionResult {
    const M = this.referenceChirp.length;
    const N = incoming.length;

    if (N < M) {
      return { detected: false, peakIndex: -1, correlation: 0, energy: 0 };
    }

    let maxCorr = 0;
    let bestIndex = -1;
    let bestSigEnergy = 0;

    // Search stride: step by 32 samples for coarse scan, then refine
    const step = 16;
    const maxSearch = N - M;

    for (let i = 0; i <= maxSearch; i += step) {
      let dot = 0;
      let sigEnergy = 0;

      // Unroll dot product
      for (let j = 0; j < M; j += 4) {
        const s0 = incoming[i + j];
        const s1 = incoming[i + j + 1];
        const s2 = incoming[i + j + 2];
        const s3 = incoming[i + j + 3];

        const r0 = this.referenceChirp[j];
        const r1 = this.referenceChirp[j + 1];
        const r2 = this.referenceChirp[j + 2];
        const r3 = this.referenceChirp[j + 3];

        dot += s0 * r0 + s1 * r1 + s2 * r2 + s3 * r3;
        sigEnergy += s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3;
      }

      if (sigEnergy > 1e-4) {
        const normCorr = dot / Math.sqrt(sigEnergy * this.refEnergy);
        if (normCorr > maxCorr) {
          maxCorr = normCorr;
          bestIndex = i;
          bestSigEnergy = sigEnergy;
        }
      }
    }

    // Refinement around peak index if above threshold
    if (maxCorr >= threshold && bestIndex >= 0) {
      const fineStart = Math.max(0, bestIndex - step);
      const fineEnd = Math.min(maxSearch, bestIndex + step);

      for (let i = fineStart; i <= fineEnd; i++) {
        let dot = 0;
        let sigEnergy = 0;
        for (let j = 0; j < M; j++) {
          const s = incoming[i + j];
          const r = this.referenceChirp[j];
          dot += s * r;
          sigEnergy += s * s;
        }
        if (sigEnergy > 1e-4) {
          const normCorr = dot / Math.sqrt(sigEnergy * this.refEnergy);
          if (normCorr > maxCorr) {
            maxCorr = normCorr;
            bestIndex = i;
            bestSigEnergy = sigEnergy;
          }
        }
      }
    }

    return {
      detected: maxCorr >= threshold,
      peakIndex: bestIndex,
      correlation: +maxCorr.toFixed(3),
      energy: +bestSigEnergy.toFixed(4),
    };
  }

  private computeBufferEnergy(buf: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      sum += buf[i] * buf[i];
    }
    return sum;
  }
}
