/**
 * PairDrop, KDE Connect & Warpinator Integration Layer
 * Derived from:
 * - schlagmichdoch/PairDrop: WebRTC ephemeral rooms, text & clipboard sharing
 * - KDE/kdeconnect-kde: Device identity, ping, battery & share payloads
 * - linuxmint/warpinator: PIN code verification & transfer authorization
 */

export interface PairDropMessage {
  type: 'TEXT' | 'CLIPBOARD' | 'FILE_METADATA' | 'FILE_CHUNK' | 'PIN_AUTH';
  senderName: string;
  payload: string;
  timestamp: number;
}

export interface KdeConnectPacket {
  id: number;
  type: 'kdeconnect.share.request' | 'kdeconnect.ping' | 'kdeconnect.battery' | 'kdeconnect.clipboard';
  body: {
    filename?: string;
    filesize?: number;
    text?: string;
    currentCharge?: number;
    isCharging?: boolean;
    pin?: string;
  };
}

export interface WarpinatorAuth {
  pinRequired: boolean;
  pinCode: string; // 4-digit code
  authorized: boolean;
}

export function generateWarpinatorPin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export function verifyWarpinatorPin(input: string, target: string): boolean {
  return input.trim() === target.trim();
}
