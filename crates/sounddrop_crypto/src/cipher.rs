use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, KeyInit, Nonce};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum CryptoError {
    #[error("AEAD decryption failed: invalid ciphertext or tampered tag")]
    DecryptionFailed,
    #[error("Replay attack detected: counter {received} is not greater than last verified counter {last}")]
    ReplayDetected { received: u64, last: u64 },
    #[error("Encrypted payload too short (minimum 24 bytes: 8B counter + 16B Poly1305 tag)")]
    PayloadTooShort,
}

/// Directional ChaCha20-Poly1305 AEAD channel with replay counter protection.
pub struct FrameCipher {
    tx_cipher: ChaCha20Poly1305,
    rx_cipher: ChaCha20Poly1305,
    tx_counter: u64,
    last_rx_counter: Option<u64>,
}

impl FrameCipher {
    pub fn new(tx_key: &[u8; 32], rx_key: &[u8; 32]) -> Self {
        Self {
            tx_cipher: ChaCha20Poly1305::new(Key::from_slice(tx_key)),
            rx_cipher: ChaCha20Poly1305::new(Key::from_slice(rx_key)),
            tx_counter: 0,
            last_rx_counter: None,
        }
    }

    fn make_nonce(direction: u8, counter: u64) -> [u8; 12] {
        let mut nonce = [0u8; 12];
        nonce[0] = direction;
        nonce[1..9].copy_from_slice(&counter.to_be_bytes());
        nonce
    }

    /// Encrypts `plaintext` with associated data `aad`.
    /// Emits `[8 bytes counter BE] + [ciphertext] + [16 bytes Poly1305 tag]`.
    pub fn encrypt(&mut self, plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let counter = self.tx_counter;
        self.tx_counter = self.tx_counter.checked_add(1).expect("Counter overflow");

        let nonce_bytes = Self::make_nonce(0x01, counter);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self
            .tx_cipher
            .encrypt(
                nonce,
                Payload {
                    msg: plaintext,
                    aad,
                },
            )
            .map_err(|_| CryptoError::DecryptionFailed)?;

        let mut output = Vec::with_capacity(8 + ciphertext.len());
        output.extend_from_slice(&counter.to_be_bytes());
        output.extend_from_slice(&ciphertext);
        Ok(output)
    }

    /// Decrypts and authenticates `payload` with associated data `aad`.
    /// Enforces monotonic replay protection.
    pub fn decrypt(&mut self, payload: &[u8], aad: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if payload.len() < 24 {
            // Minimum 8 bytes counter + 16 bytes Poly1305 tag
            return Err(CryptoError::PayloadTooShort);
        }

        let counter = u64::from_be_bytes(payload[0..8].try_into().unwrap());
        let ciphertext = &payload[8..];

        // Replay attack check
        if let Some(last) = self.last_rx_counter {
            if counter <= last {
                return Err(CryptoError::ReplayDetected {
                    received: counter,
                    last,
                });
            }
        }

        let nonce_bytes = Self::make_nonce(0x01, counter);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let plaintext = self
            .rx_cipher
            .decrypt(
                nonce,
                Payload {
                    msg: ciphertext,
                    aad,
                },
            )
            .map_err(|_| CryptoError::DecryptionFailed)?;

        self.last_rx_counter = Some(counter);
        Ok(plaintext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aead_encrypt_decrypt_roundtrip() {
        let key_a_to_b = [0x42u8; 32];
        let key_b_to_a = [0x99u8; 32];

        let mut alice = FrameCipher::new(&key_a_to_b, &key_b_to_a);
        let mut bob = FrameCipher::new(&key_b_to_a, &key_a_to_b);

        let secret_msg = b"SOUNDDROP_CRYPTO_VERIFIED";
        let aad = b"FRAME_HEADER_META";

        let encrypted = alice.encrypt(secret_msg, aad).unwrap();
        let decrypted = bob.decrypt(&encrypted, aad).unwrap();

        assert_eq!(decrypted, secret_msg);
    }

    #[test]
    fn test_aead_rejects_tampered_aad() {
        let k1 = [0x11u8; 32];
        let k2 = [0x22u8; 32];
        let mut alice = FrameCipher::new(&k1, &k2);
        let mut bob = FrameCipher::new(&k2, &k1);

        let encrypted = alice.encrypt(b"HELLO", b"VALID_HEADER").unwrap();
        let result = bob.decrypt(&encrypted, b"TAMPERED_HEADER");

        assert_eq!(result, Err(CryptoError::DecryptionFailed));
    }

    #[test]
    fn test_aead_rejects_replayed_frame() {
        let k1 = [0x33u8; 32];
        let k2 = [0x44u8; 32];
        let mut alice = FrameCipher::new(&k1, &k2);
        let mut bob = FrameCipher::new(&k2, &k1);

        let encrypted = alice.encrypt(b"MESSAGE_1", b"AAD").unwrap();
        assert!(bob.decrypt(&encrypted, b"AAD").is_ok());

        // Attacker replays identical encrypted buffer
        let replay_result = bob.decrypt(&encrypted, b"AAD");
        assert_eq!(
            replay_result,
            Err(CryptoError::ReplayDetected {
                received: 0,
                last: 0
            })
        );
    }
}
