import {
  OpenDropDevice,
  OpenDropAskRequest,
  OpenDropAskResponse,
  OpenDropTransferProgress,
} from './opendrop-types';

export type ProgressCallback = (progress: OpenDropTransferProgress) => void;
export type NodeDiscoveryCallback = (nodes: OpenDropDevice[]) => void;
export type IncomingTransferCallback = (
  request: OpenDropAskRequest,
  accept: () => Promise<void>,
  decline: () => void
) => void;

export class OpenDropClient {
  private localDevice: OpenDropDevice;
  private heartbeatTimer: number | null = null;
  private discoveryTimer: number | null = null;
  private incomingCheckTimer: number | null = null;
  private bc: BroadcastChannel | null = null;
  private localBroadcastPeers = new Map<string, OpenDropDevice>();
  private seenTransferIds = new Set<string>();
  private onNodesFound?: NodeDiscoveryCallback;
  private onIncomingTransfer?: IncomingTransferCallback;

  constructor(customName?: string) {
    let randomHex = '';
    if (typeof window !== 'undefined') {
      const stored = window.sessionStorage.getItem('sounddrop_node_hex');
      if (stored) {
        randomHex = stored;
      } else {
        randomHex = Math.random().toString(16).substring(2, 8).toUpperCase();
        window.sessionStorage.setItem('sounddrop_node_hex', randomHex);
      }
    } else {
      randomHex = Math.random().toString(16).substring(2, 8).toUpperCase();
    }

    this.localDevice = {
      id: `opendrop-node-${randomHex}`,
      computerName: customName || `SoundDrop-${randomHex}`,
      modelName: 'AirDrop-PWA',
      address: 'AirDrop 2.0 (P2P)',
      lastSeen: Date.now(),
      status: 'ONLINE',
      capabilities: {
        version: 1,
        heifSupported: true,
        airdropVersion: '2.0',
      },
    };
  }

  public getLocalDevice(): OpenDropDevice {
    return this.localDevice;
  }

  public setComputerName(name: string): void {
    this.localDevice.computerName = name.trim();
  }

  private initBroadcastDiscovery(): void {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    try {
      this.bc = new BroadcastChannel('sounddrop-opendrop-v2');
      this.bc.onmessage = (ev) => {
        const data = ev.data;
        if (!data) return;
        if (data.type === 'ANNOUNCE' && data.device && data.device.id !== this.localDevice.id) {
          this.localBroadcastPeers.set(data.device.id, {
            ...data.device,
            lastSeen: Date.now(),
          });
          void this.fetchNodes();
        } else if (data.type === 'WHO_IS_HERE') {
          this.bc?.postMessage({ type: 'ANNOUNCE', device: this.localDevice });
        } else if (
          data.type === 'INCOMING_ASK' &&
          data.ask &&
          (!data.ask.targetNodeId || data.ask.targetNodeId === this.localDevice.id) &&
          data.ask.senderId !== this.localDevice.id
        ) {
          this.dispatchIncomingAsk(data.ask as OpenDropAskRequest);
        }
      };
      this.bc.postMessage({ type: 'WHO_IS_HERE' });
      this.bc.postMessage({ type: 'ANNOUNCE', device: this.localDevice });
    } catch {
      // Optional
    }
  }

  /**
   * Start broadcasting local device presence and discovering nearby OpenDrop / AirDrop nodes
   */
  public startDiscovery(
    onNodesFound: NodeDiscoveryCallback,
    onIncoming?: IncomingTransferCallback
  ): void {
    this.onNodesFound = onNodesFound;
    this.onIncomingTransfer = onIncoming;

    this.initBroadcastDiscovery();
    void this.broadcastPresence();
    void this.fetchNodes();

    if (typeof window !== 'undefined') {
      this.heartbeatTimer = window.setInterval(() => {
        void this.broadcastPresence();
      }, 10000);

      this.discoveryTimer = window.setInterval(() => {
        void this.fetchNodes();
      }, 3000);

      this.incomingCheckTimer = window.setInterval(() => {
        void this.checkIncomingTransfers();
      }, 2500);
    }
  }

  public stopDiscovery(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.discoveryTimer !== null) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    if (this.incomingCheckTimer !== null) {
      clearInterval(this.incomingCheckTimer);
      this.incomingCheckTimer = null;
    }
    if (this.bc) {
      try {
        this.bc.close();
      } catch {
        // Ignored
      }
      this.bc = null;
    }
  }

  private async broadcastPresence(): Promise<void> {
    this.localDevice.lastSeen = Date.now();
    try {
      this.bc?.postMessage({ type: 'ANNOUNCE', device: this.localDevice });
    } catch {
      // Ignored
    }
    try {
      await fetch('/api/opendrop/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.localDevice),
      });
    } catch {
      // Offline fallback
    }
  }

  public async fetchNodes(): Promise<OpenDropDevice[]> {
    const mergedMap = new Map<string, OpenDropDevice>();
    const now = Date.now();

    this.localBroadcastPeers.forEach((peer, id) => {
      if (now - peer.lastSeen < 90000 && id !== this.localDevice.id) {
        mergedMap.set(id, peer);
      }
    });

    try {
      const res = await fetch('/api/opendrop/nodes', {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const data = (await res.json()) as { nodes?: OpenDropDevice[] };
        for (const n of data.nodes || []) {
          if (n.id !== this.localDevice.id) {
            mergedMap.set(n.id, n);
          }
        }
      }
    } catch {
      // Fallback to localBroadcastPeers
    }

    const remoteNodes = Array.from(mergedMap.values());
    if (this.onNodesFound) {
      this.onNodesFound(remoteNodes);
    }
    return remoteNodes;
  }

  private dispatchIncomingAsk(item: OpenDropAskRequest): void {
    if (!this.onIncomingTransfer || !item.transferId) return;
    if (this.seenTransferIds.has(item.transferId)) return;
    this.seenTransferIds.add(item.transferId);

    const accept = async () => {
      await fetch('/api/opendrop/ask?action=respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId: item.transferId, accepted: true }),
      });

      if (item.transferId && typeof window !== 'undefined') {
        const dlUrl = `/api/opendrop/upload?transferId=${encodeURIComponent(item.transferId)}`;
        const link = document.createElement('a');
        link.href = dlUrl;
        link.download = item.files[0]?.name || 'airdrop_file';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    };

    const decline = () => {
      void fetch('/api/opendrop/ask?action=respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId: item.transferId, accepted: false }),
      });
    };

    this.onIncomingTransfer(item, accept, decline);
  }

  private async checkIncomingTransfers(): Promise<void> {
    if (!this.onIncomingTransfer) return;
    try {
      const res = await fetch(`/api/opendrop/ask?nodeId=${encodeURIComponent(this.localDevice.id)}`, {
        headers: { 'Cache-Control': 'no-store' },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { incoming?: OpenDropAskRequest[] };
      const list = data.incoming || [];
      if (list.length > 0) {
        this.dispatchIncomingAsk(list[0]);
      }
    } catch {
      // Ignore background check failure
    }
  }

  /**
   * Complete OpenDrop 3-Step Handshake: /Discover -> /Ask -> /Upload
   */
  public async sendFile(
    targetNode: OpenDropDevice,
    file: File,
    onProgress?: ProgressCallback
  ): Promise<boolean> {
    try {
      const discoverRes = await fetch('/api/opendrop/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AirDrop-Sender': this.localDevice.computerName,
        },
        body: JSON.stringify({
          SenderComputerName: this.localDevice.computerName,
          SenderModelName: this.localDevice.modelName,
        }),
      });

      if (!discoverRes.ok) {
        throw new Error(`Échec de la découverte OpenDrop (Code HTTP ${discoverRes.status})`);
      }

      const askPayload: OpenDropAskRequest = {
        senderId: this.localDevice.id,
        targetNodeId: targetNode.id,
        senderComputerName: this.localDevice.computerName,
        senderModelName: this.localDevice.modelName,
        files: [
          {
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream',
            lastModified: file.lastModified,
          },
        ],
        totalBytes: file.size,
        timestamp: Date.now(),
      };

      const askRes = await fetch('/api/opendrop/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AirDrop-Sender': this.localDevice.computerName,
        },
        body: JSON.stringify(askPayload),
      });

      if (!askRes.ok) {
        throw new Error(
          `Le destinataire n'a pas répondu à la demande (Code HTTP ${askRes.status})`
        );
      }

      const askData = (await askRes.json()) as OpenDropAskResponse;
      if (!askData.accepted) {
        throw new Error('Le destinataire OpenDrop a refusé le transfert.');
      }

      const transferId = askData.transferId || targetNode.id;

      // Stream upload chunks (64 KB chunking for real progress feedback)
      const chunkSize = 64 * 1024;
      let offset = 0;
      const startTime = performance.now();

      if (file.size === 0) {
        const upRes = await fetch('/api/opendrop/upload', {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-AirDrop-Transfer-Id': transferId,
            'X-AirDrop-Filename': encodeURIComponent(file.name),
          },
          body: new Uint8Array(0),
        });
        if (!upRes.ok) {
          throw new Error(`Erreur lors de l'envoi OpenDrop (${upRes.status})`);
        }
      } else {
        while (offset < file.size) {
          const slice = file.slice(offset, offset + chunkSize);
          const chunkBuf = await slice.arrayBuffer();

          const uploadRes = await fetch('/api/opendrop/upload', {
            method: 'POST',
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              'X-AirDrop-Transfer-Id': transferId,
              'X-AirDrop-Filename': encodeURIComponent(file.name),
              'Content-Range': `bytes ${offset}-${offset + chunkBuf.byteLength - 1}/${file.size}`,
            },
            body: chunkBuf,
          });

          if (!uploadRes.ok) {
            throw new Error(
              `Erreur lors du streaming OpenDrop (Code HTTP ${uploadRes.status})`
            );
          }

          offset += chunkBuf.byteLength;
          const elapsedSec = (performance.now() - startTime) / 1000;
          const speed = elapsedSec > 0 ? offset / elapsedSec : 0;

          if (onProgress) {
            onProgress({
              bytesTransferred: offset,
              totalBytes: file.size,
              percentage: Math.min(100, Math.round((offset / file.size) * 100)),
              speedBytesPerSec: Math.round(speed),
              currentFileName: file.name,
            });
          }
        }
      }

      // Notify local BroadcastChannel peers immediately after upload is complete
      try {
        this.bc?.postMessage({
          type: 'INCOMING_ASK',
          ask: {
            ...askPayload,
            transferId,
            status: 'ACCEPTED',
          },
        });
      } catch {
        // Ignored
      }

      return true;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Load failed') || msg.includes('Failed to fetch')) {
        throw new Error('Connexion réseau interrompue ou bloquée par le navigateur. Réessayez.');
      }
      throw err;
    }
  }
}
