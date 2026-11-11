use sounddrop_protocol::relay::{RelayError, RelayHeader, RelayPacket, StoreAndForwardQueue};
use sounddrop_protocol::{Frame, FrameHeader, FrameType};
use std::time::Duration;

#[test]
fn test_relay_packet_serialization_roundtrip() {
    let header = FrameHeader::new(0x42A1, FrameType::Data, 1, 10);
    let payload = b"Chiffrement E2EE opaque pour relais".to_vec();
    let frame = Frame::new(header, payload);

    let recipient_hash = [0xDE, 0xAD, 0xBE, 0xEF];
    let relay_hdr = RelayHeader::new(3, recipient_hash, RelayHeader::FLAG_ENCRYPTED);
    let packet = RelayPacket::new(relay_hdr, frame);

    let bytes = packet.serialize();
    assert!(bytes.len() >= 7 + 10);

    let decoded = RelayPacket::deserialize(&bytes).expect("Failed to deserialize valid relay packet");
    assert_eq!(decoded.relay.ttl, 3);
    assert_eq!(decoded.relay.hop_count, 0);
    assert_eq!(decoded.relay.recipient_hash, recipient_hash);
    assert_eq!(decoded.relay.flags, RelayHeader::FLAG_ENCRYPTED);
    assert_eq!(decoded.frame.header.session_id, 0x42A1);
    assert_eq!(decoded.frame.payload, b"Chiffrement E2EE opaque pour relais");
}

#[test]
fn test_relay_hop_decrement_and_ttl_expiry() {
    let header = FrameHeader::new(0x1010, FrameType::Data, 0, 1);
    let frame = Frame::new(header, vec![1, 2, 3, 4]);

    let relay_hdr = RelayHeader::new(2, [1, 2, 3, 4], 0);
    let mut packet = RelayPacket::new(relay_hdr, frame);

    assert_eq!(packet.relay.ttl, 2);
    assert_eq!(packet.relay.hop_count, 0);

    // Hop 1
    assert!(packet.forward_step().is_ok());
    assert_eq!(packet.relay.ttl, 1);
    assert_eq!(packet.relay.hop_count, 1);

    // Hop 2 (TTL reaches 0 -> packet expires, cannot forward further)
    assert_eq!(packet.forward_step(), Err(RelayError::TtlExpired));
}

#[test]
fn test_store_and_forward_queue_deduplication() {
    let mut queue = StoreAndForwardQueue::new(10, Duration::from_secs(60));

    let header = FrameHeader::new(0x5555, FrameType::Data, 7, 20);
    let frame = Frame::new(header, vec![0xAA; 16]);
    let packet = RelayPacket::new(RelayHeader::new(3, [0, 0, 0, 1], 0), frame);

    // First push succeeds
    assert!(queue.push(packet.clone()).is_ok());
    assert_eq!(queue.len(), 1);

    // Duplicate push (same session_id, same seq_num) is rejected
    assert_eq!(queue.push(packet), Err(RelayError::DuplicatePacket));
    assert_eq!(queue.len(), 1);
}

#[test]
fn test_store_and_forward_matching_recipient() {
    let mut queue = StoreAndForwardQueue::new(10, Duration::from_secs(60));

    let hash_charlie = [0xCA, 0xFE, 0xBA, 0xBE];
    let hash_david = [0x12, 0x34, 0x56, 0x78];

    // Packet for Charlie
    let f1 = Frame::new(FrameHeader::new(0x100, FrameType::Data, 1, 2), b"Pour Charlie 1".to_vec());
    let p1 = RelayPacket::new(RelayHeader::new(3, hash_charlie, 0), f1);

    // Packet for David
    let f2 = Frame::new(FrameHeader::new(0x200, FrameType::Data, 1, 1), b"Pour David".to_vec());
    let p2 = RelayPacket::new(RelayHeader::new(3, hash_david, 0), f2);

    // Another packet for Charlie
    let f3 = Frame::new(FrameHeader::new(0x100, FrameType::Data, 2, 2), b"Pour Charlie 2".to_vec());
    let p3 = RelayPacket::new(RelayHeader::new(3, hash_charlie, 0), f3);

    queue.push(p1).unwrap();
    queue.push(p2).unwrap();
    queue.push(p3).unwrap();
    assert_eq!(queue.len(), 3);

    // Charlie is encountered -> drain packets for Charlie
    let charlie_packets = queue.drain_for_recipient(&hash_charlie);
    assert_eq!(charlie_packets.len(), 2);
    assert_eq!(charlie_packets[0].frame.payload, b"Pour Charlie 1");
    assert_eq!(charlie_packets[1].frame.payload, b"Pour Charlie 2");

    // David's packet is still waiting in queue
    assert_eq!(queue.len(), 1);
    let david_packets = queue.drain_for_recipient(&hash_david);
    assert_eq!(david_packets.len(), 1);
    assert_eq!(david_packets[0].frame.payload, b"Pour David");
    assert_eq!(queue.len(), 0);
}

#[test]
fn test_corrupted_relay_packet_rejected() {
    let header = FrameHeader::new(0x7777, FrameType::Data, 0, 1);
    let frame = Frame::new(header, b"Ne pas modifier".to_vec());
    let packet = RelayPacket::new(RelayHeader::new(3, [1, 1, 1, 1], 0), frame);

    let mut bytes = packet.serialize();
    // Tamper with payload byte inside inner frame
    bytes[12] ^= 0xFF;

    let res = RelayPacket::deserialize(&bytes);
    assert!(matches!(res, Err(RelayError::Protocol(_))));
}
