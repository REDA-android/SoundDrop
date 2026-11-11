import { describe, expect, it } from 'vitest';
import { FrameType } from './frame';
import {
  encodeRelayPacket,
  decodeRelayPacket,
  stepRelay,
  WebStoreAndForwardQueue,
  RelayHeader,
} from './relay';

describe('Multi-Hop Relay & Store-and-Forward Protocol (Section 4.6)', () => {
  it('encode et décode avec succès un paquet relais avec contrôle d intégrité', () => {
    const frame = {
      type: FrameType.Data,
      session: 0x1234,
      seq: 3,
      total: 10,
      payload: new Uint8Array([10, 20, 30, 40, 50]),
    };

    const recipientHash = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
    const relay: RelayHeader = {
      ttl: 4,
      hopCount: 0,
      recipientHash,
      flags: 0x04,
    };

    const encoded = encodeRelayPacket(relay, frame);
    expect(encoded.length).toBe(7 + 9 + 5 + 2);

    const decoded = decodeRelayPacket(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.relay.ttl).toBe(4);
    expect(decoded!.relay.hopCount).toBe(0);
    expect(Array.from(decoded!.relay.recipientHash)).toEqual([0xAA, 0xBB, 0xCC, 0xDD]);
    expect(decoded!.frame.session).toBe(0x1234);
    expect(decoded!.frame.seq).toBe(3);
    expect(Array.from(decoded!.frame.payload)).toEqual([10, 20, 30, 40, 50]);
  });

  it('décrémente le TTL et bloque les paquets dont la durée de vie est expirée', () => {
    const relay: RelayHeader = {
      ttl: 2,
      hopCount: 0,
      recipientHash: new Uint8Array([1, 2, 3, 4]),
      flags: 0,
    };

    const hop1 = stepRelay(relay);
    expect(hop1).not.toBeNull();
    expect(hop1!.ttl).toBe(1);
    expect(hop1!.hopCount).toBe(1);

    // TTL atteint 1 -> saut suivant impossible
    const hop2 = stepRelay(hop1!);
    expect(hop2).toBeNull();
  });

  it('déduplique les trames et délivre au bon destinataire dans la file store-and-forward', () => {
    const queue = new WebStoreAndForwardQueue(10, 60000);

    const hashAlice = new Uint8Array([0x11, 0x11, 0x11, 0x11]);
    const hashBob = new Uint8Array([0x22, 0x22, 0x22, 0x22]);

    const pAlice1 = {
      relay: { ttl: 3, hopCount: 0, recipientHash: hashAlice, flags: 0 },
      frame: { type: FrameType.Data, session: 1, seq: 1, total: 2, payload: new Uint8Array([1]) },
    };
    const pBob1 = {
      relay: { ttl: 3, hopCount: 0, recipientHash: hashBob, flags: 0 },
      frame: { type: FrameType.Data, session: 2, seq: 1, total: 1, payload: new Uint8Array([2]) },
    };
    const pAlice2 = {
      relay: { ttl: 3, hopCount: 0, recipientHash: hashAlice, flags: 0 },
      frame: { type: FrameType.Data, session: 1, seq: 2, total: 2, payload: new Uint8Array([3]) },
    };

    expect(queue.push(pAlice1)).toBe(true);
    expect(queue.push(pBob1)).toBe(true);
    expect(queue.push(pAlice2)).toBe(true);
    // Doublon
    expect(queue.push(pAlice1)).toBe(false);
    expect(queue.length).toBe(3);

    // Rencontre d'Alice -> délivrance
    const alicePackets = queue.drainForRecipient(hashAlice);
    expect(alicePackets.length).toBe(2);
    expect(queue.length).toBe(1);

    // Le paquet de Bob est toujours en attente
    const bobPackets = queue.drainForRecipient(hashBob);
    expect(bobPackets.length).toBe(1);
    expect(queue.length).toBe(0);
  });
});
