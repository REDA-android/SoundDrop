/**
 * MASTER SOUND DROP TYPE DEFINITIONS
 * AirDrop Physics Bubble Radar, Acoustic PHY, Reed-Solomon Protocol & Hybrid P2P
 */

export type ModemMode = 'audible' | 'ultrasonic' | 'whisper' | 'ggwave-audible' | 'ggwave-ultrasonic';
export type DeviceType = 'iphone' | 'macbook' | 'android' | 'pc' | 'ipad' | 'audio-node';

export interface PeerBubble {
  id: string;
  name: string;
  deviceType: DeviceType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  distanceRssi: number; // Simulated or measured acoustic signal strength (0-100)
  lastSeen: number;
  status: 'idle' | 'transmitting' | 'receiving' | 'complete' | 'failed';
  progress: number; // 0 to 100%
  blurHashPreview?: string;
  receivedPayload?: {
    type: 'text' | 'file' | 'image';
    name?: string;
    text?: string;
    mimeType?: string;
    blobUrl?: string;
    size?: number;
  };
}

export interface AcousticPacket {
  syncWord: number; // 0xAA55
  sessionId: number; // Random 8-bit session identifier
  packetIndex: number; // 0..255
  totalPackets: number; // 1..255
  payloadLength: number; // 1..64 bytes
  flags: number; // Bit 0: GZIP/LZ, Bit 1: Ultrasonic, Bit 2: Encrypted, Bit 3: BlurHash P0
  payload: Uint8Array; // Raw or compressed chunk
  fecParity: Uint8Array; // 16 bytes RS(80,64) parity
  crc32: number; // 32-bit IEEE 802.3 CRC
  rawBytes: Uint8Array; // Complete frame
}

export interface DropSession {
  sessionId: number;
  type: 'text' | 'file' | 'image';
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  blurHash?: string;
  isCompressed: boolean;
  isEncrypted: boolean;
  totalPackets: number;
  packetsReceived: Map<number, Uint8Array>;
  healedIndices: Set<number>;
  startTime: number;
  completedTime?: number;
}

export interface AcousticTelemetry {
  snrDb: number;
  noiseFloor: number;
  peakEnergy: number;
  detectedSymbol: number | null; // 0x0 to 0xF
  goertzelEnergies: number[]; // 16 bin energies
  confidence: number;
  activeFrequency: number;
  state: 'IDLE' | 'SCANNING' | 'LOCKED' | 'RECEIVING' | 'TRANSMITTING';
  framesDecoded: number;
  crcErrors: number;
  fecCorrections: number;
}

export interface SoundDropSettings {
  modemMode: ModemMode;
  loopbackSelfTest: boolean;
  hapticAudioFeedback: boolean;
  encryptionEnabled: boolean;
  encryptionPin: string;
  hybridWebRtcFallback: boolean;
}
