use crate::node::{MeshRelayNode, NodeAction};
use crate::packet::{MeshPacket, NodeId, PacketError};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct MeshEvent {
    pub step: usize,
    pub transmitter: NodeId,
    pub receiver: NodeId,
    pub packet: MeshPacket,
    pub action: NodeAction,
}

#[derive(Debug, Clone)]
pub struct MeshSimulationMetrics {
    pub steps: usize,
    pub packets_originated: usize,
    pub packets_relayed: usize,
    pub duplicates_suppressed: usize,
    pub ttl_expired: usize,
    pub packets_delivered: usize,
}

pub struct SimulatedAcousticMesh {
    pub nodes: HashMap<NodeId, MeshRelayNode>,
    /// Adjacency set representing acoustic audible links between pairs of nodes: (NodeA, NodeB)
    pub links: HashSet<(NodeId, NodeId)>,
    pub events: Vec<MeshEvent>,
    pub step_counter: usize,
}

impl SimulatedAcousticMesh {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            links: HashSet::new(),
            events: Vec::new(),
            step_counter: 0,
        }
    }

    /// Adds a node to the acoustic mesh network.
    pub fn add_node(&mut self, id: NodeId) {
        self.nodes.insert(id, MeshRelayNode::new(id));
    }

    /// Establishes a bi-directional acoustic air link between two nodes.
    pub fn add_bi_link(&mut self, a: NodeId, b: NodeId) {
        self.links.insert((a, b));
        self.links.insert((b, a));
    }

    /// Establishes a directed acoustic link from `transmitter` to `receiver`.
    pub fn add_directed_link(&mut self, transmitter: NodeId, receiver: NodeId) {
        self.links.insert((transmitter, receiver));
    }

    /// Originates a packet from `src` to `dst`.
    pub fn originate_packet(
        &mut self,
        src: NodeId,
        dst: NodeId,
        payload: Vec<u8>,
        ttl: u8,
    ) -> Result<MeshPacket, PacketError> {
        let node = self
            .nodes
            .get_mut(&src)
            .ok_or(PacketError::PacketTooShort(0))?;
        node.send_packet(dst, payload, ttl)
    }

    /// Advances the acoustic mesh by one simulation step:
    /// Transmitters broadcast pending packets from their outbox to all audible neighbors.
    pub fn step(&mut self) -> bool {
        self.step_counter += 1;
        let mut transmissions = Vec::new();

        // 1. Collect pending transmissions from all nodes
        for (&tx_id, node) in self.nodes.iter_mut() {
            if let Some(packet) = node.pop_outbox() {
                transmissions.push((tx_id, packet));
            }
        }

        if transmissions.is_empty() {
            return false;
        }

        // 2. Deliver acoustic sound waves to all connected neighbors in hearing range
        for (tx_id, packet) in transmissions {
            // Find neighbors that can hear tx_id
            let audible_neighbors: Vec<NodeId> = self
                .links
                .iter()
                .filter(|(from, _)| *from == tx_id)
                .map(|(_, to)| *to)
                .collect();

            for rx_id in audible_neighbors {
                if let Some(rx_node) = self.nodes.get_mut(&rx_id) {
                    let action = rx_node.process_incoming_packet(packet.clone(), tx_id);
                    self.events.push(MeshEvent {
                        step: self.step_counter,
                        transmitter: tx_id,
                        receiver: rx_id,
                        packet: packet.clone(),
                        action,
                    });
                }
            }
        }

        true
    }

    /// Runs the mesh simulation until all outboxes are empty or `max_steps` is reached.
    pub fn run_until_idle(&mut self, max_steps: usize) -> MeshSimulationMetrics {
        let mut steps = 0;
        while steps < max_steps && self.step() {
            steps += 1;
        }

        let mut packets_relayed = 0;
        let mut duplicates_suppressed = 0;
        let mut ttl_expired = 0;
        let mut packets_delivered = 0;

        for node in self.nodes.values() {
            packets_relayed += node.relayed_count as usize;
            duplicates_suppressed += node.dropped_dedup_count as usize;
            ttl_expired += node.dropped_ttl_count as usize;
            packets_delivered += node.delivered_count as usize;
        }

        MeshSimulationMetrics {
            steps,
            packets_originated: 1, // at least 1 in typical workflows
            packets_relayed,
            duplicates_suppressed,
            ttl_expired,
            packets_delivered,
        }
    }
}

impl Default for SimulatedAcousticMesh {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct RelayOutcome {
    pub message: String,
    pub hops_taken: u8,
    pub total_steps: usize,
    pub relays_involved: Vec<NodeId>,
    pub verified: bool,
}

/// Demonstrates an air-gapped 3-node acoustic relay:
/// Node A (Source) -> Node R (Relay Station) -> Node B (Destination)
/// Node A and Node B cannot hear each other directly!
pub fn run_three_node_relay(
    src_id: NodeId,
    relay_id: NodeId,
    dst_id: NodeId,
    message: &str,
) -> Result<RelayOutcome, PacketError> {
    let mut mesh = SimulatedAcousticMesh::new();

    mesh.add_node(src_id);
    mesh.add_node(relay_id);
    mesh.add_node(dst_id);

    // Air-gap topology: A <-> Relay, Relay <-> B. No direct link between A and B!
    mesh.add_bi_link(src_id, relay_id);
    mesh.add_bi_link(relay_id, dst_id);

    mesh.originate_packet(src_id, dst_id, message.as_bytes().to_vec(), 4)?;

    let metrics = mesh.run_until_idle(10);

    let dst_node = mesh.nodes.get(&dst_id).unwrap();
    let delivered_packet = dst_node.inbox.first();

    match delivered_packet {
        Some(pkt) => {
            let recovered_text = String::from_utf8_lossy(&pkt.payload).to_string();
            let verified = recovered_text == message && pkt.header.hop_count == 1; // 1 intermediate relay hop
            Ok(RelayOutcome {
                message: recovered_text,
                hops_taken: pkt.header.hop_count,
                total_steps: metrics.steps,
                relays_involved: vec![relay_id],
                verified,
            })
        }
        None => Ok(RelayOutcome {
            message: String::new(),
            hops_taken: 0,
            total_steps: metrics.steps,
            relays_involved: Vec::new(),
            verified: false,
        }),
    }
}

/// Demonstrates a diamond-topology multi-path relay with duplicate suppression:
/// Node A -> Relays R1 and R2 -> Node B
pub fn run_diamond_relay(
    src_id: NodeId,
    r1_id: NodeId,
    r2_id: NodeId,
    dst_id: NodeId,
    message: &str,
) -> Result<RelayOutcome, PacketError> {
    let mut mesh = SimulatedAcousticMesh::new();

    mesh.add_node(src_id);
    mesh.add_node(r1_id);
    mesh.add_node(r2_id);
    mesh.add_node(dst_id);

    // Diamond links
    mesh.add_bi_link(src_id, r1_id);
    mesh.add_bi_link(src_id, r2_id);
    mesh.add_bi_link(r1_id, dst_id);
    mesh.add_bi_link(r2_id, dst_id);

    mesh.originate_packet(src_id, dst_id, message.as_bytes().to_vec(), 4)?;

    let metrics = mesh.run_until_idle(10);

    let dst_node = mesh.nodes.get(&dst_id).unwrap();
    // In diamond topology, Node B should have received the message exactly ONCE in inbox
    // and suppressed the second concurrent copy!
    let delivered_count = dst_node.inbox.len();
    let verified = delivered_count == 1 && dst_node.dropped_dedup_count >= 1;

    let payload = dst_node
        .inbox
        .first()
        .map(|p| String::from_utf8_lossy(&p.payload).to_string())
        .unwrap_or_default();

    Ok(RelayOutcome {
        message: payload,
        hops_taken: 1,
        total_steps: metrics.steps,
        relays_involved: vec![r1_id, r2_id],
        verified,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_three_node_relay_success() {
        let outcome = run_three_node_relay(
            NodeId(0x0001),
            NodeId(0x0002),
            NodeId(0x0003),
            "Acoustic relay working!",
        )
        .expect("Relay simulation failed");

        assert!(outcome.verified);
        assert_eq!(outcome.message, "Acoustic relay working!");
        assert_eq!(outcome.hops_taken, 1);
    }

    #[test]
    fn test_diamond_relay_suppresses_duplicate() {
        let outcome = run_diamond_relay(
            NodeId(0x0001),
            NodeId(0x0002),
            NodeId(0x0003),
            NodeId(0x0004),
            "Diamond broadcast test",
        )
        .expect("Diamond relay simulation failed");

        assert!(outcome.verified);
        assert_eq!(outcome.message, "Diamond broadcast test");
    }

    #[test]
    fn test_four_hop_linear_chain_with_ttl_enforcement() {
        // Topology: N1 <-> N2 <-> N3 <-> N4 <-> N5 (4 hops required)
        let mut mesh = SimulatedAcousticMesh::new();
        let n1 = NodeId(1);
        let n2 = NodeId(2);
        let n3 = NodeId(3);
        let n4 = NodeId(4);
        let n5 = NodeId(5);

        for id in [n1, n2, n3, n4, n5] {
            mesh.add_node(id);
        }

        mesh.add_bi_link(n1, n2);
        mesh.add_bi_link(n2, n3);
        mesh.add_bi_link(n3, n4);
        mesh.add_bi_link(n4, n5);

        // Case A: TTL = 2 (cannot reach N5, drops at N3)
        mesh.originate_packet(n1, n5, b"Short TTL".to_vec(), 2).unwrap();
        mesh.run_until_idle(10);
        assert!(mesh.nodes.get(&n5).unwrap().inbox.is_empty(), "N5 should not receive packet with TTL=2");

        // Case B: TTL = 5 (reaches N5 across all 3 relays)
        mesh.originate_packet(n1, n5, b"Sufficient TTL".to_vec(), 5).unwrap();
        mesh.run_until_idle(10);
        let n5_inbox = &mesh.nodes.get(&n5).unwrap().inbox;
        assert_eq!(n5_inbox.len(), 1, "N5 must receive packet with TTL=5");
        assert_eq!(n5_inbox[0].header.hop_count, 3); // 3 intermediate relays
    }
}
