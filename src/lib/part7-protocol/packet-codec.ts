/**
 * Acoustic Packet Framing & Forward Error Correction (FEC)
 * Implements IEEE 802.3 CRC-32 and Reed-Solomon GF(2^8) RS(80,64) Codec.
 */

import { AcousticPacket } from '@/types/sound-drop';
import { computeCrc32, verifyCrc32 } from '../protocol/crc32';
import { ReedSolomonCodec } from '../protocol/fec';

export const SYNC_WORD = 0xAA55;
export const MAX_PAYLOAD_CHUNK = 64;
export const HEADER_SIZE = 6;
export const FEC_PARITY_SIZE = 16;
export const CRC_SIZE = 4;

const rsCodec = new ReedSolomonCodec(FEC_PARITY_SIZE);

export interface PacketHeader {
  versionAndMode: number; // Byte 0: 0x01 = Text, 0x02 = Binary File, 0x04 = Image BlurHash
  sessionId: number;      // Byte 1: Random 8-bit session identifier
  packetIndex: number;    // Byte 2: 0..255
  totalPackets: number;   // Byte 3: 1..255
  payloadLength: number;  // Byte 4: 1..64
  flags: number;          // Byte 5: Bit 0: Compressed, Bit 1: Ultrasonic, Bit 2: Encrypted, Bit 3: BlurHash
}

export function encodePacketFrame(
  header: Omit<PacketHeader, 'payloadLength'>,
  payload: Uint8Array
): AcousticPacket {
  const len = Math.min(payload.length, MAX_PAYLOAD_CHUNK);

  // 1. Header (6 Bytes)
  const headerBytes = new Uint8Array(HEADER_SIZE);
  headerBytes[0] = header.versionAndMode;
  headerBytes[1] = header.sessionId;
  headerBytes[2] = header.packetIndex;
  headerBytes[3] = header.totalPackets;
  headerBytes[4] = len;
  headerBytes[5] = header.flags;

  // 2. Message = Header (6B) + Payload (len bytes)
  const message = new Uint8Array(HEADER_SIZE + len);
  message.set(headerBytes, 0);
  message.set(payload.subarray(0, len), HEADER_SIZE);

  // 3. Reed-Solomon FEC Parity (16B)
  const fecParity = rsCodec.encode(message);

  // 4. IEEE 802.3 CRC-32 (4B)
  const crc = computeCrc32(message);

  // 5. Full Frame = Sync (2B) + Message (6B + len) + FEC (16B) + CRC (4B)
  const totalFrameLen = 2 + message.length + FEC_PARITY_SIZE + CRC_SIZE;
  const rawBytes = new Uint8Array(totalFrameLen);

  rawBytes[0] = 0xAA;
  rawBytes[1] = 0x55;
  rawBytes.set(message, 2);
  rawBytes.set(fecParity, 2 + message.length);

  const crcOffset = 2 + message.length + FEC_PARITY_SIZE;
  rawBytes[crcOffset + 0] = (crc >>> 24) & 0xFF;
  rawBytes[crcOffset + 1] = (crc >>> 16) & 0xFF;
  rawBytes[crcOffset + 2] = (crc >>> 8) & 0xFF;
  rawBytes[crcOffset + 3] = crc & 0xFF;

  return {
    syncWord: SYNC_WORD,
    sessionId: header.sessionId,
    packetIndex: header.packetIndex,
    totalPackets: header.totalPackets,
    payloadLength: len,
    flags: header.flags,
    payload: payload.subarray(0, len),
    fecParity,
    crc32: crc,
    rawBytes,
  };
}

export function decodePacketFrame(
  frameBytes: Uint8Array
): { packet: AcousticPacket | null; healed: boolean; crcValid: boolean; error?: string } {
  if (frameBytes.length < 2 + HEADER_SIZE + 1 + FEC_PARITY_SIZE + CRC_SIZE) {
    return { packet: null, healed: false, crcValid: false, error: 'Short frame' };
  }

  if (frameBytes[0] !== 0xAA || frameBytes[1] !== 0x55) {
    return { packet: null, healed: false, crcValid: false, error: 'Bad sync word' };
  }

  const payloadLen = frameBytes[2 + 4];
  if (payloadLen < 1 || payloadLen > MAX_PAYLOAD_CHUNK) {
    return { packet: null, healed: false, crcValid: false, error: `Invalid length: ${payloadLen}` };
  }

  const expectedTotalLen = 2 + HEADER_SIZE + payloadLen + FEC_PARITY_SIZE + CRC_SIZE;
  if (frameBytes.length < expectedTotalLen) {
    return { packet: null, healed: false, crcValid: false, error: 'Incomplete frame' };
  }

  const messageLen = HEADER_SIZE + payloadLen;
  const codewordLen = messageLen + FEC_PARITY_SIZE;
  const codeword = frameBytes.subarray(2, 2 + codewordLen);

  const crcOffset = 2 + codewordLen;
  const expectedCrc = (
    ((frameBytes[crcOffset + 0] << 24) >>> 0) |
    (frameBytes[crcOffset + 1] << 16) |
    (frameBytes[crcOffset + 2] << 8) |
    frameBytes[crcOffset + 3]
  ) >>> 0;

  // 1. Check CRC directly
  const message = codeword.subarray(0, messageLen);
  if (verifyCrc32(message, expectedCrc)) {
    return {
      packet: {
        syncWord: SYNC_WORD,
        sessionId: message[1],
        packetIndex: message[2],
        totalPackets: message[3],
        payloadLength: payloadLen,
        flags: message[5],
        payload: new Uint8Array(message.subarray(HEADER_SIZE)),
        fecParity: new Uint8Array(codeword.subarray(messageLen, codewordLen)),
        crc32: expectedCrc,
        rawBytes: new Uint8Array(frameBytes.subarray(0, expectedTotalLen)),
      },
      healed: false,
      crcValid: true,
    };
  }

  // 2. Reed-Solomon correction
  const rs = rsCodec.decode(codeword);
  if (rs.success && verifyCrc32(rs.corrected, expectedCrc)) {
    const healedMsg = rs.corrected;
    return {
      packet: {
        syncWord: SYNC_WORD,
        sessionId: healedMsg[1],
        packetIndex: healedMsg[2],
        totalPackets: healedMsg[3],
        payloadLength: payloadLen,
        flags: healedMsg[5],
        payload: new Uint8Array(healedMsg.subarray(HEADER_SIZE)),
        fecParity: new Uint8Array(codeword.subarray(messageLen, codewordLen)),
        crc32: expectedCrc,
        rawBytes: new Uint8Array(frameBytes.subarray(0, expectedTotalLen)),
      },
      healed: true,
      crcValid: true,
    };
  }

  return { packet: null, healed: false, crcValid: false, error: 'CRC failed after RS decode' };
}
