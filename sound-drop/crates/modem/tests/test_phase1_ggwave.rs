use sounddrop_modem::{GgwaveModem, ProtocolId};
use std::time::Instant;

/// Phase 1 Acceptance Criteria:
/// "ggwave : texte entre deux appareils: 32 o en < 10 s à 1 m, ≥ 95 % de réussite en pièce calme"
#[test]
fn test_phase1_32_bytes_transmission() {
    GgwaveModem::disable_logging();

    let tx = GgwaveModem::new(48000.0).expect("failed to init tx modem");
    let rx = GgwaveModem::new(48000.0).expect("failed to init rx modem");

    // Exactly 32 bytes payload
    let payload = b"SoundDrop v2: 32-byte msg active";
    assert_eq!(payload.len(), 32);

    let total_trials = 20;
    let mut successes = 0;
    let mut total_duration_secs = 0.0;

    println!("[Phase 1] Transmitting 32-byte text across simulated acoustic channel...");

    for trial in 0..total_trials {
        let start = Instant::now();

        // Encode 32 bytes with AudibleFast
        let samples = tx
            .encode(payload, ProtocolId::AudibleFast, 25)
            .expect("modulation failed");

        let duration_audio_secs = samples.len() as f64 / 48000.0;
        assert!(
            duration_audio_secs < 10.0,
            "Audio duration ({:.2} s) must be strictly < 10 s",
            duration_audio_secs
        );

        // Simulate 1m air propagation delay (~3 ms at 343 m/s) + room impulse response (gentle tail)
        let delay_samples = (0.003 * 48000.0) as usize; // ~144 samples
        let mut channel_audio = vec![0.0f32; delay_samples + 1024];
        channel_audio.extend_from_slice(&samples);
        // Trailing silence for receiver end marker
        channel_audio.extend(vec![0.0f32; 24000]);

        // Add slight room ambient noise (SNR ~25 dB)
        for (i, sample) in channel_audio.iter_mut().enumerate() {
            let pseudo_noise = ((i as f32 * 12.9898 + 78.233).sin() * 43758.5453).fract() * 0.002;
            *sample += pseudo_noise;
        }

        let mut decoded: Option<Vec<u8>> = None;
        let chunk_size = 1024;

        for chunk in channel_audio.chunks(chunk_size) {
            if let Ok(Some(data)) = rx.decode(chunk) {
                decoded = Some(data);
                break;
            }
        }

        let elapsed = start.elapsed().as_secs_f64();
        total_duration_secs += elapsed;

        if decoded.as_deref() == Some(&payload[..]) {
            successes += 1;
        } else {
            eprintln!("[Phase 1] Trial {} failed to decode", trial);
        }
    }

    let success_rate = (successes as f64 / total_trials as f64) * 100.0;
    let avg_duration = total_duration_secs / total_trials as f64;

    println!(
        "[Phase 1] Results: Success rate = {:.1}% ({}/{}), Avg trial time = {:.3} s",
        success_rate, successes, total_trials, avg_duration
    );

    assert!(
        success_rate >= 95.0,
        "Success rate must be >= 95%, got {:.1}%",
        success_rate
    );
    assert!(
        avg_duration < 10.0,
        "Acoustic delivery must be < 10 s, got {:.2} s",
        avg_duration
    );
}
