use crate::arq::ArqConfig;
use crate::session::{run_simulated_arq_transfer, SessionError, SimulatedAcousticChannel, TransferMetrics};
use sounddrop_crypto::{HandshakeError, HandshakeInitiator, HandshakeResponder, SasCode};
use sounddrop_link::{Frame, FrameType};
use sounddrop_phy::PhyConfig;

#[derive(Debug, thiserror::Error)]
pub enum SecureSessionError {
    #[error("Cryptographic handshake error: {0}")]
    Handshake(#[from] HandshakeError),
    #[error("Acoustic transport session error: {0}")]
    Session(#[from] SessionError),
    #[error("Handshake frame corrupted or dropped")]
    HandshakeDropped,
    #[error("AEAD encryption error: {0}")]
    Cipher(#[from] sounddrop_crypto::CryptoError),
}

/// Result of an end-to-end encrypted acoustic transfer including Short Authentication String (SAS) verification.
#[derive(Debug, Clone)]
pub struct EncryptedTransferOutcome {
    pub decrypted_payload: Vec<u8>,
    pub initiator_sas: SasCode,
    pub responder_sas: SasCode,
    pub sas_verified: bool,
    pub metrics: TransferMetrics,
}

/// Executes an end-to-end encrypted acoustic transfer:
/// 1. Ephemeral X25519 key exchange over physical acoustic frames.
/// 2. Derivation of directional ChaCha20-Poly1305 keys and Short Authentication String (SAS).
/// 3. Verification of SAS codes.
/// 4. Authenticated encryption (AEAD) of the payload with replay counter protection.
/// 5. Reliable multi-frame ARQ transmission over the acoustic channel.
/// 6. Decryption and Poly1305 authentication at the receiver.
pub fn run_simulated_encrypted_transfer(
    plaintext: &[u8],
    phy_config: PhyConfig,
    arq_config: ArqConfig,
    channel: &SimulatedAcousticChannel,
) -> Result<EncryptedTransferOutcome, SecureSessionError> {
    // ----------------------------------------------------
    // PHASE 1: ACOUSTIC X25519 CRYPTOGRAPHIC HANDSHAKE
    // ----------------------------------------------------
    let alice_init = HandshakeInitiator::new()?;
    let alice_pk = alice_init.public_key_bytes();

    // Alice sends HandshakeInit frame carrying Alice's public key (32 bytes)
    let init_frame = Frame {
        frame_type: FrameType::HandshakeInit,
        seq_num: 0,
        payload: alice_pk.to_vec(),
    };

    let mut alice_init_opt = Some(alice_init);
    let mut bob_state_opt: Option<(sounddrop_crypto::SecureSession, [u8; 32])> = None;
    let mut alice_session_opt = None;

    let mut attempts = 0;
    while attempts <= arq_config.max_retries {
        attempts += 1;

        // Alice sends HandshakeInit
        let rx_init = channel
            .exchange_frame(&init_frame, false)
            .map_err(SecureSessionError::Session)?;

        if let Some(rx_init_frame) = rx_init {
            if rx_init_frame.payload.len() == 32 {
                let mut alice_pk_received = [0u8; 32];
                alice_pk_received.copy_from_slice(&rx_init_frame.payload);

                if bob_state_opt.is_none() {
                    let (b_session, b_pk) = HandshakeResponder::respond(&alice_pk_received)?;
                    bob_state_opt = Some((b_session, b_pk));
                }
            }
        }

        // If Bob has received Alice's init and derived his session, Bob responds
        if let Some((_, bob_pk)) = &bob_state_opt {
            let resp_frame = Frame {
                frame_type: FrameType::HandshakeResp,
                seq_num: 0,
                payload: bob_pk.to_vec(),
            };

            let rx_resp = channel
                .exchange_frame(&resp_frame, true)
                .map_err(SecureSessionError::Session)?;

            if let Some(rx_resp_frame) = rx_resp {
                if rx_resp_frame.payload.len() == 32 {
                    let mut bob_pk_received = [0u8; 32];
                    bob_pk_received.copy_from_slice(&rx_resp_frame.payload);

                    if let Some(init) = alice_init_opt.take() {
                        let a_session = init.complete(&bob_pk_received)?;
                        alice_session_opt = Some(a_session);
                        break;
                    }
                }
            }
        }
    }

    let (mut alice_session, mut bob_session) = match (alice_session_opt, bob_state_opt) {
        (Some(a), Some((b, _))) => (a, b),
        _ => return Err(SecureSessionError::HandshakeDropped),
    };

    let initiator_sas = alice_session.sas.clone();
    let responder_sas = bob_session.sas.clone();
    let sas_verified = initiator_sas == responder_sas;

    // ----------------------------------------------------
    // PHASE 2: AEAD ENCRYPTION (ChaCha20-Poly1305)
    // ----------------------------------------------------
    let aad = b"SoundDrop-AEAD-Payload-v1";
    let encrypted_ciphertext = alice_session.cipher.encrypt(plaintext, aad)?;

    // ----------------------------------------------------
    // PHASE 3: RELIABLE ARQ MULTI-FRAME TRANSPORT
    // ----------------------------------------------------
    let (received_ciphertext, metrics) = run_simulated_arq_transfer(
        &encrypted_ciphertext,
        phy_config,
        arq_config,
        channel,
    )?;

    // ----------------------------------------------------
    // PHASE 4: AEAD AUTHENTICATION & DECRYPTION
    // ----------------------------------------------------
    let decrypted_payload = bob_session.cipher.decrypt(&received_ciphertext, aad)?;

    Ok(EncryptedTransferOutcome {
        decrypted_payload,
        initiator_sas,
        responder_sas,
        sas_verified,
        metrics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_end_to_end_encrypted_acoustic_transfer() {
        let config = PhyConfig::audible_robust_48k();
        let channel = SimulatedAcousticChannel::new(config.clone(), 0.0, 0.0, 25.0);
        let arq_cfg = ArqConfig::default();

        let secret_data = b"CONFIDENTIAL_PAYLOAD_PROTECTED_BY_X25519_AND_CHACHA20_POLY1305";

        let outcome = run_simulated_encrypted_transfer(secret_data, config, arq_cfg, &channel)
            .expect("Encrypted acoustic transfer failed");

        assert_eq!(outcome.decrypted_payload, secret_data);
        assert!(outcome.sas_verified);
        assert_eq!(outcome.initiator_sas.pin, outcome.responder_sas.pin);
        assert_eq!(outcome.initiator_sas.words, outcome.responder_sas.words);
        assert!(outcome.metrics.total_frames >= 2);
    }
}
