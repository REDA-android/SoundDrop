import { describe, expect, it } from 'vitest';
import {
  crc16,
  encodeFrame,
  decodeFrame,
  Frame,
  FrameType,
  encodeRelayEnvelope,
  decodeRelayEnvelope,
  RelayEnvelope,
} from './frame';
import {
  AckBitmap,
  FrameAssembler,
  estimateSeconds,
  validateFileSize,
  serializeMetaPayload,
  deserializeMetaPayload,
  FileMetadata,
} from './arq';

describe('Phase 4 — Protocole de Transfert (Trames, CRC-16 & ARQ)', () => {
  describe('Vecteur Officiel CRC-16/CCITT-FALSE', () => {
    it('valide le vecteur officiel ASCII 123456789 === 0x29B1', () => {
      const asciiBytes = new TextEncoder().encode('123456789');
      const val = crc16(asciiBytes);
      expect(val).toBe(0x29b1);
    });
  });

  describe('Encodage et Décodage de Trames Binaires', () => {
    it('effectue un aller-retour exact d’encodage / décodage', () => {
      const original: Frame = {
        type: FrameType.Data,
        session: 0x42a1,
        seq: 3,
        total: 10,
        payload: new Uint8Array([10, 20, 30, 40, 50]),
      };

      const encoded = encodeFrame(original);
      expect(encoded.length).toBe(9 + 5 + 2); // 16 octets
      expect(encoded[0]).toBe(1); // Version 1

      const decoded = decodeFrame(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded?.type).toBe(FrameType.Data);
      expect(decoded?.session).toBe(0x42a1);
      expect(decoded?.seq).toBe(3);
      expect(decoded?.total).toBe(10);
      expect(Array.from(decoded?.payload || [])).toEqual([10, 20, 30, 40, 50]);
    });

    it('rejette formellement toute trame altérée d’un seul bit', () => {
      const original: Frame = {
        type: FrameType.Data,
        session: 0x1234,
        seq: 1,
        total: 5,
        payload: new Uint8Array([1, 2, 3, 4]),
      };

      const encoded = encodeFrame(original);
      // Altération d'un bit dans le payload
      encoded[10] ^= 0x01;

      const decoded = decodeFrame(encoded);
      expect(decoded).toBeNull();
    });
  });

  describe('Sérialisation des Métadonnées & BlurHash', () => {
    it('sérialise et désérialise les métadonnées de fichier avec intégrité', () => {
      const meta: FileMetadata = {
        name: 'test_document.txt',
        mimeType: 'text/plain',
        size: 1024,
        nonce: new Uint8Array(24).fill(7),
        sha256Hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
      };

      const serialized = serializeMetaPayload(meta);
      const deserialized = deserializeMetaPayload(serialized);

      expect(deserialized).not.toBeNull();
      expect(deserialized?.name).toBe('test_document.txt');
      expect(deserialized?.mimeType).toBe('text/plain');
      expect(deserialized?.size).toBe(1024);
      expect(Array.from(deserialized?.nonce || [])).toEqual(Array.from(meta.nonce));
      expect(deserialized?.sha256Hex).toBe(meta.sha256Hex);
      expect(deserialized?.blurhash).toBe(meta.blurhash);
    });
  });

  describe('Plafond de Taille & Estimation de Durée', () => {
    it('refuse formellement un fichier de 17 Ko avec message explicatif', () => {
      const res = validateFileSize(17 * 1024);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('plafond dur');
      expect(res.error).toContain('16 Ko');
    });

    it('émet un avertissement avec durée estimée pour un fichier de 5 Ko', () => {
      const res = validateFileSize(5 * 1024);
      expect(res.valid).toBe(true);
      expect(res.warning).toContain('Durée estimée');
    });

    it('calcule une durée réaliste pour différents volumes', () => {
      const durSmall = estimateSeconds({ bytes: 100 });
      expect(durSmall).toBeGreaterThan(1);
      expect(durSmall).toBeLessThan(5);

      const durLarge = estimateSeconds({ bytes: 3000 });
      expect(durLarge).toBeGreaterThan(10);
      expect(durLarge).toBeLessThan(40);
    });
  });

  describe('Simulation ARQ avec 20% de Perte Aléatoire', () => {
    it('réassemble les données complètes malgré les pertes et doublons', () => {
      const sessionId = 0xbeef;
      const totalPackets = 12;
      const assembler = new FrameAssembler(sessionId, totalPackets);

      // Génération de paquets fictifs
      const packets: Frame[] = [];
      for (let i = 1; i <= totalPackets; i++) {
        packets.push({
          type: FrameType.Data,
          session: sessionId,
          seq: i,
          total: totalPackets,
          payload: new Uint8Array([i, i * 2, i * 3]),
        });
      }

      // Simulation de transmission avec perte de 20% et doublons
      const ackBitmap = new AckBitmap(totalPackets + 1); // 0 non utilisé pour data
      let rounds = 0;

      while (!assembler.isComplete() && rounds < 10) {
        rounds++;
        const toSend = ackBitmap.getMissingIndices().filter((seq) => seq >= 1);

        for (const seq of toSend) {
          // Simulation de 20% de perte
          if (Math.random() > 0.2) {
            const frame = packets[seq - 1];
            assembler.addFrame(frame);
            ackBitmap.markReceived(seq);

            // Simulation d'un doublon occasionnel
            if (Math.random() < 0.3) {
              assembler.addFrame(frame); // Doit être ignoré sans erreur
            }
          }
        }
      }

      expect(assembler.isComplete()).toBe(true);
      const assembled = assembler.assemble();
      expect(assembled).not.toBeNull();
      expect(assembled?.length).toBe(totalPackets * 3);

      // Vérification des octets
      for (let i = 1; i <= totalPackets; i++) {
        const offset = (i - 1) * 3;
        expect(assembled![offset]).toBe(i);
        expect(assembled![offset + 1]).toBe(i * 2);
        expect(assembled![offset + 2]).toBe(i * 3);
      }
    });
  });

  describe('Relais Multi-Sauts (Store-and-Forward / Section 4.6)', () => {
    it('sérialise et désérialise fidèlement une enveloppe relais', () => {
      const recipientHash = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
      const originHash = new Uint8Array([0xab, 0xcd, 0xef, 0x01]);
      const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

      const envelope: RelayEnvelope = {
        ttl: 3,
        recipientHash,
        originHash,
        innerPayload: payload,
      };

      const encoded = encodeRelayEnvelope(envelope);
      expect(encoded.length).toBe(1 + 4 + 4 + 8);
      expect(encoded[0]).toBe(3);

      const decoded = decodeRelayEnvelope(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded?.ttl).toBe(3);
      expect(Array.from(decoded?.recipientHash || [])).toEqual([0x12, 0x34, 0x56, 0x78]);
      expect(Array.from(decoded?.originHash || [])).toEqual([0xab, 0xcd, 0xef, 0x01]);
      expect(Array.from(decoded?.innerPayload || [])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('rejette les tampons de relais tronqués (< 9 octets)', () => {
      const truncated = new Uint8Array([3, 0x12, 0x34, 0x56]);
      expect(decodeRelayEnvelope(truncated)).toBeNull();
    });
  });
});
