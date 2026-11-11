/**
 * Acoustic Modulator Engine (Transmitter Pipeline)
 * Translates byte frames into continuous PCM audio waveforms (Float32Array)
 * using 16-FSK modulation, LFM preamble synchronization, and Tukey/Hann envelope shaping.
 */

import { ModemConfig, Packet } from '@/types/acoustic';
import { AUDIBLE_CONFIG, ULTRASONIC_CONFIG, getFskFrequencies } from './constants';
import { ChirpEngine } from './chirp';
import { createTukeyWindow } from './windowing';

export interface ModulationOptions {
  amplitude?: number; // 0.0 to 1.0 (default 0.85)
  includePreamble?: boolean; // default true
}

export class ModulatorEngine {
  private config: ModemConfig;
  private frequencies: number[];
  private chirpEngine: ChirpEngine;
  private symbolWindow: Float32Array;

  constructor(config: ModemConfig = AUDIBLE_CONFIG) {
    this.config = config;
    this.frequencies = getFskFrequencies(config);
    this.chirpEngine = new ChirpEngine(config);

    // Precompute Tukey window for symbol envelope to prevent boundary clicks
    const alpha = config.band === 'ultrasonic' ? 0.35 : 0.25;
    this.symbolWindow = createTukeyWindow(config.samplesPerSymbol, alpha);
  }

  public setConfig(config: ModemConfig): void {
    this.config = config;
    this.frequencies = getFskFrequencies(config);
    this.chirpEngine = new ChirpEngine(config);
    const alpha = config.band === 'ultrasonic' ? 0.35 : 0.25;
    this.symbolWindow = createTukeyWindow(config.samplesPerSymbol, alpha);
  }

  public getConfig(): ModemConfig {
    return this.config;
  }

  /**
   * Modulates a single 4-bit nibble (0x0 to 0xF) into PCM audio samples.
   */
  public synthesizeSymbol(
    nibble: number,
    startPhase = 0,
    amplitude = 0.85
  ): { samples: Float32Array; endPhase: number } {
    const s = Math.max(0, Math.min(15, nibble & 0x0F));
    const freq = this.frequencies[s];
    const N = this.config.samplesPerSymbol;
    const Fs = this.config.sampleRate;
    const samples = new Float32Array(N);

    const omega = (2 * Math.PI * freq) / Fs;
    let phase = startPhase;

    for (let n = 0; n < N; n++) {
      samples[n] = amplitude * this.symbolWindow[n] * Math.sin(phase);
      phase += omega;
    }

    // Keep phase bounded within [0, 2*PI)
    phase = phase % (2 * Math.PI);
    return { samples, endPhase: phase };
  }

  /**
   * Modulates an array of raw packet frames into a single Float32Array PCM stream.
   * Format: [LFM Preamble] -> [Symbols for Packet 0] -> [Inter-frame Gap] -> [Symbols for Packet 1]...
   */
  public synthesizeTransmission(
    packets: Packet[],
    options: ModulationOptions = {}
  ): Float32Array {
    const amplitude = options.amplitude ?? 0.85;
    const includePreamble = options.includePreamble ?? true;

    // 1. Calculate total symbol count
    let totalNibbles = 0;
    for (const p of packets) {
      totalNibbles += p.rawBytes.length * 2; // 2 nibbles per byte
    }

    // 2. Calculate buffer sizes
    const Fs = this.config.sampleRate;
    const samplesPerSymbol = this.config.samplesPerSymbol;
    const preambleWaveform = includePreamble ? this.chirpEngine.getReferencePreamble() : new Float32Array(0);
    const interFrameGapSamples = Math.round(Fs * 0.02); // 20ms silence between packets

    const totalSamples =
      preambleWaveform.length +
      totalNibbles * samplesPerSymbol +
      (packets.length > 1 ? (packets.length - 1) * interFrameGapSamples : 0) +
      Math.round(Fs * 0.05); // 50ms tail silence

    const pcm = new Float32Array(totalSamples);
    let writeOffset = 0;

    // Prepend Preamble
    if (includePreamble && preambleWaveform.length > 0) {
      pcm.set(preambleWaveform, writeOffset);
      writeOffset += preambleWaveform.length;
    }

    let continuousPhase = 0;

    // Synthesize symbols
    for (let pIdx = 0; pIdx < packets.length; pIdx++) {
      const packet = packets[pIdx];
      const raw = packet.rawBytes;

      for (let b = 0; b < raw.length; b++) {
        const byte = raw[b];
        const highNibble = (byte >> 4) & 0x0F;
        const lowNibble = byte & 0x0F;

        // High nibble
        const { samples: highSamples, endPhase: p1 } = this.synthesizeSymbol(
          highNibble,
          continuousPhase,
          amplitude
        );
        pcm.set(highSamples, writeOffset);
        writeOffset += samplesPerSymbol;
        continuousPhase = p1;

        // Low nibble
        const { samples: lowSamples, endPhase: p2 } = this.synthesizeSymbol(
          lowNibble,
          continuousPhase,
          amplitude
        );
        pcm.set(lowSamples, writeOffset);
        writeOffset += samplesPerSymbol;
        continuousPhase = p2;
      }

      // Add inter-frame gap if there is a next packet
      if (pIdx < packets.length - 1) {
        writeOffset += interFrameGapSamples;
        continuousPhase = 0;
      }
    }

    return pcm.subarray(0, writeOffset);
  }

  /**
   * Synthesizes a 150ms dual-tone chime for ACK or NACK
   */
  public synthesizeChime(type: 'ACK' | 'NACK', amplitude = 0.7): Float32Array {
    const freqs = type === 'ACK' ? this.config.ackFrequencies : this.config.nackFrequencies;
    const durationSec = 0.15;
    const Fs = this.config.sampleRate;
    const totalSamples = Math.round(durationSec * Fs);
    const chime = new Float32Array(totalSamples);
    const window = createTukeyWindow(totalSamples, 0.2);

    const f1 = freqs[0];
    const f2 = freqs[1];
    const omega1 = (2 * Math.PI * f1) / Fs;
    const omega2 = (2 * Math.PI * f2) / Fs;

    for (let n = 0; n < totalSamples; n++) {
      const s = 0.5 * Math.sin(omega1 * n) + 0.5 * Math.sin(omega2 * n);
      chime[n] = amplitude * window[n] * s;
    }

    return chime;
  }
}
