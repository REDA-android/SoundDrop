/**
 * IEEE 802.3 CRC-32 Implementation
 * Standard polynomial: 0xEDB88320 (reversed representation of 0x04C11DB7)
 */

let crcTable: Uint32Array | null = null;

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

export function computeCrc32(data: Uint8Array, offset = 0, length?: number): number {
  if (!crcTable) {
    crcTable = makeCrcTable();
  }
  const len = length !== undefined ? length : data.length - offset;
  let crc = 0xFFFFFFFF;

  for (let i = 0; i < len; i++) {
    const byte = data[offset + i];
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xFF];
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function verifyCrc32(data: Uint8Array, expectedCrc: number, offset = 0, length?: number): boolean {
  const computed = computeCrc32(data, offset, length);
  return (computed >>> 0) === (expectedCrc >>> 0);
}
