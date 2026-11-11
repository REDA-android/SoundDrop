//! Store-and-Forward delay-tolerant queue for SoundDrop Orbital Relay.
//! Buffers emergency messages while waiting for satellite passes or line-of-sight.

use crate::packet::{OrbitalError, SatellitePacket};
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

pub const DEFAULT_MAX_QUEUE_CAPACITY: usize = 64;
pub const DEFAULT_ORBITAL_TTL_SECS: u64 = 86400; // 24-hour expiration

#[derive(Debug)]
pub struct OrbitalStoreAndForwardQueue {
    queue: VecDeque<(SatellitePacket, Instant)>,
    seen_messages: HashMap<([u8; 4], u16), Instant>, // (recipient_hash, msg_id) -> timestamp
    max_capacity: usize,
    packet_ttl: Duration,
}

impl Default for OrbitalStoreAndForwardQueue {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_QUEUE_CAPACITY, Duration::from_secs(DEFAULT_ORBITAL_TTL_SECS))
    }
}

impl OrbitalStoreAndForwardQueue {
    pub fn new(max_capacity: usize, packet_ttl: Duration) -> Self {
        Self {
            queue: VecDeque::with_capacity(max_capacity),
            seen_messages: HashMap::new(),
            max_capacity,
            packet_ttl,
        }
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    /// Enqueue a packet. Priority packets (SOS) are inserted at the front of normal packets!
    pub fn push(&mut self, packet: SatellitePacket) -> Result<(), OrbitalError> {
        self.prune_expired();

        let key = (packet.header.recipient_hash, packet.header.msg_id);
        if self.seen_messages.contains_key(&key) {
            return Ok(()); // Deduplicated without error
        }

        if self.queue.len() >= self.max_capacity {
            // Evict oldest non-priority packet if possible
            if let Some(pos) = self.queue.iter().position(|(p, _)| !p.is_priority()) {
                let (evicted, _) = self.queue.remove(pos).unwrap();
                self.seen_messages.remove(&(evicted.header.recipient_hash, evicted.header.msg_id));
            } else {
                return Err(OrbitalError::QueueFull);
            }
        }

        let now = Instant::now();
        self.seen_messages.insert(key, now);

        if packet.is_priority() {
            // Priority packets go to the front
            self.queue.push_front((packet, now));
        } else {
            self.queue.push_back((packet, now));
        }

        Ok(())
    }

    /// Pop next packet to transmit via satellite uplink
    pub fn pop_next(&mut self) -> Option<SatellitePacket> {
        self.prune_expired();
        self.queue.pop_front().map(|(p, _)| p)
    }

    /// Peek at next packet without removing
    pub fn peek_next(&self) -> Option<&SatellitePacket> {
        self.queue.front().map(|(p, _)| p)
    }

    /// Drain all packets matching a specific recipient hash
    pub fn drain_for_recipient(&mut self, recipient_hash: &[u8; 4]) -> Vec<SatellitePacket> {
        self.prune_expired();
        let mut matched = Vec::new();
        let mut remaining = VecDeque::with_capacity(self.queue.len());

        while let Some((packet, ts)) = self.queue.pop_front() {
            if &packet.header.recipient_hash == recipient_hash {
                matched.push(packet);
            } else {
                remaining.push_back((packet, ts));
            }
        }
        self.queue = remaining;
        matched
    }

    pub fn prune_expired(&mut self) {
        let now = Instant::now();
        let ttl = self.packet_ttl;
        self.queue.retain(|(_, ts)| now.duration_since(*ts) < ttl);
        self.seen_messages.retain(|_, ts| now.duration_since(*ts) < ttl);
    }
}
