use crate::assembly::{FileAssembler, AssemblyError};
use crate::chunker::{FileChunk, FileChunker, ChunkerError};
use crate::manifest::{FileManifest, ManifestError};
use sounddrop_crypto::{HandshakeError, HandshakeInitiator, HandshakeResponder, SasCode};
use sounddrop_link::{Frame, FrameType};
use sounddrop_phy::PhyConfig;
use sounddrop_transport::{
    run_simulated_arq_transfer, ArqConfig, SessionError, SimulatedAcousticChannel,
};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[derive(Debug, thiserror::Error)]
pub enum FileTransferError {
    #[error("Chunker error: {0}")]
    Chunker(#[from] ChunkerError),
    #[error("Manifest error: {0}")]
    Manifest(#[from] ManifestError),
    #[error("Assembly error: {0}")]
    Assembly(#[from] AssemblyError),
    #[error("Transport session error: {0}")]
    Session(#[from] SessionError),
    #[error("Cryptographic handshake error: {0}")]
    Handshake(#[from] HandshakeError),
    #[error("AEAD encryption error: {0}")]
    Crypto(#[from] sounddrop_crypto::CryptoError),
    #[error("Handshake negotiation failed")]
    HandshakeFailed,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

/// Statistics and verification details from a completed file transfer.
#[derive(Debug, Clone)]
pub struct FileTransferOutcome {
    pub file_name: String,
    pub file_size: u64,
    pub total_chunks: u32,
    pub chunks_transferred: u32,
    pub root_hash: [u8; 32],
    pub output_path: PathBuf,
    pub sas: SasCode,
    pub sas_verified: bool,
    pub total_duration: Duration,
    pub effective_bps: f32,
}

/// Executes an end-to-end encrypted file transfer over an acoustic channel:
/// 1. Slices file into chunks and builds FileManifest with BLAKE3 hashes.
/// 2. Performs Ephemeral X25519 acoustic handshake and derives SAS and session keys.
/// 3. Transmits encrypted FileManifest over acoustic ARQ.
/// 4. Receiver checks local persistent cache for previously received chunks (resumption).
/// 5. Transmits each missing chunk encrypted with ChaCha20-Poly1305 AEAD.
/// 6. Receiver verifies individual chunk BLAKE3 hashes and writes to .part file.
/// 7. Receiver finalizes: streams BLAKE3 over complete file, moves to output path, cleans up cache.
pub fn run_simulated_file_transfer(
    input_path: &Path,
    output_dir: &Path,
    cache_dir: &Path,
    chunk_size: u32,
    phy_config: PhyConfig,
    arq_config: ArqConfig,
    channel: &SimulatedAcousticChannel,
) -> Result<FileTransferOutcome, FileTransferError> {
    let t_start = Instant::now();

    // 1. Slicing source file
    let (manifest, chunks) = FileChunker::slice_file(input_path, chunk_size)?;

    // 2. Cryptographic acoustic handshake
    let alice_init = HandshakeInitiator::new()?;
    let alice_pk = alice_init.public_key_bytes();

    let init_frame = Frame {
        frame_type: FrameType::HandshakeInit,
        seq_num: 0,
        payload: alice_pk.to_vec(),
    };

    let mut alice_init_opt = Some(alice_init);
    let mut bob_state_opt = None;
    let mut alice_session_opt = None;

    let mut attempts = 0;
    while attempts <= arq_config.max_retries {
        attempts += 1;

        let rx_init = channel
            .exchange_frame(&init_frame, false)
            .map_err(FileTransferError::Session)?;

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

        if let Some((_, bob_pk)) = &bob_state_opt {
            let resp_frame = Frame {
                frame_type: FrameType::HandshakeResp,
                seq_num: 0,
                payload: bob_pk.to_vec(),
            };

            let rx_resp = channel
                .exchange_frame(&resp_frame, true)
                .map_err(FileTransferError::Session)?;

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
        _ => return Err(FileTransferError::HandshakeFailed),
    };

    let sas_verified = alice_session.sas == bob_session.sas;

    // 3. Transmit FileManifest
    let manifest_bytes = manifest.to_bytes();
    let aad = b"SoundDrop-File-Manifest-v1";
    let encrypted_manifest = alice_session.cipher.encrypt(&manifest_bytes, aad)?;

    let (rx_encrypted_manifest, _) = run_simulated_arq_transfer(
        &encrypted_manifest,
        phy_config.clone(),
        arq_config.clone(),
        channel,
    )?;

    let decrypted_manifest_bytes = bob_session.cipher.decrypt(&rx_encrypted_manifest, aad)?;
    let rx_manifest = FileManifest::from_bytes(&decrypted_manifest_bytes)?;

    // 4. Initialize receiver FileAssembler
    let mut assembler = FileAssembler::new(rx_manifest, output_dir, cache_dir)?;

    // 5. Query missing chunks
    let missing = assembler.missing_chunks();
    let chunks_to_send = missing.len() as u32;

    // 6. Transmit missing chunks
    for chunk_idx in missing {
        let chunk = &chunks[chunk_idx as usize];
        let chunk_wire_bytes = chunk.to_bytes();
        let chunk_aad = format!("SoundDrop-Chunk-{}", chunk_idx);
        let encrypted_chunk = alice_session.cipher.encrypt(&chunk_wire_bytes, chunk_aad.as_bytes())?;

        let (rx_encrypted_chunk, _) = run_simulated_arq_transfer(
            &encrypted_chunk,
            phy_config.clone(),
            arq_config.clone(),
            channel,
        )?;

        let decrypted_chunk_bytes = bob_session.cipher.decrypt(&rx_encrypted_chunk, chunk_aad.as_bytes())?;
        let rx_chunk = FileChunk::from_bytes(&decrypted_chunk_bytes)?;

        assembler.ingest_chunk(&rx_chunk)?;
    }

    // 7. Finalize and verify complete file
    let output_path = assembler.finalize()?;
    let total_duration = t_start.elapsed();
    let elapsed_sec = total_duration.as_secs_f32().max(0.001);
    let effective_bps = (manifest.file_size as f32 * 8.0) / elapsed_sec;

    Ok(FileTransferOutcome {
        file_name: manifest.file_name,
        file_size: manifest.file_size,
        total_chunks: manifest.total_chunks,
        chunks_transferred: chunks_to_send,
        root_hash: manifest.root_hash,
        output_path,
        sas: alice_session.sas,
        sas_verified,
        total_duration,
        effective_bps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_end_to_end_file_transfer_over_acoustic_channel() {
        let source_dir = tempdir().unwrap();
        let out_dir = tempdir().unwrap();
        let cache_dir = tempdir().unwrap();

        let test_file = source_dir.path().join("secret_document.txt");
        let payload = b"CONFIDENTIAL AIR-GAP FILE TRANSFER: SoundDrop Milestone 4 verified with BLAKE3 rolling hashes, X25519, and ChaCha20-Poly1305 AEAD!";
        fs::write(&test_file, payload).unwrap();

        let config = PhyConfig::audible_robust_48k();
        let channel = SimulatedAcousticChannel::new(config.clone(), 0.0, 0.0, 30.0);
        let arq_cfg = ArqConfig {
            max_retries: 5,
            timeout_sec: 4.5,
            turnaround_delay_sec: 0.1,
        };

        // Transfer with 32-byte chunks
        let outcome = run_simulated_file_transfer(
            &test_file,
            out_dir.path(),
            cache_dir.path(),
            32,
            config,
            arq_cfg,
            &channel,
        )
        .expect("Acoustic file transfer failed");

        assert_eq!(outcome.file_name, "secret_document.txt");
        assert_eq!(outcome.file_size, payload.len() as u64);
        assert!(outcome.sas_verified);
        assert!(outcome.output_path.exists());

        // Bit-exact verification against original payload
        let restored = fs::read(&outcome.output_path).unwrap();
        assert_eq!(restored, payload);
    }
}
