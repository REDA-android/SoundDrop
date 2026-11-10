use crate::chunker::FileChunk;
use crate::manifest::{FileManifest, ManifestError};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum AssemblyError {
    #[error("I/O error during file assembly: {0}")]
    Io(#[from] std::io::Error),
    #[error("Manifest error: {0}")]
    Manifest(#[from] ManifestError),
    #[error("File ID mismatch: expected {expected}, got {got}")]
    FileIdMismatch { expected: String, got: String },
    #[error("Chunk index out of bounds: chunk {index} >= total {total}")]
    ChunkOutOfBounds { index: u32, total: u32 },
    #[error("Chunk hash verification failed at index {index}")]
    ChunkHashMismatch { index: u32 },
    #[error("Root hash mismatch: expected {expected}, computed {computed}")]
    RootHashMismatch { expected: String, computed: String },
    #[error("Corrupted state file: {0}")]
    CorruptedState(String),
    #[error("Attempted to finalize incomplete file ({received}/{total} chunks received)")]
    IncompleteAssembly { received: u32, total: u32 },
}

const STATE_MAGIC: &[u8; 4] = b"SDST";
const STATE_VERSION: u8 = 1;

/// Manages chunk verification, on-disk sparse assembly, and resuming interrupted transfers.
pub struct FileAssembler {
    manifest: FileManifest,
    output_dir: PathBuf,
    cache_dir: PathBuf,
    part_path: PathBuf,
    state_path: PathBuf,
    received_bitmap: Vec<bool>,
    received_count: u32,
    part_file: File,
}

impl FileAssembler {
    /// Initializes an assembler. If a prior transfer state exists in `cache_dir` for this `file_id`,
    /// it automatically resumes and validates previously written chunks.
    pub fn new(
        manifest: FileManifest,
        output_dir: &Path,
        cache_dir: &Path,
    ) -> Result<Self, AssemblyError> {
        fs::create_dir_all(output_dir)?;
        fs::create_dir_all(cache_dir)?;

        let id_hex = hex_encode(&manifest.file_id);
        let part_path = cache_dir.join(format!("{}.part", id_hex));
        let state_path = cache_dir.join(format!("{}.state", id_hex));

        let total = manifest.total_chunks;
        let mut received_bitmap = vec![false; total as usize];
        let mut received_count = 0;

        // Try resuming from existing state file
        if state_path.exists() && part_path.exists() {
            if let Ok((resumed_manifest, resumed_bitmap)) = Self::read_state_file(&state_path) {
                if resumed_manifest.file_id == manifest.file_id
                    && resumed_manifest.root_hash == manifest.root_hash
                    && resumed_bitmap.len() == total as usize
                {
                    log::info!(
                        "Resuming existing transfer for {} ({}) from cache",
                        manifest.file_name,
                        id_hex
                    );
                    received_count = resumed_bitmap.iter().filter(|&&r| r).count() as u32;
                    received_bitmap = resumed_bitmap;
                }
            }
        }

        // Open or create .part file
        let part_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(&part_path)?;

        // Ensure file length is pre-allocated
        if manifest.file_size > 0 {
            part_file.set_len(manifest.file_size)?;
        }

        let assembler = Self {
            manifest,
            output_dir: output_dir.to_path_buf(),
            cache_dir: cache_dir.to_path_buf(),
            part_path,
            state_path,
            received_bitmap,
            received_count,
            part_file,
        };

        // Persist initial state
        assembler.save_state_file()?;

        Ok(assembler)
    }

    /// Ingests, cryptographically verifies, and writes an incoming chunk to the on-disk .part file.
    /// Returns Ok(true) if the chunk was new and written, or Ok(false) if it was a duplicate.
    pub fn ingest_chunk(&mut self, chunk: &FileChunk) -> Result<bool, AssemblyError> {
        if chunk.file_id != self.manifest.file_id {
            return Err(AssemblyError::FileIdMismatch {
                expected: hex_encode(&self.manifest.file_id),
                got: hex_encode(&chunk.file_id),
            });
        }

        if chunk.chunk_index >= self.manifest.total_chunks {
            return Err(AssemblyError::ChunkOutOfBounds {
                index: chunk.chunk_index,
                total: self.manifest.total_chunks,
            });
        }

        let idx = chunk.chunk_index as usize;
        if self.received_bitmap[idx] {
            // Already received and verified
            return Ok(false);
        }

        // Verify chunk BLAKE3 hash
        let computed_hash = *blake3::hash(&chunk.data).as_bytes();
        if computed_hash != self.manifest.chunk_hashes[idx] || computed_hash != chunk.hash {
            return Err(AssemblyError::ChunkHashMismatch {
                index: chunk.chunk_index,
            });
        }

        // Seek and write chunk to .part file
        let byte_offset = (chunk.chunk_index as u64) * (self.manifest.chunk_size as u64);
        self.part_file.seek(SeekFrom::Start(byte_offset))?;
        self.part_file.write_all(&chunk.data)?;
        self.part_file.flush()?;

        self.received_bitmap[idx] = true;
        self.received_count += 1;

        // Persist progress to state file
        self.save_state_file()?;

        Ok(true)
    }

    /// Returns the list of missing chunk indices required to complete the file.
    pub fn missing_chunks(&self) -> Vec<u32> {
        self.received_bitmap
            .iter()
            .enumerate()
            .filter_map(|(i, &received)| if !received { Some(i as u32) } else { None })
            .collect()
    }

    /// Returns true if all chunks have been received and verified.
    pub fn is_complete(&self) -> bool {
        self.received_count == self.manifest.total_chunks
    }

    pub fn manifest(&self) -> &FileManifest {
        &self.manifest
    }

    pub fn received_count(&self) -> u32 {
        self.received_count
    }

    pub fn total_chunks(&self) -> u32 {
        self.manifest.total_chunks
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    /// Finalizes the assembly: verifies root BLAKE3 hash over the entire file,
    /// atomically renames .part to target filename in output_dir, and cleans up .state.
    pub fn finalize(mut self) -> Result<PathBuf, AssemblyError> {
        if !self.is_complete() {
            return Err(AssemblyError::IncompleteAssembly {
                received: self.received_count,
                total: self.manifest.total_chunks,
            });
        }

        // Verify complete root hash from disk
        self.part_file.seek(SeekFrom::Start(0))?;
        let mut hasher = blake3::Hasher::new();
        let mut buffer = [0u8; 8192];
        let mut total_read = 0u64;

        while total_read < self.manifest.file_size {
            let to_read = std::cmp::min(
                buffer.len() as u64,
                self.manifest.file_size - total_read,
            ) as usize;
            let n = self.part_file.read(&mut buffer[..to_read])?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
            total_read += n as u64;
        }

        let computed_root = *hasher.finalize().as_bytes();
        if computed_root != self.manifest.root_hash {
            return Err(AssemblyError::RootHashMismatch {
                expected: hex_encode(&self.manifest.root_hash),
                computed: hex_encode(&computed_root),
            });
        }

        // Drop file handle before moving
        drop(self.part_file);

        let final_destination = self.output_dir.join(&self.manifest.file_name);
        fs::rename(&self.part_path, &final_destination).or_else(|_| {
            // Fallback for cross-device moves
            fs::copy(&self.part_path, &final_destination)?;
            fs::remove_file(&self.part_path)?;
            Ok::<(), std::io::Error>(())
        })?;

        // Remove .state file
        let _ = fs::remove_file(&self.state_path);

        Ok(final_destination)
    }

    fn save_state_file(&self) -> Result<(), AssemblyError> {
        let manifest_bytes = self.manifest.to_bytes();
        let mut buf = Vec::with_capacity(4 + 1 + 4 + manifest_bytes.len() + 4 + self.received_bitmap.len());

        buf.extend_from_slice(STATE_MAGIC);
        buf.push(STATE_VERSION);
        let m_len = manifest_bytes.len() as u32;
        buf.extend_from_slice(&m_len.to_be_bytes());
        buf.extend_from_slice(&manifest_bytes);

        buf.extend_from_slice(&self.manifest.total_chunks.to_be_bytes());
        for &r in &self.received_bitmap {
            buf.push(if r { 1 } else { 0 });
        }

        // Write atomically via temporary file
        let tmp_path = self.state_path.with_extension("tmp");
        fs::write(&tmp_path, &buf)?;
        fs::rename(&tmp_path, &self.state_path)?;

        Ok(())
    }

    fn read_state_file(path: &Path) -> Result<(FileManifest, Vec<bool>), AssemblyError> {
        let data = fs::read(path)?;
        if data.len() < 4 + 1 + 4 {
            return Err(AssemblyError::CorruptedState("State file too short".into()));
        }

        if &data[0..4] != STATE_MAGIC || data[4] != STATE_VERSION {
            return Err(AssemblyError::CorruptedState("Invalid state magic or version".into()));
        }

        let m_len = u32::from_be_bytes(data[5..9].try_into().unwrap()) as usize;
        let m_end = 9 + m_len;
        if data.len() < m_end + 4 {
            return Err(AssemblyError::CorruptedState("Truncated manifest in state".into()));
        }

        let manifest = FileManifest::from_bytes(&data[9..m_end])
            .map_err(|e| AssemblyError::CorruptedState(e.to_string()))?;

        let total = u32::from_be_bytes(data[m_end..m_end + 4].try_into().unwrap()) as usize;
        let b_start = m_end + 4;
        if data.len() != b_start + total {
            return Err(AssemblyError::CorruptedState("Bitmap size mismatch".into()));
        }

        let bitmap = data[b_start..b_start + total].iter().map(|&b| b != 0).collect();
        Ok((manifest, bitmap))
    }
}

pub fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chunker::FileChunker;
    use tempfile::tempdir;

    #[test]
    fn test_file_assembler_clean_assembly() {
        let out_dir = tempdir().unwrap();
        let cache_dir = tempdir().unwrap();

        let content = b"SoundDrop: Testing end-to-end file assembly with BLAKE3 rolling hashes.";
        let (manifest, chunks) = FileChunker::slice_bytes("assembled.txt", content, 12).unwrap();

        let mut assembler = FileAssembler::new(manifest.clone(), out_dir.path(), cache_dir.path()).unwrap();

        for chunk in &chunks {
            let written = assembler.ingest_chunk(chunk).unwrap();
            assert!(written);
        }

        assert!(assembler.is_complete());
        let final_path = assembler.finalize().unwrap();

        assert_eq!(final_path.file_name().unwrap(), "assembled.txt");
        let restored_bytes = fs::read(&final_path).unwrap();
        assert_eq!(restored_bytes, content);
    }

    #[test]
    fn test_file_assembler_resume_interrupted_transfer() {
        let out_dir = tempdir().unwrap();
        let cache_dir = tempdir().unwrap();

        let content = b"RESUME_TEST: Verify partial chunk storage and state file recovery.";
        let (manifest, chunks) = FileChunker::slice_bytes("resume_doc.txt", content, 10).unwrap();

        // Pass 1: Ingest only first half of chunks
        let half = chunks.len() / 2;
        {
            let mut assembler = FileAssembler::new(manifest.clone(), out_dir.path(), cache_dir.path()).unwrap();
            for chunk in &chunks[..half] {
                assembler.ingest_chunk(chunk).unwrap();
            }
            assert_eq!(assembler.received_count(), half as u32);
            assert!(!assembler.is_complete());
            // Drops assembler (simulates power failure or connection drop)
        }

        // Pass 2: Re-open assembler from same cache directory
        {
            let mut resumed = FileAssembler::new(manifest.clone(), out_dir.path(), cache_dir.path()).unwrap();
            assert_eq!(resumed.received_count(), half as u32);
            let missing = resumed.missing_chunks();
            assert_eq!(missing.len(), chunks.len() - half);

            // Ingest remaining chunks
            for chunk in &chunks[half..] {
                let written = resumed.ingest_chunk(chunk).unwrap();
                assert!(written);
            }

            assert!(resumed.is_complete());
            let final_path = resumed.finalize().unwrap();
            let restored_bytes = fs::read(&final_path).unwrap();
            assert_eq!(restored_bytes, content);
        }
    }

    #[test]
    fn test_file_assembler_rejects_corrupted_chunk() {
        let out_dir = tempdir().unwrap();
        let cache_dir = tempdir().unwrap();

        let content = b"Corrupted chunk test payload";
        let (manifest, mut chunks) = FileChunker::slice_bytes("corrupt.txt", content, 8).unwrap();

        let mut assembler = FileAssembler::new(manifest, out_dir.path(), cache_dir.path()).unwrap();

        // Tamper with chunk data
        chunks[0].data[0] ^= 0xFF;
        let err = assembler.ingest_chunk(&chunks[0]).unwrap_err();
        match err {
            AssemblyError::ChunkHashMismatch { index } => assert_eq!(index, 0),
            other => panic!("Expected ChunkHashMismatch, got {:?}", other),
        }
    }
}
