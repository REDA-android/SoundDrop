/// Block matrix interleaver to disperse burst errors caused by acoustic clicks/taps.

pub fn interleave(data: &[u8], depth: usize) -> Vec<u8> {
    if depth <= 1 || data.len() <= depth {
        return data.to_vec();
    }

    let rows = depth;
    let cols = (data.len() + rows - 1) / rows;
    let mut out = vec![0u8; rows * cols];

    // Write row-by-row, read col-by-col
    let mut write_idx = 0;
    for c in 0..cols {
        for r in 0..rows {
            let in_idx = r * cols + c;
            if in_idx < data.len() {
                out[write_idx] = data[in_idx];
            } else {
                out[write_idx] = 0; // Pad
            }
            write_idx += 1;
        }
    }

    out
}

pub fn deinterleave(interleaved: &[u8], original_len: usize, depth: usize) -> Vec<u8> {
    if depth <= 1 || original_len <= depth {
        return interleaved[..original_len.min(interleaved.len())].to_vec();
    }

    let rows = depth;
    let cols = (original_len + rows - 1) / rows;
    let mut out = vec![0u8; original_len];

    let mut read_idx = 0;
    for c in 0..cols {
        for r in 0..rows {
            let out_idx = r * cols + c;
            if out_idx < original_len && read_idx < interleaved.len() {
                out[out_idx] = interleaved[read_idx];
            }
            read_idx += 1;
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_interleave_roundtrip() {
        let original = b"SOUNDDROP_BURST_RESILIENT_DATA_123456789";
        let depth = 4;
        let interleaved = interleave(original, depth);
        let restored = deinterleave(&interleaved, original.len(), depth);
        assert_eq!(&restored, original);
    }

    #[test]
    fn test_burst_error_dispersion() {
        let original = b"0123456789ABCDEF"; // 16 bytes
        let depth = 4;
        let mut interleaved = interleave(original, depth);

        // Simulate an acoustic click wiping out 3 consecutive interleaved symbols
        interleaved[4] = 0xFF;
        interleaved[5] = 0xFF;
        interleaved[6] = 0xFF;

        let restored = deinterleave(&interleaved, original.len(), depth);

        // The 3 consecutive errors in interleaved space should now be separated in restored space
        let mut error_positions = Vec::new();
        for (i, (&a, &b)) in original.iter().zip(restored.iter()).enumerate() {
            if a != b {
                error_positions.push(i);
            }
        }

        assert_eq!(error_positions.len(), 3);
        // Verify that errors are not adjacent in original space
        assert!(error_positions[1] - error_positions[0] > 1);
    }
}
