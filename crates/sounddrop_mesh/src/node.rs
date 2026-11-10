use crate::dedup::DeduplicationTable;
use crate::packet::{
    MeshPacket, NodeId, PacketError, FLAG_DIRECTED, FLAG_FLOOD,
};
use crate::routing::RoutingTable;
use std::collections::VecDeque;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeAction {
    /// Packet was addressed to this node and delivered to local inbox.
    Delivered(MeshPacket),
    /// Broadcast packet was delivered to local inbox and also queued for re-broadcast.
    DeliveredAndRelayed(MeshPacket),
    /// Packet was addressed to another node and queued in outbox for relaying.
    Relayed(MeshPacket),
    /// Duplicate packet was suppressed.
    DroppedDuplicate { src: NodeId, packet_id: u16 },
    /// Packet was dropped because its TTL expired (reached 0).
    DroppedTtlExpired { packet: MeshPacket },
}

pub struct MeshRelayNode {
    pub id: NodeId,
    pub dedup: DeduplicationTable,
    pub routing: RoutingTable,
    pub inbox: Vec<MeshPacket>,
    pub outbox: VecDeque<MeshPacket>,
    pub next_packet_id: u16,
    pub relayed_count: u64,
    pub dropped_dedup_count: u64,
    pub dropped_ttl_count: u64,
    pub delivered_count: u64,
}

impl MeshRelayNode {
    pub fn new(id: NodeId) -> Self {
        Self {
            id,
            dedup: DeduplicationTable::default(),
            routing: RoutingTable::new(),
            inbox: Vec::new(),
            outbox: VecDeque::new(),
            next_packet_id: 1,
            relayed_count: 0,
            dropped_dedup_count: 0,
            dropped_ttl_count: 0,
            delivered_count: 0,
        }
    }

    /// Originates a new mesh packet from this node and queues it into the outbox.
    pub fn send_packet(
        &mut self,
        dst: NodeId,
        payload: Vec<u8>,
        ttl: u8,
    ) -> Result<MeshPacket, PacketError> {
        let packet_id = self.next_packet_id;
        self.next_packet_id = self.next_packet_id.wrapping_add(1);
        if self.next_packet_id == 0 {
            self.next_packet_id = 1;
        }

        let flags = if dst.is_broadcast() {
            FLAG_FLOOD
        } else if self.routing.lookup(dst).is_some() {
            FLAG_DIRECTED
        } else {
            FLAG_FLOOD
        };

        let packet = MeshPacket::new(self.id, dst, packet_id, ttl, flags, payload)?;

        // Record locally originated packet to prevent echoing
        self.dedup.record(self.id, packet_id);
        self.outbox.push_back(packet.clone());

        Ok(packet)
    }

    /// Processes an incoming acoustic frame/packet received from a neighbor.
    pub fn process_incoming_packet(
        &mut self,
        mut packet: MeshPacket,
        prev_hop: NodeId,
    ) -> NodeAction {
        // 1. Check deduplication
        if self.dedup.is_duplicate(packet.header.src, packet.header.packet_id) {
            self.dropped_dedup_count += 1;
            return NodeAction::DroppedDuplicate {
                src: packet.header.src,
                packet_id: packet.header.packet_id,
            };
        }

        // 2. Mark packet as seen
        self.dedup.record(packet.header.src, packet.header.packet_id);

        // 3. Learn reverse routing path to sender
        self.routing
            .learn_route(packet.header.src, prev_hop, packet.header.hop_count + 1);

        // 4. Destination assessment
        let is_for_me = packet.header.dst == self.id;
        let is_broadcast = packet.header.dst.is_broadcast();

        if is_for_me {
            self.delivered_count += 1;
            self.inbox.push(packet.clone());
            NodeAction::Delivered(packet)
        } else if is_broadcast {
            self.delivered_count += 1;
            self.inbox.push(packet.clone());

            // Relay broadcast further if TTL permits
            if packet.header.ttl > 1 {
                packet.header.ttl -= 1;
                packet.header.hop_count += 1;
                self.relayed_count += 1;
                self.outbox.push_back(packet.clone());
                NodeAction::DeliveredAndRelayed(packet)
            } else {
                NodeAction::Delivered(packet)
            }
        } else {
            // Forward packet to next hop
            if packet.header.ttl <= 1 {
                self.dropped_ttl_count += 1;
                NodeAction::DroppedTtlExpired { packet }
            } else {
                packet.header.ttl -= 1;
                packet.header.hop_count += 1;
                self.relayed_count += 1;
                self.outbox.push_back(packet.clone());
                NodeAction::Relayed(packet)
            }
        }
    }

    /// Pops the next packet ready for acoustic transmission.
    pub fn pop_outbox(&mut self) -> Option<MeshPacket> {
        self.outbox.pop_front()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_drops_duplicate_packets() {
        let mut node = MeshRelayNode::new(NodeId(0x0002));
        let packet = MeshPacket::new(
            NodeId(0x0001),
            NodeId(0x0003),
            100,
            4,
            FLAG_FLOOD,
            b"Duplicate test".to_vec(),
        )
        .unwrap();

        let action1 = node.process_incoming_packet(packet.clone(), NodeId(0x0001));
        assert!(matches!(action1, NodeAction::Relayed(_)));

        let action2 = node.process_incoming_packet(packet, NodeId(0x0001));
        assert!(matches!(action2, NodeAction::DroppedDuplicate { .. }));
        assert_eq!(node.dropped_dedup_count, 1);
    }

    #[test]
    fn test_node_drops_packet_when_ttl_expires() {
        let mut node = MeshRelayNode::new(NodeId(0x0002));
        let packet = MeshPacket::new(
            NodeId(0x0001),
            NodeId(0x0003),
            101,
            1, // TTL = 1, so relay node cannot decrement further
            FLAG_FLOOD,
            b"Expired packet".to_vec(),
        )
        .unwrap();

        let action = node.process_incoming_packet(packet, NodeId(0x0001));
        assert!(matches!(action, NodeAction::DroppedTtlExpired { .. }));
        assert_eq!(node.dropped_ttl_count, 1);
        assert_eq!(node.relayed_count, 0);
    }
}
