//! Payload handling for Sound Drop v2
//! Compliant with Section 2, 4.1, 4.3, 5.1:
//! - Real BlurHash encoding & decoding (20-30 chars) via `blurhash` crate
//! - zstd compression (strictly BEFORE encryption)
//! - Packet 0 metadata formatting
//! - Transfer duration estimator

use blurhash::{decode as bh_decode, encode as bh_encode};
use std::io::{Read, Write};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PayloadError {
    #[error("zstd compression error: {0}")]
    CompressionError(#[from] std::io::Error),
    #[error("BlurHash error: {0}")]
    BlurHashError(String),
    #[error("Invalid packet 0 metadata: {0}")]
    MetadataError(String),
}

/// Packet 0 metadata for preview and file transfer initiation
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Packet0Metadata {
    pub file_name: String,
    pub total_bytes: u32,
    pub is_image: bool,
    /// Real BlurHash string (20-30 chars, empty if not image)
    pub blurhash: String,
}

impl Packet0Metadata {
    pub fn new(file_name: String, total_bytes: u32, blurhash: Option<String>) -> Self {
        let is_image = blurhash.is_some();
        Self {
            file_name,
            total_bytes,
            is_image,
            blurhash: blurhash.unwrap_or_default(),
        }
    }

    /// Serialize Packet 0 to binary bytes
    /// Format: [flags: 1B][total_bytes: 4B BE][name_len: 2B BE][name][bh_len: 1B][blurhash]
    pub fn serialize(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        let flags = if self.is_image { 0x01 } else { 0x00 };
        buf.push(flags);
        buf.extend_from_slice(&self.total_bytes.to_be_bytes());

        let name_bytes = self.file_name.as_bytes();
        let name_len = (name_bytes.len() as u16).to_be_bytes();
        buf.extend_from_slice(&name_len);
        buf.extend_from_slice(name_bytes);

        let bh_bytes = self.blurhash.as_bytes();
        buf.push(bh_bytes.len() as u8);
        buf.extend_from_slice(bh_bytes);

        buf
    }

    /// Deserialize Packet 0 from binary bytes
    pub fn deserialize(buf: &[u8]) -> Result<Self, PayloadError> {
        if buf.len() < 8 {
            return Err(PayloadError::MetadataError("Buffer too short".into()));
        }
        let is_image = (buf[0] & 0x01) != 0;
        let total_bytes = u32::from_be_bytes([buf[1], buf[2], buf[3], buf[4]]);
        let name_len = u16::from_be_bytes([buf[5], buf[6]]) as usize;

        let mut offset = 7;
        if buf.len() < offset + name_len + 1 {
            return Err(PayloadError::MetadataError("Buffer truncated at filename".into()));
        }
        let file_name = String::from_utf8_lossy(&buf[offset..offset + name_len]).to_string();
        offset += name_len;

        let bh_len = buf[offset] as usize;
        offset += 1;
        if buf.len() < offset + bh_len {
            return Err(PayloadError::MetadataError("Buffer truncated at blurhash".into()));
        }
        let blurhash = String::from_utf8_lossy(&buf[offset..offset + bh_len]).to_string();

        Ok(Self {
            file_name,
            total_bytes,
            is_image,
            blurhash,
        })
    }
}

/// Generate a real BlurHash (4x3 components -> ~28 chars) from RGBA pixels
pub fn generate_blurhash_rgba(
    width: u32,
    height: u32,
    rgba_pixels: &[u8],
) -> Result<String, PayloadError> {
    if rgba_pixels.len() != (width * height * 4) as usize {
        return Err(PayloadError::BlurHashError("Pixel buffer size mismatch".into()));
    }

    // blurhash crate expects 4 bytes per pixel (RGBA)
    bh_encode(4, 3, width, height, rgba_pixels)
        .map_err(|e| PayloadError::BlurHashError(format!("{:?}", e)))
}

/// Decode a BlurHash string into RGBA pixels (4 bytes per pixel) for preview rendering
pub fn decode_blurhash_to_rgba(
    blurhash_str: &str,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, PayloadError> {
    bh_decode(blurhash_str, width, height, 1.0)
        .map_err(|e| PayloadError::BlurHashError(format!("{:?}", e)))
}

/// Compress payload using zstd (must be performed before encryption)
pub fn compress_payload(data: &[u8]) -> Result<Vec<u8>, PayloadError> {
    let mut encoder = zstd::stream::Encoder::new(Vec::new(), 3)?;
    encoder.write_all(data)?;
    let compressed = encoder.finish()?;
    Ok(compressed)
}

/// Decompress payload using zstd (performed after decryption)
pub fn decompress_payload(compressed: &[u8]) -> Result<Vec<u8>, PayloadError> {
    let mut decoder = zstd::stream::Decoder::new(compressed)?;
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed)?;
    Ok(decompressed)
}

/// Estimated transfer duration in seconds based on payload size and profile net throughput
pub fn estimate_transfer_seconds(total_bytes: usize, net_bytes_per_sec: f32) -> f32 {
    if net_bytes_per_sec <= 0.0 {
        return 0.0;
    }
    total_bytes as f32 / net_bytes_per_sec
}

/// Format duration into honest human-readable French text (Section 5.1: "Dire la vérité sur la lenteur")
pub fn format_duration_french(seconds: f32) -> String {
    if seconds < 60.0 {
        format!("{:.0} secondes", seconds.ceil())
    } else {
        let mins = (seconds / 60.0).floor();
        let secs = (seconds % 60.0).ceil();
        format!("{:.0} min {:.0} s", mins, secs)
    }
}
