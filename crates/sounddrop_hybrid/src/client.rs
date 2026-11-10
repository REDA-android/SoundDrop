use crate::protocol::{read_tcp_frame, write_tcp_frame, ProtocolError, TcpMsgType};
use sounddrop_file::{FileChunk, FileManifest};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("I/O error connecting or streaming to peer: {0}")]
    Io(#[from] std::io::Error),
    #[error("Protocol error: {0}")]
    Protocol(#[from] ProtocolError),
    #[error("Mutual authentication rejected by peer server")]
    AuthRejected,
    #[error("Unexpected message from peer: expected {expected:?}, got {got:?}")]
    UnexpectedMessage { expected: TcpMsgType, got: TcpMsgType },
}

pub struct HybridTcpClient {
    stream: TcpStream,
}

impl HybridTcpClient {
    /// Connects to the peer's advertised TCP socket with a connection timeout.
    pub fn connect(addr: SocketAddr, timeout: Duration) -> Result<Self, ClientError> {
        let stream = TcpStream::connect_timeout(&addr, timeout)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        Ok(Self { stream })
    }

    /// Performs mutual challenge-response authentication with the peer server.
    pub fn authenticate(&mut self, auth_token: [u8; 16]) -> Result<(), ClientError> {
        write_tcp_frame(&mut self.stream, TcpMsgType::AuthRequest, &auth_token)?;

        let (msg_type, payload) = read_tcp_frame(&mut self.stream)?;
        if msg_type != TcpMsgType::AuthResponse {
            return Err(ClientError::UnexpectedMessage {
                expected: TcpMsgType::AuthResponse,
                got: msg_type,
            });
        }

        if payload.is_empty() || payload[0] != 0x00 {
            return Err(ClientError::AuthRejected);
        }

        Ok(())
    }

    /// Streams the file manifest and all chunks directly over the high-speed TCP socket.
    pub fn send_file(
        &mut self,
        manifest: &FileManifest,
        chunks: &[FileChunk],
    ) -> Result<(), ClientError> {
        // 1. Send FileManifest
        let manifest_bytes = manifest.to_bytes();
        write_tcp_frame(&mut self.stream, TcpMsgType::FileManifest, &manifest_bytes)?;

        // 2. Stream all chunks
        for chunk in chunks {
            let chunk_bytes = chunk.to_bytes();
            write_tcp_frame(&mut self.stream, TcpMsgType::FileChunk, &chunk_bytes)?;
        }

        // 3. Send TransferComplete
        write_tcp_frame(&mut self.stream, TcpMsgType::TransferComplete, &[])?;

        Ok(())
    }
}
