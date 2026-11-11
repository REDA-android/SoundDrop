//! SoundDrop Acoustic Mesh Network Coordinator & Ad-Hoc Routing Engine
//! Compliant with Section 2.D of the SAMP Architecture.

pub mod coordinator;
pub mod duty_cycle;
pub mod node;
pub mod routing;

pub use coordinator::{MeshError, NetworkCoordinator, NetworkHealthReport};
pub use duty_cycle::{DutyCycleManager, DutyState, PowerProfile};
pub use node::{Neighbor, NeighborTable, NodeId, NodeRole, TransportType};
pub use routing::{RouteEntry, RouteReply, RouteRequest, RoutingTable};
