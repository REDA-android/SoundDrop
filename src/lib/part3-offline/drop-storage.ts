/**
 * Offline-First IndexedDB Storage Engine (Dexie.js)
 * Caches acoustic packets for resume-on-drop & persists complete received files vault.
 */

import Dexie, { Table } from 'dexie';

export interface StoredPacket {
  id?: number;
  sessionId: number;
  packetIndex: number;
  data: Uint8Array;
  timestamp: number;
}

export interface StoredDrop {
  id: string;
  sessionId: number;
  type: 'text' | 'file' | 'image';
  name: string;
  mimeType: string;
  size: number;
  text?: string;
  data: Uint8Array;
  timestamp: number;
}

class SoundDropDatabase extends Dexie {
  public packets!: Table<StoredPacket, number>;
  public receivedDrops!: Table<StoredDrop, string>;

  constructor() {
    super('SoundDropDB');
    this.version(1).stores({
      packets: '++id, sessionId, packetIndex, timestamp',
      receivedDrops: 'id, sessionId, type, timestamp',
    });
  }
}

export const dropDb = new SoundDropDatabase();

export async function savePacketToCache(
  sessionId: number,
  packetIndex: number,
  data: Uint8Array
): Promise<void> {
  try {
    await dropDb.packets.add({
      sessionId,
      packetIndex,
      data,
      timestamp: Date.now(),
    });
  } catch {
    // Ignore storage errors in private browsing
  }
}

export async function saveReceivedDrop(drop: StoredDrop): Promise<void> {
  try {
    await dropDb.receivedDrops.put(drop);
  } catch (err) {
    console.warn('Failed to save drop to IndexedDB:', err);
  }
}

export async function getAllReceivedDrops(): Promise<StoredDrop[]> {
  try {
    return await dropDb.receivedDrops.orderBy('timestamp').reverse().toArray();
  } catch {
    return [];
  }
}

export async function clearDropVault(): Promise<void> {
  try {
    await dropDb.receivedDrops.clear();
    await dropDb.packets.clear();
  } catch {
    // Ignore
  }
}
