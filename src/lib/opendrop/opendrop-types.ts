/**
 * OpenDrop & Apple AirDrop Protocol Type Definitions
 * Derived from seemoo-lab/opendrop specification (AWDL / AirDrop v2 HTTP JSON & plist API)
 */

export interface OpenDropFileManifest {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
  sha256?: string;
}

export interface OpenDropDevice {
  id: string; // Node ID (Hex/UUID)
  computerName: string; // e.g., "iPhone de Reda", "SoundDrop-Node"
  modelName: string; // e.g., "MacBookPro16,1", "iPhone15,2", "SoundDrop-PWA"
  address?: string; // Endpoint info (e.g. "AIRDROP 2.0" / "LAN")
  port?: number;
  capabilities?: {
    version?: number;
    heifSupported?: boolean;
    airdropVersion?: string;
  };
  lastSeen: number;
  status: 'ONLINE' | 'TRANSFERRING' | 'BUSY';
}

export interface OpenDropAskRequest {
  transferId?: string;
  senderId?: string;
  targetNodeId?: string;
  senderComputerName: string;
  senderModelName: string;
  bundleId?: string;
  files: OpenDropFileManifest[];
  totalBytes: number;
  timestamp: number;
  status?: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'TRANSFERRING' | 'COMPLETED' | 'ERROR';
}

export interface OpenDropAskResponse {
  accepted: boolean;
  transferId?: string;
  receiverComputerName: string;
  receiverModelName: string;
  reason?: string;
  status?: string;
}

export interface OpenDropTransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  currentFileName: string;
}
