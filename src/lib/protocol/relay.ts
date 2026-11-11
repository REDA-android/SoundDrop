/**
 * SoundDrop Multi-Hop Relay & Store-and-Forward Protocol (Section 4.6).
 * Carrier-agnostic envelope enabling data mules and multi-hop delivery
 * while strictly maintaining End-to-End Encryption.
 */

import { Frame, encodeFrame, decodeFrame } from './frame';

export const DEFAULT_MAX_RELAY_HOPS = 5;
export const RELAY_HEADER_SIZE = 7;

export interface RelayHeader {
  ttl: number;
  hopCount: number;
  recipientHash: Uint8Array; // 4 bytes
  flags: number;
}

export interface RelayPacket {
  relay: RelayHeader;
  frame: Frame;
}

/**
 * Encodage sérialisé d'un paquet relais : [RelayHeader: 7o][Trame Interne avec CRC-16: N+11 o]
 */
export function encodeRelayPacket(relay: RelayHeader, frame: Frame): Uint8Array {
  const innerBytes = encodeFrame(frame);
  const out = new Uint8Array(RELAY_HEADER_SIZE + innerBytes.length);

  out[0] = Math.min(DEFAULT_MAX_RELAY_HOPS, Math.max(1, relay.ttl));
  out[1] = Math.max(0, relay.hopCount);
  out.set(relay.recipientHash.subarray(0, 4), 2);
  out[6] = relay.flags;
  out.set(innerBytes, RELAY_HEADER_SIZE);

  return out;
}

/**
 * Décodage et validation d'un paquet relais avec contrôle d'intégrité de la trame interne.
 */
export function decodeRelayPacket(buf: Uint8Array): RelayPacket | null {
  if (buf.length < RELAY_HEADER_SIZE + 11) {
    return null;
  }

  const ttl = buf[0];
  const hopCount = buf[1];
  const recipientHash = buf.slice(2, 6);
  const flags = buf[6];

  const innerBytes = buf.subarray(RELAY_HEADER_SIZE);
  const frame = decodeFrame(innerBytes);
  if (!frame) {
    return null;
  }

  return {
    relay: {
      ttl,
      hopCount,
      recipientHash,
      flags,
    },
    frame,
  };
}

/**
 * Avance d'un saut dans le relais : décrémente le TTL et incrémente hopCount.
 * Renvoie null si le TTL est expiré (paquet à détruire).
 */
export function stepRelay(relay: RelayHeader): RelayHeader | null {
  if (relay.ttl <= 1) {
    return null; // TTL expiré
  }
  return {
    ttl: relay.ttl - 1,
    hopCount: relay.hopCount + 1,
    recipientHash: relay.recipientHash,
    flags: relay.flags,
  };
}

/**
 * File d'attente Store-and-Forward en mémoire pour nœuds relais et mules de données.
 */
export class WebStoreAndForwardQueue {
  private queue: Array<{ packet: RelayPacket; timestamp: number }> = [];
  private seenKeys = new Set<string>();
  private readonly maxCapacity: number;
  private readonly ttlMs: number;

  constructor(maxCapacity = 64, ttlMs = 3600 * 1000) {
    this.maxCapacity = maxCapacity;
    this.ttlMs = ttlMs;
  }

  get length(): number {
    return this.queue.length;
  }

  push(packet: RelayPacket): boolean {
    this.pruneExpired();

    const key = `${packet.frame.session}:${packet.frame.seq}`;
    if (this.seenKeys.has(key)) {
      return false; // Déduplication : déjà en stock
    }

    if (this.queue.length >= this.maxCapacity) {
      const evicted = this.queue.shift();
      if (evicted) {
        this.seenKeys.delete(`${evicted.packet.frame.session}:${evicted.packet.frame.seq}`);
      }
    }

    this.seenKeys.add(key);
    this.queue.push({ packet, timestamp: Date.now() });
    return true;
  }

  drainForRecipient(targetHash: Uint8Array): RelayPacket[] {
    this.pruneExpired();

    const matched: RelayPacket[] = [];
    const remaining: Array<{ packet: RelayPacket; timestamp: number }> = [];

    for (const item of this.queue) {
      let isMatch = true;
      for (let i = 0; i < 4; i++) {
        if (item.packet.relay.recipientHash[i] !== targetHash[i]) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        matched.push(item.packet);
      } else {
        remaining.push(item);
      }
    }

    this.queue = remaining;
    return matched;
  }

  pruneExpired(): void {
    const now = Date.now();
    this.queue = this.queue.filter((item) => now - item.timestamp < this.ttlMs);
  }
}
