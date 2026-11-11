//! Multi-hop Relay & Store-and-Forward Subsystem (Section 4.6).
//! Enables air-gapped packet relay through intermediary nodes or long-range bridges
//! while preserving End-to-End Encryption (E2EE).

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};
use thiserror::Error;

use crate::{Frame, ProtocolError};

pub const DEFAULT_MAX_HOPS: u8 = 5;
pub const MAX_STORE_QUEUE_SIZE: usize = 128;
pub const DEFAULT_PACKET_TTL_SECS: u64 = 3600; // 1 hour expiration in store-and-forward

#[derive(Error, Debug, PartialEq, Eq)]
pub enum RelayError {
    #[error("Packet TTL expired (maximum hops exceeded)")]
    TtlExpired,
    #[error("Relay header truncated (expected 7 bytes)")]
    HeaderTooShort,
    #[error("Duplicate packet detected in store queue")]
    DuplicatePacket,
    #[error("Relay queue at maximum capacity")]
    QueueFull,
    #[error("Protocol error: {0}")]
    Protocol(#[from] ProtocolError),
}

/// 7-byte Relay Routing Header
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RelayHeader {
    /// Number of remaining hops allowed before dropping
    pub ttl: u8,
    /// Number of hops already traversed
    pub hop_count: u8,
    /// Truncated recipient identifier: SHA-256(pub_dest)[0..4]
    pub recipient_hash: [u8; 4],
    /// Routing and prioritization flags
    pub flags: u8,
}

impl RelayHeader {
    pub const FLAG_REQUIRE_ACK: u8 = 0x01;
    pub const FLAG_HIGH_PRIORITY: u8 = 0x02;
    pub const FLAG_ENCRYPTED: u8 = 0x04;

    pub fn new(ttl: u8, recipient_hash: [u8; 4], flags: u8) -> Self {
        Self {
            ttl: ttl.min(DEFAULT_MAX_HOPS),
            hop_count: 0,
            recipient_hash,
            flags,
        }
    }

    pub fn serialize(&self) -> [u8; 7] {
        let mut buf = [0u8; 7];
        buf[0] = self.ttl;
        buf[1] = self.hop_count;
        buf[2..6].copy_from_slice(&self.recipient_hash);
        buf[6] = self.flags;
        buf
    }

    pub fn deserialize(buf: &[u8]) -> Result<Self, RelayError> {
        if buf.len() < 7 {
            return Err(RelayError::HeaderTooShort);
        }
        let mut recipient_hash = [0u8; 4];
        recipient_hash.copy_from_slice(&buf[2..6]);

        Ok(Self {
            ttl: buf[0],
            hop_count: buf[1],
            recipient_hash,
            flags: buf[6],
        })
    }

    /// Decrement TTL and increment hop count for next hop
    pub fn step(&mut self) -> Result<(), RelayError> {
        if self.ttl == 0 {
            return Err(RelayError::TtlExpired);
        }
        self.ttl -= 1;
        self.hop_count = self.hop_count.saturating_add(1);
        if self.ttl == 0 {
            return Err(RelayError::TtlExpired);
        }
        Ok(())
    }
}

/// An envelope wrapping an inner protocol Frame with multi-hop relay metadata
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RelayPacket {
    pub relay: RelayHeader,
    pub frame: Frame,
}

impl RelayPacket {
    pub fn new(relay: RelayHeader, frame: Frame) -> Self {
        Self { relay, frame }
    }

    /// Serialize relay packet: [RelayHeader (7B)][Inner Frame with CRC]
    pub fn serialize(&self) -> Vec<u8> {
        let inner = self.frame.serialize();
        let mut buf = Vec::with_capacity(7 + inner.len());
        buf.extend_from_slice(&self.relay.serialize());
        buf.extend_from_slice(&inner);
        buf
    }

    /// Deserialize relay packet and verify inner frame CRC
    pub fn deserialize(buf: &[u8]) -> Result<Self, RelayError> {
        if buf.len() < 7 + 10 {
            return Err(RelayError::HeaderTooShort);
        }
        let relay = RelayHeader::deserialize(&buf[0..7])?;
        let frame = Frame::deserialize(&buf[7..])?;
        Ok(Self { relay, frame })
    }

    /// Advance one hop in the relay path
    pub fn forward_step(&mut self) -> Result<(), RelayError> {
        self.relay.step()
    }
}

/// Store-and-Forward memory queue for intermediary nodes and data mules
#[derive(Debug)]
pub struct StoreAndForwardQueue {
    queue: VecDeque<(RelayPacket, Instant)>,
    seen_packets: HashMap<(u16, u16), Instant>, // (session_id, seq_num) -> first_seen
    max_capacity: usize,
    packet_ttl: Duration,
}

impl Default for StoreAndForwardQueue {
    fn default() -> Self {
        Self::new(MAX_STORE_QUEUE_SIZE, Duration::from_secs(DEFAULT_PACKET_TTL_SECS))
    }
}

impl StoreAndForwardQueue {
    pub fn new(max_capacity: usize, packet_ttl: Duration) -> Self {
        Self {
            queue: VecDeque::with_capacity(max_capacity),
            seen_packets: HashMap::new(),
            max_capacity,
            packet_ttl,
        }
    }

    /// Current count of packets held in queue
    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    /// Ingest a relay packet into the queue (with deduplication and capacity check)
    pub fn push(&mut self, packet: RelayPacket) -> Result<(), RelayError> {
        self.prune_expired();

        let key = (packet.frame.header.session_id, packet.frame.header.seq_num);
        if self.seen_packets.contains_key(&key) {
            return Err(RelayError::DuplicatePacket);
        }

        if self.queue.len() >= self.max_capacity {
            // Evict oldest packet to make room for new ingress
            if let Some((evicted, _)) = self.queue.pop_front() {
                let ev_key = (evicted.frame.header.session_id, evicted.frame.header.seq_num);
                self.seen_packets.remove(&ev_key);
            }
        }

        let now = Instant::now();
        self.seen_packets.insert(key, now);
        self.queue.push_back((packet, now));
        Ok(())
    }

    /// Extract all packets destined for a specific recipient hash (when recipient is detected)
    pub fn drain_for_recipient(&mut self, recipient_hash: &[u8; 4]) -> Vec<RelayPacket> {
        self.prune_expired();

        let mut matched = Vec::new();
        let mut remaining = VecDeque::with_capacity(self.queue.len());

        while let Some((packet, ts)) = self.queue.pop_front() {
            if &packet.relay.recipient_hash == recipient_hash {
                matched.push(packet);
            } else {
                remaining.push_back((packet, ts));
            }
        }

        self.queue = remaining;
        matched
    }

    /// Retrieve the next packet to forward (for blind hop propagation)
    pub fn pop_next_to_forward(&mut self) -> Option<RelayPacket> {
        self.prune_expired();
        self.queue.pop_front().map(|(p, _)| p)
    }

    /// Prune expired packets from queue and deduplication cache
    pub fn prune_expired(&mut self) {
        let now = Instant::now();
        let ttl = self.packet_ttl;

        self.queue.retain(|(_, ts)| now.duration_since(*ts) < ttl);
        self.seen_packets.retain(|_, ts| now.duration_since(*ts) < ttl);
    }
}
