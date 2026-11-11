import { describe, expect, it } from 'vitest';
import {
  newKeyPair,
  sessionKey,
  seal,
  open,
  createCommitment,
  verifyCommitment,
  computeSas,
  deriveKeyFromPassphrase,
  sasDigits,
} from './session';

describe('Phase 5 — Cryptographie E2EE & Appairage SAS', () => {
  describe('Chiffrement Authentifié (TweetNaCl secretbox)', () => {
    it('scelle et ouvre un message en clair avec intégrité parfaite', () => {
      const key = new Uint8Array(32).fill(42);
      const plaintext = new TextEncoder().encode('Données ultra-secrètes transmises par ondes sonores');

      const { nonce, box } = seal(plaintext, key);
      expect(nonce.length).toBe(24);
      expect(box.length).toBe(plaintext.length + 16); // 16 octets Poly1305 MAC

      const opened = open(box, nonce, key);
      expect(new TextDecoder().decode(opened)).toBe('Données ultra-secrètes transmises par ondes sonores');
    });

    it('rejette immédiatement tout message dont 1 seul octet a été modifié', () => {
      const key = new Uint8Array(32).fill(99);
      const plaintext = new TextEncoder().encode('Document intègre');

      const { nonce, box } = seal(plaintext, key);

      // Altération d'un octet dans la boîte chiffrée
      const corrupted = new Uint8Array(box);
      corrupted[5] ^= 0x01;

      expect(() => open(corrupted, nonce, key)).toThrow('Authentification échouée');
    });
  });

  describe('Protocole Commit-Reveal et SAS à 6 Chiffres', () => {
    it('génère un SAS exactement identique entre deux parties honnêtes (Alice & Bob)', async () => {
      const aliceKeys = newKeyPair();
      const bobKeys = newKeyPair();

      // 1. Alice génère le Commit = SHA-256(pubA || rA)
      const { commitHash, randomSecret: rA } = await createCommitment(aliceKeys.publicKey);

      // 2. Bob vérifie le Reveal d'Alice
      const validCommit = await verifyCommitment(commitHash, aliceKeys.publicKey, rA);
      expect(validCommit).toBe(true);

      // 3. Les deux calculent le SAS de manière indépendante
      const sasAlice = await computeSas(aliceKeys.publicKey, bobKeys.publicKey, rA);
      const sasBob = await computeSas(aliceKeys.publicKey, bobKeys.publicKey, rA);

      expect(sasAlice.length).toBe(6);
      expect(sasAlice).toMatch(/^\d{6}$/);
      expect(sasAlice).toBe(sasBob);

      // 4. Dérivation de la clé de session symétrique
      const keyAlice = sessionKey(bobKeys.publicKey, aliceKeys.secretKey);
      const keyBob = sessionKey(aliceKeys.publicKey, bobKeys.secretKey);
      expect(Array.from(keyAlice)).toEqual(Array.from(keyBob));
    });

    it('rejette un Reveal falsifié qui ne correspond pas au Commit', async () => {
      const aliceKeys = newKeyPair();
      const malloryKeys = newKeyPair(); // Clé substituée par un attaquant

      const { commitHash, randomSecret: rA } = await createCommitment(aliceKeys.publicKey);

      // Mallory tente de révéler sa propre clé publique
      const isValid = await verifyCommitment(commitHash, malloryKeys.publicKey, rA);
      expect(isValid).toBe(false);
    });

    it('détecte une attaque MITM (homme du milieu) via un SAS discordant', async () => {
      const aliceKeys = newKeyPair();
      const bobKeys = newKeyPair();
      const malloryKeys = newKeyPair();

      const { randomSecret: rA } = await createCommitment(aliceKeys.publicKey);

      // Mallory s'interpose : Alice parle à Mallory, Mallory parle à Bob
      const sasAliceMallory = await computeSas(aliceKeys.publicKey, malloryKeys.publicKey, rA);
      const sasBobMallory = await computeSas(malloryKeys.publicKey, bobKeys.publicKey, rA);

      // Les codes sur les écrans d'Alice et Bob sont DIFFÉRENTS => Attaque détectée visuellement !
      expect(sasAliceMallory).not.toBe(sasBobMallory);
    });

    it('garantit un SAS rigoureusement identique sur 1 000 tirages aléatoires légitimes', async () => {
      for (let i = 0; i < 1000; i++) {
        const alice = newKeyPair();
        const bob = newKeyPair();
        const { randomSecret } = await createCommitment(alice.publicKey);

        const sasA = await computeSas(alice.publicKey, bob.publicKey, randomSecret);
        const sasB = await computeSas(alice.publicKey, bob.publicKey, randomSecret);
        expect(sasA).toBe(sasB);
        expect(sasA).toMatch(/^\d{6}$/);
      }
    });
  });

  describe('Dérivation par Phrase de Passe (Mode Diffusion Unidirectionnelle)', () => {
    it('dérive une clé déterministe de 32 octets avec PBKDF2-SHA256 (600 000 itérations)', async () => {
      const phrase = 'phrase-secrete-sounddrop-airgap-1234';
      const key1 = await deriveKeyFromPassphrase(phrase);
      const key2 = await deriveKeyFromPassphrase(phrase);

      expect(key1.length).toBe(32);
      expect(Array.from(key1)).toEqual(Array.from(key2));

      // Phrase différente donne une clé différente
      const keyDiff = await deriveKeyFromPassphrase('autre-phrase');
      expect(Array.from(key1)).not.toEqual(Array.from(keyDiff));
    });
  });
});
