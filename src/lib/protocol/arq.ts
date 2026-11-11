/**
 * Protocole ARQ (Automatic Repeat reQuest) en demi-duplex et réassemblage.
 * Plafond dur à 16 Ko, découpage en rafales de 8, bitmap d'ACK et intégrité SHA-256.
 */

import { Frame, FrameType, encodeFrame, decodeFrame } from './frame';

export const MAX_ACOUSTIC_PAYLOAD_BYTES = 16 * 1024; // 16 Ko plafond dur
export const WARNING_ACOUSTIC_PAYLOAD_BYTES = 4 * 1024; // 4 Ko seuil d'avertissement
export const DEFAULT_PAYLOAD_PER_FRAME = 129; // 140 max - 11 en-tête

export interface FileMetadata {
  name: string;
  mimeType: string;
  size: number;
  nonce: Uint8Array; // 24 octets TweetNaCl
  sha256Hex: string; // Hash du clair
  blurhash?: string;
}

export interface EstimateOptions {
  bytes: number;
  payloadPerFrame?: number;
  secondsPerFrame?: number;
  gapSeconds?: number;
  lossRate?: number;
}

/**
 * Estimation mathématique de la durée du transfert acoustique (en secondes).
 */
export function estimateSeconds(opts: EstimateOptions): number {
  const {
    bytes,
    payloadPerFrame = DEFAULT_PAYLOAD_PER_FRAME,
    secondsPerFrame = 0.35, // Mesure standard
    gapSeconds = 0.3,       // Demi-duplex
    lossRate = 0.1,         // 10% de retransmissions estimées
  } = opts;

  const dataFrames = Math.ceil(Math.max(1, bytes) / payloadPerFrame);
  const totalFrames = dataFrames + 1; // + Meta
  const baseDuration = totalFrames * (secondsPerFrame + gapSeconds);
  return Math.round(baseDuration * (1 + lossRate) * 10) / 10;
}

/**
 * Valide la taille du fichier avant transmission acoustique.
 */
export function validateFileSize(size: number): { valid: boolean; error?: string; warning?: string } {
  if (size > MAX_ACOUSTIC_PAYLOAD_BYTES) {
    return {
      valid: false,
      error: `Fichier trop volumineux (${(size / 1024).toFixed(1)} Ko). Le plafond dur acoustique est de 16 Ko. Utilisez WebRTC LAN pour ce fichier.`,
    };
  }

  if (size >= WARNING_ACOUSTIC_PAYLOAD_BYTES) {
    return {
      valid: true,
      warning: `Fichier volumineux pour le son (${(size / 1024).toFixed(1)} Ko). Durée estimée : environ ${Math.ceil(estimateSeconds({ bytes: size }) / 60)} minute(s).`,
    };
  }

  return { valid: true };
}

/**
 * Sérialisation de la trame Meta (seq=0).
 */
export function serializeMetaPayload(meta: FileMetadata): Uint8Array {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(meta.name.slice(0, 40));
  const mimeBytes = enc.encode(meta.mimeType.slice(0, 30));
  const bhBytes = enc.encode((meta.blurhash || '').slice(0, 32));

  const totalLen =
    1 + nameBytes.length +
    1 + mimeBytes.length +
    4 + // uint32 size
    24 + // nonce
    32 + // sha256 bytes
    1 + bhBytes.length;

  const out = new Uint8Array(totalLen);
  const v = new DataView(out.buffer);
  let o = 0;

  out[o++] = nameBytes.length;
  out.set(nameBytes, o);
  o += nameBytes.length;

  out[o++] = mimeBytes.length;
  out.set(mimeBytes, o);
  o += mimeBytes.length;

  v.setUint32(o, meta.size);
  o += 4;

  out.set(meta.nonce.subarray(0, 24), o);
  o += 24;

  // SHA256 hex string vers 32 octets
  const shaRaw = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    shaRaw[i] = parseInt(meta.sha256Hex.slice(i * 2, i * 2 + 2) || '0', 16);
  }
  out.set(shaRaw, o);
  o += 32;

  out[o++] = bhBytes.length;
  out.set(bhBytes, o);
  o += bhBytes.length;

  return out;
}

/**
 * Désérialisation de la trame Meta (seq=0).
 */
export function deserializeMetaPayload(buf: Uint8Array): FileMetadata | null {
  if (buf.length < 63) return null;
  const dec = new TextDecoder();
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;

  const nameLen = buf[o++];
  if (o + nameLen > buf.length) return null;
  const name = dec.decode(buf.subarray(o, o + nameLen));
  o += nameLen;

  const mimeLen = buf[o++];
  if (o + mimeLen > buf.length) return null;
  const mimeType = dec.decode(buf.subarray(o, o + mimeLen));
  o += mimeLen;

  const size = v.getUint32(o);
  o += 4;

  const nonce = buf.slice(o, o + 24);
  o += 24;

  const shaBytes = buf.subarray(o, o + 32);
  o += 32;
  const sha256Hex = Array.from(shaBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  let blurhash: string | undefined;
  if (o < buf.length) {
    const bhLen = buf[o++];
    if (o + bhLen <= buf.length && bhLen > 0) {
      blurhash = dec.decode(buf.subarray(o, o + bhLen));
    }
  }

  return { name, mimeType, size, nonce, sha256Hex, blurhash };
}

/**
 * Bitmap d'ACK pour renvoyer l'état de réception des trames d'une session.
 */
export class AckBitmap {
  private bits: Uint8Array;

  constructor(public readonly totalFrames: number) {
    this.bits = new Uint8Array(Math.ceil(totalFrames / 8));
  }

  public markReceived(seq: number): void {
    if (seq < 0 || seq >= this.totalFrames) return;
    const byteIdx = Math.floor(seq / 8);
    const bitIdx = seq % 8;
    this.bits[byteIdx] |= 1 << bitIdx;
  }

  public isReceived(seq: number): boolean {
    if (seq < 0 || seq >= this.totalFrames) return false;
    const byteIdx = Math.floor(seq / 8);
    const bitIdx = seq % 8;
    return (this.bits[byteIdx] & (1 << bitIdx)) !== 0;
  }

  public getMissingIndices(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < this.totalFrames; i++) {
      if (!this.isReceived(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  public isComplete(): boolean {
    return this.getMissingIndices().length === 0;
  }

  public toBytes(): Uint8Array {
    return new Uint8Array(this.bits);
  }

  public static fromBytes(totalFrames: number, bytes: Uint8Array): AckBitmap {
    const bm = new AckBitmap(totalFrames);
    const len = Math.min(bm.bits.length, bytes.length);
    bm.bits.set(bytes.subarray(0, len));
    return bm;
  }
}

/**
 * Assembleur de trames recevant les morceaux dans n'importe quel ordre et ignorant les doublons.
 */
export class FrameAssembler {
  private receivedFrames = new Map<number, Uint8Array>();
  private metadata: FileMetadata | null = null;

  constructor(public readonly session: number, public readonly total: number) {}

  public addFrame(frame: Frame): boolean {
    if (frame.session !== this.session) return false;

    if (frame.type === FrameType.Meta && frame.seq === 0) {
      this.metadata = deserializeMetaPayload(frame.payload);
      return true;
    }

    if (frame.type === FrameType.Data) {
      if (this.receivedFrames.has(frame.seq)) {
        return false; // Doublon ignoré
      }
      this.receivedFrames.set(frame.seq, frame.payload);
      return true;
    }

    return false;
  }

  public isComplete(): boolean {
    if (this.total === 0) return false;
    return this.receivedFrames.size === this.total;
  }

  public getProgress(): { received: number; total: number; percent: number } {
    const received = this.receivedFrames.size;
    const percent = this.total > 0 ? Math.round((received / this.total) * 100) : 0;
    return { received, total: this.total, percent };
  }

  public assemble(): Uint8Array | null {
    if (!this.isComplete()) return null;

    let totalLen = 0;
    for (let i = 1; i <= this.total; i++) {
      const chunk = this.receivedFrames.get(i);
      if (!chunk) return null;
      totalLen += chunk.length;
    }

    const fullPayload = new Uint8Array(totalLen);
    let offset = 0;
    for (let i = 1; i <= this.total; i++) {
      const chunk = this.receivedFrames.get(i)!;
      fullPayload.set(chunk, offset);
      offset += chunk.length;
    }

    return fullPayload;
  }

  public getMetadata(): FileMetadata | null {
    return this.metadata;
  }
}
