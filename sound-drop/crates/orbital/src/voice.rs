//! Ultra-low bitrate voice compression framing for satellite transmission.
//! Based on Codec 2 framing specifications (450 bps, 700 bps, 1200 bps).
//! Allows 3-5 second emergency voice messages to fit into 160-280 bytes.

use crate::packet::OrbitalError;

pub const MAX_VOICE_DURATION_MS: u32 = 6000; // 6 seconds maximum for satellite IoT uplink
pub const VOICE_SAMPLE_RATE: u16 = 8000;     // 8 kHz narrowband speech

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Codec2Mode {
    Bps450 = 0,   // ~56 bytes/second (2.25 bytes per 40ms frame)
    Bps700 = 1,   // ~87.5 bytes/second (3.5 bytes per 40ms frame)
    Bps1200 = 2,  // ~150 bytes/second (6 bytes per 40ms frame)
}

impl Codec2Mode {
    pub fn bytes_per_second(&self) -> usize {
        match self {
            Codec2Mode::Bps450 => 56,
            Codec2Mode::Bps700 => 88,
            Codec2Mode::Bps1200 => 150,
        }
    }

    pub fn frame_duration_ms(&self) -> u32 {
        40 // 40 ms per speech analysis frame
    }
}

/// 4-byte Voice Framing Header
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VoiceHeader {
    pub mode: Codec2Mode,
    pub duration_ms: u16,
    pub flags: u8,
}

impl VoiceHeader {
    pub fn new(mode: Codec2Mode, duration_ms: u16) -> Self {
        Self {
            mode,
            duration_ms,
            flags: 0,
        }
    }

    pub fn serialize(&self) -> [u8; 4] {
        let mut buf = [0u8; 4];
        buf[0] = self.mode as u8;
        buf[1..3].copy_from_slice(&self.duration_ms.to_be_bytes());
        buf[3] = self.flags;
        buf
    }

    pub fn deserialize(buf: &[u8; 4]) -> Result<Self, OrbitalError> {
        let mode = match buf[0] {
            0 => Codec2Mode::Bps450,
            1 => Codec2Mode::Bps700,
            2 => Codec2Mode::Bps1200,
            other => return Err(OrbitalError::UnsupportedVersion(other)),
        };
        let duration_ms = u16::from_be_bytes([buf[1], buf[2]]);
        let flags = buf[3];
        Ok(Self {
            mode,
            duration_ms,
            flags,
        })
    }
}

/// Helper for packing and unpacking ultra-low bitrate speech frames
pub struct VoiceMessageCompressor;

impl VoiceMessageCompressor {
    /// Pack raw voice frames into a compact orbital payload
    pub fn pack_voice_payload(
        mode: Codec2Mode,
        duration_ms: u32,
        encoded_frames: &[u8],
    ) -> Result<Vec<u8>, OrbitalError> {
        if duration_ms > MAX_VOICE_DURATION_MS {
            return Err(OrbitalError::VoiceTooLong(duration_ms, MAX_VOICE_DURATION_MS));
        }

        let header = VoiceHeader::new(mode, duration_ms as u16);
        let mut payload = Vec::with_capacity(4 + encoded_frames.len());
        payload.extend_from_slice(&header.serialize());
        payload.extend_from_slice(encoded_frames);
        Ok(payload)
    }

    /// Unpack orbital payload into voice header and raw frame bytes
    pub fn unpack_voice_payload(payload: &[u8]) -> Result<(VoiceHeader, Vec<u8>), OrbitalError> {
        if payload.len() < 4 {
            return Err(OrbitalError::PacketTooShort);
        }
        let mut hdr_bytes = [0u8; 4];
        hdr_bytes.copy_from_slice(&payload[0..4]);
        let header = VoiceHeader::deserialize(&hdr_bytes)?;
        let frames = payload[4..].to_vec();
        Ok((header, frames))
    }

    /// Calculate estimated payload size for a given duration and mode
    pub fn estimate_payload_bytes(mode: Codec2Mode, duration_ms: u32) -> usize {
        let bytes_per_sec = mode.bytes_per_second();
        4 + ((duration_ms as usize * bytes_per_sec) / 1000)
    }
}
