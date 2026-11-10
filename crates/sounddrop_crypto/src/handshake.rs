use crate::cipher::FrameCipher;
use crate::kdf::{derive_session_keys, hash_transcript};
use crate::sas::SasCode;
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum HandshakeError {
    #[error("RNG error generating ephemeral key: {0}")]
    Rng(String),
    #[error("Invalid public key")]
    InvalidPublicKey,
}

/// An established, end-to-end encrypted session with authenticated cipher and SAS verification.
pub struct SecureSession {
    pub cipher: FrameCipher,
    pub sas: SasCode,
    pub transcript_hash: [u8; 32],
}

/// State of the initiator party in an X25519 acoustic handshake.
pub struct HandshakeInitiator {
    private_key: StaticSecret,
    public_key: PublicKey,
}

impl HandshakeInitiator {
    pub fn new() -> Result<Self, HandshakeError> {
        let mut secret_bytes = [0u8; 32];
        getrandom::getrandom(&mut secret_bytes)
            .map_err(|e| HandshakeError::Rng(e.to_string()))?;

        let private_key = StaticSecret::from(secret_bytes);
        let public_key = PublicKey::from(&private_key);

        Ok(Self {
            private_key,
            public_key,
        })
    }

    /// The 32-byte public key to be transmitted to the responder over acoustic frames.
    pub fn public_key_bytes(&self) -> [u8; 32] {
        *self.public_key.as_bytes()
    }

    /// Completes the handshake upon receiving the responder's 32-byte public key.
    pub fn complete(self, responder_pk_bytes: &[u8; 32]) -> Result<SecureSession, HandshakeError> {
        let responder_pk = PublicKey::from(*responder_pk_bytes);
        let shared_secret = self.private_key.diffie_hellman(&responder_pk);

        let transcript = hash_transcript(self.public_key.as_bytes(), responder_pk.as_bytes());
        let keys = derive_session_keys(shared_secret.as_bytes(), &transcript, true);

        let cipher = FrameCipher::new(&keys.tx_key, &keys.rx_key);

        Ok(SecureSession {
            cipher,
            sas: keys.sas,
            transcript_hash: transcript,
        })
    }
}

/// Responder party in an X25519 acoustic handshake.
pub struct HandshakeResponder;

impl HandshakeResponder {
    /// Responds to the initiator's public key by generating an ephemeral key pair,
    /// returning the established SecureSession and the responder's public key bytes to transmit back.
    pub fn respond(
        initiator_pk_bytes: &[u8; 32],
    ) -> Result<(SecureSession, [u8; 32]), HandshakeError> {
        let mut secret_bytes = [0u8; 32];
        getrandom::getrandom(&mut secret_bytes)
            .map_err(|e| HandshakeError::Rng(e.to_string()))?;

        let private_key = StaticSecret::from(secret_bytes);
        let public_key = PublicKey::from(&private_key);

        let initiator_pk = PublicKey::from(*initiator_pk_bytes);
        let shared_secret = private_key.diffie_hellman(&initiator_pk);

        let transcript = hash_transcript(initiator_pk.as_bytes(), public_key.as_bytes());
        let keys = derive_session_keys(shared_secret.as_bytes(), &transcript, false);

        let cipher = FrameCipher::new(&keys.tx_key, &keys.rx_key);
        let responder_pk_bytes = *public_key.as_bytes();

        Ok((
            SecureSession {
                cipher,
                sas: keys.sas,
                transcript_hash: transcript,
            },
            responder_pk_bytes,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_x25519_handshake_and_secure_channel() {
        // Alice initiates
        let alice_init = HandshakeInitiator::new().unwrap();
        let alice_pk = alice_init.public_key_bytes();

        // Bob responds
        let (mut bob_session, bob_pk) = HandshakeResponder::respond(&alice_pk).unwrap();

        // Alice completes
        let mut alice_session = alice_init.complete(&bob_pk).unwrap();

        // Verify transcripts match
        assert_eq!(alice_session.transcript_hash, bob_session.transcript_hash);

        // Verify SAS match
        assert_eq!(alice_session.sas.pin, bob_session.sas.pin);
        assert_eq!(alice_session.sas.words, bob_session.sas.words);

        // Verify bi-directional encryption
        let alice_to_bob = b"SECRET_FOR_BOB_EYES_ONLY";
        let encrypted_for_bob = alice_session.cipher.encrypt(alice_to_bob, b"META").unwrap();
        let decrypted_by_bob = bob_session.cipher.decrypt(&encrypted_for_bob, b"META").unwrap();
        assert_eq!(decrypted_by_bob, alice_to_bob);

        let bob_to_alice = b"SECRET_REPLY_FROM_BOB";
        let encrypted_for_alice = bob_session.cipher.encrypt(bob_to_alice, b"META2").unwrap();
        let decrypted_by_alice = alice_session.cipher.decrypt(&encrypted_for_alice, b"META2").unwrap();
        assert_eq!(decrypted_by_alice, bob_to_alice);
    }

    #[test]
    fn test_mitm_tamper_detected_by_sas() {
        let alice_init = HandshakeInitiator::new().unwrap();
        let mut intercepted_alice_pk = alice_init.public_key_bytes();
        // Mallory modifies 1 byte of Alice's public key
        intercepted_alice_pk[0] ^= 0x01;

        let (bob_session, bob_pk) = HandshakeResponder::respond(&intercepted_alice_pk).unwrap();
        let alice_session = alice_init.complete(&bob_pk).unwrap();

        // The SAS codes MUST not match, alerting the users
        assert_ne!(alice_session.sas.pin, bob_session.sas.pin);
        assert_ne!(alice_session.sas.words, bob_session.sas.words);
    }
}
