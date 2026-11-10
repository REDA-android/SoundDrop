use crate::manifest::{FileManifest, ManifestError};
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum ChunkerError {
    #[error("I/O error reading source file: {0}")]
    Io(#[from] std::io::Error),
    #[error("Manifest error: {0}")]
    Manifest(#[from] ManifestError),
    #[error("RNG error generating file ID: {0}")]
    Rng(String),
    #[error("Chunk serialization error: {0}")]
    Serialization(String),
    #[error("Chunk deserialization error: {0}")]
    Deserialization(String),
}

const CHUNK_MAGIC: &[u8; 4] = b"SDFC";

/// Individual verifiable payload chunk of a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChunk {
    pub file_id: [u8; 16],
    pub chunk_index: u32,
    pub total_chunks: u32,
    pub hash: [u8; 32],
    pub data: Vec<u8>,
}

impl FileChunk {
    pub fn new(
        file_id: [u8; 16],
        chunk_index: u32,
        total_chunks: u32,
        data: Vec<u8>,
    ) -> Self {
        let hash = *blake3::hash(&data).as_bytes();
        Self {
            file_id,
            chunk_index,
            total_chunks,
            hash,
            data,
        }
    }

    /// Serializes chunk into binary wire format.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(4 + 16 + 4 + 4 + 32 + 4 + self.data.len());
        buf.extend_from_slice(CHUNK_MAGIC);
        buf.extend_from_slice(&self.file_id);
        buf.extend_from_slice(&self.chunk_index.to_be_bytes());
        buf.extend_from_slice(&self.total_chunks.to_be_bytes());
        buf.extend_from_slice(&self.hash);
        let data_len = self.data.len() as u32;
        buf.extend_from_slice(&data_len.to_be_bytes());
        buf.extend_from_slice(&self.data);
        buf
    }

    /// Deserializes chunk from binary wire format.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, ChunkerError> {
        if bytes.len() < 4 + 16 + 4 + 4 + 32 + 4 {
            return Err(ChunkerError::Deserialization(
                "Buffer too short for chunk header".to_string(),
            ));
        }

        if &bytes[0..4] != CHUNK_MAGIC {
            return Err(ChunkerError::Deserialization("Invalid chunk magic".to_string()));
        }

        let mut file_id = [0u8; 16];
        file_id.copy_from_slice(&bytes[4..20]);

        let chunk_index = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        let total_chunks = u32::from_be_bytes(bytes[24..28].try_into().unwrap());

        let mut hash = [0u8; 32];
        hash.copy_from_slice(&bytes[28..60]);

        let data_len = u32::from_be_bytes(bytes[60..64].try_into().unwrap()) as usize;
        let expected_total = 64 + data_len;
        if bytes.len() != expected_total {
            return Err(ChunkerError::Deserialization(format!(
                "Payload size mismatch: expected {} bytes, got {}",
                expected_total,
                bytes.len()
            )));
        }

        let data = bytes[64..64 + data_len].to_vec();

        // Verify chunk hash integrity immediately
        let computed = blake3::hash(&data);
        if computed.as_bytes() != &hash {
            return Err(ChunkerError::Deserialization(
                "Chunk hash mismatch upon deserialization".to_string(),
            ));
        }

        Ok(Self {
            file_id,
            chunk_index,
            total_chunks,
            hash,
            data,
        })
    }
}

pub struct FileChunker;

impl FileChunker {
    /// Slices an in-memory byte slice into a FileManifest and sequenced FileChunks.
    pub fn slice_bytes(
        file_name: &str,
        data: &[u8],
        chunk_size: u32,
    ) -> Result<(FileManifest, Vec<FileChunk>), ChunkerError> {
        if chunk_size == 0 {
            return Err(ChunkerError::Manifest(ManifestError::InvalidChunkSize(
                chunk_size,
            )));
        }

        let mut file_id = [0u8; 16];
        getrandom::getrandom(&mut file_id).map_err(|e| ChunkerError::Rng(e.to_string()))?;

        let file_size = data.len() as u64;
        let root_hash = *blake3::hash(data).as_bytes();

        let total_chunks = if file_size == 0 {
            0
        } else {
            ((file_size + chunk_size as u64 - 1) / chunk_size as u64) as u32
        };

        let mut chunk_hashes = Vec::with_capacity(total_chunks as usize);
        let mut chunks = Vec::with_capacity(total_chunks as usize);

        for i in 0..total_chunks {
            let start = (i as usize) * (chunk_size as usize);
            let end = std::cmp::min(start + (chunk_size as usize), data.len());
            let chunk_data = data[start..end].to_vec();
            let chunk = FileChunk::new(file_id, i, total_chunks, chunk_data);
            chunk_hashes.push(chunk.hash);
            chunks.push(chunk);
        }

        let manifest = FileManifest::new(
            file_id,
            file_name,
            file_size,
            chunk_size,
            root_hash,
            chunk_hashes,
        )?;

        Ok((manifest, chunks))
    }

    /// Reads a file from disk and slices it into a FileManifest and sequenced FileChunks.
    pub fn slice_file(
        path: &Path,
        chunk_size: u32,
    ) -> Result<(FileManifest, Vec<FileChunk>), ChunkerError> {
        let mut file = File::open(path)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;

        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unnamed_file");

        Self::slice_bytes(filename, &data, chunk_size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunker_slicing_and_hashing() {
        let test_data = b"Hello, SoundDrop file chunking engine! Testing multi-chunk hashing.";
        let chunk_size = 16;

        let (manifest, chunks) =
            FileChunker::slice_bytes("test.txt", test_data, chunk_size).expect("Slicing failed");

        assert_eq!(manifest.file_name, "test.txt");
        assert_eq!(manifest.file_size, test_data.len() as u64);
        assert_eq!(chunks.len(), manifest.total_chunks as usize);

        // Verify each chunk hash matches the manifest chunk hash
        for (i, chunk) in chunks.iter().enumerate() {
            assert_eq!(chunk.chunk_index, i as u32);
            assert_eq!(chunk.hash, manifest.chunk_hashes[i]);
            assert_eq!(chunk.file_id, manifest.file_id);
        }

        // Verify chunk wire roundtrip
        for chunk in &chunks {
            let bytes = chunk.to_bytes();
            let decoded = FileChunk::from_bytes(&bytes).expect("Chunk deserialization failed");
            assert_eq!(chunk, &decoded);
        }
    }
}
