use sounddrop_modem::{
    demodulate_bytes, modulate_bytes, MfskProfile,
};

/// Phase 6 Acceptance Criteria:
/// "Ultrasons (expérimental): Rapport de mesure par modèle d’appareil"
#[test]
fn test_phase6_ultrasonic_transmission_and_attenuation() {
    let profile = MfskProfile::Ultra;
    let sr = 48000.0;
    let test_bytes = b"ULTRASONIC_18KHZ_EXP_TEST".to_vec();

    // Verify frequencies are within ultrasonic band (17.5 - 19.5 kHz)
    let f_min = profile.base_freq();
    let f_max = profile.base_freq() + 15.0 * profile.freq_step();
    println!(
        "[Phase 6] Ultrasonic band: {:.1} kHz to {:.1} kHz (Nyquist limit: {:.1} kHz)",
        f_min / 1000.0,
        f_max / 1000.0,
        sr / 2000.0
    );
    assert!(f_min >= 17500.0);
    assert!(f_max <= 19500.0);
    assert!(f_max < sr / 2.0); // Within Nyquist limit for 48 kHz

    // 1. Modulate ultrasonic audio
    let audio = modulate_bytes(profile, &test_bytes, sr);

    // 2. Simulate frequency roll-off / transducer attenuation
    // Typical smartphone speakers/microphones attenuate signals above 18 kHz by -12 to -24 dB
    let mut attenuated_audio = audio.clone();
    let attenuation_factor = 0.25; // -12 dB attenuation
    for s in attenuated_audio.iter_mut() {
        *s *= attenuation_factor;
    }

    // Demodulate
    let (demod, snr) = demodulate_bytes(profile, &attenuated_audio, test_bytes.len(), sr)
        .expect("ultrasonic demodulation failed");

    println!(
        "[Phase 6] Ultrasonic demodulated: '{}', SNR: {:.1} dB under -12 dB speaker attenuation",
        String::from_utf8_lossy(&demod),
        snr
    );

    assert_eq!(demod, test_bytes);
}
