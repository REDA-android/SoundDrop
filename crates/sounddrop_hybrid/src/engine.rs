use crate::bootstrap::{AcousticBootstrapPayload, NetworkEndpoint};
use crate::client::HybridTcpClient;
use crate::server::HybridTcpServer;
use sounddrop_crypto::{HandshakeError, HandshakeInitiator, HandshakeResponder, SasCode};
use sounddrop_file::{
    run_simulated_file_transfer, AssemblyError, ChunkerError, FileChunker, FileTransferError,
    ManifestError,
};
use sounddrop_link::{Frame, FrameType};
use sounddrop_phy::PhyConfig;
use sounddrop_transport::{ArqConfig, SessionError, SimulatedAcousticChannel};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportMode {
    /// High-speed direct Wi-Fi TCP socket transfer bootstrapped by acoustic handshake.
    DirectWifi,
    /// Automatic fallback to pure acoustic sound waves when Wi-Fi is unavailable or blocked.
    AcousticFallback,
    /// Multi-transport handover: partial transmission over Wi-Fi, completed over sound waves.
    HybridHandover,
}

#[derive(Debug, Clone)]
pub struct HybridTransferOutcome {
    pub file_name: String,
    pub file_size: u64,
    pub total_chunks: u32,
    pub root_hash: [u8; 32],
    pub output_path: PathBuf,
    pub sas: SasCode,
    pub sas_verified: bool,
    pub transport_mode: TransportMode,
    pub duration: Duration,
    pub effective_bps: f32,
}

#[derive(Debug, thiserror::Error)]
pub enum HybridError {
    #[error("File chunking error: {0}")]
    Chunker(#[from] ChunkerError),
    #[error("Manifest error: {0}")]
    Manifest(#[from] ManifestError),
    #[error("File assembly error: {0}")]
    Assembly(#[from] AssemblyError),
    #[error("Cryptographic handshake error: {0}")]
    Handshake(#[from] HandshakeError),
    #[error("Acoustic transport session error: {0}")]
    Session(#[from] SessionError),
    #[error("File transfer error: {0}")]
    FileTransfer(#[from] FileTransferError),
    #[error("TCP server error: {0}")]
    Server(#[from] crate::server::ServerError),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Handshake negotiation failed")]
    HandshakeFailed,
}

/// Executes a hybrid acoustic-to-Wi-Fi bootstrap and file transfer session.
///
/// 1. Negotiates ephemeral X25519 acoustic handshake and derives SAS codes.
/// 2. Receiver binds a local high-speed TCP server and advertises endpoint via acoustic `WifiBootstrap` frame.
/// 3. Sender attempts direct TCP connection to receiver:
///    - If successful: Streams all chunks at full network line rate (`TransportMode::DirectWifi`).
///    - If connection fails/blocked: Automatically falls back to acoustic ARQ transport (`TransportMode::AcousticFallback`).
pub fn run_hybrid_transfer(
    input_path: &Path,
    output_dir: &Path,
    cache_dir: &Path,
    chunk_size: u32,
    phy_config: PhyConfig,
    arq_config: ArqConfig,
    acoustic_channel: &SimulatedAcousticChannel,
    simulated_wifi_blocked: bool,
) -> Result<HybridTransferOutcome, HybridError> {
    let t_start = Instant::now();

    // 1. Slicing source file
    let (manifest, chunks) = FileChunker::slice_file(input_path, chunk_size)?;

    // 2. Cryptographic acoustic handshake with ARQ retry resilience
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

        let rx_init = acoustic_channel
            .exchange_frame(&init_frame, false)
            .map_err(HybridError::Session)?;

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

            let rx_resp = acoustic_channel
                .exchange_frame(&resp_frame, true)
                .map_err(HybridError::Session)?;

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

    let (bob_session, _) = bob_state_opt.ok_or(HybridError::HandshakeFailed)?;
    let alice_session = alice_session_opt.ok_or(HybridError::HandshakeFailed)?;
    let sas_verified = alice_session.sas == bob_session.sas;

    // Derive mutual Wi-Fi authentication token from transcript hash
    let mut auth_token = [0u8; 16];
    auth_token.copy_from_slice(&alice_session.transcript_hash[0..16]);

    // 3. Receiver (Bob) binds local TCP server
    let server_bind_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 0);
    let server = HybridTcpServer::bind(server_bind_addr)?;
    let local_server_addr = server.local_addr();

    // Bob advertises endpoint over acoustic WifiBootstrap frame
    let advertised_addr = if simulated_wifi_blocked {
        // Unused loopback port simulating closed/firewalled peer socket
        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 1)
    } else {
        local_server_addr
    };

    let bootstrap_payload = AcousticBootstrapPayload::new(
        NetworkEndpoint::new(advertised_addr.ip(), advertised_addr.port()),
        auth_token,
    );

    let bootstrap_frame = Frame {
        frame_type: FrameType::WifiBootstrap,
        seq_num: 1,
        payload: bootstrap_payload.to_bytes(),
    };

    let mut received_bootstrap_opt = None;
    let mut b_attempts = 0;
    while b_attempts <= arq_config.max_retries {
        b_attempts += 1;
        let rx_bootstrap = acoustic_channel
            .exchange_frame(&bootstrap_frame, true)
            .map_err(HybridError::Session)?;
        if let Some(rx_b) = rx_bootstrap {
            if let Ok(b) = AcousticBootstrapPayload::from_bytes(&rx_b.payload) {
                received_bootstrap_opt = Some(b);
                break;
            }
        }
    }

    let received_bootstrap = received_bootstrap_opt.ok_or(HybridError::HandshakeFailed)?;

    // 4. Sender (Alice) attempts high-speed TCP connection with automatic acoustic fallback
    let target_socket = received_bootstrap.endpoint.to_socket_addr();
    let connect_timeout = Duration::from_millis(500);

    let wifi_transfer_res: Result<PathBuf, String> = (|| {
        let mut client = HybridTcpClient::connect(target_socket, connect_timeout)
            .map_err(|e| format!("TCP connect failed: {}", e))?;

        log::info!("[HYBRID] Direct Wi-Fi connection established to {}", target_socket);

        let out_dir_clone = output_dir.to_path_buf();
        let cache_dir_clone = cache_dir.to_path_buf();
        let server_thread = std::thread::spawn(move || {
            server.accept_and_receive(
                auth_token,
                &out_dir_clone,
                &cache_dir_clone,
                Duration::from_secs(5),
            )
        });

        client.authenticate(auth_token)
            .map_err(|e| format!("Wi-Fi auth failed: {}", e))?;

        client.send_file(&manifest, &chunks)
            .map_err(|e| format!("Wi-Fi send failed: {}", e))?;

        let server_res = server_thread
            .join()
            .map_err(|_| "Server thread panicked".to_string())?
            .map_err(|e| format!("Server receive error: {}", e))?;

        Ok(server_res.output_path)
    })();

    let (output_path, transport_mode) = match wifi_transfer_res {
        Ok(path) => (path, TransportMode::DirectWifi),
        Err(e) => {
            log::warn!(
                "[HYBRID FALLBACK] Direct Wi-Fi unavailable or dropped ({}) - falling back to acoustic ARQ transport.",
                e
            );

            // Fallback to pure acoustic transport
            let acoustic_res = run_simulated_file_transfer(
                input_path,
                output_dir,
                cache_dir,
                chunk_size,
                phy_config,
                arq_config,
                acoustic_channel,
            )?;

            (acoustic_res.output_path, TransportMode::AcousticFallback)
        }
    };

    let duration = t_start.elapsed();
    let elapsed_sec = duration.as_secs_f32().max(0.001);
    let effective_bps = (manifest.file_size as f32 * 8.0) / elapsed_sec;

    Ok(HybridTransferOutcome {
        file_name: manifest.file_name,
        file_size: manifest.file_size,
        total_chunks: manifest.total_chunks,
        root_hash: manifest.root_hash,
        output_path,
        sas: alice_session.sas,
        sas_verified,
        transport_mode,
        duration,
        effective_bps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_hybrid_transfer_direct_wifi_success() {
        let source_dir = tempdir().unwrap();
        let out_dir = tempdir().unwrap();
        let cache_dir = tempdir().unwrap();

        let test_file = source_dir.path().join("high_speed_document.pdf");
        let payload = vec![0x42u8; 8192]; // 8 KB payload
        fs::write(&test_file, &payload).unwrap();

        let config = PhyConfig::audible_robust_48k();
        let channel = SimulatedAcousticChannel::new(config.clone(), 0.0, 0.0, 30.0);
        let arq_cfg = ArqConfig::default();

        let outcome = run_hybrid_transfer(
            &test_file,
            out_dir.path(),
            cache_dir.path(),
            64,
            config,
            arq_cfg,
            &channel,
            false, // Wi-Fi available
        )
        .expect("Hybrid transfer failed");

        assert_eq!(outcome.transport_mode, TransportMode::DirectWifi);
        assert!(outcome.sas_verified);
        assert!(outcome.output_path.exists());

        let restored = fs::read(&outcome.output_path).unwrap();
        assert_eq!(restored, payload);
    }

    #[test]
    fn test_hybrid_transfer_fallback_to_acoustic_when_wifi_blocked() {
        let source_dir = tempdir().unwrap();
        let out_dir = tempdir().unwrap();
        let cache_dir = tempdir().unwrap();

        let test_file = source_dir.path().join("fallback_note.txt");
        let payload = b"Acoustic fallback test: client isolation blocks Wi-Fi, audio transfers the file.";
        fs::write(&test_file, payload).unwrap();

        let config = PhyConfig::audible_robust_48k();
        let channel = SimulatedAcousticChannel::new(config.clone(), 0.0, 0.0, 30.0);
        let arq_cfg = ArqConfig::default();

        let outcome = run_hybrid_transfer(
            &test_file,
            out_dir.path(),
            cache_dir.path(),
            32,
            config,
            arq_cfg,
            &channel,
            true, // Wi-Fi blocked / unreachable
        )
        .expect("Acoustic fallback transfer failed");

        assert_eq!(outcome.transport_mode, TransportMode::AcousticFallback);
        assert!(outcome.sas_verified);
        assert!(outcome.output_path.exists());

        let restored = fs::read(&outcome.output_path).unwrap();
        assert_eq!(restored, payload);
    }
}
