use sounddrop_modem::{GgwaveModem, ProtocolId};

#[test]
fn test_ggwave_encode_decode_roundtrip() {
    let tx = GgwaveModem::new(48000.0).expect("failed to init tx modem");
    let rx = GgwaveModem::new(48000.0).expect("failed to init rx modem");

    let payload = b"Hello, Sound Drop v2!";
    let samples = tx
        .encode(payload, ProtocolId::AudibleFast, 25)
        .expect("encoding failed");

    println!("Samples len: {}", samples.len());

    // Pad front and back with silence (1 second each)
    let silence_front = vec![0.0f32; 48000];
    let silence_back = vec![0.0f32; 48000];

    let mut full_audio = Vec::new();
    full_audio.extend_from_slice(&silence_front);
    full_audio.extend_from_slice(&samples);
    full_audio.extend_from_slice(&silence_back);

    let mut decoded: Option<Vec<u8>> = None;
    // Feed in 1024 sample chunks (matching samples_per_frame)
    for (idx, chunk) in full_audio.chunks(1024).enumerate() {
        match rx.decode(chunk) {
            Ok(Some(data)) => {
                println!("Decoded at chunk {}: {:?}", idx, String::from_utf8_lossy(&data));
                decoded = Some(data);
                break;
            }
            Ok(None) => {}
            Err(e) => {
                println!("Error at chunk {}: {}", idx, e);
            }
        }
    }

    assert_eq!(decoded.as_deref(), Some(&payload[..]));
}
