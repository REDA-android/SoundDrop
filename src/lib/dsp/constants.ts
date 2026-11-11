/**
 * Physical Layer (PHY) Constants & Acoustic Modem Configurations
 * Dual-band software-defined acoustic modem specifications.
 */

import { ModemConfig } from '@/types/acoustic';

export const SAMPLE_RATE = 48000;

export const AUDIBLE_CONFIG: ModemConfig = {
  band: 'audible',
  sampleRate: SAMPLE_RATE,
  symbolDurationMs: (2048 / SAMPLE_RATE) * 1000, // 42.666 ms
  samplesPerSymbol: 2048,
  baseFrequency: 1600,
  deltaFrequency: 187.5,
  numTones: 16,
  preambleFStart: 1200,
  preambleFEnd: 4800,
  preambleDurationMs: 250,
  guardDurationMs: 50,
  ackFrequencies: [2000, 3000],
  nackFrequencies: [1200, 1600],
};

export const ULTRASONIC_CONFIG: ModemConfig = {
  band: 'ultrasonic',
  sampleRate: SAMPLE_RATE,
  symbolDurationMs: 64, // 64 ms (3072 samples at 48 kHz)
  samplesPerSymbol: Math.round(SAMPLE_RATE * 0.064), // 3072 samples
  baseFrequency: 17600,
  deltaFrequency: 187.5,
  numTones: 16,
  preambleFStart: 17200,
  preambleFEnd: 20200,
  preambleDurationMs: 250,
  guardDurationMs: 50,
  ackFrequencies: [18000, 19500],
  nackFrequencies: [17500, 18500],
};

export const WHISPER_CONFIG: ModemConfig = {
  band: 'whisper',
  sampleRate: SAMPLE_RATE,
  symbolDurationMs: 64, // 64 ms (3072 samples at 48 kHz)
  samplesPerSymbol: Math.round(SAMPLE_RATE * 0.064), // 3072 samples
  baseFrequency: 18500,
  deltaFrequency: 106.25,
  numTones: 16,
  preambleFStart: 18500,
  preambleFEnd: 20200,
  preambleDurationMs: 250,
  guardDurationMs: 50,
  ackFrequencies: [18600, 19800],
  nackFrequencies: [18500, 19200],
};

/**
 * Returns the exact ModemConfig for the specified acoustic band
 */
export function getConfigForBand(band: import('@/types/acoustic').AcousticBand): ModemConfig {
  switch (band) {
    case 'whisper':
      return WHISPER_CONFIG;
    case 'ultrasonic':
      return ULTRASONIC_CONFIG;
    case 'audible':
    default:
      return AUDIBLE_CONFIG;
  }
}

/**
 * Generates the 16 exact FSK frequencies for a given modem configuration.
 * f_k = f_0 + k * delta_f
 */
export function getFskFrequencies(config: ModemConfig): number[] {
  const freqs: number[] = [];
  for (let k = 0; k < config.numTones; k++) {
    freqs.push(config.baseFrequency + k * config.deltaFrequency);
  }
  return freqs;
}

/**
 * Formats Hz into readable kHz or Hz string
 */
export function formatFrequency(hz: number): string {
  if (hz >= 1000) {
    return `${(hz / 1000).toFixed(2)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}
