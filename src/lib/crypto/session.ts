/**
 * Module Cryptographique E2EE SoundDrop v2 (TweetNaCl & WebCrypto).
 * - Chiffrement authentifié ChaCha20/XSalsa20-Poly1305.
 * - Échange de clés Diffie-Hellman Curve25519 avec engagement (Commit-Reveal).
 * - Dérivation du Short Authentication String (SAS) à 6 chiffres anti-MITM.
 * - Dérivation de clé par phrase de passe PBKDF2-SHA256 (600 000 itérations).
 */

import nacl from 'tweetnacl';

/**
 * Calcul SHA-256 via l'API WebCrypto standard (fonctionne dans le navigateur et Node.js).
 */
export async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

/**
 * Extrait 6 chiffres décimaux (formatés avec zéros de tête) à partir des 4 premiers octets d'un hash.
 */
export function sasDigits(hash: Uint8Array): string {
  const v = ((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0;
  return String(v % 1_000_000).padStart(6, '0');
}

/**
 * Génère une nouvelle paire de clés éphémères X25519 (jetees après usage).
 */
export function newKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair();
}

/**
 * Dérive une clé de session symétrique de 32 octets via Diffie-Hellman X25519 (nacl.box.before).
 */
export function sessionKey(theirPublic: Uint8Array, mySecret: Uint8Array): Uint8Array {
  return nacl.box.before(theirPublic, mySecret);
}

/**
 * Scelle un message en clair avec un nonce aléatoire de 24 octets via TweetNaCl secretbox.
 */
export function seal(plain: Uint8Array, key: Uint8Array): { nonce: Uint8Array; box: Uint8Array } {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  return { nonce, box: nacl.secretbox(plain, nonce, key) };
}

/**
 * Ouvre et authentifie un message scellé. Lève une erreur si altéré ou clé incorrecte.
 */
export function open(box: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  const out = nacl.secretbox.open(box, nonce, key);
  if (!out) {
    throw new Error('Authentification échouée : message altéré ou clé invalide');
  }
  return out;
}

/**
 * Dérive une clé symétrique de 32 octets à partir d'une phrase de passe via PBKDF2-SHA256 (WebCrypto).
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt = new Uint8Array([115, 110, 100, 112, 45, 97, 105, 114, 103, 97, 112, 45, 115, 97, 108, 116]) // 'sndp-airgap-salt'
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 600000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 octets
  );

  return new Uint8Array(derivedBits);
}

export interface CommitPayload {
  commitHash: Uint8Array;
}

export interface RevealPayload {
  publicKey: Uint8Array;
  randomSecret: Uint8Array;
}

/**
 * Étape 1 : Alice génère un engagement (Commit) = SHA-256(pubA || rA).
 */
export async function createCommitment(
  publicKey: Uint8Array
): Promise<{ commitHash: Uint8Array; randomSecret: Uint8Array }> {
  const randomSecret = nacl.randomBytes(16);
  const commitHash = await sha256(publicKey, randomSecret);
  return { commitHash, randomSecret };
}

/**
 * Étape 4 : Bob vérifie que le Reveal d'Alice correspond à son engagement initial.
 */
export async function verifyCommitment(
  expectedCommitHash: Uint8Array,
  revealedPublicKey: Uint8Array,
  revealedRandomSecret: Uint8Array
): Promise<boolean> {
  const computedHash = await sha256(revealedPublicKey, revealedRandomSecret);
  if (computedHash.length !== expectedCommitHash.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHash.length; i++) {
    diff |= computedHash[i] ^ expectedCommitHash[i];
  }
  return diff === 0;
}

/**
 * Étape 5 : Calcul bilatéral du code court SAS (6 chiffres).
 * SAS = 6 chiffres de SHA-256(pubA || pubB || rA)
 */
export async function computeSas(
  pubA: Uint8Array,
  pubB: Uint8Array,
  rA: Uint8Array
): Promise<string> {
  const hash = await sha256(pubA, pubB, rA);
  return sasDigits(hash);
}
