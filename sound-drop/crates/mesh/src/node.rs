//! Node identification and neighbor table management for SoundDrop Acoustic Mesh.

use std::collections::HashMap;
use std::time::{Duration, Instant};

pub type NodeId = [u8; 4];

pub const NEIGHBOR_EXPIRATION_SECS: u64 = 120; // 2 minutes without beacon marks neighbor as stale

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum NodeRole {
    Endpoint,         // Standard mobile sender/receiver
    PersonalRelay,    // Mobile node temporarily relaying packets (DTN mule)
    DedicatedRelay,   // Stationary 24/7 relay (solar/grid powered)
    SatelliteGateway, // Hybrid node connected to satellite uplink
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum TransportType {
    Acoustic,
    WifiDirect,
    Ble,
    Satellite,
}

#[derive(Clone, Debug)]
pub struct Neighbor {
    pub id: NodeId,
    pub role: NodeRole,
    pub transport: TransportType,
    pub last_seen: Instant,
    pub snr_db: f32,
    pub lqi: u8, // Link Quality Indicator (0..100)
    pub packet_success_count: u32,
    pub packet_fail_count: u32,
}

impl Neighbor {
    pub fn new(id: NodeId, role: NodeRole, transport: TransportType, snr_db: f32) -> Self {
        let lqi = Self::calculate_lqi(snr_db);
        Self {
            id,
            role,
            transport,
            last_seen: Instant::now(),
            snr_db,
            lqi,
            packet_success_count: 0,
            packet_fail_count: 0,
        }
    }

    /// Calculate LQI (0..100) from acoustic SNR:
    /// SNR < 0 dB -> 0..10
    /// SNR 0..20 dB -> 10..90
    /// SNR > 20 dB -> 100
    pub fn calculate_lqi(snr_db: f32) -> u8 {
        if snr_db <= 0.0 {
            0
        } else if snr_db >= 25.0 {
            100
        } else {
            ((snr_db / 25.0) * 100.0) as u8
        }
    }

    pub fn update_link(&mut self, snr_db: f32) {
        self.last_seen = Instant::now();
        // Exponential moving average for SNR (alpha = 0.3)
        self.snr_db = self.snr_db * 0.7 + snr_db * 0.3;
        self.lqi = Self::calculate_lqi(self.snr_db);
    }

    pub fn record_delivery(&mut self, success: bool) {
        if success {
            self.packet_success_count = self.packet_success_count.saturating_add(1);
        } else {
            self.packet_fail_count = self.packet_fail_count.saturating_add(1);
        }
    }

    pub fn is_relay_capable(&self) -> bool {
        matches!(
            self.role,
            NodeRole::PersonalRelay | NodeRole::DedicatedRelay | NodeRole::SatelliteGateway
        )
    }
}

/// Dynamic Neighbor Table tracking nodes in acoustic hearing range
#[derive(Debug)]
pub struct NeighborTable {
    neighbors: HashMap<NodeId, Neighbor>,
    expiration: Duration,
}

impl Default for NeighborTable {
    fn default() -> Self {
        Self::new(Duration::from_secs(NEIGHBOR_EXPIRATION_SECS))
    }
}

impl NeighborTable {
    pub fn new(expiration: Duration) -> Self {
        Self {
            neighbors: HashMap::new(),
            expiration,
        }
    }

    pub fn len(&self) -> usize {
        self.neighbors.len()
    }

    pub fn is_empty(&self) -> bool {
        self.neighbors.is_empty()
    }

    /// Register or update a neighbor from an incoming chirp beacon or packet
    pub fn record_neighbor(
        &mut self,
        id: NodeId,
        role: NodeRole,
        transport: TransportType,
        snr_db: f32,
    ) {
        self.prune_stale();
        self.neighbors
            .entry(id)
            .and_modify(|n| {
                n.role = role;
                n.transport = transport;
                n.update_link(snr_db);
            })
            .or_insert_with(|| Neighbor::new(id, role, transport, snr_db));
    }

    pub fn get(&self, id: &NodeId) -> Option<&Neighbor> {
        self.neighbors.get(id)
    }

    pub fn get_mut(&mut self, id: &NodeId) -> Option<&mut Neighbor> {
        self.neighbors.get_mut(id)
    }

    /// Retrieve all currently active neighbors that are capable of relaying
    pub fn get_active_relays(&self) -> Vec<&Neighbor> {
        let now = Instant::now();
        self.neighbors
            .values()
            .filter(|n| n.is_relay_capable() && now.duration_since(n.last_seen) < self.expiration)
            .collect()
    }

    /// Select the best relay based on link quality (highest LQI)
    pub fn select_best_relay(&self) -> Option<&Neighbor> {
        self.get_active_relays()
            .into_iter()
            .max_by_key(|n| n.lqi)
    }

    pub fn prune_stale(&mut self) {
        let now = Instant::now();
        let exp = self.expiration;
        self.neighbors.retain(|_, n| now.duration_since(n.last_seen) < exp);
    }
}
