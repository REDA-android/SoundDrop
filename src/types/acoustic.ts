/**
 * Sound Drop - Acoustic & Ultrasonic Protocol & DSP Types
 */

export type AcousticBand = 'audible' | 'ultrasonic' | 'whisper';
export type TransmissionMode = 'broadcast' | 'handshake';

export interface ModemConfig {
  band: AcousticBand;
  sampleRate: number;              // Standard 48000 Hz
  symbolDurationMs: number;        // e.g., 42.666 ms (2048 samples) or 64 ms
  samplesPerSymbol: number;        // e.g. 2048 at 48kHz
  baseFrequency: number;           // f0 (e.g. 1600 Hz audible, 17600 Hz ultrasonic)
  deltaFrequency: number;          // Step (e.g. 187.5 Hz)
  numTones: number;                // 16 for 16-FSK (0x0 to 0xF nibble)
  preambleFStart: number;          // e.g. 1200 Hz audible / 17200 Hz ultrasonic
  preambleFEnd: number;            // e.g. 4800 Hz audible / 20200 Hz ultrasonic
  preambleDurationMs: number;      // 250 ms up + 250 ms down
  guardDurationMs: number;         // 50 ms silence
  ackFrequencies: [number, number];   // [2000, 3000]
  nackFrequencies: [number, number];  // [1200, 1600]
}

export interface PacketHeader {
  versionAndMode: number;          // Byte 0: 0x01 = Text, 0x02 = Compressed File, 0x03 = ACK/NACK
  sessionId: number;               // Byte 1: Random 8-bit session identifier
  packetIndex: number;             // Byte 2: 0..255
  totalPackets: number;            // Byte 3: 1..255
  payloadLength: number;           // Byte 4: 1..64
  flags: number;                   // Byte 5: Bit 0: GZIP, Bit 1: Ultrasonic, Bit 2: Requires ACK
}

export interface Packet {
  syncWord: number;                // 0xAA55
  header: PacketHeader;
  payload: Uint8Array;             // 1 to 64 bytes
  fecParity: Uint8Array;           // 16 bytes (Reed-Solomon or Hamming parity)
  crc32: number;                   // 4-byte IEEE 802.3 CRC over Header + Payload
  rawBytes: Uint8Array;            // Encoded frame
}

export type PacketStatus = 'pending' | 'receiving' | 'verified' | 'healed' | 'corrupted';

export type DemodState = 'IDLE' | 'LISTENING_FOR_CHIRP' | 'LOCKED_ON_SIGNAL' | 'DECODING_SYMBOLS';

export interface Telemetry {
  snrDb: number;
  noiseFloor: number;
  peakEnergy: number;
  detectedSymbol: number | null;   // 0x0 to 0xF
  goertzelEnergies: number[];       // 16 bins
  confidence: number;              // 0.0 to 1.0
  activeFrequency: number;
  lockedState: DemodState;
  framesDecoded: number;
  crcErrors: number;
  fecCorrections: number;
}

export interface DropFileMetadata {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
}

export interface DropResult {
  id: string;
  type: 'text' | 'file';
  name: string;
  mimeType: string;
  size: number;
  timestamp: number;
  data: Uint8Array;
  text?: string;
  isCompressed?: boolean;
}

export interface AcousticDeviceStats {
  volume: number;
  isTransmitting: boolean;
  isReceiving: boolean;
  loopbackActive: boolean;
  sampleRate: number;
}
