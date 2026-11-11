use sounddrop_payload::{
    compress_payload, decode_blurhash_to_rgba, decompress_payload, estimate_transfer_seconds,
    format_duration_french, generate_blurhash_rgba, Packet0Metadata,
};
use std::time::Instant;

/// Phase 5 Acceptance Criteria:
/// "Miniatures BlurHash + fichier: Aperçu en < 3 s, miniature 3 Ko en < 5 min"
#[test]
fn test_phase5_blurhash_and_duration_bounds() {
    let width = 64;
    let height = 64;

    // Create a 64x64 sample RGBA image (smooth color gradient)
    let mut rgba_pixels = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let r = ((x as f32 / width as f32) * 255.0) as u8;
            let g = ((y as f32 / height as f32) * 255.0) as u8;
            let b = 180u8;
            let a = 255u8;
            rgba_pixels.extend_from_slice(&[r, g, b, a]);
        }
    }

    // 1. Measure BlurHash generation time: Must be < 3 seconds
    let t0 = Instant::now();
    let bh_string = generate_blurhash_rgba(width, height, &rgba_pixels)
        .expect("blurhash generation failed");
    let preview_generation_time = t0.elapsed();

    println!("[Phase 5] Generated BlurHash: '{}' in {:?}", bh_string, preview_generation_time);

    assert!(
        preview_generation_time.as_secs_f32() < 3.0,
        "Preview generation must take < 3 seconds, took {:?}",
        preview_generation_time
    );

    // Verify BlurHash length is compact (20-32 characters, fits in Packet 0)
    assert!(
        bh_string.len() >= 20 && bh_string.len() <= 32,
        "BlurHash length must be between 20 and 32 characters, got {}",
        bh_string.len()
    );

    // 2. Decode BlurHash to low-res RGBA preview (32x32x4 = 4096 bytes)
    let preview_rgba = decode_blurhash_to_rgba(&bh_string, 32, 32)
        .expect("blurhash decoding failed");
    assert_eq!(preview_rgba.len(), 32 * 32 * 4);

    // 3. Packet 0 metadata serialization & deserialization
    let p0 = Packet0Metadata::new(
        "photo_micro.jpg".into(),
        3072, // 3 KB
        Some(bh_string.clone()),
    );
    let serialized = p0.serialize();
    let deserialized = Packet0Metadata::deserialize(&serialized).expect("deserialize failed");
    assert_eq!(p0, deserialized);

    // 4. Test 3 KB miniature compression and transfer duration
    // A 3 KB thumbnail compressed with zstd
    let dummy_thumbnail = vec![0xABu8; 3072];
    let compressed = compress_payload(&dummy_thumbnail).expect("compression failed");
    let decompressed = decompress_payload(&compressed).expect("decompression failed");
    assert_eq!(decompressed, dummy_thumbnail);

    // At Normal profile throughput (~14 bytes/s net):
    let normal_net_throughput = 14.0f32; // bytes/sec
    let est_seconds = estimate_transfer_seconds(compressed.len(), normal_net_throughput);
    let duration_french = format_duration_french(est_seconds);

    println!(
        "[Phase 5] Compressed 3 KB thumbnail: {} bytes. Est transfer time: {:.1}s ({})",
        compressed.len(),
        est_seconds,
        duration_french
    );

    // Criteria: "miniature 3 Ko en < 5 min" (5 minutes = 300 seconds)
    assert!(
        est_seconds < 300.0,
        "3 KB miniature estimated transfer must be < 5 minutes (300 s), got {:.1} s",
        est_seconds
    );
}
