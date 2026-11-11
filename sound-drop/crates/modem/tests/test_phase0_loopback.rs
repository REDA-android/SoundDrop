use sounddrop_audio_io::VirtualAcousticLoopback;
use sounddrop_modem::{GgwaveModem, ProtocolId};

/// Phase 0 Acceptance Criteria:
/// "Boucle haut-parleur → micro sur une machine: Octets reçus = octets envoyés, 100 fois"
#[test]
fn test_phase0_acoustic_loopback_100_runs() {
    GgwaveModem::disable_logging();

    let tx = GgwaveModem::new(48000.0).expect("failed to init tx modem");
    let rx = GgwaveModem::new(48000.0).expect("failed to init rx modem");

    let total_runs = 100;
    let mut successes = 0;

    println!("[Phase 0] Starting 100-run acoustic loopback test...");

    for i in 0..total_runs {
        let payload = format!("SOUNDDROP-P0-{:04}", i).into_bytes();

        let samples = tx
            .encode(&payload, ProtocolId::AudibleFastest, 25)
            .expect("modulation failed");

        // Use lock-free ring buffer for loopback transfer
        let mut loopback = VirtualAcousticLoopback::new(samples.len() + 48000 * 2);

        // Prepend 1024 samples silence
        loopback.emit(&vec![0.0f32; 1024]);
        loopback.emit(&samples);
        // Trailing silence for acoustic end-marker detection
        loopback.emit(&vec![0.0f32; 24000]);

        let mut decoded: Option<Vec<u8>> = None;
        let chunk_size = 1024;

        while loopback.available() > 0 {
            let chunk = loopback.capture_chunk(chunk_size);
            if chunk.is_empty() {
                break;
            }

            if let Ok(Some(data)) = rx.decode(&chunk) {
                decoded = Some(data);
                break;
            }
        }

        assert_eq!(
            decoded.as_deref(),
            Some(&payload[..]),
            "Phase 0 failure at run {}/{}: bytes sent != bytes received",
            i + 1,
            total_runs
        );

        successes += 1;
    }

    println!("[Phase 0] PASS: {}/{} runs successful with exact payload match.", successes, total_runs);
    assert_eq!(successes, 100);
}
