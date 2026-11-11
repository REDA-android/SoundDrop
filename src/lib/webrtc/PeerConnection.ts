/**
 * Hybrid Multi-Engine WebRTC Transport Layer
 * Integrates:
 * 1. `PeerJS` (peers/peerjs) with `serialization: 'raw'`: Zero-config Global WebRTC Broker
 * 2. Direct `RTCPeerConnection` with multi-path signaling (`BroadcastChannel` + PeerJS JSON Relay + Serverless Node API)
 * 3. STUN + TURN NAT traversal (Cloudflare, Google, Twilio + OpenRelay TURN TCP/UDP) for 4G/5G & Wi-Fi cross-network transfers
 */

import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';

export type TransportEngineType = 'HYBRID_AUTO' | 'PEERJS' | 'SIMPLE_PEER_EDGE';

export interface WebRTCStats {
  roundTripTimeMs: number;
  bytesSent: number;
  bytesReceived: number;
  sendBitrateBps: number;
  receiveBitrateBps: number;
  localCandidateType: string;
  remoteCandidateType: string;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  activeEngine: string;
}

export interface PeerEvents {
  onSignalNeeded: (data: {
    type: 'offer' | 'answer' | 'candidate';
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
  }) => Promise<void> | void;
  onConnectionStateChange: (state: RTCPeerConnectionState, engineName?: string) => void;
  onDataChannelReady: (channel: RTCDataChannel) => void;
  onExtraChannelReady?: (channel: RTCDataChannel) => void;
  onStatsUpdate?: (stats: WebRTCStats) => void;
}

export const PEERJS_ID_PREFIX = 'sounddrop-v2-room-';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export class PeerConnectionManager {
  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private peerJsInstance: Peer | null = null;
  private peerJsConn: DataConnection | null = null;
  private events: PeerEvents;
  private statsIntervalId: number | null = null;
  private prevBytesSent = 0;
  private prevBytesReceived = 0;
  private prevStatsTimestamp = 0;
  private isChannelDispatched = false;
  private isClosed = false;
  private activeEngineName = 'Direct WebRTC';

  // Queue local candidates until offer/answer is emitted, and remote candidates until remoteDescription is set
  private isLocalDescriptionDispatched = false;
  private queuedLocalCandidates: RTCIceCandidateInit[] = [];
  private allLocalCandidates: RTCIceCandidateInit[] = [];
  private queuedRemoteCandidates: RTCIceCandidateInit[] = [];

  constructor(events: PeerEvents) {
    this.events = events;
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    this.pc = new RTCPeerConnection({
      iceServers: isOnline ? DEFAULT_ICE_SERVERS : [],
      iceCandidatePoolSize: isOnline ? 8 : 2,
    });

    this.setupListeners();
    this.startStatsPoller();
  }

  private dispatchReadyChannel(channel: RTCDataChannel, engineName: string): void {
    if (this.isClosed) return;
    channel.binaryType = 'arraybuffer';
    if (!this.isChannelDispatched) {
      this.isChannelDispatched = true;
      this.activeEngineName = engineName;
      this.dataChannel = channel;
      this.events.onConnectionStateChange('connected', engineName);
      this.events.onDataChannelReady(channel);
    } else if (this.dataChannel !== channel && this.events.onExtraChannelReady) {
      this.events.onExtraChannelReady(channel);
    }
  }

  private setupListeners(): void {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candJson = event.candidate.toJSON();
        this.allLocalCandidates.push(candJson);
        if (!this.isLocalDescriptionDispatched) {
          this.queuedLocalCandidates.push(candJson);
        } else {
          void this.events.onSignalNeeded({
            type: 'candidate',
            payload: candJson,
          });
        }
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (!this.isChannelDispatched && !this.isClosed) {
        this.events.onConnectionStateChange(this.pc.connectionState, this.activeEngineName);
      }
    };

    this.pc.ondatachannel = (event) => {
      const ch = event.channel;
      ch.binaryType = 'arraybuffer';
      if (ch.readyState === 'open') {
        this.dispatchReadyChannel(ch, 'Direct WebRTC');
      } else {
        ch.onopen = () => {
          this.dispatchReadyChannel(ch, 'Direct WebRTC');
        };
      }
    };
  }

  private async flushQueuedLocalCandidates(): Promise<void> {
    this.isLocalDescriptionDispatched = true;
    while (this.queuedLocalCandidates.length > 0) {
      const cand = this.queuedLocalCandidates.shift();
      if (cand) {
        await this.events.onSignalNeeded({
          type: 'candidate',
          payload: cand,
        });
      }
    }
  }

  private async flushQueuedRemoteCandidates(): Promise<void> {
    if (!this.pc.remoteDescription) return;
    while (this.queuedRemoteCandidates.length > 0) {
      const cand = this.queuedRemoteCandidates.shift();
      if (cand) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Non-fatal ICE candidate flush warning:', e);
        }
      }
    }
  }

  private bindPeerJsDataChannel(conn: DataConnection): void {
    let boundDc: RTCDataChannel | null = null;
    const checkAndBind = () => {
      if (this.isClosed) return;
      const rawDc =
        (conn as unknown as { dataChannel?: RTCDataChannel; _dc?: RTCDataChannel }).dataChannel ||
        (conn as unknown as { _dc?: RTCDataChannel })._dc;

      if (rawDc && rawDc !== boundDc) {
        boundDc = rawDc;
        rawDc.binaryType = 'arraybuffer';
        if (rawDc.readyState === 'open') {
          this.dispatchReadyChannel(rawDc, 'PeerJS Mesh');
          return;
        }
        rawDc.addEventListener(
          'open',
          () => {
            this.dispatchReadyChannel(rawDc, 'PeerJS Mesh');
          },
          { once: true }
        );
      }
    };

    conn.on('open', checkAndBind);
    checkAndBind();
    setTimeout(checkAndBind, 100);
    setTimeout(checkAndBind, 350);
  }

  /**
   * Starts PeerJS host listener on deterministic ID `sounddrop-v2-room-${roomId}`
   * and waits up to 1500ms for the broker WebSocket to confirm registration.
   */
  public async startPeerJsHost(roomId: string): Promise<void> {
    if (typeof window === 'undefined' || this.isClosed) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    return new Promise<void>(async (resolve) => {
      const readyTimer = setTimeout(() => resolve(), 1500);

      try {
        const PeerModule = (await import('peerjs')).default || (await import('peerjs')).Peer;
        const peerId = `${PEERJS_ID_PREFIX}${roomId.trim().toUpperCase()}`;

        if (this.peerJsInstance) {
          try {
            this.peerJsInstance.destroy();
          } catch {
            // Ignored
          }
        }

        this.peerJsInstance = new PeerModule(peerId, {
          debug: 0,
          config: {
            iceServers: DEFAULT_ICE_SERVERS,
          },
        });

        this.peerJsInstance.on('open', () => {
          clearTimeout(readyTimer);
          resolve();
        });

        this.peerJsInstance.on('error', (err) => {
          clearTimeout(readyTimer);
          console.warn('PeerJS host notice (Direct WebRTC active):', err?.message || err);
          resolve();
        });

        this.peerJsInstance.on('connection', (conn: DataConnection) => {
          this.peerJsConn = conn;
          this.bindPeerJsDataChannel(conn);
        });
      } catch (e) {
        clearTimeout(readyTimer);
        console.warn('PeerJS host fallback notice:', e);
        resolve();
      }
    });
  }

  /**
   * Connects to a PeerJS host room ID (`sounddrop-v2-room-${roomId}`) using `serialization: 'raw'`.
   * Retries up to `maxAttempts` if the host is still initializing.
   */
  public async connectViaPeerJs(roomId: string, maxAttempts = 4): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const targetId = `${PEERJS_ID_PREFIX}${roomId.trim().toUpperCase()}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.isChannelDispatched || this.isClosed) {
        return this.isChannelDispatched;
      }

      const attemptOk = await new Promise<boolean>(async (resolve) => {
        const timeout = setTimeout(() => resolve(false), 3800);

        try {
          const PeerModule = (await import('peerjs')).default || (await import('peerjs')).Peer;

          if (this.peerJsInstance) {
            try {
              this.peerJsInstance.destroy();
            } catch {
              // Ignored
            }
          }

          this.peerJsInstance = new PeerModule({
            debug: 0,
            config: {
              iceServers: DEFAULT_ICE_SERVERS,
            },
          });

          this.peerJsInstance.on('open', () => {
            if (!this.peerJsInstance || this.isClosed) {
              clearTimeout(timeout);
              resolve(false);
              return;
            }

            // CRITICAL FIX: PeerJS 1.5.5 uses 'raw' for SerializationType.None (NOT 'none')
            const conn = this.peerJsInstance.connect(targetId, {
              reliable: true,
              serialization: 'raw',
            });

            if (!conn) {
              clearTimeout(timeout);
              resolve(false);
              return;
            }

            this.peerJsConn = conn;

            let boundClientDc: RTCDataChannel | null = null;
            const checkDc = () => {
              const rawDc =
                (conn as unknown as { dataChannel?: RTCDataChannel }).dataChannel ||
                (conn as unknown as { _dc?: RTCDataChannel })._dc;
              if (rawDc && rawDc !== boundClientDc) {
                boundClientDc = rawDc;
                rawDc.binaryType = 'arraybuffer';
                if (rawDc.readyState === 'open') {
                  clearTimeout(timeout);
                  this.dispatchReadyChannel(rawDc, 'PeerJS Mesh');
                  resolve(true);
                } else {
                  rawDc.addEventListener(
                    'open',
                    () => {
                      clearTimeout(timeout);
                      this.dispatchReadyChannel(rawDc, 'PeerJS Mesh');
                      resolve(true);
                    },
                    { once: true }
                  );
                }
              }
            };

            conn.on('open', checkDc);
            conn.on('error', () => {
              clearTimeout(timeout);
              resolve(false);
            });
            setTimeout(checkDc, 120);
          });

          this.peerJsInstance.on('error', () => {
            clearTimeout(timeout);
            resolve(false);
          });
        } catch {
          clearTimeout(timeout);
          resolve(false);
        }
      });

      if (attemptOk || this.isChannelDispatched) {
        return true;
      }

      if (attempt < maxAttempts && !this.isClosed) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return this.isChannelDispatched;
  }

  public async initiateOffer(
    roomId?: string,
    _engine: TransportEngineType = 'HYBRID_AUTO'
  ): Promise<RTCSessionDescriptionInit> {
    this.isLocalDescriptionDispatched = false;
    this.queuedLocalCandidates = [];

    // Start PeerJS host non-blockingly in parallel so room creation is instant (<15ms)
    if (roomId) {
      void this.startPeerJsHost(roomId);
    }

    const dc = this.pc.createDataChannel('sounddrop-raw-transport', {
      ordered: true,
    });
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      this.dispatchReadyChannel(dc, 'Direct WebRTC');
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    await this.events.onSignalNeeded({
      type: 'offer',
      payload: offer,
    });

    await this.flushQueuedLocalCandidates();

    return offer;
  }

  public async handleOfferAndAnswer(
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    this.isLocalDescriptionDispatched = false;
    this.queuedLocalCandidates = [];

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.flushQueuedRemoteCandidates();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    await this.events.onSignalNeeded({
      type: 'answer',
      payload: answer,
    });

    await this.flushQueuedLocalCandidates();

    return answer;
  }

  public async applyAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (this.pc.signalingState === 'have-local-offer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      await this.flushQueuedRemoteCandidates();
    }
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc.remoteDescription) {
      this.queuedRemoteCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('Non-fatal ICE candidate insertion race:', e);
    }
  }

  private startStatsPoller(): void {
    if (typeof window === 'undefined') return;

    this.statsIntervalId = window.setInterval(async () => {
      const targetPc =
        (this.peerJsConn as unknown as { peerConnection?: RTCPeerConnection })?.peerConnection ||
        this.pc;

      if (!targetPc || targetPc.connectionState === 'closed') {
        return;
      }

      try {
        const stats = await targetPc.getStats();
        let rtt = 0;
        let bytesSent = 0;
        let bytesReceived = 0;
        let localCandType = 'host';
        let remoteCandType = 'srflx';

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (typeof report.currentRoundTripTime === 'number') {
              rtt = Math.round(report.currentRoundTripTime * 1000);
            }
          }
          if (report.type === 'data-channel') {
            bytesSent = report.bytesSent || 0;
            bytesReceived = report.bytesReceived || 0;
          }
          if (report.type === 'local-candidate') {
            localCandType = report.candidateType || 'host';
          }
          if (report.type === 'remote-candidate') {
            remoteCandType = report.candidateType || 'srflx';
          }
        });

        const now = performance.now();
        const deltaSec = this.prevStatsTimestamp > 0 ? (now - this.prevStatsTimestamp) / 1000 : 1;
        const sendBitrate = deltaSec > 0 ? ((bytesSent - this.prevBytesSent) * 8) / deltaSec : 0;
        const recvBitrate =
          deltaSec > 0 ? ((bytesReceived - this.prevBytesReceived) * 8) / deltaSec : 0;

        this.prevBytesSent = bytesSent;
        this.prevBytesReceived = bytesReceived;
        this.prevStatsTimestamp = now;

        if (this.events.onStatsUpdate) {
          this.events.onStatsUpdate({
            roundTripTimeMs: rtt,
            bytesSent,
            bytesReceived,
            sendBitrateBps: Math.max(0, sendBitrate),
            receiveBitrateBps: Math.max(0, recvBitrate),
            localCandidateType: localCandType,
            remoteCandidateType: remoteCandType,
            connectionState: this.isChannelDispatched ? 'connected' : targetPc.connectionState,
            iceConnectionState: targetPc.iceConnectionState,
            activeEngine: this.activeEngineName,
          });
        }
      } catch {
        // Ignore transient closed state
      }
    }, 1000);
  }

  private stopStatsPoller(): void {
    if (this.statsIntervalId !== null) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
  }

  public getConnectionState(): RTCPeerConnectionState {
    if (this.isChannelDispatched) return 'connected';
    return this.pc.connectionState;
  }

  public getDataChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  public getLocalDescriptionAndCandidates(): {
    description: RTCSessionDescriptionInit | null;
    candidates: RTCIceCandidateInit[];
  } {
    return {
      description: this.pc.localDescription
        ? { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp }
        : null,
      candidates: [...this.allLocalCandidates],
    };
  }

  public close(): void {
    this.isClosed = true;
    this.stopStatsPoller();
    this.isChannelDispatched = false;
    this.queuedLocalCandidates = [];
    this.queuedRemoteCandidates = [];
    if (this.peerJsConn) {
      try {
        this.peerJsConn.close();
      } catch {
        // Ignored
      }
      this.peerJsConn = null;
    }
    if (this.peerJsInstance) {
      try {
        this.peerJsInstance.destroy();
      } catch {
        // Ignored
      }
      this.peerJsInstance = null;
    }
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {
        // Ignored
      }
      this.dataChannel = null;
    }
    try {
      this.pc.close();
    } catch {
      // Ignored
    }
  }
}
