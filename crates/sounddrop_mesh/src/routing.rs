use crate::packet::NodeId;
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct RouteEntry {
    pub dst: NodeId,
    pub next_hop: NodeId,
    pub hop_count: u8,
    pub updated_at: Instant,
}

pub struct RoutingTable {
    routes: HashMap<NodeId, RouteEntry>,
}

impl RoutingTable {
    pub fn new() -> Self {
        Self {
            routes: HashMap::new(),
        }
    }

    /// Updates or learns a route to `dst` reachable via neighbor `next_hop`.
    /// Only replaces an existing route if the new hop count is shorter or equal (refreshes timestamp).
    pub fn learn_route(&mut self, dst: NodeId, next_hop: NodeId, hop_count: u8) -> bool {
        if dst.is_broadcast() {
            return false;
        }

        if let Some(existing) = self.routes.get_mut(&dst) {
            if hop_count <= existing.hop_count {
                existing.next_hop = next_hop;
                existing.hop_count = hop_count;
                existing.updated_at = Instant::now();
                return true;
            }
            false
        } else {
            self.routes.insert(
                dst,
                RouteEntry {
                    dst,
                    next_hop,
                    hop_count,
                    updated_at: Instant::now(),
                },
            );
            true
        }
    }

    /// Looks up the next hop node to forward towards `dst`.
    pub fn lookup(&self, dst: NodeId) -> Option<NodeId> {
        self.routes.get(&dst).map(|r| r.next_hop)
    }

    pub fn get_route(&self, dst: NodeId) -> Option<&RouteEntry> {
        self.routes.get(&dst)
    }

    pub fn len(&self) -> usize {
        self.routes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.routes.is_empty()
    }

    pub fn clear(&mut self) {
        self.routes.clear();
    }
}

impl Default for RoutingTable {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_route_learning_and_shortest_path_preference() {
        let mut table = RoutingTable::new();
        let target = NodeId(0x0003);
        let relay1 = NodeId(0x0002);
        let relay2 = NodeId(0x0004);

        // Learn route via relay1 with hop count 3
        assert!(table.learn_route(target, relay1, 3));
        assert_eq!(table.lookup(target), Some(relay1));

        // Attempt worse route with hop count 4 (should be rejected)
        assert!(!table.learn_route(target, relay2, 4));
        assert_eq!(table.lookup(target), Some(relay1));

        // Shorter route with hop count 2 (should be accepted)
        assert!(table.learn_route(target, relay2, 2));
        assert_eq!(table.lookup(target), Some(relay2));
    }
}
