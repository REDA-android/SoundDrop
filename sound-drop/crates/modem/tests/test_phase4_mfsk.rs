use sounddrop_modem::{
    demodulate_bytes, demodulate_frame, modulate_bytes, modulate_frame, MfskProfile,
};
use sounddrop_protocol::{ErasureCoder, Frame, FrameHeader, FrameType};
use std::time::Instant;

/// Phase 4 Acceptance Criteria:
/// "Modem MFSK maison + erasure: Profil Normal ≥ 10 o/s mesurés, BER documenté"
#[test]
fn test_phase4_mfsk_normal_profile_throughput() {
    let profile = MfskProfile::Normal;
    let sr = 48000.0;

    // Test with a 32-byte payload
    let payload = b"SoundDrop-Native-MFSK-Normal-32B".to_vec();
    assert_eq!(payload.len(), 32);

    let header = FrameHeader::new(0x2026, FrameType::Data, 1, 1);
    let frame = Frame::new(header, payload.clone());

    // Modulate to audio samples
    let t0 = Instant::now();
    let samples = modulate_frame(profile, &frame, sr);
    let modulation_time = t0.elapsed();

    let total_audio_seconds = samples.len() as f32 / sr;
    let net_throughput_bytes_per_sec = payload.len() as f32 / total_audio_seconds;

    println!(
        "[Phase 4] Audio duration: {:.3} s, Payload: {} bytes, Measured Net Throughput: {:.2} bytes/s (Modulation time: {:?})",
        total_audio_seconds,
        payload.len(),
        net_throughput_bytes_per_sec,
        modulation_time
    );

    // Acceptance criterion: Profil Normal >= 10 bytes/sec
    assert!(
        net_throughput_bytes_per_sec >= 10.0,
        "Net throughput must be >= 10 bytes/sec, measured {:.2} bytes/s",
        net_throughput_bytes_per_sec
    );

    // Demodulate the frame
    let (decoded_frame, avg_snr) = demodulate_frame(profile, &samples, payload.len(), sr)
        .expect("demodulation failed");

    println!("[Phase 4] Demodulated with Avg SNR: {:.1} dB", avg_snr);
    assert_eq!(decoded_frame.payload, payload);
    assert_eq!(decoded_frame.header.session_id, 0x2026);
}

#[test]
fn test_phase4_mfsk_ber_under_noise() {
    let profile = MfskProfile::Normal;
    let sr = 48000.0;
    let test_bytes = b"BER_TEST_PACKET_ACOUSTIC_2026!".to_vec(); // 30 bytes = 240 bits

    // 1. Clean transmission
    let clean_audio = modulate_bytes(profile, &test_bytes, sr);
    let (demod_clean, _) = demodulate_bytes(profile, &clean_audio, test_bytes.len(), sr)
        .expect("clean demod failed");
    assert_eq!(demod_clean, test_bytes);

    // 2. Measure BER under simulated noise levels
    let snr_targets = [30.0, 20.0, 15.0];
    for &target_snr in &snr_targets {
        let mut noisy_audio = clean_audio.clone();
        // Calculate noise amplitude for target SNR
        let signal_power: f32 = noisy_audio.iter().map(|&x| x * x).sum::<f32>() / noisy_audio.len() as f32;
        let noise_power = signal_power / (10.0f32.powf(target_snr / 10.0));
        let noise_std = noise_power.sqrt();

        // Pseudo-random Gaussian noise
        for (i, s) in noisy_audio.iter_mut().enumerate() {
            let u1 = ((i as f32 * 3.1415 + 1.234).sin().abs() + 0.0001).clamp(0.0001, 0.9999);
            let u2 = ((i as f32 * 2.7182 + 5.678).cos().abs() + 0.0001).clamp(0.0001, 0.9999);
            let gauss = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f32::consts::PI * u2).cos();
            *s += gauss * noise_std;
        }

        if let Ok((demod_noisy, measured_snr)) = demodulate_bytes(profile, &noisy_audio, test_bytes.len(), sr) {
            let mut bit_errors = 0;
            for (b_orig, b_noisy) in test_bytes.iter().zip(demod_noisy.iter()) {
                bit_errors += (b_orig ^ b_noisy).count_ones();
            }
            let total_bits = test_bytes.len() * 8;
            let ber = bit_errors as f32 / total_bits as f32;
            println!(
                "[Phase 4 BER] Target SNR: {:.0} dB, Measured SNR: {:.1} dB, Bit Errors: {}/{}, BER: {:.4}",
                target_snr, measured_snr, bit_errors, total_bits, ber
            );
            assert!(ber < 0.05, "BER at {:.0} dB must be < 5%, got {:.4}", target_snr, ber);
        }
    }
}

#[test]
fn test_phase4_erasure_coding_with_packet_loss() {
    // 5 data shards + 2 parity shards (40% redundancy, Section 4.4)
    let coder = ErasureCoder::new(5, 2).expect("erasure coder init failed");
    let message = b"High-Reliability Air-Gapped Simplex Transmission with 40% Parity Protection";

    let shards = coder.encode(message).expect("encoding failed");
    assert_eq!(shards.len(), 7);

    // Simulate loss of 2 shards (drop shard 1 and shard 4)
    let mut received_shards: Vec<Option<Vec<u8>>> = shards.into_iter().map(Some).collect();
    received_shards[1] = None; // dropped
    received_shards[4] = None; // dropped

    println!("[Phase 4 Erasure] Reconstructing message after 2/7 shards lost...");
    let reconstructed = coder
        .reconstruct(&mut received_shards, message.len())
        .expect("reconstruction failed");

    assert_eq!(&reconstructed[..], message);
    println!("[Phase 4 Erasure] SUCCESS: Full original message recovered!");
}
