#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ManifestError {
    #[error("Filename is empty")]
    EmptyFilename,
    #[error("Filename contains illegal characters or path traversal: {0}")]
    IllegalFilename(String),
    #[error("File size {0} bytes is invalid")]
    InvalidFileSize(u64),
    #[error("Chunk size {0} bytes is invalid (must be > 0 and <= 65535)")]
    InvalidChunkSize(u32),
    #[error("Manifest serialization error: {0}")]
    SerializationError(String),
    #[error("Manifest deserialization error: {0}")]
    DeserializationError(String),
}

/// Magic header for SoundDrop File Manifest wire format.
const MANIFEST_MAGIC: &[u8; 4] = b"SDFM";
const MANIFEST_VERSION: u8 = 1;

/// Metadata manifest describing a file being transmitted over SoundDrop.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileManifest {
    /// 16-byte unique transfer identifier
    pub file_id: [u8; 16],
    /// Sanitized base filename (no directories)
    pub file_name: String,
    /// Total file size in bytes
    pub file_size: u64,
    /// Standard payload chunk size in bytes
    pub chunk_size: u32,
    /// Total number of chunks
    pub total_chunks: u32,
    /// BLAKE3 256-bit cryptographic root hash of the complete file
    pub root_hash: [u8; 32],
    /// BLAKE3 hash of each individual chunk in sequential order
    pub chunk_hashes: Vec<[u8; 32]>,
}

impl FileManifest {
    pub fn new(
        file_id: [u8; 16],
        file_name: &str,
        file_size: u64,
        chunk_size: u32,
        root_hash: [u8; 32],
        chunk_hashes: Vec<[u8; 32]>,
    ) -> Result<Self, ManifestError> {
        let clean_name = sanitize_filename(file_name)?;

        if chunk_size == 0 || chunk_size > 65535 {
            return Err(ManifestError::InvalidChunkSize(chunk_size));
        }

        let total_chunks = if file_size == 0 {
            0
        } else {
            ((file_size + chunk_size as u64 - 1) / chunk_size as u64) as u32
        };

        if chunk_hashes.len() != total_chunks as usize {
            return Err(ManifestError::SerializationError(format!(
                "Chunk hash count mismatch: expected {}, got {}",
                total_chunks,
                chunk_hashes.len()
            )));
        }

        Ok(Self {
            file_id,
            file_name: clean_name,
            file_size,
            chunk_size,
            total_chunks,
            root_hash,
            chunk_hashes,
        })
    }

    /// Serializes the manifest into a deterministic binary wire format.
    pub fn to_bytes(&self) -> Vec<u8> {
        let name_bytes = self.file_name.as_bytes();
        let mut buf = Vec::with_capacity(
            4 + 1 + 16 + 8 + 4 + 4 + 32 + 2 + name_bytes.len() + (self.chunk_hashes.len() * 32),
        );

        buf.extend_from_slice(MANIFEST_MAGIC);
        buf.push(MANIFEST_VERSION);
        buf.extend_from_slice(&self.file_id);
        buf.extend_from_slice(&self.file_size.to_be_bytes());
        buf.extend_from_slice(&self.chunk_size.to_be_bytes());
        buf.extend_from_slice(&self.total_chunks.to_be_bytes());
        buf.extend_from_slice(&self.root_hash);

        let name_len = name_bytes.len() as u16;
        buf.extend_from_slice(&name_len.to_be_bytes());
        buf.extend_from_slice(name_bytes);

        for hash in &self.chunk_hashes {
            buf.extend_from_slice(hash);
        }

        buf
    }

    /// Deserializes the manifest from raw binary bytes.
    pub fn from_bytes(data: &[u8]) -> Result<Self, ManifestError> {
        let min_header_len = 4 + 1 + 16 + 8 + 4 + 4 + 32 + 2;
        if data.len() < min_header_len {
            return Err(ManifestError::DeserializationError(
                "Buffer too short for manifest header".to_string(),
            ));
        }

        if &data[0..4] != MANIFEST_MAGIC {
            return Err(ManifestError::DeserializationError(
                "Invalid manifest magic".to_string(),
            ));
        }

        let version = data[4];
        if version != MANIFEST_VERSION {
            return Err(ManifestError::DeserializationError(format!(
                "Unsupported manifest version {}",
                version
            )));
        }

        let mut file_id = [0u8; 16];
        file_id.copy_from_slice(&data[5..21]);

        let file_size = u64::from_be_bytes(data[21..29].try_into().unwrap());
        let chunk_size = u32::from_be_bytes(data[29..33].try_into().unwrap());
        let total_chunks = u32::from_be_bytes(data[33..37].try_into().unwrap());

        let mut root_hash = [0u8; 32];
        root_hash.copy_from_slice(&data[37..69]);

        let name_len = u16::from_be_bytes(data[69..71].try_into().unwrap()) as usize;
        let name_end = 71 + name_len;
        if data.len() < name_end {
            return Err(ManifestError::DeserializationError(
                "Buffer too short for filename".to_string(),
            ));
        }

        let raw_name = std::str::from_utf8(&data[71..name_end])
            .map_err(|e| ManifestError::DeserializationError(format!("Invalid UTF-8: {}", e)))?;
        let file_name = sanitize_filename(raw_name)?;

        let hashes_expected_bytes = total_chunks as usize * 32;
        if data.len() != name_end + hashes_expected_bytes {
            return Err(ManifestError::DeserializationError(format!(
                "Payload size mismatch: expected {} total bytes, got {}",
                name_end + hashes_expected_bytes,
                data.len()
            )));
        }

        let mut chunk_hashes = Vec::with_capacity(total_chunks as usize);
        let mut offset = name_end;
        for _ in 0..total_chunks {
            let mut h = [0u8; 32];
            h.copy_from_slice(&data[offset..offset + 32]);
            chunk_hashes.push(h);
            offset += 32;
        }

        Ok(Self {
            file_id,
            file_name,
            file_size,
            chunk_size,
            total_chunks,
            root_hash,
            chunk_hashes,
        })
    }
}

/// Sanitizes a filename to prevent path traversal attacks (Directory Traversal / CWE-22).
/// Rejects path separators ('/', '\\'), parent directory references ('..'), and null bytes.
pub fn sanitize_filename(input: &str) -> Result<String, ManifestError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ManifestError::EmptyFilename);
    }

    // Split on either '/' or '\\' to handle cross-platform path separators safely
    let base_name = trimmed
        .split(&['/', '\\'][..])
        .filter(|s| !s.is_empty())
        .last()
        .ok_or_else(|| ManifestError::IllegalFilename(input.to_string()))?;

    if base_name == "." || base_name == ".." {
        return Err(ManifestError::IllegalFilename(input.to_string()));
    }

    // Disallow null bytes or control characters
    for c in base_name.chars() {
        if c.is_control() || c == '\0' || c == '/' || c == '\\' {
            return Err(ManifestError::IllegalFilename(input.to_string()));
        }
    }

    Ok(base_name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("document.pdf").unwrap(), "document.pdf");
        assert_eq!(sanitize_filename("/home/user/test.txt").unwrap(), "test.txt");
        assert_eq!(sanitize_filename("C:\\Users\\test.png").unwrap(), "test.png");
        assert!(sanitize_filename("..").is_err());
        assert!(sanitize_filename("../../etc/passwd").unwrap() == "passwd");
        assert!(sanitize_filename("").is_err());
        assert!(sanitize_filename("bad\0file.txt").is_err());
    }

    #[test]
    fn test_manifest_roundtrip_serialization() {
        let file_id = [0x42u8; 16];
        let root_hash = [0xAAu8; 32];
        let chunk_hashes = vec![[0x01u8; 32], [0x02u8; 32], [0x03u8; 32]];

        let manifest = FileManifest::new(
            file_id,
            "sample_audio.wav",
            300,
            100,
            root_hash,
            chunk_hashes.clone(),
        )
        .expect("Manifest creation failed");

        assert_eq!(manifest.total_chunks, 3);

        let bytes = manifest.to_bytes();
        let decoded = FileManifest::from_bytes(&bytes).expect("Manifest deserialization failed");

        assert_eq!(manifest, decoded);
    }
}
