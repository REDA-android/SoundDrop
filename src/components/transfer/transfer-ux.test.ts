import { describe, expect, it } from 'vitest';
import {
  MAX_ACOUSTIC_PAYLOAD_BYTES,
  validateFileSize,
  estimateSeconds,
  serializeMetaPayload,
  deserializeMetaPayload,
  FileMetadata,
} from '../../lib/protocol/arq';
import { encodeFrame, decodeFrame, FrameType } from '../../lib/protocol/frame';
import {
  newKeyPair,
  createCommitment,
  computeSas,
  seal,
  open,
  sessionKey,
  sha256,
} from '../../lib/crypto/session';
import { calculateRmsDbfs, classifyNoiseLevel } from '../../lib/audio/rms';

describe('Phase 6 — Parcours UX en 3 Écrans & Mobile First', () => {
  describe('Écran 1 : Préparation & Durée Estimée (Taille Max 16 Ko)', () => {
    it('applique une limite matérielle stricte à 16 Ko et rejette au-delà', () => {
      expect(MAX_ACOUSTIC_PAYLOAD_BYTES).toBe(16384);

      const validSmall = validateFileSize(500);
      expect(validSmall.valid).toBe(true);
      expect(validSmall.error).toBeUndefined();

      const validAtLimit = validateFileSize(16384);
      expect(validAtLimit.valid).toBe(true);

      const invalidOversize = validateFileSize(16385);
      expect(invalidOversize.valid).toBe(false);
      expect(invalidOversize.error).toContain('trop volumineux');
      expect(invalidOversize.error).toContain('16 Ko');
    });

    it('calcule la durée estimée selon le profil (durées mesurées réalistes)', () => {
      const bytes = 120;
      const secRobust = estimateSeconds({ bytes, secondsPerFrame: 0.45, payloadPerFrame: 100 });
      const secNormal = estimateSeconds({ bytes, secondsPerFrame: 0.35, payloadPerFrame: 100 });
      const secFast = estimateSeconds({ bytes, secondsPerFrame: 0.20, payloadPerFrame: 100 });

      expect(secRobust).toBeGreaterThan(secNormal);
      expect(secNormal).toBeGreaterThan(secFast);
      expect(secNormal).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Écran 2 : Proximité, SAS & Jauge de Bruit RMS', () => {
    it('dérive un SAS à 6 chiffres unique pour la session bilatérale', async () => {
      const alice = newKeyPair();
      const bob = newKeyPair();
      const { randomSecret: rA } = await createCommitment(alice.publicKey);

      const sas = await computeSas(alice.publicKey, bob.publicKey, rA);
      expect(sas).toMatch(/^\d{6}$/);
      expect(sas.length).toBe(6);
    });

    it('classifie correctement les seuils de bruit ambiant (seuil > -30 dBFS pour trop bruyant)', () => {
      expect(classifyNoiseLevel(-55)).toBe('calm');
      expect(classifyNoiseLevel(-35)).toBe('noisy');
      expect(classifyNoiseLevel(-25)).toBe('too_noisy');
      expect(classifyNoiseLevel(-10)).toBe('too_noisy');
    });

    it('calcule le RMS dBFS sur des échantillons réels sans mock', () => {
      const silence = new Float32Array(128).fill(0);
      expect(calculateRmsDbfs(silence)).toBeLessThan(-90);

      const loudSignal = new Float32Array(128).fill(0.8);
      const dbfs = calculateRmsDbfs(loudSignal);
      expect(dbfs).toBeGreaterThan(-5);
      expect(classifyNoiseLevel(dbfs)).toBe('too_noisy');
    });
  });

  describe('Écran 3 : Transfert par Trames Réelles & Intégrité Authentifiée', () => {
    it('structure les trames réelles sans faux pourcentage', () => {
      const meta: FileMetadata = {
        name: 'test.txt',
        mimeType: 'text/plain',
        size: 64,
        nonce: new Uint8Array(24),
        sha256Hex: 'abcd1234abcd1234',
      };
      const metaBytes = serializeMetaPayload(meta);

      const metaFrame = encodeFrame({
        type: FrameType.Meta,
        session: 0x42,
        seq: 0,
        total: 3,
        payload: metaBytes,
      });

      const decodedMeta = decodeFrame(metaFrame);
      expect(decodedMeta).not.toBeNull();
      expect(decodedMeta?.type).toBe(FrameType.Meta);
      expect(decodedMeta?.total).toBe(3);

      const deserializedMeta = deserializeMetaPayload(decodedMeta!.payload);
      expect(deserializedMeta?.name).toBe('test.txt');
      expect(deserializedMeta?.size).toBe(64);
    });

    it('chiffre et authentifie de bout en bout avec TweetNaCl', async () => {
      const alice = newKeyPair();
      const bob = newKeyPair();
      const sessionKeyAB = sessionKey(bob.publicKey, alice.secretKey);
      const sessionKeyBA = sessionKey(alice.publicKey, bob.secretKey);
      expect(Array.from(sessionKeyAB)).toEqual(Array.from(sessionKeyBA));

      const message = new TextEncoder().encode('Transfert sécurisé air-gap');
      const { nonce, box } = seal(message, sessionKeyAB);

      const decrypted = open(box, nonce, sessionKeyBA);
      expect(new TextDecoder().decode(decrypted)).toBe('Transfert sécurisé air-gap');

      const hash = await sha256(message);
      expect(hash.byteLength).toBe(32);
    });
  });
});
