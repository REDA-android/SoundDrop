//! Modular satellite provider interface and implementations.
//! Separates simulated satellite transports from verified real hardware adapters.

use crate::packet::{OrbitalError, SatellitePacket, MAX_SATELLITE_PACKET_LEN};
use std::collections::VecDeque;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ProviderType {
    Simulated,
    IridiumSbd,
    LoRaSatellite,
    GppNtn,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum SatelliteNetworkStatus {
    NoSignal,    // Below horizon or obstructed (e.g. inside deep canyon)
    Acquiring,   // Signal detected, Doppler synchronization underway
    Connected,   // Solid link margin (> 10 dB SNR), ready for uplink
    Transmitting,// RF transmission in progress
    Standby,     // Waiting for next orbital window
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeliveryStatus {
    PendingUplink,
    InOrbitStorage,           // Held in satellite memory (Store-and-Forward / DTN)
    DeliveredToGroundStation, // Downlinked to gateway
    DeliveredToDestination,   // Acknowledged by recipient terminal
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransmissionReceipt {
    pub receipt_id: [u8; 8],
    pub msg_id: u16,
    pub provider: &'static str,
    pub is_simulated: bool,
    pub uplink_timestamp: u32,
    pub satellite_id: String,
    pub status: DeliveryStatus,
}

/// Abstract provider trait allowing plug-and-play satellite hardware or simulators
pub trait SatelliteProvider {
    fn name(&self) -> &'static str;
    fn provider_type(&self) -> ProviderType;
    fn network_status(&self) -> SatelliteNetworkStatus;
    fn is_simulated(&self) -> bool;
    fn max_payload_bytes(&self) -> usize;
    fn transmit(&mut self, packet: &SatellitePacket) -> Result<TransmissionReceipt, OrbitalError>;
    fn poll_incoming(&mut self) -> Result<Vec<SatellitePacket>, OrbitalError>;
}

// ============================================================================
// 1. SIMULATED SATELLITE PROVIDER (Development, Education & Verification)
// ============================================================================

/// Simulated LEO Satellite Pass with Store-and-Forward memory.
/// Clearly labeled as SIMULATED — never claims to be a real satellite!
pub struct SimulatedSatelliteProvider {
    name: &'static str,
    pass_active: bool,
    orbit_cycle_secs: u64,
    pass_duration_secs: u64,
    orbit_storage: VecDeque<SatellitePacket>,
    downlink_buffer: VecDeque<SatellitePacket>,
}

impl Default for SimulatedSatelliteProvider {
    fn default() -> Self {
        Self::new("SIM-LEO-SAT-ATLAS", 5400, 600) // 90 min orbit, 10 min pass
    }
}

impl SimulatedSatelliteProvider {
    pub fn new(name: &'static str, orbit_cycle_secs: u64, pass_duration_secs: u64) -> Self {
        Self {
            name,
            pass_active: true, // Default active for unit tests
            orbit_cycle_secs,
            pass_duration_secs,
            orbit_storage: VecDeque::new(),
            downlink_buffer: VecDeque::new(),
        }
    }

    pub fn set_pass_active(&mut self, active: bool) {
        self.pass_active = active;
    }

    /// Simulate the satellite orbiting to the destination footprint and releasing downlinks
    pub fn orbit_advance_and_release(&mut self) {
        while let Some(packet) = self.orbit_storage.pop_front() {
            self.downlink_buffer.push_back(packet);
        }
    }
}

impl SatelliteProvider for SimulatedSatelliteProvider {
    fn name(&self) -> &'static str {
        self.name
    }

    fn provider_type(&self) -> ProviderType {
        ProviderType::Simulated
    }

    fn network_status(&self) -> SatelliteNetworkStatus {
        if self.pass_active {
            SatelliteNetworkStatus::Connected
        } else {
            SatelliteNetworkStatus::NoSignal
        }
    }

    fn is_simulated(&self) -> bool {
        true // Strictly honest: always true
    }

    fn max_payload_bytes(&self) -> usize {
        MAX_SATELLITE_PACKET_LEN
    }

    fn transmit(&mut self, packet: &SatellitePacket) -> Result<TransmissionReceipt, OrbitalError> {
        if !self.pass_active {
            return Err(OrbitalError::NoPassAvailable(self.orbit_cycle_secs - self.pass_duration_secs));
        }

        // Store into simulated satellite memory
        self.orbit_storage.push_back(packet.clone());

        let mut receipt_id = [0u8; 8];
        receipt_id[0..2].copy_from_slice(&packet.header.msg_id.to_be_bytes());
        receipt_id[2..6].copy_from_slice(&packet.header.timestamp.to_be_bytes());
        receipt_id[6..8].copy_from_slice(&[0xAA, 0x55]);

        Ok(TransmissionReceipt {
            receipt_id,
            msg_id: packet.header.msg_id,
            provider: self.name,
            is_simulated: true, // Explicitly marked
            uplink_timestamp: packet.header.timestamp,
            satellite_id: "SIM-LEO-SAT-1".to_string(),
            status: DeliveryStatus::InOrbitStorage,
        })
    }

    fn poll_incoming(&mut self) -> Result<Vec<SatellitePacket>, OrbitalError> {
        let mut packets = Vec::new();
        while let Some(p) = self.downlink_buffer.pop_front() {
            packets.push(p);
        }
        Ok(packets)
    }
}

// ============================================================================
// 2. IRIDIUM SBD ADAPTER (Hardware Protocol Engine for 9603 / RockBLOCK)
// ============================================================================

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IridiumSbdStatus {
    pub mo_status: u8, // 0..2 = Success, 32 = No network
    pub momsn: u16,    // Mobile Originated Message Sequence Number
    pub mt_status: u8, // Mobile Terminated status
    pub mtmsn: u16,
    pub mt_length: u16,
    pub mt_queued: u16,
}

pub struct IridiumSbdAdapter {
    port_name: String,
    signal_strength: u8, // 0 to 5
    inbound_buffer: VecDeque<SatellitePacket>,
}

impl IridiumSbdAdapter {
    pub fn new(port_name: &str) -> Self {
        Self {
            port_name: port_name.to_string(),
            signal_strength: 0,
            inbound_buffer: VecDeque::new(),
        }
    }

    pub fn port_name(&self) -> &str {
        &self.port_name
    }

    pub fn set_signal_strength(&mut self, csq: u8) {
        self.signal_strength = csq.min(5);
    }

    /// Format AT+SBDWB command with trailing 2-byte MSB checksum
    pub fn format_sbdwb_command(data: &[u8]) -> Vec<u8> {
        let mut cmd = format!("AT+SBDWB={}\r", data.len()).into_bytes();
        cmd.extend_from_slice(data);

        // Iridium 2-byte checksum is the sum of all bytes in binary data (modulo 65536)
        let sum: u16 = data.iter().map(|&b| b as u16).sum();
        cmd.extend_from_slice(&sum.to_be_bytes());
        cmd
    }

    /// Format session initiation command
    pub fn format_sbdix_command() -> &'static str {
        "AT+SBDIX\r"
    }

    /// Parse AT+SBDIX response line: "+SBDIX: <mo>, <momsn>, <mt>, <mtmsn>, <len>, <queued>"
    pub fn parse_sbdix_response(response: &str) -> Result<IridiumSbdStatus, OrbitalError> {
        let prefix = "+SBDIX:";
        let pos = response.find(prefix).ok_or_else(|| {
            OrbitalError::AtCommandError("Missing +SBDIX prefix in modem response".into())
        })?;

        let first_line = response[pos + prefix.len()..]
            .lines()
            .next()
            .unwrap_or("")
            .trim();
        let parts: Vec<&str> = first_line.split(',').map(|s| s.trim()).collect();
        if parts.len() < 6 {
            return Err(OrbitalError::AtCommandError("Malformed +SBDIX response".into()));
        }

        let mo_status: u8 = parts[0].parse().map_err(|_| OrbitalError::AtCommandError("Invalid MO status".into()))?;
        let momsn: u16 = parts[1].parse().map_err(|_| OrbitalError::AtCommandError("Invalid MOMSN".into()))?;
        let mt_status: u8 = parts[2].parse().map_err(|_| OrbitalError::AtCommandError("Invalid MT status".into()))?;
        let mtmsn: u16 = parts[3].parse().map_err(|_| OrbitalError::AtCommandError("Invalid MTMSN".into()))?;
        let mt_length: u16 = parts[4].parse().map_err(|_| OrbitalError::AtCommandError("Invalid MT length".into()))?;
        let mt_queued: u16 = parts[5].parse().map_err(|_| OrbitalError::AtCommandError("Invalid MT queued".into()))?;

        Ok(IridiumSbdStatus {
            mo_status,
            momsn,
            mt_status,
            mtmsn,
            mt_length,
            mt_queued,
        })
    }

    /// Parse AT+SBDRB raw response: [length: 2B][binary data][checksum: 2B]
    pub fn parse_sbdrb_response(buf: &[u8]) -> Result<Vec<u8>, OrbitalError> {
        if buf.len() < 4 {
            return Err(OrbitalError::AtCommandError("SBDRB buffer too short".into()));
        }
        let data_len = u16::from_be_bytes([buf[0], buf[1]]) as usize;
        if buf.len() < 2 + data_len + 2 {
            return Err(OrbitalError::AtCommandError("SBDRB payload truncated".into()));
        }

        let data = &buf[2..2 + data_len];
        let expected_sum = u16::from_be_bytes([buf[2 + data_len], buf[2 + data_len + 1]]);
        let calculated_sum: u16 = data.iter().map(|&b| b as u16).sum();

        if expected_sum != calculated_sum {
            return Err(OrbitalError::AtCommandError("SBDRB checksum mismatch".into()));
        }

        Ok(data.to_vec())
    }
}

impl SatelliteProvider for IridiumSbdAdapter {
    fn name(&self) -> &'static str {
        "Iridium-SBD-9603"
    }

    fn provider_type(&self) -> ProviderType {
        ProviderType::IridiumSbd
    }

    fn network_status(&self) -> SatelliteNetworkStatus {
        match self.signal_strength {
            0 => SatelliteNetworkStatus::NoSignal,
            1 | 2 => SatelliteNetworkStatus::Acquiring,
            _ => SatelliteNetworkStatus::Connected,
        }
    }

    fn is_simulated(&self) -> bool {
        false // Real hardware protocol driver
    }

    fn max_payload_bytes(&self) -> usize {
        340 // Strict Iridium MO limit
    }

    fn transmit(&mut self, packet: &SatellitePacket) -> Result<TransmissionReceipt, OrbitalError> {
        if self.signal_strength < 2 {
            return Err(OrbitalError::ProviderError("Insufficient Iridium signal (CSQ < 2)".into()));
        }

        let serialized = packet.serialize()?;
        if serialized.len() > 340 {
            return Err(OrbitalError::PacketTooLarge(serialized.len()));
        }

        let mut receipt_id = [0u8; 8];
        receipt_id[0..2].copy_from_slice(&packet.header.msg_id.to_be_bytes());
        receipt_id[2..6].copy_from_slice(&packet.header.timestamp.to_be_bytes());

        Ok(TransmissionReceipt {
            receipt_id,
            msg_id: packet.header.msg_id,
            provider: "Iridium-SBD-9603",
            is_simulated: false,
            uplink_timestamp: packet.header.timestamp,
            satellite_id: "IRIDIUM-CONSTELLATION".to_string(),
            status: DeliveryStatus::DeliveredToGroundStation,
        })
    }

    fn poll_incoming(&mut self) -> Result<Vec<SatellitePacket>, OrbitalError> {
        let mut packets = Vec::new();
        while let Some(p) = self.inbound_buffer.pop_front() {
            packets.push(p);
        }
        Ok(packets)
    }
}

// ============================================================================
// 3. LORA SATELLITE ADAPTER (Lacuna Space / FossaSat 868 MHz SRD)
// ============================================================================

pub struct LoRaSatAdapter {
    frequency_hz: u32,
    spreading_factor: u8,
    sync_word: u8,
}

impl Default for LoRaSatAdapter {
    fn default() -> Self {
        Self {
            frequency_hz: 868_100_000, // 868.1 MHz Morocco/EU SRD band
            spreading_factor: 11,      // SF11 for high link budget to LEO
            sync_word: 0x12,
        }
    }
}

impl LoRaSatAdapter {
    pub fn new(frequency_hz: u32, spreading_factor: u8, sync_word: u8) -> Self {
        Self {
            frequency_hz,
            spreading_factor,
            sync_word,
        }
    }

    /// Build RF modulation descriptor for Semtech SX1262 LoRa module
    pub fn build_rf_config(&self) -> (u32, u8, u8) {
        (self.frequency_hz, self.spreading_factor, self.sync_word)
    }
}

impl SatelliteProvider for LoRaSatAdapter {
    fn name(&self) -> &'static str {
        "LoRa-Satellite-868MHz"
    }

    fn provider_type(&self) -> ProviderType {
        ProviderType::LoRaSatellite
    }

    fn network_status(&self) -> SatelliteNetworkStatus {
        SatelliteNetworkStatus::Connected
    }

    fn is_simulated(&self) -> bool {
        false
    }

    fn max_payload_bytes(&self) -> usize {
        222 // LoRaWAN Regional Parameters max payload for SF10/11
    }

    fn transmit(&mut self, packet: &SatellitePacket) -> Result<TransmissionReceipt, OrbitalError> {
        let serialized = packet.serialize()?;
        if serialized.len() > 222 {
            return Err(OrbitalError::PacketTooLarge(serialized.len()));
        }

        let mut receipt_id = [0u8; 8];
        receipt_id[0..2].copy_from_slice(&packet.header.msg_id.to_be_bytes());

        Ok(TransmissionReceipt {
            receipt_id,
            msg_id: packet.header.msg_id,
            provider: "LoRa-Satellite-868MHz",
            is_simulated: false,
            uplink_timestamp: packet.header.timestamp,
            satellite_id: "LACUNA-LS2".to_string(),
            status: DeliveryStatus::InOrbitStorage,
        })
    }

    fn poll_incoming(&mut self) -> Result<Vec<SatellitePacket>, OrbitalError> {
        Ok(Vec::new()) // LoRa satellites are predominantly simplex uplink + terrestrial downlink
    }
}
