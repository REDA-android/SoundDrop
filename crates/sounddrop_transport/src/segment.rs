use sounddrop_link::{Frame, FrameType, MAX_PAYLOAD_LEN};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SegmentError {
    #[error("Empty data payload cannot be segmented")]
    EmptyData,
    #[error("Message too large: exceeds maximum transport size ({0} bytes)")]
    TooLarge(usize),
}

/// Splits an arbitrary data slice into an in-order sequence of Link Frames.
/// Each frame contains at most `MAX_PAYLOAD_LEN` bytes.
/// Intermediate frames use `FrameType::Data`; the final frame uses `FrameType::DataEnd`.
pub fn segment_payload(
    data: &[u8],
    start_seq: u8,
) -> Result<Vec<Frame>, SegmentError> {
    if data.is_empty() {
        return Err(SegmentError::EmptyData);
    }

    let chunks: Vec<&[u8]> = data.chunks(MAX_PAYLOAD_LEN).collect();
    let num_chunks = chunks.len();
    if num_chunks > 255 {
        return Err(SegmentError::TooLarge(255 * MAX_PAYLOAD_LEN));
    }

    let mut frames = Vec::with_capacity(num_chunks);
    let mut seq = start_seq;

    for (i, chunk) in chunks.iter().enumerate() {
        let is_last = i == num_chunks - 1;
        let frame_type = if is_last {
            FrameType::DataEnd
        } else {
            FrameType::Data
        };

        frames.push(Frame {
            frame_type,
            seq_num: seq,
            payload: chunk.to_vec(),
        });

        seq = seq.wrapping_add(1);
    }

    Ok(frames)
}

/// Accumulates received chunks, verifies contiguous sequence numbers, and reassembles the original data.
#[derive(Debug, Default, Clone)]
pub struct MessageReassembler {
    expected_seq: u8,
    received_bytes: Vec<u8>,
    completed: bool,
    frame_count: usize,
}

impl MessageReassembler {
    pub fn new(expected_start_seq: u8) -> Self {
        Self {
            expected_seq: expected_start_seq,
            received_bytes: Vec::new(),
            completed: false,
            frame_count: 0,
        }
    }

    pub fn is_completed(&self) -> bool {
        self.completed
    }

    pub fn expected_seq(&self) -> u8 {
        self.expected_seq
    }

    pub fn frame_count(&self) -> usize {
        self.frame_count
    }

    pub fn payload(&self) -> Option<&[u8]> {
        if self.completed {
            Some(&self.received_bytes)
        } else {
            None
        }
    }

    /// Appends an in-order frame. Returns true if this was a valid new chunk.
    pub fn push_frame(&mut self, frame: &Frame) -> Result<bool, SegmentError> {
        if self.completed {
            return Ok(false);
        }

        if frame.seq_num != self.expected_seq {
            // Not the expected sequence (duplicate or future frame)
            return Ok(false);
        }

        self.received_bytes.extend_from_slice(&frame.payload);
        self.expected_seq = self.expected_seq.wrapping_add(1);
        self.frame_count += 1;

        if frame.frame_type == FrameType::DataEnd {
            self.completed = true;
        }

        Ok(true)
    }

    /// Consumes the reassembler and returns the verified complete payload.
    pub fn finish(self) -> Option<Vec<u8>> {
        if self.completed {
            Some(self.received_bytes)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_segmentation_and_reassembly_roundtrip() {
        let original_data = b"SoundDrop: An offline-first, privacy-focused, cross-platform file and data communication system operating over physical sound waves!";
        let frames = segment_payload(original_data, 10).expect("Segmentation failed");

        assert!(frames.len() > 1, "Payload of 133 bytes must produce multiple frames");
        assert_eq!(frames.first().unwrap().frame_type, FrameType::Data);
        assert_eq!(frames.last().unwrap().frame_type, FrameType::DataEnd);

        let mut reassembler = MessageReassembler::new(10);
        for frame in &frames {
            let accepted = reassembler.push_frame(frame).unwrap();
            assert!(accepted, "In-order frame must be accepted");
        }

        assert!(reassembler.is_completed());
        let restored = reassembler.finish().expect("Must finish cleanly");
        assert_eq!(restored, original_data);
    }

    #[test]
    fn test_reassembler_rejects_duplicates() {
        let data = b"CHUNK_1_CHUNK_2_TEST";
        let frames = segment_payload(data, 0).unwrap();

        let mut reassembler = MessageReassembler::new(0);
        assert!(reassembler.push_frame(&frames[0]).unwrap());

        // Push duplicate of frame 0
        assert!(!reassembler.push_frame(&frames[0]).unwrap(), "Duplicate frame must be rejected");
    }
}
