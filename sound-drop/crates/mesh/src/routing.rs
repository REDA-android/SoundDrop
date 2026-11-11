//! Dynamic reactive routing table (AODV-Acoustic) for multi-hop mesh networking.

use crate::node::NodeId;
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub const DEFAULT_ROUTE_LIFETIME_SECS: u64 = 300; // 5-minute route expiration

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteEntry {
    pub destination: NodeId,
    pub next_hop: NodeId,
    pub hop_count: u8,
    pub path_lqi: u8, // Lowest LQI on the path (bottleneck link quality)
    pub seq_num: u16,
    pub is_valid: bool,
    pub expires_at: Instant,
}

impl RouteEntry {
    pub fn new(
        destination: NodeId,
        next_hop: NodeId,
        hop_count: u8,
        path_lqi: u8,
        seq_num: u16,
        lifetime: Duration,
    ) -> Self {
        Self {
            destination,
            next_hop,
            hop_count,
            path_lqi,
            seq_num,
            is_valid: true,
            expires_at: Instant::now() + lifetime,
        }
    }

    pub fn is_expired(&self) -> bool {
        Instant::now() >= self.expires_at
    }
}

/// Routing Table managing active multi-hop paths
#[derive(Debug)]
pub struct RoutingTable {
    routes: HashMap<NodeId, RouteEntry>,
    default_lifetime: Duration,
}

impl Default for RoutingTable {
    fn default() -> Self {
        Self::new(Duration::from_secs(DEFAULT_ROUTE_LIFETIME_SECS))
    }
}

impl RoutingTable {
    pub fn new(default_lifetime: Duration) -> Self {
        Self {
            routes: HashMap::new(),
            default_lifetime,
        }
    }

    pub fn len(&self) -> usize {
        self.routes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.routes.is_empty()
    }

    /// Lookup a valid, non-expired route to destination
    pub fn lookup(&mut self, destination: &NodeId) -> Option<&RouteEntry> {
        self.prune_expired();
        self.routes.get(destination).filter(|r| r.is_valid && !r.is_expired())
    }

    /// Update or insert a route entry following AODV freshness rules:
    /// 1. Higher sequence number wins (fresher information).
    /// 2. If sequence number is equal: fewer hops wins.
    /// 3. If hops are equal: higher path LQI wins.
    pub fn update_route(
        &mut self,
        destination: NodeId,
        next_hop: NodeId,
        hop_count: u8,
        path_lqi: u8,
        seq_num: u16,
    ) -> bool {
        self.prune_expired();
        let lifetime = self.default_lifetime;

        let should_update = match self.routes.get(&destination) {
            None => true,
            Some(existing) => {
                if !existing.is_valid || existing.is_expired() {
                    true
                } else if seq_num > existing.seq_num {
                    true
                } else if seq_num == existing.seq_num {
                    if hop_count < existing.hop_count {
                        true
                    } else if hop_count == existing.hop_count && path_lqi > existing.path_lqi {
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
        };

        if should_update {
            self.routes.insert(
                destination,
                RouteEntry::new(destination, next_hop, hop_count, path_lqi, seq_num, lifetime),
            );
            true
        } else {
            false
        }
    }

    /// Mark route as broken when transmission fails
    pub fn invalidate(&mut self, destination: &NodeId) {
        if let Some(entry) = self.routes.get_mut(destination) {
            entry.is_valid = false;
        }
    }

    /// Invalidate all routes traversing a failed next-hop neighbor
    pub fn invalidate_via_next_hop(&mut self, next_hop: &NodeId) {
        for entry in self.routes.values_mut() {
            if &entry.next_hop == next_hop {
                entry.is_valid = false;
            }
        }
    }

    pub fn prune_expired(&mut self) {
        let now = Instant::now();
        self.routes.retain(|_, r| r.is_valid && r.expires_at > now);
    }
}

// ============================================================================
// ROUTING PROTOCOL MESSAGES (AODV-Acoustic)
// ============================================================================

/// Route Request (RREQ) broadcast to discover path to unknown destination
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteRequest {
    pub origin: NodeId,
    pub destination: NodeId,
    pub broadcast_id: u16,
    pub origin_seq_num: u16,
    pub hop_count: u8,
    pub path_lqi: u8,
}

impl RouteRequest {
    pub fn new(origin: NodeId, destination: NodeId, broadcast_id: u16, origin_seq_num: u16) -> Self {
        Self {
            origin,
            destination,
            broadcast_id,
            origin_seq_num,
            hop_count: 0,
            path_lqi: 100,
        }
    }

    /// Advance one hop through an intermediate relay
    pub fn step(&mut self, link_lqi: u8) {
        self.hop_count = self.hop_count.saturating_add(1);
        self.path_lqi = self.path_lqi.min(link_lqi); // Bottleneck metric
    }
}

/// Route Reply (RREP) unicast back to origin
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteReply {
    pub origin: NodeId,
    pub destination: NodeId,
    pub dest_seq_num: u16,
    pub hop_count: u8,
    pub path_lqi: u8,
}

impl RouteReply {
    pub fn new(origin: NodeId, destination: NodeId, dest_seq_num: u16) -> Self {
        Self {
            origin,
            destination,
            dest_seq_num,
            hop_count: 0,
            path_lqi: 100,
        }
    }

    pub fn step(&mut self, link_lqi: u8) {
        self.hop_count = self.hop_count.saturating_add(1);
        self.path_lqi = self.path_lqi.min(link_lqi);
    }
}
