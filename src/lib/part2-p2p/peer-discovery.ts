/**
 * Ultra-Compact Acoustic Beacon Identity Engine
 * 4-Byte Discovery Ping: [DeviceType_AvatarID (1B), ColorTheme (1B), ShortName_2Chars (2B)] + 1B CRC8
 * Broadcasts and listens for acoustic presence pings to spawn and update radar bubbles.
 */

import { PeerBubble, DeviceType } from '@/types/sound-drop';

export interface CompactBeacon {
  deviceType: DeviceType;
  avatarId: number;
  colorTheme: string;
  shortName: string;
}

const COLOR_THEMES = [
  '#06B6D4', // Neon Cyan
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#A855F7', // Purple
  '#F43F5E', // Rose
  '#38BDF8', // Sky
  '#EC4899', // Pink
  '#84CC16', // Lime
];

const DEVICE_TYPE_MAP: DeviceType[] = ['iphone', 'android', 'macbook', 'ipad', 'pc'];

/**
 * Standard CRC-8 Checksum (Dallas/Maxim polynomial: 0x31)
 */
export function computeCrc8(data: Uint8Array, len: number): number {
  let crc = 0x00;
  for (let i = 0; i < len; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x80) {
        crc = ((crc << 1) ^ 0x31) & 0xFF;
      } else {
        crc = (crc << 1) & 0xFF;
      }
    }
  }
  return crc;
}

export class PeerDiscoveryEngine {
  private localDevice: PeerBubble;
  private knownPeers: Map<string, PeerBubble> = new Map();

  constructor() {
    let devType: DeviceType = 'pc';
    if (typeof navigator !== 'undefined') {
      if (/iPhone/i.test(navigator.userAgent)) devType = 'iphone';
      else if (/iPad/i.test(navigator.userAgent)) devType = 'ipad';
      else if (/Android/i.test(navigator.userAgent)) devType = 'android';
      else if (/Macintosh/i.test(navigator.userAgent)) devType = 'macbook';
    }

    const shortId = Math.random().toString(36).substring(2, 4).toUpperCase();
    const id = `node-${shortId}`;
    const colorIndex = Math.floor(Math.random() * COLOR_THEMES.length);

    this.localDevice = {
      id,
      name: `${devType.toUpperCase()}-${shortId}`,
      deviceType: devType,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 46,
      color: COLOR_THEMES[colorIndex],
      distanceRssi: 100,
      lastSeen: Date.now(),
      status: 'idle',
      progress: 0,
    };
  }

  public getLocalDevice(): PeerBubble {
    return this.localDevice;
  }

  /**
   * Encodes 4-Byte Acoustic Discovery Beacon:
   * Byte 0: (deviceTypeIdx << 4) | (avatarId & 0x0F)
   * Byte 1: colorTheme index (0..7)
   * Byte 2-3: 2-character ASCII ShortName
   * Byte 4: CRC-8
   */
  public encode4ByteBeacon(): Uint8Array {
    const beacon = new Uint8Array(5);

    const devTypeIdx = Math.max(0, DEVICE_TYPE_MAP.indexOf(this.localDevice.deviceType));
    const avatarId = 1;
    beacon[0] = ((devTypeIdx & 0x0F) << 4) | (avatarId & 0x0F);

    const colorIdx = Math.max(0, COLOR_THEMES.indexOf(this.localDevice.color));
    beacon[1] = colorIdx & 0xFF;

    const short = this.localDevice.id.replace('node-', '').padEnd(2, 'X').slice(0, 2);
    beacon[2] = short.charCodeAt(0) & 0xFF;
    beacon[3] = short.charCodeAt(1) & 0xFF;

    beacon[4] = computeCrc8(beacon, 4);
    return beacon;
  }

  /**
   * Decodes 4-Byte + 1B CRC8 discovery ping and updates radar bubble
   */
  public handleIncomingBeacon(
    beaconBytes: Uint8Array,
    snrDb: number
  ): PeerBubble | null {
    if (beaconBytes.length < 5) return null;

    const expectedCrc = computeCrc8(beaconBytes, 4);
    if (beaconBytes[4] !== expectedCrc) {
      return null; // Corrupted ping or noise
    }

    const devTypeIdx = (beaconBytes[0] >> 4) & 0x0F;
    const devType = DEVICE_TYPE_MAP[devTypeIdx] || 'pc';

    const colorIdx = beaconBytes[1] % COLOR_THEMES.length;
    const color = COLOR_THEMES[colorIdx];

    const c1 = String.fromCharCode(beaconBytes[2]);
    const c2 = String.fromCharCode(beaconBytes[3]);
    const shortName = `${c1}${c2}`;
    const peerId = `node-${shortName}`;

    if (peerId === this.localDevice.id) return null; // Ignore self

    const existing = this.knownPeers.get(peerId);
    const measuredRssi = Math.min(100, Math.max(10, Math.round(snrDb * 4.5)));

    if (existing) {
      existing.lastSeen = Date.now();
      existing.distanceRssi = measuredRssi;
      return existing;
    }

    // Spawn new peer bubble
    const newPeer: PeerBubble = {
      id: peerId,
      name: `${devType.toUpperCase()}-${shortName}`,
      deviceType: devType,
      x: (Math.random() - 0.5) * 200,
      y: (Math.random() - 0.5) * 200,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: 44,
      color,
      distanceRssi: measuredRssi,
      lastSeen: Date.now(),
      status: 'idle',
      progress: 0,
    };

    this.knownPeers.set(peerId, newPeer);
    return newPeer;
  }

  public getActivePeers(): PeerBubble[] {
    const now = Date.now();
    for (const [id, peer] of this.knownPeers.entries()) {
      if (now - peer.lastSeen > 45000) {
        this.knownPeers.delete(id);
      }
    }
    return Array.from(this.knownPeers.values());
  }

  public addManualPeer(name: string, deviceType: DeviceType): PeerBubble {
    const short = Math.random().toString(36).substring(2, 4).toUpperCase();
    const id = `node-${short}`;
    const color = COLOR_THEMES[Math.floor(Math.random() * COLOR_THEMES.length)];
    const peer: PeerBubble = {
      id,
      name: `${name} (${short})`,
      deviceType,
      x: (Math.random() - 0.5) * 180,
      y: (Math.random() - 0.5) * 180,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: 44,
      color,
      distanceRssi: 88,
      lastSeen: Date.now(),
      status: 'idle',
      progress: 0,
    };
    this.knownPeers.set(id, peer);
    return peer;
  }
}

export const peerDiscovery = new PeerDiscoveryEngine();
