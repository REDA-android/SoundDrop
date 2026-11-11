/**
 * Acoustic End-to-End Encryption (E2EE)
 * Authenticated encryption using TweetNaCl SecretBox (XSalsa20-Poly1305).
 * Prevents eavesdroppers in the room from decoding transmitted acoustic tones.
 */

import nacl from 'tweetnacl';

/**
 * Derives a deterministic 32-byte key from user PIN / Passphrase via SHA-256
 */
async function deriveKeyFromPin(pin: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`sound-drop-salt:${pin}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

export async function encryptAcousticPayload(
  payload: Uint8Array,
  pin: string
): Promise<Uint8Array> {
  const key = await deriveKeyFromPin(pin);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength); // 24 bytes
  const encryptedBox = nacl.secretbox(payload, nonce, key);

  // Return [24-byte Nonce] + [Encrypted Box with 16-byte Poly1305 Auth Tag]
  const result = new Uint8Array(nonce.length + encryptedBox.length);
  result.set(nonce, 0);
  result.set(encryptedBox, nonce.length);
  return result;
}

export async function decryptAcousticPayload(
  encryptedBytes: Uint8Array,
  pin: string
): Promise<Uint8Array | null> {
  if (encryptedBytes.length < nacl.secretbox.nonceLength + nacl.secretbox.overheadLength) {
    return null;
  }

  const key = await deriveKeyFromPin(pin);
  const nonce = encryptedBytes.subarray(0, nacl.secretbox.nonceLength);
  const box = encryptedBytes.subarray(nacl.secretbox.nonceLength);

  const decrypted = nacl.secretbox.open(box, nonce, key);
  return decrypted ? new Uint8Array(decrypted) : null;
}
