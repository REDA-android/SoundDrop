/**
 * Acoustic Packetizer & Protocol Framer
 * Implements packet serialization, Reed-Solomon FEC protection, CRC-32,
 * fragmentation, and multi-packet reassembly.
 */

import { Packet, PacketHeader, DropResult, DropFileMetadata } from '@/types/acoustic';
import { computeCrc32, verifyCrc32 } from './crc32';
import { ReedSolomonCodec } from './fec';
import { compressPayload, decompressPayload } from './compression';

export const SYNC_WORD = 0xAA55;
export const MAX_PAYLOAD_SIZE = 64; // Max 64 bytes per packet
export const HEADER_SIZE = 6;
export const FEC_PARITY_SIZE = 16;
export const CRC_SIZE = 4;

const rsCodec = new ReedSolomonCodec(FEC_PARITY_SIZE);

export interface PacketizationResult {
  sessionId: number;
  totalPackets: number;
  packets: Packet[];
  totalBytes: number;
  isCompressed: boolean;
  type: 'text' | 'file';
  filename?: string;
}

/**
 * Creates a raw binary acoustic packet from header and payload.
 */
export function buildPacket(
  header: Omit<PacketHeader, 'payloadLength'>,
  payload: Uint8Array
): Packet {
  const payloadLen = Math.min(payload.length, MAX_PAYLOAD_SIZE);
  const fullHeader: PacketHeader = {
    ...header,
    payloadLength: payloadLen,
  };

  // 1. Serialize Header (6 bytes)
  const headerBytes = new Uint8Array(HEADER_SIZE);
  headerBytes[0] = fullHeader.versionAndMode;
  headerBytes[1] = fullHeader.sessionId;
  headerBytes[2] = fullHeader.packetIndex;
  headerBytes[3] = fullHeader.totalPackets;
  headerBytes[4] = fullHeader.payloadLength;
  headerBytes[5] = fullHeader.flags;

  // 2. Prepare Message for FEC: Header (6B) + Payload (L bytes)
  const messageBytes = new Uint8Array(HEADER_SIZE + payloadLen);
  messageBytes.set(headerBytes, 0);
  messageBytes.set(payload.subarray(0, payloadLen), HEADER_SIZE);

  // 3. Compute Reed-Solomon FEC parity (16 bytes)
  const fecParity = rsCodec.encode(messageBytes);

  // 4. Compute CRC-32 over Header + Payload
  const crc = computeCrc32(messageBytes);

  // 5. Assemble full frame: SYNC (2B) + Header (6B) + Payload (LB) + FEC (16B) + CRC (4B)
  const totalFrameLen = 2 + HEADER_SIZE + payloadLen + FEC_PARITY_SIZE + CRC_SIZE;
  const rawBytes = new Uint8Array(totalFrameLen);

  // Sync Word: 0xAA 0x55 (Big Endian)
  rawBytes[0] = 0xAA;
  rawBytes[1] = 0x55;

  // Header & Payload
  rawBytes.set(messageBytes, 2);

  // FEC Parity
  rawBytes.set(fecParity, 2 + messageBytes.length);

  // CRC-32 (4 bytes Big-Endian)
  const crcOffset = 2 + messageBytes.length + FEC_PARITY_SIZE;
  rawBytes[crcOffset + 0] = (crc >>> 24) & 0xFF;
  rawBytes[crcOffset + 1] = (crc >>> 16) & 0xFF;
  rawBytes[crcOffset + 2] = (crc >>> 8) & 0xFF;
  rawBytes[crcOffset + 3] = crc & 0xFF;

  return {
    syncWord: SYNC_WORD,
    header: fullHeader,
    payload: payload.subarray(0, payloadLen),
    fecParity,
    crc32: crc,
    rawBytes,
  };
}

/**
 * Parses and verifies a raw packet frame.
 * Applies Reed-Solomon FEC if noise/errors are detected.
 */
export function parsePacketFrame(
  frameBytes: Uint8Array
): { packet: Packet | null; healed: boolean; crcValid: boolean; error?: string } {
  if (frameBytes.length < 2 + HEADER_SIZE + 1 + FEC_PARITY_SIZE + CRC_SIZE) {
    return { packet: null, healed: false, crcValid: false, error: 'Frame too short' };
  }

  // Verify Sync Word
  if (frameBytes[0] !== 0xAA || frameBytes[1] !== 0x55) {
    return { packet: null, healed: false, crcValid: false, error: 'Invalid sync word' };
  }

  const payloadLen = frameBytes[2 + 4];
  if (payloadLen < 1 || payloadLen > MAX_PAYLOAD_SIZE) {
    return { packet: null, healed: false, crcValid: false, error: `Invalid payload length: ${payloadLen}` };
  }

  const expectedTotalLen = 2 + HEADER_SIZE + payloadLen + FEC_PARITY_SIZE + CRC_SIZE;
  if (frameBytes.length < expectedTotalLen) {
    return { packet: null, healed: false, crcValid: false, error: 'Truncated frame' };
  }

  // Extract Message + FEC Codeword
  const messageLen = HEADER_SIZE + payloadLen;
  const codewordLen = messageLen + FEC_PARITY_SIZE;
  const codeword = frameBytes.subarray(2, 2 + codewordLen);

  // Extract received CRC-32
  const crcOffset = 2 + codewordLen;
  const expectedCrc = (
    ((frameBytes[crcOffset + 0] << 24) >>> 0) |
    (frameBytes[crcOffset + 1] << 16) |
    (frameBytes[crcOffset + 2] << 8) |
    frameBytes[crcOffset + 3]
  ) >>> 0;

  // 1. First check if message is valid without FEC correction
  const initialMessage = codeword.subarray(0, messageLen);
  const initialCrcMatch = verifyCrc32(initialMessage, expectedCrc);

  if (initialCrcMatch) {
    const header: PacketHeader = {
      versionAndMode: initialMessage[0],
      sessionId: initialMessage[1],
      packetIndex: initialMessage[2],
      totalPackets: initialMessage[3],
      payloadLength: initialMessage[4],
      flags: initialMessage[5],
    };
    const payload = initialMessage.subarray(HEADER_SIZE);
    const fecParity = codeword.subarray(messageLen, codewordLen);

    return {
      packet: {
        syncWord: SYNC_WORD,
        header,
        payload,
        fecParity,
        crc32: expectedCrc,
        rawBytes: frameBytes.subarray(0, expectedTotalLen),
      },
      healed: false,
      crcValid: true,
    };
  }

  // 2. Attempt Reed-Solomon correction
  const rsResult = rsCodec.decode(codeword);
  if (rsResult.success) {
    const healedMessage = rsResult.corrected;
    const healedCrcMatch = verifyCrc32(healedMessage, expectedCrc);

    if (healedCrcMatch) {
      const header: PacketHeader = {
        versionAndMode: healedMessage[0],
        sessionId: healedMessage[1],
        packetIndex: healedMessage[2],
        totalPackets: healedMessage[3],
        payloadLength: healedMessage[4],
        flags: healedMessage[5],
      };
      const payload = healedMessage.subarray(HEADER_SIZE);
      const fecParity = codeword.subarray(messageLen, codewordLen);

      return {
        packet: {
          syncWord: SYNC_WORD,
          header,
          payload,
          fecParity,
          crc32: expectedCrc,
          rawBytes: frameBytes.subarray(0, expectedTotalLen),
        },
        healed: true,
        crcValid: true,
      };
    }
  }

  return { packet: null, healed: false, crcValid: false, error: 'CRC failed after FEC decoding' };
}

/**
 * Packetizes a UTF-8 text string into acoustic packets.
 */
export function packetizeText(
  text: string,
  isUltrasonic = false,
  sessionId = Math.floor(Math.random() * 254) + 1
): PacketizationResult {
  const comp = compressPayload(text);
  const data = comp.data;
  const totalChunks = Math.max(1, Math.ceil(data.length / MAX_PAYLOAD_SIZE));
  const packets: Packet[] = [];

  const flags = (comp.isCompressed ? 0x01 : 0x00) | (isUltrasonic ? 0x02 : 0x00);

  for (let idx = 0; idx < totalChunks; idx++) {
    const start = idx * MAX_PAYLOAD_SIZE;
    const end = Math.min(start + MAX_PAYLOAD_SIZE, data.length);
    const chunk = data.subarray(start, end);

    const packet = buildPacket(
      {
        versionAndMode: 0x01, // Text
        sessionId,
        packetIndex: idx,
        totalPackets: totalChunks,
        flags,
      },
      chunk
    );
    packets.push(packet);
  }

  return {
    sessionId,
    totalPackets: totalChunks,
    packets,
    totalBytes: data.length,
    isCompressed: comp.isCompressed,
    type: 'text',
  };
}

/**
 * Packetizes a binary file into acoustic packets.
 * Packet 0 contains a JSON manifest with file name and MIME type.
 * Packets 1..N contain the file contents.
 */
export function packetizeFile(
  fileBytes: Uint8Array,
  metadata: DropFileMetadata,
  isUltrasonic = false,
  sessionId = Math.floor(Math.random() * 254) + 1
): PacketizationResult {
  const comp = compressPayload(fileBytes);
  const data = comp.data;

  // Metadata packet (Packet 0)
  const metaObj = {
    n: metadata.name.slice(0, 32),
    s: metadata.size,
    t: metadata.type.slice(0, 24),
    c: comp.isCompressed,
  };
  const metaBytes = new TextEncoder().encode(JSON.stringify(metaObj));

  const dataChunks = Math.max(1, Math.ceil(data.length / MAX_PAYLOAD_SIZE));
  const totalPackets = 1 + dataChunks;
  const packets: Packet[] = [];

  const flags = (comp.isCompressed ? 0x01 : 0x00) | (isUltrasonic ? 0x02 : 0x00);

  // Packet 0: Metadata
  packets.push(
    buildPacket(
      {
        versionAndMode: 0x02, // Binary File Metadata
        sessionId,
        packetIndex: 0,
        totalPackets,
        flags,
      },
      metaBytes
    )
  );

  // Packets 1..N: Binary File Data
  for (let idx = 0; idx < dataChunks; idx++) {
    const start = idx * MAX_PAYLOAD_SIZE;
    const end = Math.min(start + MAX_PAYLOAD_SIZE, data.length);
    const chunk = data.subarray(start, end);

    packets.push(
      buildPacket(
        {
          versionAndMode: 0x02,
          sessionId,
          packetIndex: idx + 1,
          totalPackets,
          flags,
        },
        chunk
      )
    );
  }

  return {
    sessionId,
    totalPackets,
    packets,
    totalBytes: data.length,
    isCompressed: comp.isCompressed,
    type: 'file',
    filename: metadata.name,
  };
}

/**
 * Reassembles received packets into a DropResult when all packets are collected.
 */
export class PacketAssembler {
  private currentSessionId: number | null = null;
  private totalPackets = 0;
  private receivedPackets = new Map<number, Packet>();
  private healedPacketsCount = 0;

  public reset(): void {
    this.currentSessionId = null;
    this.totalPackets = 0;
    this.receivedPackets.clear();
    this.healedPacketsCount = 0;
  }

  public getSessionId(): number | null {
    return this.currentSessionId;
  }

  public getTotalPackets(): number {
    return this.totalPackets;
  }

  public getReceivedCount(): number {
    return this.receivedPackets.size;
  }

  public getHealedCount(): number {
    return this.healedPacketsCount;
  }

  public getReceivedMap(): Map<number, Packet> {
    return this.receivedPackets;
  }

  public addPacket(packet: Packet, wasHealed = false): boolean {
    const header = packet.header;

    if (this.currentSessionId === null) {
      this.currentSessionId = header.sessionId;
      this.totalPackets = header.totalPackets;
    } else if (this.currentSessionId !== header.sessionId) {
      // If we see a new session and have very few packets or this one is newer, reset
      if (this.receivedPackets.size < 2) {
        this.reset();
        this.currentSessionId = header.sessionId;
        this.totalPackets = header.totalPackets;
      } else {
        return false;
      }
    }

    if (!this.receivedPackets.has(header.packetIndex)) {
      this.receivedPackets.set(header.packetIndex, packet);
      if (wasHealed) this.healedPacketsCount++;
      return true;
    }

    return false;
  }

  public isComplete(): boolean {
    return this.totalPackets > 0 && this.receivedPackets.size >= this.totalPackets;
  }

  public assemble(): DropResult | null {
    if (!this.isComplete()) return null;

    const packets: Packet[] = [];
    for (let i = 0; i < this.totalPackets; i++) {
      const p = this.receivedPackets.get(i);
      if (!p) return null; // Missing packet
      packets.push(p);
    }

    const firstHeader = packets[0].header;
    const isFile = firstHeader.versionAndMode === 0x02;
    const isCompressed = (firstHeader.flags & 0x01) !== 0;

    if (isFile) {
      // Packet 0 is metadata JSON
      let meta: { n: string; s: number; t: string; c: boolean };
      try {
        const metaStr = new TextDecoder().decode(packets[0].payload);
        meta = JSON.parse(metaStr);
      } catch {
        meta = { n: 'sound_drop_file.bin', s: 0, t: 'application/octet-stream', c: isCompressed };
      }

      // Packets 1..N are file chunks
      let totalLength = 0;
      for (let i = 1; i < packets.length; i++) {
        totalLength += packets[i].payload.length;
      }

      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (let i = 1; i < packets.length; i++) {
        combined.set(packets[i].payload, offset);
        offset += packets[i].payload.length;
      }

      const rawData = decompressPayload(combined, isCompressed);

      return {
        id: `drop_${firstHeader.sessionId}_${Date.now()}`,
        type: 'file',
        name: meta.n || 'sound_drop_file.bin',
        mimeType: meta.t || 'application/octet-stream',
        size: rawData.length,
        timestamp: Date.now(),
        data: rawData,
        isCompressed,
      };
    } else {
      // Plain text drop
      let totalLength = 0;
      for (const p of packets) {
        totalLength += p.payload.length;
      }

      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const p of packets) {
        combined.set(p.payload, offset);
        offset += p.payload.length;
      }

      const decompressed = decompressPayload(combined, isCompressed);
      const text = new TextDecoder().decode(decompressed);

      return {
        id: `drop_${firstHeader.sessionId}_${Date.now()}`,
        type: 'text',
        name: 'Acoustic Note',
        mimeType: 'text/plain',
        size: decompressed.length,
        timestamp: Date.now(),
        data: decompressed,
        text,
        isCompressed,
      };
    }
  }
}
