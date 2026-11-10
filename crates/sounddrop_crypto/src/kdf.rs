use crate::sas::SasCode;

pub const KDF_CTX_INIT_TO_RESP: &str = "SoundDrop-v1-Initiator-To-Responder-Key";
pub const KDF_CTX_RESP_TO_INIT: &str = "SoundDrop-v1-Responder-To-Initiator-Key";
pub const KDF_CTX_SAS: &str = "SoundDrop-v1-SAS-Verification";

/// Symmetric session keys and verification parameters derived from the X25519 handshake.
#[derive(Debug, Clone)]
pub struct SessionKeys {
    pub tx_key: [u8; 32],
    pub rx_key: [u8; 32],
    pub sas: SasCode,
}

/// Derives directional AEAD encryption keys and the SAS verification code.
pub fn derive_session_keys(
    shared_secret: &[u8; 32],
    transcript_hash: &[u8; 32],
    is_initiator: bool,
) -> SessionKeys {
    let mut key_material = Vec::with_capacity(64);
    key_material.extend_from_slice(shared_secret);
    key_material.extend_from_slice(transcript_hash);

    let k_init_to_resp = blake3::derive_key(KDF_CTX_INIT_TO_RESP, &key_material);
    let k_resp_to_init = blake3::derive_key(KDF_CTX_RESP_TO_INIT, &key_material);
    let sas_digest = blake3::derive_key(KDF_CTX_SAS, &key_material);

    let (tx_key, rx_key) = if is_initiator {
        (k_init_to_resp, k_resp_to_init)
    } else {
        (k_resp_to_init, k_init_to_resp)
    };

    let sas = SasCode::from_digest(&sas_digest);

    SessionKeys {
        tx_key,
        rx_key,
        sas,
    }
}

/// Computes the cryptographic transcript hash of the exchanged ephemeral public keys.
pub fn hash_transcript(initiator_pk: &[u8; 32], responder_pk: &[u8; 32]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"SoundDrop-Transcript-v1:");
    hasher.update(initiator_pk);
    hasher.update(responder_pk);
    *hasher.finalize().as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_directional_key_derivation() {
        let shared_secret = [0x99u8; 32];
        let transcript = [0x11u8; 32];

        let alice_keys = derive_session_keys(&shared_secret, &transcript, true);
        let bob_keys = derive_session_keys(&shared_secret, &transcript, false);

        // Alice TX key must equal Bob RX key
        assert_eq!(alice_keys.tx_key, bob_keys.rx_key);
        // Alice RX key must equal Bob TX key
        assert_eq!(alice_keys.rx_key, bob_keys.tx_key);
        // SAS codes on both devices must match perfectly
        assert_eq!(alice_keys.sas, bob_keys.sas);
    }
}
