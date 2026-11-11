//! SoundDrop Orbital Relay (SOR)
//! Modular, satellite-assisted, store-and-forward communication for zero-coverage rural areas.

pub mod manager;
pub mod packet;
pub mod provider;
pub mod queue;
pub mod voice;

pub use manager::OrbitalRelayManager;
pub use packet::{
    OrbitalError, PacketFlags, SatelliteHeader, SatellitePacket, MAX_SATELLITE_PACKET_LEN,
};
pub use provider::{
    DeliveryStatus, IridiumSbdAdapter, IridiumSbdStatus, LoRaSatAdapter, ProviderType,
    SatelliteNetworkStatus, SatelliteProvider, SimulatedSatelliteProvider, TransmissionReceipt,
};
pub use queue::OrbitalStoreAndForwardQueue;
pub use voice::{Codec2Mode, VoiceHeader, VoiceMessageCompressor, MAX_VOICE_DURATION_MS};
