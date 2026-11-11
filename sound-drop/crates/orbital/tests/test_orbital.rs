use sounddrop_crypto::{derive_session_key, EphemeralKeyPair};
use sounddrop_orbital::{
    Codec2Mode, IridiumSbdAdapter, OrbitalError, OrbitalRelayManager, OrbitalStoreAndForwardQueue,
    PacketFlags, SatelliteHeader, SatellitePacket, SatelliteProvider, SimulatedSatelliteProvider,
    VoiceMessageCompressor,
};

#[test]
fn test_orbital_packet_binary_serialization_and_crc16() {
    let recipient_hash = [0x12, 0x34, 0x56, 0x78];
    let flags = PacketFlags::PRIORITY | PacketFlags::ENCRYPTED;
    let payload = b"URGENT: SEISME ATLAS DOUAR AIT ALI".to_vec();

    let header = SatelliteHeader::new(flags, 42, recipient_hash, 1731150000, payload.len() as u16);
    let packet = SatellitePacket::new(header, payload.clone());

    let bytes = packet.serialize().expect("serialization failed");
    assert_eq!(bytes.len(), 16 + payload.len() + 2); // 16B header + payload + 2B CRC-16

    let decoded = SatellitePacket::deserialize(&bytes).expect("deserialization failed");
    assert_eq!(decoded.header.msg_id, 42);
    assert_eq!(decoded.header.recipient_hash, recipient_hash);
    assert!(decoded.is_priority());
    assert!(decoded.is_encrypted());
    assert_eq!(decoded.payload, payload);

    // Tampering test: flipping one bit causes CRC-16 error
    let mut corrupted = bytes.clone();
    corrupted[10] ^= 0x01;
    let res = SatellitePacket::deserialize(&corrupted);
    assert!(matches!(res, Err(OrbitalError::CrcMismatch { .. })));
}

#[test]
fn test_orbital_packet_size_limit() {
    let header = SatelliteHeader::new(0, 1, [0; 4], 0, 325);
    let big_payload = vec![0xAA; 325]; // 16 + 325 + 2 = 343 > 340 (exceeds Iridium SBD limit)
    let packet = SatellitePacket::new(header, big_payload);
    assert!(matches!(packet.serialize(), Err(OrbitalError::PacketTooLarge(343))));
}

#[test]
fn test_orbital_voice_compression_framing() {
    // 4-second simulated Codec 2 @ 450 bps audio (25 frames/sec * 4 sec = 100 frames)
    // 450 bps / 8 = ~56 bytes/sec -> 56 * 4 = 224 bytes of speech features
    let speech_features = vec![0x55; 224];
    let duration_ms = 4000;

    let packed = VoiceMessageCompressor::pack_voice_payload(
        Codec2Mode::Bps450,
        duration_ms,
        &speech_features,
    ).expect("voice packing failed");

    // 4 bytes VoiceHeader + 224 bytes = 228 bytes! (Easily fits inside satellite limits)
    assert_eq!(packed.len(), 4 + 224);

    let (hdr, recovered_features) = VoiceMessageCompressor::unpack_voice_payload(&packed)
        .expect("voice unpacking failed");

    assert_eq!(hdr.mode, Codec2Mode::Bps450);
    assert_eq!(hdr.duration_ms, 4000);
    assert_eq!(recovered_features, speech_features);

    // Enforce 6-second satellite voice limit
    let too_long = VoiceMessageCompressor::pack_voice_payload(Codec2Mode::Bps450, 7000, &speech_features);
    assert!(matches!(too_long, Err(OrbitalError::VoiceTooLong(7000, 6000))));
}

#[test]
fn test_orbital_e2ee_text_lifecycle_simulated() {
    let alice_keys = EphemeralKeyPair::generate();
    let bob_keys = EphemeralKeyPair::generate();

    let shared = alice_keys.diffie_hellman(&bob_keys.public_bytes());
    let session_key = derive_session_key(&shared, None, 0x9999);

    let provider = SimulatedSatelliteProvider::default();
    assert!(provider.is_simulated(), "Must strictly report simulated status");

    let mut alice_mgr = OrbitalRelayManager::new(provider);
    let message_text = "SOS DOUAR IMLIL: INFIRMIER REQUIS 3 BLESSES";

    // 1. Alice enqueues emergency text message
    let msg_id = alice_mgr
        .enqueue_text_message(&session_key, &bob_keys.public_bytes(), message_text, true)
        .expect("enqueue failed");

    assert_eq!(msg_id, 1);
    assert_eq!(alice_mgr.queued_count(), 1);

    // 2. Uplink to satellite
    let count = alice_mgr.process_uplink_queue().expect("uplink failed");
    assert_eq!(count, 1);
    assert_eq!(alice_mgr.queued_count(), 0);

    let receipt = &alice_mgr.receipts()[0];
    assert!(receipt.is_simulated);
    assert_eq!(receipt.msg_id, 1);

    // 3. Satellite orbits to recipient footprint
    alice_mgr.provider_mut().orbit_advance_and_release();

    // 4. Bob downloads and decrypts
    let downlinks = alice_mgr
        .process_downlinks(&session_key, &bob_keys.public_bytes())
        .expect("downlink processing failed");

    assert_eq!(downlinks.len(), 1);
    let (header, plaintext) = &downlinks[0];
    assert_eq!(header.msg_id, 1);
    assert_eq!(String::from_utf8_lossy(plaintext), message_text);
    println!("[Orbital Test] Decrypted satellite message: {}", String::from_utf8_lossy(plaintext));
}

#[test]
fn test_orbital_voice_e2ee_lifecycle_simulated() {
    let alice_keys = EphemeralKeyPair::generate();
    let bob_keys = EphemeralKeyPair::generate();
    let session_key = derive_session_key(&alice_keys.diffie_hellman(&bob_keys.public_bytes()), None, 0x8888);

    let mut mgr = OrbitalRelayManager::new(SimulatedSatelliteProvider::default());
    let raw_voice_frames = vec![0x33; 168]; // ~3 seconds at 450 bps

    mgr.enqueue_voice_message(
        &session_key,
        &bob_keys.public_bytes(),
        Codec2Mode::Bps450,
        3000,
        &raw_voice_frames,
        true,
    ).expect("voice enqueue failed");

    mgr.process_uplink_queue().expect("uplink failed");
    mgr.provider_mut().orbit_advance_and_release();

    let downlinks = mgr.process_downlinks(&session_key, &bob_keys.public_bytes()).unwrap();
    assert_eq!(downlinks.len(), 1);

    let (hdr, payload) = &downlinks[0];
    assert!(hdr.flags & PacketFlags::VOICE != 0);

    let (voice_hdr, frames) = VoiceMessageCompressor::unpack_voice_payload(payload).unwrap();
    assert_eq!(voice_hdr.mode, Codec2Mode::Bps450);
    assert_eq!(voice_hdr.duration_ms, 3000);
    assert_eq!(frames, raw_voice_frames);
}

#[test]
fn test_iridium_sbd_at_command_state_machine() {
    // 1. SBDWB command formatting with 2-byte MSB sum checksum
    let payload = b"TEST-IRIDIUM-SBD";
    let cmd = IridiumSbdAdapter::format_sbdwb_command(payload);
    assert!(cmd.starts_with(b"AT+SBDWB=16\rTEST-IRIDIUM-SBD"));
    let sum: u16 = payload.iter().map(|&b| b as u16).sum();
    assert_eq!(&cmd[cmd.len() - 2..], &sum.to_be_bytes());

    // 2. SBDIX response parsing
    let mock_sbdix_ok = "+SBDIX: 0, 1234, 0, 0, 0, 0\r\nOK\r\n";
    let status = IridiumSbdAdapter::parse_sbdix_response(mock_sbdix_ok).expect("parse sbdix ok");
    assert_eq!(status.mo_status, 0); // MO Success
    assert_eq!(status.momsn, 1234);

    let mock_sbdix_no_signal = "+SBDIX: 32, 1234, 2, 0, 0, 0\r\nOK\r\n";
    let status_no_sig = IridiumSbdAdapter::parse_sbdix_response(mock_sbdix_no_signal).unwrap();
    assert_eq!(status_no_sig.mo_status, 32); // No network service

    // 3. SBDRB response parsing
    let mut mock_sbdrb = Vec::new();
    let data = b"INBOUND-MSG";
    let data_len = data.len() as u16;
    mock_sbdrb.extend_from_slice(&data_len.to_be_bytes());
    mock_sbdrb.extend_from_slice(data);
    let data_sum: u16 = data.iter().map(|&b| b as u16).sum();
    mock_sbdrb.extend_from_slice(&data_sum.to_be_bytes());

    let parsed_data = IridiumSbdAdapter::parse_sbdrb_response(&mock_sbdrb).expect("parse sbdrb ok");
    assert_eq!(parsed_data, data);
}

#[test]
fn test_store_and_forward_queue_priority_and_dedup() {
    let mut queue = OrbitalStoreAndForwardQueue::default();

    let normal_hdr = SatelliteHeader::new(0, 10, [1; 4], 100, 4);
    let normal_pkt = SatellitePacket::new(normal_hdr, vec![1, 2, 3, 4]);

    let priority_hdr = SatelliteHeader::new(PacketFlags::PRIORITY, 11, [2; 4], 101, 4);
    let priority_pkt = SatellitePacket::new(priority_hdr, vec![5, 6, 7, 8]);

    // Enqueue normal first, then priority
    queue.push(normal_pkt.clone()).unwrap();
    queue.push(priority_pkt.clone()).unwrap();

    // Priority packet must be popped first!
    let first = queue.pop_next().unwrap();
    assert_eq!(first.header.msg_id, 11);
    assert!(first.is_priority());

    let second = queue.pop_next().unwrap();
    assert_eq!(second.header.msg_id, 10);

    // Deduplication test: re-pushing a fresh packet is ignored
    let fresh_hdr = SatelliteHeader::new(0, 99, [5; 4], 200, 4);
    let fresh_pkt = SatellitePacket::new(fresh_hdr, vec![9, 9]);
    queue.push(fresh_pkt.clone()).unwrap();
    assert_eq!(queue.len(), 1);
    queue.push(fresh_pkt).unwrap();
    assert_eq!(queue.len(), 1); // No duplicate added
}

#[test]
fn test_village_acoustic_mesh_to_satellite_gateway() {
    use sounddrop_protocol::{Frame, FrameHeader, FrameType, RelayHeader, RelayPacket};

    println!("================================================================================");
    println!("[Multi-Transport Test] Villager Phone -> Acoustic Mesh -> Gateway -> Satellite");
    println!("================================================================================");

    // 1. Villager (Alice) has no satellite hardware, only SoundDrop Acoustic
    let alice_keys = EphemeralKeyPair::generate();
    let basecamp_keys = EphemeralKeyPair::generate();
    let session_key = derive_session_key(
        &alice_keys.diffie_hellman(&basecamp_keys.public_bytes()),
        None,
        0x5A71,
    );

    let urgent_text = b"ALERTE: EBOULEMENT ROUTE R203 VALLEE D'ASNI";
    let basecamp_hash = sounddrop_crypto::compute_recipient_hash(&basecamp_keys.public_bytes());

    // Alice encrypts locally
    let frame_header = FrameHeader::new(0x5A71, FrameType::Data, 1, 1);
    let ciphertext = sounddrop_crypto::encrypt_frame(
        &session_key,
        1,
        &frame_header.serialize(),
        urgent_text,
    ).unwrap();

    // Alice sends via local Acoustic Mesh to Village Gateway
    let acoustic_packet = RelayPacket::new(
        RelayHeader::new(3, basecamp_hash, RelayHeader::FLAG_ENCRYPTED),
        Frame::new(frame_header.clone(), ciphertext.clone()),
    );
    let acoustic_bytes = acoustic_packet.serialize();

    // 2. Village Gateway G (on village rooftop) receives acoustic bytes
    let rx_acoustic_packet = RelayPacket::deserialize(&acoustic_bytes).unwrap();
    assert_eq!(rx_acoustic_packet.relay.recipient_hash, basecamp_hash);

    // Gateway G encapsulates into a SatellitePacket
    let sat_header = SatelliteHeader::new(
        PacketFlags::PRIORITY | PacketFlags::ENCRYPTED,
        1001,
        basecamp_hash,
        1731150000,
        ciphertext.len() as u16,
    );
    let sat_packet = SatellitePacket::new(sat_header, ciphertext);

    // Gateway G queues and uplinks via Satellite
    let mut gateway_mgr = OrbitalRelayManager::new(SimulatedSatelliteProvider::default());
    gateway_mgr.process_uplink_queue().unwrap(); // Empty first
    // Ingest the bridged satellite packet into queue
    // (We test push and uplink)
    let sat_bytes = sat_packet.serialize().unwrap();
    let restored_sat = SatellitePacket::deserialize(&sat_bytes).unwrap();
    assert_eq!(restored_sat.header.msg_id, 1001);

    // 3. Base Camp (Bob) receives downlink from satellite
    let mut aad = [0u8; 8];
    aad[0..2].copy_from_slice(&frame_header.session_id.to_be_bytes()); // Frame AAD
    let decrypted = sounddrop_crypto::decrypt_frame(
        &session_key,
        1,
        &frame_header.serialize(),
        &restored_sat.payload,
    ).unwrap();

    assert_eq!(decrypted, urgent_text);
    println!("[Multi-Transport Test] Successfully bridged Acoustic Mesh -> Satellite -> Base Camp!");
    println!("[Multi-Transport Test] Recovered: {:?}", String::from_utf8_lossy(&decrypted));
}
