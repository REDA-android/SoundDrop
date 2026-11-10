use crc32fast::Hasher as Crc32Hasher;
use std::io::{Read, Write};

#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("I/O error on TCP stream: {0}")]
    Io(#[from] std::io::Error),
    #[error("TCP frame corrupted: CRC-32 mismatch (expected {expected:08x}, got {computed:08x})")]
    CrcMismatch { expected: u32, computed: u32 },
    #[error("Invalid TCP message type: {0}")]
    InvalidMsgType(u8),
    #[error("Frame length exceeds limit ({0} bytes)")]
    FrameTooLarge(usize),
    #[error("Unexpected EOF on TCP stream")]
    UnexpectedEof,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TcpMsgType {
    AuthRequest = 0x01,
    AuthResponse = 0x02,
    FileManifest = 0x03,
    FileChunk = 0x04,
    TransferComplete = 0x05,
}

impl TryFrom<u8> for TcpMsgType {
    type Error = ProtocolError;
    fn try_from(val: u8) -> Result<Self, Self::Error> {
        match val {
            0x01 => Ok(TcpMsgType::AuthRequest),
            0x02 => Ok(TcpMsgType::AuthResponse),
            0x03 => Ok(TcpMsgType::FileManifest),
            0x04 => Ok(TcpMsgType::FileChunk),
            0x05 => Ok(TcpMsgType::TransferComplete),
            other => Err(ProtocolError::InvalidMsgType(other)),
        }
    }
}

const MAX_TCP_FRAME_SIZE: usize = 16 * 1024 * 1024; // 16 MB

/// Writes a framed message over a TCP stream:
/// [LENGTH(4 bytes, BE), MSG_TYPE(1 byte), CRC32(4 bytes, BE), PAYLOAD(N bytes)]
pub fn write_tcp_frame<W: Write>(
    writer: &mut W,
    msg_type: TcpMsgType,
    payload: &[u8],
) -> Result<(), ProtocolError> {
    if payload.len() > MAX_TCP_FRAME_SIZE {
        return Err(ProtocolError::FrameTooLarge(payload.len()));
    }

    let mut hasher = Crc32Hasher::new();
    hasher.update(&[msg_type as u8]);
    hasher.update(payload);
    let crc = hasher.finalize();

    let total_len = (1 + 4 + payload.len()) as u32;
    writer.write_all(&total_len.to_be_bytes())?;
    writer.write_all(&[msg_type as u8])?;
    writer.write_all(&crc.to_be_bytes())?;
    writer.write_all(payload)?;
    writer.flush()?;

    Ok(())
}

/// Reads a framed message from a TCP stream.
pub fn read_tcp_frame<R: Read>(reader: &mut R) -> Result<(TcpMsgType, Vec<u8>), ProtocolError> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err(ProtocolError::UnexpectedEof);
        }
        Err(e) => return Err(ProtocolError::Io(e)),
    }

    let total_len = u32::from_be_bytes(len_buf) as usize;
    if total_len < 5 {
        return Err(ProtocolError::FrameTooLarge(total_len));
    }
    if total_len > MAX_TCP_FRAME_SIZE {
        return Err(ProtocolError::FrameTooLarge(total_len));
    }

    let mut type_buf = [0u8; 1];
    reader.read_exact(&mut type_buf)?;
    let msg_type = TcpMsgType::try_from(type_buf[0])?;

    let mut crc_buf = [0u8; 4];
    reader.read_exact(&mut crc_buf)?;
    let expected_crc = u32::from_be_bytes(crc_buf);

    let payload_len = total_len - 5;
    let mut payload = vec![0u8; payload_len];
    reader.read_exact(&mut payload)?;

    let mut hasher = Crc32Hasher::new();
    hasher.update(&[msg_type as u8]);
    hasher.update(&payload);
    let computed_crc = hasher.finalize();

    if computed_crc != expected_crc {
        return Err(ProtocolError::CrcMismatch {
            expected: expected_crc,
            computed: computed_crc,
        });
    }

    Ok((msg_type, payload))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_tcp_frame_roundtrip() {
        let payload = b"Direct TCP high-speed chunk payload";
        let mut buffer = Vec::new();

        write_tcp_frame(&mut buffer, TcpMsgType::FileChunk, payload).unwrap();

        let mut cursor = Cursor::new(buffer);
        let (msg_type, decoded_payload) = read_tcp_frame(&mut cursor).unwrap();

        assert_eq!(msg_type, TcpMsgType::FileChunk);
        assert_eq!(decoded_payload, payload);
    }
}
