use crc32fast::Hasher;
use crate::interleaver::{deinterleave, interleave};
use crate::reed_solomon::{ReedSolomonCodec, ReedSolomonError};

pub const FRAME_MAGIC: u8 = 0x53; // 'S'
pub const PROTOCOL_VERSION: u8 = 0x01;
pub const MAX_PAYLOAD_LEN: usize = 32;
pub const DEFAULT_PARITY_LEN: usize = 8;
pub const DEFAULT_INTERLEAVE_DEPTH: usize = 4;

/// Computes CRC-8 (polynomial 0x07) for PHY header validation.
pub fn crc8(byte: u8) -> u8 {
    let mut crc = byte;
    for _ in 0..8 {
        if (crc & 0x80) != 0 {
            crc = (crc << 1) ^ 0x07;
        } else {
            crc <<= 1;
        }
    }
    crc
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameType {
    Data = 0x01,
    Ack = 0x02,
    Nack = 0x03,
    DataEnd = 0x04,
}

impl TryFrom<u8> for FrameType {
    type Error = FrameError;
    fn try_from(val: u8) -> Result<Self, Self::Error> {
        match val {
            0x01 => Ok(FrameType::Data),
            0x02 => Ok(FrameType::Ack),
            0x03 => Ok(FrameType::Nack),
            0x04 => Ok(FrameType::DataEnd),
            other => Err(FrameError::InvalidFrameType(other)),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub frame_type: FrameType,
    pub seq_num: u8,
    pub payload: Vec<u8>,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum FrameError {
    #[error("Payload exceeds maximum size of {0} bytes")]
    PayloadTooLarge(usize),
    #[error("Received data too short to contain a valid frame")]
    TooShort,
    #[error("PHY header CRC-8 mismatch: expected {expected:#04x}, got {calculated:#04x}")]
    PhyHeaderCrcMismatch { expected: u8, calculated: u8 },
    #[error("Invalid magic byte: expected {FRAME_MAGIC:#04x}, got {0:#04x}")]
    InvalidMagic(u8),
    #[error("Unsupported protocol version: {0}")]
    UnsupportedVersion(u8),
    #[error("Invalid frame type: {0}")]
    InvalidFrameType(u8),
    #[error("Payload length mismatch: header says {header}, but available {available}")]
    LengthMismatch { header: usize, available: usize },
    #[error("CRC-32 checksum mismatch: expected {expected:#010x}, calculated {calculated:#010x}")]
    CrcMismatch { expected: u32, calculated: u32 },
    #[error("FEC error: {0}")]
    Fec(#[from] ReedSolomonError),
}

/// Link Layer framing engine handling serialization, CRC-32, Reed-Solomon FEC, and symbol packing.
#[derive(Clone)]
pub struct LinkEngine {
    rs_codec: ReedSolomonCodec,
    interleave_depth: usize,
}

impl Default for LinkEngine {
    fn default() -> Self {
        Self::new(DEFAULT_PARITY_LEN, DEFAULT_INTERLEAVE_DEPTH)
    }
}

impl LinkEngine {
    pub fn new(parity_len: usize, interleave_depth: usize) -> Self {
        Self {
            rs_codec: ReedSolomonCodec::new(parity_len),
            interleave_depth,
        }
    }

    /// Packs a Frame into a sequence of 4-bit M-FSK symbols (each in `0..16`).
    /// Structure:
    /// [PHY Header: 2 bytes (Len, CRC8) -> 4 symbols] + [Interleaved Codeword -> 2 * N symbols]
    pub fn frame_to_symbols(&self, frame: &Frame) -> Result<Vec<u8>, FrameError> {
        if frame.payload.len() > MAX_PAYLOAD_LEN {
            return Err(FrameError::PayloadTooLarge(MAX_PAYLOAD_LEN));
        }

        // 1. Construct raw packet: [Magic, Version, Type, Seq, PayloadLen, Payload, CRC32]
        let mut raw = Vec::with_capacity(5 + frame.payload.len() + 4);
        raw.push(FRAME_MAGIC);
        raw.push(PROTOCOL_VERSION);
        raw.push(frame.frame_type as u8);
        raw.push(frame.seq_num);
        raw.push(frame.payload.len() as u8);
        raw.extend_from_slice(&frame.payload);

        // Calculate CRC-32 over Header + Payload
        let mut hasher = Hasher::new();
        hasher.update(&raw);
        let crc = hasher.finalize();
        raw.extend_from_slice(&crc.to_le_bytes());

        // 2. Reed-Solomon FEC encoding
        let codeword = self.rs_codec.encode(&raw);

        // 3. Matrix Interleaving
        let interleaved = interleave(&codeword, self.interleave_depth);

        // 4. Prepend PHY Header: [interleaved_len (1 byte), crc8(len) (1 byte)]
        let len_byte = interleaved.len() as u8;
        let crc_byte = crc8(len_byte);

        let mut symbols = Vec::with_capacity(4 + interleaved.len() * 2);
        symbols.push((len_byte >> 4) & 0x0F);
        symbols.push(len_byte & 0x0F);
        symbols.push((crc_byte >> 4) & 0x0F);
        symbols.push(crc_byte & 0x0F);

        // 5. Expand interleaved payload into 4-bit symbols
        for b in interleaved {
            symbols.push((b >> 4) & 0x0F);
            symbols.push(b & 0x0F);
        }

        Ok(symbols)
    }

    /// Reconstructs and verifies a Frame from a sequence of 4-bit M-FSK symbols.
    /// Safely ignores any trailing symbols in the buffer beyond the declared frame size.
    /// Returns `(Frame, errors_corrected_by_fec)`.
    pub fn symbols_to_frame(&self, symbols: &[u8]) -> Result<(Frame, usize), FrameError> {
        if symbols.len() < 4 {
            return Err(FrameError::TooShort);
        }

        // 1. Decode PHY Header (first 4 symbols = 2 bytes)
        let len_byte = ((symbols[0] & 0x0F) << 4) | (symbols[1] & 0x0F);
        let expected_crc = ((symbols[2] & 0x0F) << 4) | (symbols[3] & 0x0F);
        let calculated_crc = crc8(len_byte);

        if calculated_crc != expected_crc {
            return Err(FrameError::PhyHeaderCrcMismatch {
                expected: expected_crc,
                calculated: calculated_crc,
            });
        }

        let num_interleaved_bytes = len_byte as usize;
        let total_required_symbols = 4 + num_interleaved_bytes * 2;

        if symbols.len() < total_required_symbols {
            return Err(FrameError::TooShort);
        }

        // 2. Unpack exact number of interleaved bytes (ignore any extra trailing symbols)
        let payload_symbols = &symbols[4..total_required_symbols];
        let mut interleaved = Vec::with_capacity(num_interleaved_bytes);
        for i in 0..num_interleaved_bytes {
            let hi = payload_symbols[i * 2] & 0x0F;
            let lo = payload_symbols[i * 2 + 1] & 0x0F;
            interleaved.push((hi << 4) | lo);
        }

        // 3. De-interleave
        let deinterleaved = deinterleave(&interleaved, num_interleaved_bytes, self.interleave_depth);

        // 4. Reed-Solomon FEC error correction
        let (raw_packet, errors_fixed) = self.rs_codec.decode(&deinterleaved)?;

        if raw_packet.len() < 9 {
            return Err(FrameError::TooShort);
        }

        let magic = raw_packet[0];
        if magic != FRAME_MAGIC {
            return Err(FrameError::InvalidMagic(magic));
        }

        let version = raw_packet[1];
        if version != PROTOCOL_VERSION {
            return Err(FrameError::UnsupportedVersion(version));
        }

        let frame_type = FrameType::try_from(raw_packet[2])?;
        let seq_num = raw_packet[3];
        let payload_len = raw_packet[4] as usize;
        let expected_total_len = 5 + payload_len + 4;

        if raw_packet.len() < expected_total_len {
            return Err(FrameError::LengthMismatch {
                header: payload_len,
                available: raw_packet.len().saturating_sub(9),
            });
        }

        let payload = raw_packet[5..5 + payload_len].to_vec();
        let expected_crc32 = u32::from_le_bytes([
            raw_packet[5 + payload_len],
            raw_packet[5 + payload_len + 1],
            raw_packet[5 + payload_len + 2],
            raw_packet[5 + payload_len + 3],
        ]);

        // 5. Verify CRC-32 integrity
        let mut hasher = Hasher::new();
        hasher.update(&raw_packet[..5 + payload_len]);
        let calculated_crc32 = hasher.finalize();

        if calculated_crc32 != expected_crc32 {
            return Err(FrameError::CrcMismatch {
                expected: expected_crc32,
                calculated: calculated_crc32,
            });
        }

        Ok((
            Frame {
                frame_type,
                seq_num,
                payload,
            },
            errors_fixed,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_frame_encode_decode_clean() {
        let engine = LinkEngine::default();
        let frame = Frame {
            frame_type: FrameType::Data,
            seq_num: 42,
            payload: b"HELLO_SOUNDDROP".to_vec(),
        };

        let symbols = engine.frame_to_symbols(&frame).expect("Encoding must succeed");
        let (decoded, errors) = engine.symbols_to_frame(&symbols).expect("Decoding must succeed");

        assert_eq!(decoded, frame);
        assert_eq!(errors, 0);
    }

    #[test]
    fn test_frame_ignores_trailing_garbage_symbols() {
        let engine = LinkEngine::default();
        let frame = Frame {
            frame_type: FrameType::Data,
            seq_num: 7,
            payload: b"TEST_PADDING_IS_IGNORED".to_vec(),
        };

        let mut symbols = engine.frame_to_symbols(&frame).unwrap();

        // Append 50 random garbage symbols (simulating ambient room noise or trailing silence)
        symbols.extend(vec![0, 3, 5, 12, 15, 1, 8, 9, 2, 4]);

        let (decoded, errors) = engine.symbols_to_frame(&symbols)
            .expect("Should decode cleanly despite trailing noise symbols");

        assert_eq!(decoded, frame);
        assert_eq!(errors, 0);
    }

    #[test]
    fn test_frame_fec_recovery_under_symbol_corruption() {
        let engine = LinkEngine::default();
        let frame = Frame {
            frame_type: FrameType::Data,
            seq_num: 99,
            payload: b"RESILIENT_PAYLOAD".to_vec(),
        };

        let mut symbols = engine.frame_to_symbols(&frame).unwrap();

        // Corrupt 3 symbols inside the payload block (symbols[4..])
        symbols[6] = (symbols[6] + 1) % 16;
        symbols[14] = (symbols[14] + 5) % 16;
        symbols[22] = (symbols[22] + 3) % 16;

        let (decoded, errors) = engine.symbols_to_frame(&symbols)
            .expect("FEC must recover corrupted frame");

        assert_eq!(decoded, frame);
        assert!(errors > 0, "Errors should have been fixed by RS codec");
    }

    #[test]
    fn test_frame_tamper_rejected_by_crc() {
        let engine = LinkEngine::default();
        let frame = Frame {
            frame_type: FrameType::Data,
            seq_num: 1,
            payload: b"DATA".to_vec(),
        };

        let mut symbols = engine.frame_to_symbols(&frame).unwrap();

        // Massively corrupt symbols to exceed RS capacity
        for i in 4..24 {
            symbols[i] ^= 0x0F;
        }

        let result = engine.symbols_to_frame(&symbols);
        assert!(result.is_err(), "Massively corrupted symbols must be rejected");
    }
}
