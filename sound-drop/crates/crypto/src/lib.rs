//! Cryptographic primitives for Sound Drop v2
//! Compliant with Section 4.3 & 4.4:
//! - Ephemeral X25519 Key Exchange
//! - HKDF-SHA256 Session Key Derivation
//! - ChaCha20-Poly1305 AEAD with frame counter nonce and header AAD
//! - SAS (Short Authentication String) generation (4 to 6 digits)
//! - Argon2id derivation for broadcast / pre-shared diode secret

use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use thiserror::Error;
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Encryption failed")]
    EncryptionFailed,
    #[error("Decryption failed / authentication tag mismatch")]
    DecryptionFailed,
    #[error("Invalid key length")]
    InvalidKeyLength,
    #[error("Argon2 key derivation error: {0}")]
    Argon2Error(String),
}

/// Ephemeral X25519 key pair for acoustic handshake
pub struct EphemeralKeyPair {
    secret: StaticSecret,
    public: PublicKey,
}

impl EphemeralKeyPair {
    pub fn generate() -> Self {
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        let secret = StaticSecret::from(seed);
        let public = PublicKey::from(&secret);
        Self { secret, public }
    }

    pub fn public_key(&self) -> PublicKey {
        self.public
    }

    pub fn public_bytes(&self) -> [u8; 32] {
        *self.public.as_bytes()
    }

    /// Compute Diffie-Hellman shared secret
    pub fn diffie_hellman(&self, peer_public_bytes: &[u8; 32]) -> [u8; 32] {
        let peer_pub = PublicKey::from(*peer_public_bytes);
        let shared = self.secret.diffie_hellman(&peer_pub);
        *shared.as_bytes()
    }
}

/// Derive a 32-byte session key from Diffie-Hellman secret using HKDF-SHA256
pub fn derive_session_key(shared_secret: &[u8; 32], salt: Option<&[u8]>, session_id: u16) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(salt, shared_secret);
    let mut session_key = [0u8; 32];
    let info = format!("sounddrop-v2-session-{:04x}", session_id);
    hk.expand(info.as_bytes(), &mut session_key)
        .expect("32 bytes is valid length for HKDF-SHA256");
    session_key
}

/// Compute SAS (Short Authentication String) from handshake transcript
/// Returns a 6-digit number formatted as a string (e.g. "849201")
pub fn compute_sas(
    initiator_pub: &[u8; 32],
    responder_pub: &[u8; 32],
    session_id: u16,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"SOUNDDROP-V2-SAS-TRANSCRIPT");
    hasher.update(&session_id.to_be_bytes());
    // Lexicographically sort public keys so both peers produce identical SAS regardless of who calls it
    if initiator_pub < responder_pub {
        hasher.update(initiator_pub);
        hasher.update(responder_pub);
    } else {
        hasher.update(responder_pub);
        hasher.update(initiator_pub);
    }

    let hash = hasher.finalize();
    // Derive a 6-digit code (100000 - 999999)
    let num = u32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]);
    let sas_code = 100_000 + (num % 900_000);
    format!("{:06}", sas_code)
}

/// Derive pre-shared key for Broadcast / Hardware Diode mode using Argon2id
pub fn derive_broadcast_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], CryptoError> {
    let mut output_key = [0u8; 32];
    let argon2 = Argon2::default();
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut output_key)
        .map_err(|e| CryptoError::Argon2Error(e.to_string()))?;
    Ok(output_key)
}

/// Encrypt frame payload with ChaCha20-Poly1305 AEAD
/// Nonce is formed from 64-bit frame sequence counter
/// AAD is the unencrypted frame header
pub fn encrypt_frame(
    key: &[u8; 32],
    frame_counter: u64,
    aad: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));

    // 96-bit (12-byte) nonce: 4 bytes zero + 8 bytes frame_counter
    let mut nonce_bytes = [0u8; 12];
    nonce_bytes[4..12].copy_from_slice(&frame_counter.to_be_bytes());
    let nonce = Nonce::from_slice(&nonce_bytes);

    let payload = Payload {
        msg: plaintext,
        aad,
    };

    cipher
        .encrypt(nonce, payload)
        .map_err(|_| CryptoError::EncryptionFailed)
}

/// Decrypt frame payload with ChaCha20-Poly1305 AEAD
pub fn decrypt_frame(
    key: &[u8; 32],
    frame_counter: u64,
    aad: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));

    let mut nonce_bytes = [0u8; 12];
    nonce_bytes[4..12].copy_from_slice(&frame_counter.to_be_bytes());
    let nonce = Nonce::from_slice(&nonce_bytes);

    let payload = Payload {
        msg: ciphertext,
        aad,
    };

    cipher
        .decrypt(nonce, payload)
        .map_err(|_| CryptoError::DecryptionFailed)
}

/// Compute 4-byte truncated recipient hash from public key: SHA-256(pub_key)[0..4]
pub fn compute_recipient_hash(public_key_bytes: &[u8; 32]) -> [u8; 4] {
    let mut hasher = Sha256::new();
    hasher.update(b"SOUNDDROP-V2-RECIPIENT-HASH");
    hasher.update(public_key_bytes);
    let hash = hasher.finalize();
    let mut out = [0u8; 4];
    out.copy_from_slice(&hash[0..4]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_recipient_hash() {
        let pub_key = [0x42u8; 32];
        let h1 = compute_recipient_hash(&pub_key);
        let h2 = compute_recipient_hash(&pub_key);
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 4);

        let pub_key_different = [0x43u8; 32];
        let h3 = compute_recipient_hash(&pub_key_different);
        assert_ne!(h1, h3);
    }
}
