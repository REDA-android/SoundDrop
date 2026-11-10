use crate::packet::NodeId;
use std::collections::{HashSet, VecDeque};

pub struct DeduplicationTable {
    capacity: usize,
    seen_set: HashSet<(NodeId, u16)>,
    order_queue: VecDeque<(NodeId, u16)>,
}

impl DeduplicationTable {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            seen_set: HashSet::with_capacity(capacity),
            order_queue: VecDeque::with_capacity(capacity),
        }
    }

    /// Checks if a packet has already been observed.
    pub fn is_duplicate(&self, src: NodeId, packet_id: u16) -> bool {
        self.seen_set.contains(&(src, packet_id))
    }

    /// Marks a packet as seen.
    /// Returns `true` if the packet was newly recorded, or `false` if it was already known.
    pub fn record(&mut self, src: NodeId, packet_id: u16) -> bool {
        let key = (src, packet_id);
        if self.seen_set.contains(&key) {
            return false;
        }

        if self.seen_set.len() >= self.capacity {
            if let Some(oldest) = self.order_queue.pop_front() {
                self.seen_set.remove(&oldest);
            }
        }

        self.seen_set.insert(key);
        self.order_queue.push_back(key);
        true
    }

    pub fn len(&self) -> usize {
        self.seen_set.len()
    }

    pub fn is_empty(&self) -> bool {
        self.seen_set.is_empty()
    }

    pub fn clear(&mut self) {
        self.seen_set.clear();
        self.order_queue.clear();
    }
}

impl Default for DeduplicationTable {
    fn default() -> Self {
        Self::new(256)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dedup_records_and_detects_duplicates() {
        let mut table = DeduplicationTable::new(10);
        let src = NodeId(0x100);

        assert!(table.record(src, 1));
        assert!(table.is_duplicate(src, 1));
        assert!(!table.record(src, 1)); // Second attempt returns false

        assert!(table.record(src, 2));
        assert!(table.is_duplicate(src, 2));
    }

    #[test]
    fn test_dedup_eviction_on_capacity() {
        let mut table = DeduplicationTable::new(3);
        let src = NodeId(0x100);

        table.record(src, 1);
        table.record(src, 2);
        table.record(src, 3);
        assert_eq!(table.len(), 3);

        // Recording 4 should evict 1
        table.record(src, 4);
        assert_eq!(table.len(), 3);
        assert!(!table.is_duplicate(src, 1));
        assert!(table.is_duplicate(src, 2));
        assert!(table.is_duplicate(src, 3));
        assert!(table.is_duplicate(src, 4));
    }
}
