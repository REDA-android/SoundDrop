import {
  DeliveryStatus,
  ProviderType,
  SatelliteHeader,
  SatelliteNetworkStatus,
  SatellitePacket,
  SatelliteProvider,
  TransmissionReceipt,
} from './satellite-types';
import { calculateCRC16 } from '../audio/crc16';

export const MAX_SATELLITE_PACKET_LEN = 340; // Iridium SBD limit

export const PACKET_FLAGS = {
  VOICE: 0x01,
  PRIORITY: 0x02,
  ACK_REQUEST: 0x04,
  ENCRYPTED: 0x08,
} as const;

/**
 * Encode a SatellitePacket to binary Uint8Array with 16B header + payload + 2B CRC-16
 */
export function encodeSatellitePacket(packet: SatellitePacket): Uint8Array {
  const totalLen = 16 + packet.payload.length + 2;
  if (totalLen > MAX_SATELLITE_PACKET_LEN) {
    throw new Error(`Packet exceeds maximum satellite limit of ${MAX_SATELLITE_PACKET_LEN} bytes (got ${totalLen})`);
  }

  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);

  // Magic 'SO' (0x53, 0x4F)
  out[0] = 0x53;
  out[1] = 0x4f;
  out[2] = packet.header.version;
  out[3] = packet.header.flags;
  view.setUint16(4, packet.header.msgId, false);

  // Recipient hash (4 bytes from hex)
  const hex = packet.header.recipientHash.replace(/^0x/, '').padStart(8, '0');
  for (let i = 0; i < 4; i++) {
    out[6 + i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }

  view.setUint32(10, packet.header.timestamp, false);
  view.setUint16(14, packet.payload.length, false);

  out.set(packet.payload, 16);

  // Compute CRC-16 over header + payload
  const checksum = calculateCRC16(out.subarray(0, totalLen - 2));
  view.setUint16(totalLen - 2, checksum, false);

  return out;
}

/**
 * Decode a binary Uint8Array into a SatellitePacket with CRC-16 verification
 */
export function decodeSatellitePacket(buf: Uint8Array): SatellitePacket {
  if (buf.length < 18) {
    throw new Error('Packet too short, minimum size is 18 bytes');
  }
  if (buf.length > MAX_SATELLITE_PACKET_LEN) {
    throw new Error(`Packet exceeds maximum satellite limit of ${MAX_SATELLITE_PACKET_LEN} bytes`);
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const totalLen = buf.length;
  const expectedCrc = view.getUint16(totalLen - 2, false);
  const calculatedCrc = calculateCRC16(buf.subarray(0, totalLen - 2));

  if (expectedCrc !== calculatedCrc) {
    throw new Error(`CRC-16 mismatch: expected 0x${expectedCrc.toString(16)}, got 0x${calculatedCrc.toString(16)}`);
  }

  if (buf[0] !== 0x53 || buf[1] !== 0x4f) {
    throw new Error('Invalid orbital magic bytes, expected SO');
  }

  const version = buf[2];
  const flags = buf[3];
  const msgId = view.getUint16(4, false);

  let hashHex = '';
  for (let i = 0; i < 4; i++) {
    hashHex += buf[6 + i].toString(16).padStart(2, '0');
  }

  const timestamp = view.getUint32(10, false);
  const payloadLen = view.getUint16(14, false);

  if (payloadLen !== totalLen - 18) {
    throw new Error(`Payload length mismatch: header says ${payloadLen}, buffer has ${totalLen - 18}`);
  }

  const payload = buf.subarray(16, totalLen - 2);

  return {
    header: {
      magic: 'SO',
      version,
      flags,
      msgId,
      recipientHash: hashHex,
      timestamp,
      payloadLen,
    },
    payload,
  };
}

/**
 * Simulated Satellite Provider
 * Conforms strictly to honesty policy: isSimulated = true.
 */
export class SimulatedSatelliteProvider implements SatelliteProvider {
  readonly name = 'SIM-LEO-SAT-ATLAS';
  readonly providerType: ProviderType = 'simulated';
  readonly isSimulated = true;
  readonly maxPayloadBytes = MAX_SATELLITE_PACKET_LEN;

  private passActive = true;
  private orbitStorage: SatellitePacket[] = [];
  private downlinkBuffer: SatellitePacket[] = [];

  setPassActive(active: boolean) {
    this.passActive = active;
  }

  getNetworkStatus(): SatelliteNetworkStatus {
    return this.passActive ? 'connected' : 'no_signal';
  }

  async transmit(packet: SatellitePacket): Promise<TransmissionReceipt> {
    if (!this.passActive) {
      throw new Error('No satellite pass available at this moment (next pass in 4800 seconds)');
    }

    this.orbitStorage.push(packet);

    return {
      receiptId: `SIM-REC-${packet.header.msgId}-${packet.header.timestamp}`,
      msgId: packet.header.msgId,
      provider: this.name,
      isSimulated: true, // Explicitly honest
      uplinkTimestamp: packet.header.timestamp,
      satelliteId: 'SIM-LEO-SAT-1',
      status: 'in_orbit_storage' as DeliveryStatus,
    };
  }

  advanceOrbitAndRelease() {
    while (this.orbitStorage.length > 0) {
      this.downlinkBuffer.push(this.orbitStorage.shift()!);
    }
  }

  async pollIncoming(): Promise<SatellitePacket[]> {
    const out = [...this.downlinkBuffer];
    this.downlinkBuffer = [];
    return out;
  }
}

/**
 * Helpers for Iridium 9603 SBD AT command parsing
 */
export class IridiumSbdProtocol {
  static formatSbdwb(data: Uint8Array): { cmd: string; binaryPayload: Uint8Array; checksum: number } {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum = (sum + data[i]) & 0xffff;
    }
    return {
      cmd: `AT+SBDWB=${data.length}\r`,
      binaryPayload: data,
      checksum: sum,
    };
  }

  static parseSbdixResponse(response: string): { moStatus: number; momsn: number; mtStatus: number } {
    const prefix = '+SBDIX:';
    const idx = response.indexOf(prefix);
    if (idx === -1) {
      throw new Error('Missing +SBDIX prefix');
    }
    const firstLine = response.slice(idx + prefix.length).split('\n')[0].trim();
    const parts = firstLine.split(',').map((s) => s.trim());
    if (parts.length < 3) {
      throw new Error('Malformed +SBDIX response');
    }
    return {
      moStatus: parseInt(parts[0], 10),
      momsn: parseInt(parts[1], 10),
      mtStatus: parseInt(parts[2], 10),
    };
  }
}
