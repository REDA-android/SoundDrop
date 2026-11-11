//! Compact binary framing for SoundDrop Orbital Relay (SOR).
//! Designed for tight satellite IoT budgets (Iridium SBD: 340 bytes max, LoRa Satellite: 51-222 bytes max).

use crc::{Crc, CRC_16_IBM_3740};
use thiserror::Error;

pub const CRC16: Crc<u16> = Crc::<u16>::new(&CRC_16_IBM_3740);
pub const ORBITAL_MAGIC: [u8; 2] = [0x53, 0x4F]; // 'S', 'O' -> SoundDrop Orbital
pub const ORBITAL_VERSION: u8 = 1;
pub const MAX_SATELLITE_PACKET_LEN: usize = 340; // Strict Iridium SBD limit

#[derive(Error, Debug, PartialEq, Eq)]
pub enum OrbitalError {
    #[error("Packet too short, minimum size is 18 bytes")]
    PacketTooShort,
    #[error("Invalid orbital magic bytes, expected 'SO'")]
    InvalidMagic,
    #[error("Unsupported orbital version: {0}")]
    UnsupportedVersion(u8),
    #[error("Packet exceeds maximum satellite limit of {MAX_SATELLITE_PACKET_LEN} bytes (got {0})")]
    PacketTooLarge(usize),
    #[error("Payload length mismatch: header says {header_len}, buffer has {actual_len}")]
    LengthMismatch { header_len: usize, actual_len: usize },
    #[error("CRC-16 checksum mismatch: expected 0x{expected:04x}, calculated 0x{calculated:04x}")]
    CrcMismatch { expected: u16, calculated: u16 },
    #[error("Provider error: {0}")]
    ProviderError(String),
    #[error("No satellite pass available at this moment (next pass in {0} seconds)")]
    NoPassAvailable(u64),
    #[error("Queue is full")]
    QueueFull,
    #[error("Voice duration exceeds maximum satellite limit: {0} ms (max {1} ms)")]
    VoiceTooLong(u32, u32),
    #[error("AT command error: {0}")]
    AtCommandError(String),
}

/// Bit flags for SatellitePacket
pub struct PacketFlags;
impl PacketFlags {
    pub const VOICE: u8 = 0x01;       // 0 = Text, 1 = Compressed Voice (Codec 2)
    pub const PRIORITY: u8 = 0x02;    // 1 = Emergency / SOS priority
    pub const ACK_REQUEST: u8 = 0x04;// 1 = Return ACK receipt via next downlink
    pub const ENCRYPTED: u8 = 0x08;  // 1 = ChaCha20-Poly1305 E2EE
}

/// 16-byte fixed header for satellite transmission
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SatelliteHeader {
    pub magic: [u8; 2],
    pub version: u8,
    pub flags: u8,
    pub msg_id: u16,
    pub recipient_hash: [u8; 4],
    pub timestamp: u32,
    pub payload_len: u16,
}

impl SatelliteHeader {
    pub fn new(flags: u8, msg_id: u16, recipient_hash: [u8; 4], timestamp: u32, payload_len: u16) -> Self {
        Self {
            magic: ORBITAL_MAGIC,
            version: ORBITAL_VERSION,
            flags,
            msg_id,
            recipient_hash,
            timestamp,
            payload_len,
        }
    }

    pub fn serialize(&self) -> [u8; 16] {
        let mut buf = [0u8; 16];
        buf[0..2].copy_from_slice(&self.magic);
        buf[2] = self.version;
        buf[3] = self.flags;
        buf[4..6].copy_from_slice(&self.msg_id.to_be_bytes());
        buf[6..10].copy_from_slice(&self.recipient_hash);
        buf[10..14].copy_from_slice(&self.timestamp.to_be_bytes());
        buf[14..16].copy_from_slice(&self.payload_len.to_be_bytes());
        buf
    }

    pub fn deserialize(buf: &[u8; 16]) -> Result<Self, OrbitalError> {
        if buf[0..2] != ORBITAL_MAGIC {
            return Err(OrbitalError::InvalidMagic);
        }
        if buf[2] != ORBITAL_VERSION {
            return Err(OrbitalError::UnsupportedVersion(buf[2]));
        }
        let flags = buf[3];
        let msg_id = u16::from_be_bytes([buf[4], buf[5]]);
        let mut recipient_hash = [0u8; 4];
        recipient_hash.copy_from_slice(&buf[6..10]);
        let timestamp = u32::from_be_bytes([buf[10], buf[11], buf[12], buf[13]]);
        let payload_len = u16::from_be_bytes([buf[14], buf[15]]);

        Ok(Self {
            magic: ORBITAL_MAGIC,
            version: buf[2],
            flags,
            msg_id,
            recipient_hash,
            timestamp,
            payload_len,
        })
    }
}

/// A complete binary packet for orbital relay
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SatellitePacket {
    pub header: SatelliteHeader,
    pub payload: Vec<u8>,
}

impl SatellitePacket {
    pub fn new(header: SatelliteHeader, payload: Vec<u8>) -> Self {
        Self { header, payload }
    }

    pub fn is_voice(&self) -> bool {
        (self.header.flags & PacketFlags::VOICE) != 0
    }

    pub fn is_priority(&self) -> bool {
        (self.header.flags & PacketFlags::PRIORITY) != 0
    }

    pub fn is_encrypted(&self) -> bool {
        (self.header.flags & PacketFlags::ENCRYPTED) != 0
    }

    /// Serialize into binary bytes with trailing CRC-16
    pub fn serialize(&self) -> Result<Vec<u8>, OrbitalError> {
        let total_len = 16 + self.payload.len() + 2;
        if total_len > MAX_SATELLITE_PACKET_LEN {
            return Err(OrbitalError::PacketTooLarge(total_len));
        }

        let mut buf = Vec::with_capacity(total_len);
        buf.extend_from_slice(&self.header.serialize());
        buf.extend_from_slice(&self.payload);

        let checksum = CRC16.checksum(&buf);
        buf.extend_from_slice(&checksum.to_be_bytes());
        Ok(buf)
    }

    /// Deserialize binary bytes and verify CRC-16
    pub fn deserialize(buf: &[u8]) -> Result<Self, OrbitalError> {
        if buf.len() < 18 {
            return Err(OrbitalError::PacketTooShort);
        }
        if buf.len() > MAX_SATELLITE_PACKET_LEN {
            return Err(OrbitalError::PacketTooLarge(buf.len()));
        }

        let data_len = buf.len() - 2;
        let expected_crc = u16::from_be_bytes([buf[data_len], buf[data_len + 1]]);
        let calculated_crc = CRC16.checksum(&buf[..data_len]);

        if expected_crc != calculated_crc {
            return Err(OrbitalError::CrcMismatch {
                expected: expected_crc,
                calculated: calculated_crc,
            });
        }

        let mut header_bytes = [0u8; 16];
        header_bytes.copy_from_slice(&buf[0..16]);
        let header = SatelliteHeader::deserialize(&header_bytes)?;

        let actual_payload_len = data_len - 16;
        if header.payload_len as usize != actual_payload_len {
            return Err(OrbitalError::LengthMismatch {
                header_len: header.payload_len as usize,
                actual_len: actual_payload_len,
            });
        }

        let payload = buf[16..data_len].to_vec();
        Ok(Self { header, payload })
    }
}
