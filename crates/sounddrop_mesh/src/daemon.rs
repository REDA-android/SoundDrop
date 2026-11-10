use crate::node::{MeshRelayNode, NodeAction};
use crate::packet::{MeshPacket, NodeId, PacketError, MESH_HEADER_LEN};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, Mutex, Notify};

#[derive(Debug, thiserror::Error)]
pub enum DaemonError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Packet error: {0}")]
    Packet(#[from] PacketError),
    #[error("Daemon is shutting down")]
    Shutdown,
    #[error("Peer not found: {0:?}")]
    PeerNotFound(NodeId),
}

#[derive(Debug, Clone)]
pub struct DaemonStats {
    pub node_id: NodeId,
    pub active_peer_links: usize,
    pub packets_relayed: u64,
    pub duplicates_suppressed: u64,
    pub ttl_expired: u64,
    pub packets_delivered: u64,
}

pub struct AsyncMeshRelayDaemon {
    pub node_id: NodeId,
    pub local_addr: SocketAddr,
    node: Arc<Mutex<MeshRelayNode>>,
    peers: Arc<Mutex<HashMap<NodeId, SocketAddr>>>,
    delivery_tx: broadcast::Sender<MeshPacket>,
    shutdown_notify: Arc<Notify>,
}

impl AsyncMeshRelayDaemon {
    /// Binds an asynchronous mesh daemon to a local TCP socket.
    pub async fn bind(node_id: NodeId, bind_addr: SocketAddr) -> Result<Self, DaemonError> {
        let listener = TcpListener::bind(bind_addr).await?;
        let local_addr = listener.local_addr()?;

        let node = Arc::new(Mutex::new(MeshRelayNode::new(node_id)));
        let peers = Arc::new(Mutex::new(HashMap::new()));
        let (delivery_tx, _) = broadcast::channel(128);
        let shutdown_notify = Arc::new(Notify::new());

        let daemon = Self {
            node_id,
            local_addr,
            node: Arc::clone(&node),
            peers: Arc::clone(&peers),
            delivery_tx: delivery_tx.clone(),
            shutdown_notify: Arc::clone(&shutdown_notify),
        };

        // Spawn background connection accept loop
        let accept_node = Arc::clone(&node);
        let accept_peers = Arc::clone(&peers);
        let accept_delivery_tx = delivery_tx;
        let accept_shutdown = Arc::clone(&shutdown_notify);

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = accept_shutdown.notified() => {
                        log::info!("[ASYNC MESH] Daemon {} received shutdown signal", node_id);
                        break;
                    }
                    accept_res = listener.accept() => {
                        match accept_res {
                            Ok((stream, peer_addr)) => {
                                let s_node = Arc::clone(&accept_node);
                                let s_peers = Arc::clone(&accept_peers);
                                let s_deliv = accept_delivery_tx.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = Self::handle_incoming_connection(
                                        stream, peer_addr, s_node, s_peers, s_deliv,
                                    ).await {
                                        log::debug!("[ASYNC MESH] Peer connection closed with: {}", e);
                                    }
                                });
                            }
                            Err(e) => {
                                log::warn!("[ASYNC MESH] Accept failed: {}", e);
                            }
                        }
                    }
                }
            }
        });

        Ok(daemon)
    }

    /// Registers a neighboring peer endpoint in the mesh daemon.
    pub async fn add_peer(&self, peer_id: NodeId, peer_addr: SocketAddr) {
        let mut peers = self.peers.lock().await;
        peers.insert(peer_id, peer_addr);
    }

    /// Subscribes to packets delivered to this node's inbox.
    pub fn subscribe(&self) -> broadcast::Receiver<MeshPacket> {
        self.delivery_tx.subscribe()
    }

    /// Originates and sends a packet towards `dst`.
    pub async fn send_packet(
        &self,
        dst: NodeId,
        payload: Vec<u8>,
        ttl: u8,
    ) -> Result<MeshPacket, DaemonError> {
        let packet = {
            let mut node = self.node.lock().await;
            node.send_packet(dst, payload, ttl)?
        };

        self.forward_to_peers(&packet).await;
        Ok(packet)
    }

    /// Queries live daemon metrics.
    pub async fn stats(&self) -> DaemonStats {
        let node = self.node.lock().await;
        let peers = self.peers.lock().await;
        DaemonStats {
            node_id: self.node_id,
            active_peer_links: peers.len(),
            packets_relayed: node.relayed_count,
            duplicates_suppressed: node.dropped_dedup_count,
            ttl_expired: node.dropped_ttl_count,
            packets_delivered: node.delivered_count,
        }
    }

    /// Stops the daemon.
    pub fn shutdown(&self) {
        self.shutdown_notify.notify_waiters();
    }

    async fn handle_incoming_connection(
        mut stream: TcpStream,
        _peer_addr: SocketAddr,
        node: Arc<Mutex<MeshRelayNode>>,
        peers: Arc<Mutex<HashMap<NodeId, SocketAddr>>>,
        delivery_tx: broadcast::Sender<MeshPacket>,
    ) -> Result<(), DaemonError> {
        let mut buf = [0u8; 512];
        loop {
            let n = stream.read(&mut buf).await?;
            if n == 0 {
                break; // Connection closed
            }

            if n < MESH_HEADER_LEN {
                continue;
            }

            if let Ok(packet) = MeshPacket::from_bytes(&buf[..n]) {
                let action = {
                    let mut n_guard = node.lock().await;
                    n_guard.process_incoming_packet(packet.clone(), packet.header.src)
                };

                match action {
                    NodeAction::Delivered(delivered_pkt) => {
                        let _ = delivery_tx.send(delivered_pkt);
                    }
                    NodeAction::DeliveredAndRelayed(delivered_pkt) => {
                        let _ = delivery_tx.send(delivered_pkt.clone());
                        Self::forward_packet_to_registered_peers(&delivered_pkt, &peers).await;
                    }
                    NodeAction::Relayed(fwd_pkt) => {
                        Self::forward_packet_to_registered_peers(&fwd_pkt, &peers).await;
                    }
                    NodeAction::DroppedDuplicate { .. } | NodeAction::DroppedTtlExpired { .. } => {
                        // Suppressed - zero retransmission
                    }
                }
            }
        }
        Ok(())
    }

    async fn forward_to_peers(&self, packet: &MeshPacket) {
        Self::forward_packet_to_registered_peers(packet, &self.peers).await;
    }

    async fn forward_packet_to_registered_peers(
        packet: &MeshPacket,
        peers: &Arc<Mutex<HashMap<NodeId, SocketAddr>>>,
    ) {
        let peer_addrs: Vec<SocketAddr> = {
            let guard = peers.lock().await;
            guard.values().copied().collect()
        };

        let raw_bytes = packet.to_bytes();
        for addr in peer_addrs {
            let bytes_clone = raw_bytes.clone();
            tokio::spawn(async move {
                if let Ok(mut stream) = TcpStream::connect(addr).await {
                    let _ = stream.write_all(&bytes_clone).await;
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_async_mesh_three_node_relay() {
        let bind_unspecified: SocketAddr = "127.0.0.1:0".parse().unwrap();

        // Node A (Origin), Relay R, Node B (Destination)
        let node_a = AsyncMeshRelayDaemon::bind(NodeId(0x0001), bind_unspecified).await.unwrap();
        let relay_r = AsyncMeshRelayDaemon::bind(NodeId(0x0002), bind_unspecified).await.unwrap();
        let node_b = AsyncMeshRelayDaemon::bind(NodeId(0x0003), bind_unspecified).await.unwrap();

        // Topology: Node A knows Relay R. Relay R knows Node B.
        // Node A DOES NOT have Node B's address (enforces multi-hop forwarding).
        node_a.add_peer(relay_r.node_id, relay_r.local_addr).await;
        relay_r.add_peer(node_b.node_id, node_b.local_addr).await;

        let mut b_rx = node_b.subscribe();

        // Node A sends directed message to Node B
        let test_msg = b"Async Tokio Mesh Relay OK!".to_vec();
        node_a.send_packet(NodeId(0x0003), test_msg.clone(), 4).await.unwrap();

        // Node B should receive the relayed packet within 2 seconds
        let delivered = tokio::time::timeout(Duration::from_secs(2), b_rx.recv())
            .await
            .expect("Timeout waiting for packet at Node B")
            .expect("Channel closed");

        assert_eq!(delivered.payload, test_msg);
        assert_eq!(delivered.header.hop_count, 1, "Must have been relayed by Relay R");

        let r_stats = relay_r.stats().await;
        assert!(r_stats.packets_relayed >= 1, "Relay R must record forwarded packet");

        node_a.shutdown();
        relay_r.shutdown();
        node_b.shutdown();
    }
}
