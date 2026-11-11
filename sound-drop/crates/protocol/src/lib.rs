//! Protocol frames, sequencing, CRC-16, ACK bitmap, and Reed-Solomon erasure coding.
//! Compliant with Section 4.1 & 4.4:
//! - Frame: [chirp preamble][header][payload][CRC-16][FEC erasure parity]
//! - Header: version (1B), session_id (2B), packet_type (1B), seq_num (2B), total_seq (2B) = 8 bytes
//! - CRC-16/IBM-3740 integrity check
//! - Bidirectional Selective ACK bitmap
//! - Broadcast Reed-Solomon erasure coding (30-50% redundancy)

use crc::{Crc, CRC_16_IBM_3740};
use reed_solomon_erasure::galois_8::ReedSolomon;
use thiserror::Error;

pub const PROTOCOL_VERSION: u8 = 2;
pub const CRC16: Crc<u16> = Crc::<u16>::new(&CRC_16_IBM_3740);

#[derive(Error, Debug, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("Frame truncated, minimum length is 10 bytes")]
    FrameTooShort,
    #[error("Unsupported protocol version: {0}")]
    UnsupportedVersion(u8),
    #[error("CRC-16 mismatch: expected 0x{expected:04x}, calculated 0x{calculated:04x}")]
    CrcMismatch { expected: u16, calculated: u16 },
    #[error("Reed-Solomon erasure error: {0}")]
    ErasureError(String),
    #[error("Not enough shards to reconstruct data ({received}/{needed})")]
    NotEnoughShards { received: usize, needed: usize },
    #[error("Relay TTL expired (hop count exceeded)")]
    TtlExpired,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameType {
    Offer = 1,
    Answer = 2,
    Data = 3,
    Ack = 4,
    Relay = 5,
}

impl TryFrom<u8> for FrameType {
    type Error = ProtocolError;

    fn try_from(val: u8) -> Result<Self, Self::Error> {
        match val {
            1 => Ok(FrameType::Offer),
            2 => Ok(FrameType::Answer),
            3 => Ok(FrameType::Data),
            4 => Ok(FrameType::Ack),
            5 => Ok(FrameType::Relay),
            _ => Err(ProtocolError::FrameTooShort),
        }
    }
}

/// 8-byte Frame Header
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrameHeader {
    pub version: u8,
    pub session_id: u16,
    pub frame_type: FrameType,
    pub seq_num: u16,
    pub total_seq: u16,
}

impl FrameHeader {
    pub fn new(session_id: u16, frame_type: FrameType, seq_num: u16, total_seq: u16) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            session_id,
            frame_type,
            seq_num,
            total_seq,
        }
    }

    pub fn serialize(&self) -> [u8; 8] {
        let mut bytes = [0u8; 8];
        bytes[0] = self.version;
        bytes[1..3].copy_from_slice(&self.session_id.to_be_bytes());
        bytes[3] = self.frame_type as u8;
        bytes[4..6].copy_from_slice(&self.seq_num.to_be_bytes());
        bytes[6..8].copy_from_slice(&self.total_seq.to_be_bytes());
        bytes
    }

    pub fn deserialize(bytes: &[u8; 8]) -> Result<Self, ProtocolError> {
        if bytes[0] != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion(bytes[0]));
        }
        let session_id = u16::from_be_bytes([bytes[1], bytes[2]]);
        let frame_type = FrameType::try_from(bytes[3])?;
        let seq_num = u16::from_be_bytes([bytes[4], bytes[5]]);
        let total_seq = u16::from_be_bytes([bytes[6], bytes[7]]);

        Ok(Self {
            version: bytes[0],
            session_id,
            frame_type,
            seq_num,
            total_seq,
        })
    }
}

/// A complete protocol frame: Header (8B) + Payload + CRC-16 (2B)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame {
    pub header: FrameHeader,
    pub payload: Vec<u8>,
}

impl Frame {
    pub fn new(header: FrameHeader, payload: Vec<u8>) -> Self {
        Self { header, payload }
    }

    /// Serialize frame into bytes with CRC-16 appended at the end
    pub fn serialize(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(8 + self.payload.len() + 2);
        buf.extend_from_slice(&self.header.serialize());
        buf.extend_from_slice(&self.payload);

        let checksum = CRC16.checksum(&buf);
        buf.extend_from_slice(&checksum.to_be_bytes());
        buf
    }

    /// Deserialize frame bytes and verify CRC-16
    pub fn deserialize(buf: &[u8]) -> Result<Self, ProtocolError> {
        if buf.len() < 10 {
            return Err(ProtocolError::FrameTooShort);
        }

        let data_len = buf.len() - 2;
        let expected_crc = u16::from_be_bytes([buf[data_len], buf[data_len + 1]]);
        let calculated_crc = CRC16.checksum(&buf[..data_len]);

        if expected_crc != calculated_crc {
            return Err(ProtocolError::CrcMismatch {
                expected: expected_crc,
                calculated: calculated_crc,
            });
        }

        let mut header_bytes = [0u8; 8];
        header_bytes.copy_from_slice(&buf[0..8]);
        let header = FrameHeader::deserialize(&header_bytes)?;
        let payload = buf[8..data_len].to_vec();

        Ok(Self { header, payload })
    }
}

/// Bidirectional selective ACK bitmap
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AckBitmap {
    pub session_id: u16,
    pub base_seq: u16,
    pub bitmap: u64, // 64-bit window of received frames
}

impl AckBitmap {
    pub fn new(session_id: u16, base_seq: u16) -> Self {
        Self {
            session_id,
            base_seq,
            bitmap: 0,
        }
    }

    pub fn mark_received(&mut self, seq_num: u16) {
        if seq_num >= self.base_seq && seq_num < self.base_seq + 64 {
            let offset = (seq_num - self.base_seq) as u64;
            self.bitmap |= 1u64 << offset;
        }
    }

    pub fn is_received(&self, seq_num: u16) -> bool {
        if seq_num >= self.base_seq && seq_num < self.base_seq + 64 {
            let offset = (seq_num - self.base_seq) as u64;
            (self.bitmap & (1u64 << offset)) != 0
        } else {
            false
        }
    }

    pub fn to_bytes(&self) -> [u8; 12] {
        let mut buf = [0u8; 12];
        buf[0..2].copy_from_slice(&self.session_id.to_be_bytes());
        buf[2..4].copy_from_slice(&self.base_seq.to_be_bytes());
        buf[4..12].copy_from_slice(&self.bitmap.to_be_bytes());
        buf
    }

    pub fn from_bytes(buf: &[u8; 12]) -> Self {
        let session_id = u16::from_be_bytes([buf[0], buf[1]]);
        let base_seq = u16::from_be_bytes([buf[2], buf[3]]);
        let bitmap = u64::from_be_bytes(buf[4..12].try_into().unwrap());
        Self {
            session_id,
            base_seq,
            bitmap,
        }
    }
}

/// Reed-Solomon Erasure Coder for broadcast / simplex transmission (Section 4.4)
/// Provides 30% to 50% redundancy so any k out of n shards suffice to reconstruct data.
pub struct ErasureCoder {
    data_shards: usize,
    parity_shards: usize,
    rs: ReedSolomon,
}

impl ErasureCoder {
    pub fn new(data_shards: usize, parity_shards: usize) -> Result<Self, ProtocolError> {
        let rs = ReedSolomon::new(data_shards, parity_shards)
            .map_err(|e| ProtocolError::ErasureError(format!("{:?}", e)))?;
        Ok(Self {
            data_shards,
            parity_shards,
            rs,
        })
    }

    pub fn total_shards(&self) -> usize {
        self.data_shards + self.parity_shards
    }

    /// Encode data into data_shards + parity_shards
    pub fn encode(&self, data: &[u8]) -> Result<Vec<Vec<u8>>, ProtocolError> {
        // Pad data so each shard has equal size
        let shard_size = (data.len() + self.data_shards - 1) / self.data_shards;
        let mut shards: Vec<Vec<u8>> = Vec::with_capacity(self.total_shards());

        for i in 0..self.data_shards {
            let start = i * shard_size;
            let end = (start + shard_size).min(data.len());
            let mut shard = vec![0u8; shard_size];
            if start < data.len() {
                shard[..end - start].copy_from_slice(&data[start..end]);
            }
            shards.push(shard);
        }

        for _ in 0..self.parity_shards {
            shards.push(vec![0u8; shard_size]);
        }

        self.rs
            .encode(&mut shards)
            .map_err(|e| ProtocolError::ErasureError(format!("{:?}", e)))?;

        Ok(shards)
    }

    /// Reconstruct data from received shards (Option<Vec<u8>> where None indicates an erasure)
    pub fn reconstruct(
        &self,
        shards: &mut [Option<Vec<u8>>],
        original_len: usize,
    ) -> Result<Vec<u8>, ProtocolError> {
        let present = shards.iter().filter(|s| s.is_some()).count();
        if present < self.data_shards {
            return Err(ProtocolError::NotEnoughShards {
                received: present,
                needed: self.data_shards,
            });
        }

        self.rs
            .reconstruct(shards)
            .map_err(|e| ProtocolError::ErasureError(format!("{:?}", e)))?;

        let mut output = Vec::with_capacity(original_len);
        for i in 0..self.data_shards {
            if let Some(ref shard) = shards[i] {
                output.extend_from_slice(shard);
            }
        }
        output.truncate(original_len);
        Ok(output)
    }
}

pub mod relay;
pub use relay::{RelayError, RelayHeader, RelayPacket, StoreAndForwardQueue};

/// Multi-hop store-and-forward relay envelope (Section 4.6 & Section 3 Architecture Native)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RelayEnvelope {
    pub ttl: u8,
    pub recipient_hash: [u8; 4],
    pub origin_hash: [u8; 4],
    pub inner_payload: Vec<u8>,
}

impl RelayEnvelope {
    pub fn new(ttl: u8, recipient_hash: [u8; 4], origin_hash: [u8; 4], inner_payload: Vec<u8>) -> Self {
        Self {
            ttl,
            recipient_hash,
            origin_hash,
            inner_payload,
        }
    }

    /// Decrement TTL on hop. Returns error if expired.
    pub fn hop(&mut self) -> Result<u8, ProtocolError> {
        if self.ttl == 0 {
            return Err(ProtocolError::TtlExpired);
        }
        self.ttl -= 1;
        if self.ttl == 0 {
            return Err(ProtocolError::TtlExpired);
        }
        Ok(self.ttl)
    }

    /// Serialize relay envelope into bytes: [ttl: 1B][recipient_hash: 4B][origin_hash: 4B][payload]
    pub fn serialize(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(1 + 4 + 4 + self.inner_payload.len());
        buf.push(self.ttl);
        buf.extend_from_slice(&self.recipient_hash);
        buf.extend_from_slice(&self.origin_hash);
        buf.extend_from_slice(&self.inner_payload);
        buf
    }

    /// Deserialize relay envelope
    pub fn deserialize(bytes: &[u8]) -> Result<Self, ProtocolError> {
        if bytes.len() < 9 {
            return Err(ProtocolError::FrameTooShort);
        }
        let ttl = bytes[0];
        let mut recipient_hash = [0u8; 4];
        recipient_hash.copy_from_slice(&bytes[1..5]);
        let mut origin_hash = [0u8; 4];
        origin_hash.copy_from_slice(&bytes[5..9]);
        let inner_payload = bytes[9..].to_vec();

        Ok(Self {
            ttl,
            recipient_hash,
            origin_hash,
            inner_payload,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_relay_envelope_serialization_and_hop() {
        let recipient_hash = [0x12, 0x34, 0x56, 0x78];
        let origin_hash = [0xAB, 0xCD, 0xEF, 0x01];
        let payload = b"secret-opaque-e2ee-payload".to_vec();

        let mut envelope = RelayEnvelope::new(3, recipient_hash, origin_hash, payload.clone());
        let serialized = envelope.serialize();
        assert_eq!(serialized.len(), 1 + 4 + 4 + payload.len());

        let decoded = RelayEnvelope::deserialize(&serialized).expect("deserialization failed");
        assert_eq!(decoded.ttl, 3);
        assert_eq!(decoded.recipient_hash, recipient_hash);
        assert_eq!(decoded.origin_hash, origin_hash);
        assert_eq!(decoded.inner_payload, payload);

        // Hop 1 (3 -> 2)
        assert_eq!(envelope.hop(), Ok(2));
        // Hop 2 (2 -> 1)
        assert_eq!(envelope.hop(), Ok(1));
        // Hop 3 (1 -> 0: expired)
        assert_eq!(envelope.hop(), Err(ProtocolError::TtlExpired));
    }
}

