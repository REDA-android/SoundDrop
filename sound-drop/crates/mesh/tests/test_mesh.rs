use sounddrop_mesh::{
    MeshError, NetworkCoordinator, NodeRole, PowerProfile, TransportType,
};
use std::time::Duration;

#[test]
fn test_neighbor_discovery_and_lqi_calculation() {
    let mut coordinator = NetworkCoordinator::new([1, 1, 1, 1], NodeRole::Endpoint, PowerProfile::Continuous);

    let neighbor_b = [2, 2, 2, 2];
    let neighbor_c = [3, 3, 3, 3];

    // Node B has high SNR (25 dB -> 100% LQI)
    coordinator.handle_beacon(neighbor_b, NodeRole::PersonalRelay, TransportType::Acoustic, 25.0);

    // Node C has low SNR (5 dB -> 20% LQI)
    coordinator.handle_beacon(neighbor_c, NodeRole::DedicatedRelay, TransportType::Acoustic, 5.0);

    assert_eq!(coordinator.neighbors().len(), 2);

    let b = coordinator.neighbors().get(&neighbor_b).unwrap();
    assert_eq!(b.lqi, 100);
    assert!(b.is_relay_capable());

    let c = coordinator.neighbors().get(&neighbor_c).unwrap();
    assert_eq!(c.lqi, 20);

    // Best relay selected must be B due to higher LQI
    let best = coordinator.neighbors().select_best_relay().unwrap();
    assert_eq!(best.id, neighbor_b);
}

#[test]
fn test_aodv_reactive_route_discovery_3_hops() {
    println!("================================================================================");
    println!("[Mesh Routing Test] AODV Multi-Hop Discovery: Alice -> R1 -> R2 -> Bob");
    println!("================================================================================");

    let alice_id = [0xAA, 0x01, 0x00, 0x00];
    let r1_id = [0xBB, 0x01, 0x00, 0x00];
    let r2_id = [0xCC, 0x01, 0x00, 0x00];
    let bob_id = [0xDD, 0x01, 0x00, 0x00];

    let mut alice = NetworkCoordinator::new(alice_id, NodeRole::Endpoint, PowerProfile::Continuous);
    let mut r1 = NetworkCoordinator::new(r1_id, NodeRole::DedicatedRelay, PowerProfile::Continuous);
    let mut r2 = NetworkCoordinator::new(r2_id, NodeRole::DedicatedRelay, PowerProfile::Continuous);
    let mut bob = NetworkCoordinator::new(bob_id, NodeRole::Endpoint, PowerProfile::Continuous);

    // 1. Initial State: Alice has no route to Bob
    assert_eq!(alice.resolve_next_hop(&bob_id), Err(MeshError::NoRoute(bob_id)));

    // 2. Alice generates RREQ for Bob
    let rreq_alice = alice.create_route_request(bob_id);
    assert_eq!(rreq_alice.hop_count, 0);

    // 3. R1 receives RREQ from Alice (Link LQI = 90)
    let rrep_at_r1 = r1.handle_rreq(rreq_alice.clone(), alice_id, 90);
    assert!(rrep_at_r1.is_none()); // R1 is not Bob, so it forwards

    // 4. R2 receives stepped RREQ from R1 (Link LQI = 85)
    let mut rreq_r1 = rreq_alice.clone();
    rreq_r1.step(90);
    let rrep_at_r2 = r2.handle_rreq(rreq_r1.clone(), r1_id, 85);
    assert!(rrep_at_r2.is_none()); // R2 is not Bob, forwards

    // 5. Bob receives stepped RREQ from R2 (Link LQI = 80)
    let mut rreq_r2 = rreq_r1.clone();
    rreq_r2.step(85);
    let rrep_from_bob = bob.handle_rreq(rreq_r2, r2_id, 80).expect("Bob must generate RREP!");

    assert_eq!(rrep_from_bob.origin, alice_id);
    assert_eq!(rrep_from_bob.destination, bob_id);

    // 6. RREP travels backwards: Bob -> R2
    let fwd_at_r2 = r2.handle_rrep(rrep_from_bob.clone(), bob_id, 80).expect("R2 forwards to R1");
    assert_eq!(fwd_at_r2, r1_id);

    // 7. RREP travels backwards: R2 -> R1
    let mut rrep_r2 = rrep_from_bob.clone();
    rrep_r2.step(80);
    let fwd_at_r1 = r1.handle_rrep(rrep_r2.clone(), r2_id, 85).expect("R1 forwards to Alice");
    assert_eq!(fwd_at_r1, alice_id);

    // 8. RREP reaches Alice!
    let mut rrep_r1 = rrep_r2.clone();
    rrep_r1.step(85);
    let fwd_at_alice = alice.handle_rrep(rrep_r1, r1_id, 90);
    assert!(fwd_at_alice.is_none()); // Alice is origin, route established!

    // 9. Verification: Alice can now resolve next hop to Bob!
    let next_hop = alice.resolve_next_hop(&bob_id).expect("Route to Bob must be resolved");
    assert_eq!(next_hop, r1_id, "Alice must forward to R1 for path to Bob!");

    // Also check intermediate node R1 has route to Bob via R2
    assert_eq!(r1.resolve_next_hop(&bob_id), Ok(r2_id));
    // And R2 has direct route to Bob
    assert_eq!(r2.resolve_next_hop(&bob_id), Ok(bob_id));

    println!("[Mesh Routing Test] SUCCESS: 3-Hop Route Alice -> R1 -> R2 -> Bob established!");
}

#[test]
fn test_route_invalidation_on_link_failure() {
    let alice_id = [1, 0, 0, 0];
    let bob_id = [2, 0, 0, 0];
    let mut alice = NetworkCoordinator::new(alice_id, NodeRole::Endpoint, PowerProfile::Continuous);

    alice.routing_table_mut().update_route(bob_id, [3, 0, 0, 0], 2, 80, 10);
    assert_eq!(alice.resolve_next_hop(&bob_id), Ok([3, 0, 0, 0]));

    // Record link failure
    alice.record_delivery_outcome(&[3, 0, 0, 0], false);

    // Route must be invalidated
    assert_eq!(alice.resolve_next_hop(&bob_id), Err(MeshError::NoRoute(bob_id)));
}

#[test]
fn test_duty_cycle_wake_on_acoustic() {
    let mut coordinator = NetworkCoordinator::new([1, 2, 3, 4], NodeRole::PersonalRelay, PowerProfile::EcoRelay);

    // Trigger acoustic wake
    coordinator.duty_cycle_mut().wake_on_chirp(Duration::from_millis(500));
    assert!(coordinator.duty_cycle_mut().is_listening());
}

#[test]
fn test_network_health_telemetry_report() {
    let mut coordinator = NetworkCoordinator::new([0xDE, 0xAD, 0xBE, 0xEF], NodeRole::DedicatedRelay, PowerProfile::Continuous);

    coordinator.handle_beacon([1, 1, 1, 1], NodeRole::PersonalRelay, TransportType::Acoustic, 20.0);
    coordinator.handle_beacon([2, 2, 2, 2], NodeRole::DedicatedRelay, TransportType::Acoustic, 18.0);
    // Route 1 via [1, 1, 1, 1] (will be invalidated by link failure)
    coordinator.routing_table_mut().update_route([3, 3, 3, 3], [1, 1, 1, 1], 2, 85, 1);
    // Route 2 via [2, 2, 2, 2] (remains valid)
    coordinator.routing_table_mut().update_route([4, 4, 4, 4], [2, 2, 2, 2], 1, 90, 1);

    coordinator.record_delivery_outcome(&[1, 1, 1, 1], true);
    coordinator.record_delivery_outcome(&[1, 1, 1, 1], true);
    coordinator.record_delivery_outcome(&[1, 1, 1, 1], false); // Fails [1, 1, 1, 1] link

    let health = coordinator.health_report();
    assert_eq!(health.active_neighbors_count, 2);
    assert_eq!(health.active_routes_count, 1); // Route to [4, 4, 4, 4] remains valid
    assert!((health.packet_delivery_ratio - (2.0 / 3.0)).abs() < 0.01);
}
