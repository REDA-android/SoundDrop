/**
 * Types and interfaces for SoundDrop Orbital Relay (SOR).
 * Provider abstraction separating simulated satellite transports from verified real hardware.
 */

export type ProviderType = 'simulated' | 'iridium-sbd' | 'lora-satellite' | '3gpp-ntn';

export type SatelliteNetworkStatus = 'no_signal' | 'acquiring' | 'connected' | 'transmitting' | 'standby';

export type DeliveryStatus = 'pending_uplink' | 'in_orbit_storage' | 'delivered_to_ground' | 'delivered_to_destination';

export interface TransmissionReceipt {
  receiptId: string;
  msgId: number;
  provider: string;
  isSimulated: boolean;
  uplinkTimestamp: number;
  satelliteId: string;
  status: DeliveryStatus;
}

export interface SatelliteHeader {
  magic: string; // 'SO'
  version: number; // 1
  flags: number;
  msgId: number;
  recipientHash: string; // Hex representation of 4 bytes
  timestamp: number;
  payloadLen: number;
}

export interface SatellitePacket {
  header: SatelliteHeader;
  payload: Uint8Array;
}

export interface SatelliteProvider {
  readonly name: string;
  readonly providerType: ProviderType;
  readonly isSimulated: boolean;
  readonly maxPayloadBytes: number;

  getNetworkStatus(): SatelliteNetworkStatus;
  transmit(packet: SatellitePacket): Promise<TransmissionReceipt>;
  pollIncoming(): Promise<SatellitePacket[]>;
}
