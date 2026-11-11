/**
 * Digital Signal Processing (DSP) and Multi-Engine Acoustic Modem Constants
 * Supports 3 Open-Source Acoustic Protocols:
 * 1. GGWAVE (ggerganov/ggwave): Reed-Solomon ECC + Multi-Tone FSK (WebAssembly)
 * 2. SONICNET (jborichevskiy/sonicnet): Fast M-FSK Character Alphabet Dictionary
 * 3. QUIET_FSK: Binary FSK + CRC-16-CCITT framing (Audible & Ultrasonic bands)
 */

export type AcousticBandMode = 'ULTRASONIC' | 'AUDIBLE';
export type AcousticEngineType = 'GGWAVE' | 'SONICNET' | 'QUIET_FSK';

export interface BandFrequencies {
  PREAMBLE_FREQ_1: number;
  PREAMBLE_FREQ_2: number;
  BIT_0_FREQ: number;
  BIT_1_FREQ: number;
  SONIC_MIN_FREQ: number;
  SONIC_MAX_FREQ: number;
  NOISE_FLOOR_MIN: number;
  NOISE_FLOOR_MAX: number;
  VIS_MIN_FREQ: number;
  VIS_MAX_FREQ: number;
}

export const ACOUSTIC_BANDS: Record<AcousticBandMode, BandFrequencies> = {
  ULTRASONIC: {
    PREAMBLE_FREQ_1: 17500, // Sync Tone A (Hz)
    PREAMBLE_FREQ_2: 18000, // Sync Tone B (Hz)
    BIT_0_FREQ: 18600,      // Binary 0 Tone (Space) (Hz)
    BIT_1_FREQ: 19400,      // Binary 1 Tone (Mark) (Hz)
    SONIC_MIN_FREQ: 17500,
    SONIC_MAX_FREQ: 19800,
    NOISE_FLOOR_MIN: 16800,
    NOISE_FLOOR_MAX: 17200,
    VIS_MIN_FREQ: 16500,
    VIS_MAX_FREQ: 20500,
  },
  AUDIBLE: {
    PREAMBLE_FREQ_1: 1800,  // Sync Tone A (Hz)
    PREAMBLE_FREQ_2: 2200,  // Sync Tone B (Hz)
    BIT_0_FREQ: 2600,       // Binary 0 Tone (Space) (Hz)
    BIT_1_FREQ: 3200,       // Binary 1 Tone (Mark) (Hz)
    SONIC_MIN_FREQ: 1800,
    SONIC_MAX_FREQ: 3600,
    NOISE_FLOOR_MIN: 1300,
    NOISE_FLOOR_MAX: 1600,
    VIS_MIN_FREQ: 1000,
    VIS_MAX_FREQ: 4000,
  },
};

// SonicNet Alphabet: prefix '^', alphanumeric characters, colon ':', and terminal '$'
export const SONICNET_ALPHABET = '^0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:$';

// 2-byte Magic protocol preamble for Quiet-FSK frames: ASCII 'S' (0x53), 'D' (0x44)
export const MAGIC_FRAME_HEADER = new Uint8Array([0x53, 0x44]);

/**
 * Strict validator for acoustic signaling room tokens.
 * Rejects ambient acoustic noise, replacement characters (\uFFFD), symbols, and garbage.
 */
export function isValidRoomToken(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const clean = token.trim().toUpperCase();
  // Valid room code is strictly 4 to 10 alphanumeric characters [A-Z0-9]
  return /^[A-Z0-9]{4,10}$/.test(clean);
}

export const DSP_CONFIG = {
  SAMPLE_RATE: 48000,
  PREAMBLE_FREQ_1: 17500,
  PREAMBLE_FREQ_2: 18000,
  BIT_0_FREQ: 18600,
  BIT_1_FREQ: 19400,
  SYMBOL_DURATION: 0.045, // 45 milliseconds per bit
  SONIC_CHAR_DURATION: 0.085, // 85 milliseconds per character in SonicNet M-FSK
  PREAMBLE_DURATION: 0.090, // 90 milliseconds per sync tone
  GUARD_INTERVAL: 0.010,  // 10 milliseconds silence guard
  AMPLITUDE: 0.85,        // Normalized gain level
  DETECTION_THRESHOLD_DB: 10.0, // Signal over dynamic noise floor requirement (dB)
  FFT_SIZE: 4096,
  ULTRASONIC_MIN_FREQ: 17000,
  ULTRASONIC_MAX_FREQ: 20500,
} as const;
