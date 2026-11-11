/**
 * CRC-16-CCITT Implementation
 * Polynomial: x^16 + x^12 + x^5 + 1 (0x1021)
 * Initial Value: 0xFFFF
 */

export function calculateCRC16(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
}

export function verifyCRC16(data: Uint8Array, expectedCrc: number): boolean {
  return calculateCRC16(data) === (expectedCrc & 0xffff);
}
