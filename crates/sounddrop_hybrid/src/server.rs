use crate::protocol::{read_tcp_frame, write_tcp_frame, ProtocolError, TcpMsgType};
use sounddrop_file::{AssemblyError, ChunkerError, FileAssembler, FileChunk, FileManifest, ManifestError};
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Protocol error: {0}")]
    Protocol(#[from] ProtocolError),
    #[error("Manifest error: {0}")]
    Manifest(#[from] ManifestError),
    #[error("Chunker error: {0}")]
    Chunker(#[from] ChunkerError),
    #[error("File assembly error: {0}")]
    Assembly(#[from] AssemblyError),
    #[error("Authentication failed: invalid auth token or session ID")]
    AuthFailed,
    #[error("Connection timed out waiting for peer")]
    Timeout,
    #[error("Unexpected message: expected {expected:?}, got {got:?}")]
    UnexpectedMessage { expected: TcpMsgType, got: TcpMsgType },
}

pub struct HybridServerOutcome {
    pub file_name: String,
    pub file_size: u64,
    pub total_chunks: u32,
    pub output_path: PathBuf,
}

pub struct HybridTcpServer {
    listener: TcpListener,
    local_addr: SocketAddr,
}

impl HybridTcpServer {
    /// Binds to a local network address (use port 0 for an OS-assigned ephemeral port).
    pub fn bind(addr: SocketAddr) -> Result<Self, ServerError> {
        let listener = TcpListener::bind(addr)?;
        let local_addr = listener.local_addr()?;
        Ok(Self {
            listener,
            local_addr,
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    /// Accepts an incoming connection from the authenticated peer, ingests the file manifest and chunks,
    /// and finalizes the file assembly on disk.
    pub fn accept_and_receive(
        self,
        expected_auth: [u8; 16],
        output_dir: &Path,
        cache_dir: &Path,
        timeout: Duration,
    ) -> Result<HybridServerOutcome, ServerError> {
        // Non-blocking accept check with timeout
        self.listener.set_nonblocking(true)?;
        let start = std::time::Instant::now();

        let (mut stream, _peer_addr) = loop {
            match self.listener.accept() {
                Ok((s, addr)) => break (s, addr),
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if start.elapsed() >= timeout {
                        return Err(ServerError::Timeout);
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(e) => return Err(ServerError::Io(e)),
            }
        };

        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;

        // 1. Authenticate peer
        let (msg_type, auth_payload) = read_tcp_frame(&mut stream)?;
        if msg_type != TcpMsgType::AuthRequest {
            return Err(ServerError::UnexpectedMessage {
                expected: TcpMsgType::AuthRequest,
                got: msg_type,
            });
        }

        if auth_payload.len() != 16 {
            let _ = write_tcp_frame(&mut stream, TcpMsgType::AuthResponse, &[0x01]);
            return Err(ServerError::AuthFailed);
        }

        let mut received_auth = [0u8; 16];
        received_auth.copy_from_slice(&auth_payload[0..16]);

        // Constant-time comparison
        let auth_match = (0..16).fold(0, |acc, i| acc | (received_auth[i] ^ expected_auth[i])) == 0;

        if !auth_match {
            let _ = write_tcp_frame(&mut stream, TcpMsgType::AuthResponse, &[0x01]);
            return Err(ServerError::AuthFailed);
        }

        // Send OK AuthResponse
        write_tcp_frame(&mut stream, TcpMsgType::AuthResponse, &[0x00])?;

        // 2. Receive FileManifest
        let (msg_type, manifest_bytes) = read_tcp_frame(&mut stream)?;
        if msg_type != TcpMsgType::FileManifest {
            return Err(ServerError::UnexpectedMessage {
                expected: TcpMsgType::FileManifest,
                got: msg_type,
            });
        }

        let manifest = FileManifest::from_bytes(&manifest_bytes)?;
        let file_name = manifest.file_name.clone();
        let file_size = manifest.file_size;
        let total_chunks = manifest.total_chunks;

        let mut assembler = FileAssembler::new(manifest, output_dir, cache_dir)?;

        // 3. Receive FileChunks
        loop {
            let (m_type, chunk_data) = read_tcp_frame(&mut stream)?;
            match m_type {
                TcpMsgType::FileChunk => {
                    let chunk = FileChunk::from_bytes(&chunk_data)?;
                    assembler.ingest_chunk(&chunk)?;
                }
                TcpMsgType::TransferComplete => {
                    break;
                }
                other => {
                    return Err(ServerError::UnexpectedMessage {
                        expected: TcpMsgType::FileChunk,
                        got: other,
                    });
                }
            }
        }

        // 4. Finalize file assembly
        let output_path = assembler.finalize()?;

        Ok(HybridServerOutcome {
            file_name,
            file_size,
            total_chunks,
            output_path,
        })
    }
}
