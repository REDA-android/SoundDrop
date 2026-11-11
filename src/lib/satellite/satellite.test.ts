import { describe, it, expect } from 'vitest';
import {
  decodeSatellitePacket,
  encodeSatellitePacket,
  IridiumSbdProtocol,
  PACKET_FLAGS,
  SimulatedSatelliteProvider,
} from './satellite-manager';
import { SatellitePacket } from './satellite-types';

describe('SoundDrop Orbital Relay — Satellite Web Module', () => {
  it('encodes and decodes satellite packets with CRC-16 integrity', () => {
    const payload = new TextEncoder().encode('SOS DOUAR AIT ALI SEISME');
    const packet: SatellitePacket = {
      header: {
        magic: 'SO',
        version: 1,
        flags: PACKET_FLAGS.PRIORITY | PACKET_FLAGS.ENCRYPTED,
        msgId: 101,
        recipientHash: 'deadbeef',
        timestamp: 1731150000,
        payloadLen: payload.length,
      },
      payload,
    };

    const encoded = encodeSatellitePacket(packet);
    expect(encoded.length).toBe(16 + payload.length + 2);

    const decoded = decodeSatellitePacket(encoded);
    expect(decoded.header.magic).toBe('SO');
    expect(decoded.header.msgId).toBe(101);
    expect(decoded.header.recipientHash).toBe('deadbeef');
    expect(decoded.header.flags & PACKET_FLAGS.PRIORITY).toBeTruthy();
    expect(new TextDecoder().decode(decoded.payload)).toBe('SOS DOUAR AIT ALI SEISME');
  });

  it('rejects packets with corrupted CRC-16 checksums', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const packet: SatellitePacket = {
      header: {
        magic: 'SO',
        version: 1,
        flags: 0,
        msgId: 1,
        recipientHash: '12345678',
        timestamp: 1731150000,
        payloadLen: 5,
      },
      payload,
    };

    const encoded = encodeSatellitePacket(packet);
    // Tamper with one byte in the payload
    encoded[17] ^= 0xff;

    expect(() => decodeSatellitePacket(encoded)).toThrow(/CRC-16 mismatch/);
  });

  it('strictly identifies simulated provider and runs simulated orbital pass', async () => {
    const sim = new SimulatedSatelliteProvider();
    expect(sim.isSimulated).toBe(true);
    expect(sim.getNetworkStatus()).toBe('connected');

    const payload = new TextEncoder().encode('TEST ORBIT');
    const packet: SatellitePacket = {
      header: {
        magic: 'SO',
        version: 1,
        flags: 0,
        msgId: 5,
        recipientHash: 'aabbccdd',
        timestamp: 1731150000,
        payloadLen: payload.length,
      },
      payload,
    };

    const receipt = await sim.transmit(packet);
    expect(receipt.isSimulated).toBe(true);
    expect(receipt.status).toBe('in_orbit_storage');

    // Initially downlink buffer is empty
    const pendingBefore = await sim.pollIncoming();
    expect(pendingBefore.length).toBe(0);

    // Satellite orbits and reaches destination
    sim.advanceOrbitAndRelease();

    const pendingAfter = await sim.pollIncoming();
    expect(pendingAfter.length).toBe(1);
    expect(pendingAfter[0].header.msgId).toBe(5);
  });

  it('formats and parses Iridium 9603 SBD commands with arithmetic checksum', () => {
    const binaryData = new Uint8Array([0x10, 0x20, 0x30]);
    const formatted = IridiumSbdProtocol.formatSbdwb(binaryData);

    expect(formatted.cmd).toBe('AT+SBDWB=3\r');
    expect(formatted.checksum).toBe(0x10 + 0x20 + 0x30);

    const sbdixResp = '+SBDIX: 0, 456, 0, 0, 0, 0\r\nOK\r\n';
    const parsed = IridiumSbdProtocol.parseSbdixResponse(sbdixResp);
    expect(parsed.moStatus).toBe(0); // Outgoing transmission success
    expect(parsed.momsn).toBe(456);
  });
});
