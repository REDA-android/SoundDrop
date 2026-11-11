/**
 * Format de trame binaire SoundDrop v2 (11 octets d'en-tête et contrôle).
 * [ver: 1o][type: 1o][session: 2o][seq: 2o][total: 2o][len: 1o][payload: len o][crc16: 2o]
 */

export const FrameType = {
  Offer: 1,
  Answer: 2,
  Commit: 3,
  Reveal: 4,
  Meta: 5,
  Data: 6,
  Ack: 7,
  Done: 8,
  Relay: 9,
} as const;

export type FrameTypeId = (typeof FrameType)[keyof typeof FrameType];

export interface Frame {
  type: FrameTypeId;
  session: number;
  seq: number;
  total: number;
  payload: Uint8Array;
}

/**
 * Calcul du CRC-16/CCITT-FALSE (polynôme 0x1021, valeur initiale 0xFFFF).
 * Vecteur de test officiel : crc16(ASCII('123456789')) === 0x29B1.
 */
export function crc16(buf: Uint8Array): number {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * Encodage sérialisé d'une trame avec CRC-16.
 */
export function encodeFrame(f: Frame): Uint8Array {
  const totalLength = 9 + f.payload.length + 2;
  const out = new Uint8Array(totalLength);
  const v = new DataView(out.buffer);

  out[0] = 1; // Version 1
  out[1] = f.type;
  v.setUint16(2, f.session);
  v.setUint16(4, f.seq);
  v.setUint16(6, f.total);
  out[8] = f.payload.length;
  out.set(f.payload, 9);

  const crcVal = crc16(out.subarray(0, 9 + f.payload.length));
  v.setUint16(9 + f.payload.length, crcVal);
  return out;
}

/**
 * Décodage et validation stricte CRC-16 d'un tampon reçu.
 * Renvoie null si version incompatible, longueur invalide ou CRC erroné.
 */
export function decodeFrame(buf: Uint8Array): Frame | null {
  if (buf.length < 11 || buf[0] !== 1) return null;

  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = buf[8];
  if (buf.length !== 9 + len + 2) return null;

  const expectedCrc = crc16(buf.subarray(0, 9 + len));
  const receivedCrc = v.getUint16(9 + len);
  if (receivedCrc !== expectedCrc) return null;

  return {
    type: buf[1] as FrameTypeId,
    session: v.getUint16(2),
    seq: v.getUint16(4),
    total: v.getUint16(6),
    payload: buf.slice(9, 9 + len),
  };
}

/**
 * Enveloppe de relais multi-sauts (Store-and-Forward / Section 4.6).
 * [ttl: 1o][recipientHash: 4o][originHash: 4o][innerPayload: n o]
 */
export interface RelayEnvelope {
  ttl: number;
  recipientHash: Uint8Array; // 4 octets
  originHash: Uint8Array;    // 4 octets
  innerPayload: Uint8Array;
}

export function encodeRelayEnvelope(env: RelayEnvelope): Uint8Array {
  const out = new Uint8Array(1 + 4 + 4 + env.innerPayload.length);
  out[0] = env.ttl;
  out.set(env.recipientHash.subarray(0, 4), 1);
  out.set(env.originHash.subarray(0, 4), 5);
  out.set(env.innerPayload, 9);
  return out;
}

export function decodeRelayEnvelope(buf: Uint8Array): RelayEnvelope | null {
  if (buf.length < 9) return null;
  return {
    ttl: buf[0],
    recipientHash: buf.slice(1, 5),
    originHash: buf.slice(5, 9),
    innerPayload: buf.slice(9),
  };
}

