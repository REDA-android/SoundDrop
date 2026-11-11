//! Milestone 1: End-to-End Multi-Hop Acoustic Mesh Verification
//!
//! Validates the core acoustic relay pipeline:
//! Device A (Alice) ---> Acoustic Signal ---> Relay Station R ---> Acoustic Signal ---> Device B (Bob)
//!
//! Key properties verified:
//! 1. End-to-End Encryption (E2EE): Relays carry opaque payloads and cannot read plaintext.
//! 2. Zero-Trust Tamper Proofing: Any payload or header modification invalidates CRC-16 or AEAD Poly1305 MAC.
//! 3. Store-and-Forward Deduplication: Prevents acoustic broadcast storms and replay attacks.
//! 4. Hop Management: TTL decremented and hop count incremented at each relay hop.
//! 5. 100% Bit-for-bit acoustic reconstruction across simulated physical air propagation.

use sounddrop_crypto::{
    compute_recipient_hash, decrypt_frame, derive_session_key, encrypt_frame, EphemeralKeyPair,
};
use sounddrop_modem::{
    demodulate_bytes, modulate_bytes, GgwaveModem, MfskProfile, ProtocolId,
};
use sounddrop_protocol::relay::{RelayError, RelayHeader, RelayPacket, StoreAndForwardQueue};
use sounddrop_protocol::{Frame, FrameHeader, FrameType};
use std::time::Duration;

/// Simulate physical air channel: acoustic propagation delay (~3ms/m) + ambient room noise
fn simulate_air_channel(samples: &[f32], noise_amplitude: f32) -> Vec<f32> {
    let delay_samples = (0.003 * 48000.0) as usize; // ~144 samples (1 meter distance)
    let lead_in_silence = 4800; // 100 ms lead-in
    let lead_out_silence = 14400; // 300 ms lead-out for modem state decay

    let mut channel_audio = Vec::with_capacity(lead_in_silence + delay_samples + samples.len() + lead_out_silence);
    channel_audio.resize(lead_in_silence + delay_samples, 0.0);
    channel_audio.extend_from_slice(samples);
    channel_audio.resize(channel_audio.len() + lead_out_silence, 0.0);

    // Inject pseudo-random ambient noise (typical living room / office environment)
    for (i, sample) in channel_audio.iter_mut().enumerate() {
        let pseudo_noise = ((i as f32 * 12.9898 + 78.233).sin() * 43758.5453).fract() * noise_amplitude;
        *sample += pseudo_noise;
    }

    channel_audio
}

/// Helper to decode an audio buffer using ggwave modem instance
fn decode_ggwave_stream(modem: &GgwaveModem, audio: &[f32]) -> Option<Vec<u8>> {
    for chunk in audio.chunks(1024) {
        if let Ok(Some(data)) = modem.decode(chunk) {
            return Some(data);
        }
    }
    None
}

#[test]
fn test_milestone1_multihop_acoustic_ggwave() {
    GgwaveModem::disable_logging();

    println!("================================================================================");
    println!("[Milestone 1] Testing Multi-Hop Acoustic Mesh: Alice -> Relay R -> Bob (ggwave)");
    println!("================================================================================");

    // 1. Setup Identities
    let alice_keys = EphemeralKeyPair::generate();
    let bob_keys = EphemeralKeyPair::generate();
    let relay_keys = EphemeralKeyPair::generate();

    let bob_pub = bob_keys.public_bytes();
    let bob_hash = compute_recipient_hash(&bob_pub);
    let relay_hash = compute_recipient_hash(&relay_keys.public_bytes());

    let session_id: u16 = 0x5044; // "SD"
    let original_message = b"URGENT: MEDEVAC LAT 48.85 LON 2.35"; // Confidential 35-byte payload

    // 2. Device A (Alice): Encrypt and build RelayPacket
    let alice_shared = alice_keys.diffie_hellman(&bob_pub);
    let session_key = derive_session_key(&alice_shared, None, session_id);

    let frame_header = FrameHeader::new(session_id, FrameType::Data, 1, 1);
    let aad = frame_header.serialize();
    let ciphertext = encrypt_frame(&session_key, 1, &aad, original_message)
        .expect("encryption failed");

    let relay_hdr_alice = RelayHeader::new(3 /* TTL */, bob_hash, RelayHeader::FLAG_ENCRYPTED);
    let alice_packet = RelayPacket::new(relay_hdr_alice, Frame::new(frame_header.clone(), ciphertext));
    let alice_tx_bytes = alice_packet.serialize();

    println!("[Alice] Plaintext: {:?} ({} bytes)", String::from_utf8_lossy(original_message), original_message.len());
    println!("[Alice] Serialized Relay Packet: {} bytes (Header + RecipientHash + Ciphertext + CRC-16)", alice_tx_bytes.len());

    // 3. Hop 1: Alice -> Acoustic Air -> Relay Station R
    let alice_modem = GgwaveModem::new(48000.0).expect("init alice modem");
    let relay_rx_modem = GgwaveModem::new(48000.0).expect("init relay rx modem");

    let alice_audio = alice_modem
        .encode(&alice_tx_bytes, ProtocolId::AudibleFast, 25)
        .expect("modulation failed");
    let channel_1 = simulate_air_channel(&alice_audio, 0.001);

    let relay_rx_raw = decode_ggwave_stream(&relay_rx_modem, &channel_1)
        .expect("Relay R failed to decode acoustic transmission from Alice");

    assert_eq!(relay_rx_raw, alice_tx_bytes, "Relay received corrupted bytes over air!");

    // 4. Relay Station R Processing
    let relay_packet = RelayPacket::deserialize(&relay_rx_raw)
        .expect("Relay R failed to deserialize relay packet");

    // Zero-Trust validation: Relay confirms it is NOT the destination
    assert_ne!(relay_packet.relay.recipient_hash, relay_hash);
    assert_eq!(relay_packet.relay.recipient_hash, bob_hash);

    // Relay store-and-forward queue with deduplication
    let mut relay_queue = StoreAndForwardQueue::new(64, Duration::from_secs(300));
    relay_queue.push(relay_packet).expect("failed to push to relay queue");

    // Pop from queue and execute forward step
    let mut fwd_packet = relay_queue.pop_next_to_forward().expect("queue is empty");
    assert_eq!(fwd_packet.relay.ttl, 3);
    assert_eq!(fwd_packet.relay.hop_count, 0);

    fwd_packet.forward_step().expect("hop step failed");
    assert_eq!(fwd_packet.relay.ttl, 2, "TTL must be decremented from 3 to 2");
    assert_eq!(fwd_packet.relay.hop_count, 1, "Hop count must be incremented to 1");

    let relay_tx_bytes = fwd_packet.serialize();

    // 5. Hop 2: Relay Station R -> Acoustic Air -> Device B (Bob)
    let relay_tx_modem = GgwaveModem::new(48000.0).expect("init relay tx modem");
    let bob_rx_modem = GgwaveModem::new(48000.0).expect("init bob rx modem");

    let relay_audio = relay_tx_modem
        .encode(&relay_tx_bytes, ProtocolId::AudibleFast, 25)
        .expect("relay modulation failed");
    let channel_2 = simulate_air_channel(&relay_audio, 0.001);

    let bob_rx_raw = decode_ggwave_stream(&bob_rx_modem, &channel_2)
        .expect("Bob failed to decode acoustic transmission from Relay R");

    assert_eq!(bob_rx_raw, relay_tx_bytes, "Bob received corrupted bytes over air!");

    // 6. Device B (Bob): Verification, Ingress, and Decryption
    let bob_packet = RelayPacket::deserialize(&bob_rx_raw)
        .expect("Bob failed to deserialize packet");

    assert_eq!(bob_packet.relay.recipient_hash, bob_hash, "Recipient hash mismatch");
    assert_eq!(bob_packet.relay.ttl, 2);
    assert_eq!(bob_packet.relay.hop_count, 1);

    // Bob derives session key and decrypts
    let bob_shared = bob_keys.diffie_hellman(&alice_keys.public_bytes());
    let bob_session_key = derive_session_key(&bob_shared, None, session_id);
    assert_eq!(session_key, bob_session_key);

    let decrypted = decrypt_frame(
        &bob_session_key,
        bob_packet.frame.header.seq_num as u64,
        &bob_packet.frame.header.serialize(),
        &bob_packet.frame.payload,
    ).expect("Bob failed to decrypt E2EE payload");

    assert_eq!(decrypted, original_message, "100% bit-for-bit payload identity required!");
    println!("[Bob] Decrypted: {:?}", String::from_utf8_lossy(&decrypted));
    println!("[Milestone 1] SUCCESS: Multi-hop acoustic transmission validated end-to-end!");
}

#[test]
fn test_milestone1_multihop_acoustic_mfsk() {
    println!("================================================================================");
    println!("[Milestone 1] Testing Multi-Hop Acoustic Mesh: Alice -> Relay R -> Bob (MFSK 16)");
    println!("================================================================================");

    let profile = MfskProfile::Normal;
    let sr = 48000.0;

    // Alice builds packet
    let recipient_hash = [0xFE, 0xED, 0xFA, 0xCE];
    let payload = b"AIRGAP_MFSK_MULTI_HOP_OK!";
    let frame = Frame::new(FrameHeader::new(0x3030, FrameType::Data, 1, 1), payload.to_vec());
    let packet = RelayPacket::new(RelayHeader::new(3, recipient_hash, 0), frame);

    let alice_bytes = packet.serialize();

    // Hop 1: Alice -> Relay R via MFSK audio
    let alice_audio = modulate_bytes(profile, &alice_bytes, sr);
    let channel_1 = simulate_air_channel(&alice_audio, 0.0005);
    let (relay_bytes, _) = demodulate_bytes(profile, &channel_1, alice_bytes.len(), sr)
        .expect("Relay MFSK demod failed");
    assert_eq!(relay_bytes, alice_bytes);

    // Relay R advances hop
    let mut relay_packet = RelayPacket::deserialize(&relay_bytes).unwrap();
    relay_packet.forward_step().unwrap();
    assert_eq!(relay_packet.relay.ttl, 2);
    assert_eq!(relay_packet.relay.hop_count, 1);
    let relay_tx_bytes = relay_packet.serialize();

    // Hop 2: Relay R -> Bob via MFSK audio
    let relay_audio = modulate_bytes(profile, &relay_tx_bytes, sr);
    let channel_2 = simulate_air_channel(&relay_audio, 0.0005);
    let (bob_bytes, _) = demodulate_bytes(profile, &channel_2, relay_tx_bytes.len(), sr)
        .expect("Bob MFSK demod failed");
    assert_eq!(bob_bytes, relay_tx_bytes);

    let bob_packet = RelayPacket::deserialize(&bob_bytes).unwrap();
    assert_eq!(bob_packet.frame.payload, payload);
    assert_eq!(bob_packet.relay.hop_count, 1);
    println!("[MFSK] Reconstructed payload across 2 acoustic hops: {:?}", String::from_utf8_lossy(&bob_packet.frame.payload));
}

#[test]
fn test_milestone1_relay_zero_trust_tamper_detection() {
    let alice_keys = EphemeralKeyPair::generate();
    let bob_keys = EphemeralKeyPair::generate();
    let bob_hash = compute_recipient_hash(&bob_keys.public_bytes());

    let session_key = derive_session_key(&alice_keys.diffie_hellman(&bob_keys.public_bytes()), None, 0x1111);
    let frame_header = FrameHeader::new(0x1111, FrameType::Data, 1, 1);
    let ciphertext = encrypt_frame(&session_key, 1, &frame_header.serialize(), b"CONFIDENTIAL").unwrap();

    let packet = RelayPacket::new(
        RelayHeader::new(3, bob_hash, RelayHeader::FLAG_ENCRYPTED),
        Frame::new(frame_header.clone(), ciphertext),
    );

    let mut bytes = packet.serialize();

    // Malicious intermediary tampers with 1 byte of the encrypted payload
    let tamper_idx = 7 + 8 + 4; // Inside ciphertext
    bytes[tamper_idx] ^= 0x01;

    // Deserialization immediately fails CRC-16 check
    let res = RelayPacket::deserialize(&bytes);
    assert!(res.is_err(), "Corrupted packet must be rejected by CRC-16");

    // Even if CRC were recomputed maliciously, AEAD Poly1305 MAC tag would reject it
    let forged_packet = RelayPacket::new(
        RelayHeader::new(2, bob_hash, RelayHeader::FLAG_ENCRYPTED),
        Frame::new(frame_header.clone(), bytes[7 + 8..bytes.len() - 2].to_vec()),
    );
    let decrypt_res = decrypt_frame(
        &session_key,
        1,
        &frame_header.serialize(),
        &forged_packet.frame.payload,
    );
    assert!(decrypt_res.is_err(), "AEAD Poly1305 tag must reject forged payload");
}

#[test]
fn test_milestone1_store_and_forward_loop_and_echo_suppression() {
    let mut queue = StoreAndForwardQueue::new(10, Duration::from_secs(60));
    let frame = Frame::new(FrameHeader::new(0x9999, FrameType::Data, 5, 10), vec![0x42; 16]);
    let packet = RelayPacket::new(RelayHeader::new(3, [1, 2, 3, 4], 0), frame);

    // Initial ingestion
    assert!(queue.push(packet.clone()).is_ok());

    // Acoustic echo or loop retransmission is strictly suppressed
    assert_eq!(queue.push(packet), Err(RelayError::DuplicatePacket));
    assert_eq!(queue.len(), 1);
}

#[test]
fn test_milestone1_ttl_expiry_stops_mesh_flooding() {
    let frame = Frame::new(FrameHeader::new(0x7777, FrameType::Data, 1, 1), vec![0x11; 8]);
    let mut packet = RelayPacket::new(RelayHeader::new(1 /* TTL = 1 */, [1, 1, 1, 1], 0), frame);

    // Hop 1 consumes the last remaining hop -> packet expires
    assert_eq!(packet.forward_step(), Err(RelayError::TtlExpired));
}
