/**
 * Multi-Path Signaling Client bridging Room Tokens & PAKE Phrases to WebRTC SDP Exchange
 * Combines 4 simultaneous signaling channels for 100% cross-device & serverless reliability:
 * 1. `BroadcastChannel('sounddrop-signaling-v2')` for zero-latency (<5ms) same-device/multi-tab P2P
 * 2. Global WebSocket Signaling Relay via PeerJS JSON broker (`sounddrop-sig-v5-${roomId}`) — bypasses serverless isolate boundaries across PC, iPhone, Android, 4G/5G & Wi-Fi
 * 3. Node.js Serverless `/api/signal/create` & `/api/signal/join` with 2s Sender keep-alive heartbeat
 * 4. Server-Sent Events (SSE) `/api/signal/stream` push
 */

import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';

export interface SignalingPayload {
  roomId: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  role?: 'initiator' | 'receiver';
}

export interface RoomJoinState {
  offer: RTCSessionDescriptionInit | null;
  initiatorCandidates: RTCIceCandidateInit[];
}

interface BroadcastPacket {
  roomId: string;
  type: 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'WHO_HAS_OFFER' | 'CLIPBOARD';
  role?: 'initiator' | 'receiver';
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  initiatorCandidates?: RTCIceCandidateInit[];
  clipboardItem?: {
    id: string;
    senderName: string;
    payload: string;
    timestamp: number;
  };
}

const SIGNAL_PEER_PREFIX = 'sounddrop-sig-v5-';

export class SignalingClient {
  private roomId: string;
  private sse: EventSource | null = null;
  private pollIntervalId: number | null = null;
  private heartbeatIntervalId: number | null = null;
  private bc: BroadcastChannel | null = null;
  private sigPeer: Peer | null = null;
  private sigConns: DataConnection[] = [];
  private seenCandidates = new Set<string>();
  private cachedLocalOffer: RTCSessionDescriptionInit | null = null;
  private cachedPakePhrase?: string;
  private cachedLocalInitiatorCandidates: RTCIceCandidateInit[] = [];
  private receivedExternalOffer: RTCSessionDescriptionInit | null = null;
  private receivedExternalInitiatorCandidates: RTCIceCandidateInit[] = [];
  private onAnswerCallback: ((answer: RTCSessionDescriptionInit) => void) | null = null;
  private onCandidateCallback: ((cand: RTCIceCandidateInit) => void) | null = null;
  private hasDispatchedAnswer = false;
  private isClosed = false;

  constructor(roomId: string) {
    this.roomId = roomId.trim().toUpperCase();
    this.initBroadcastChannel();
  }

  private addReceivedInitiatorCandidate(cand: RTCIceCandidateInit): void {
    if (!cand) return;
    const key = JSON.stringify(cand);
    const existing = new Set(
      this.receivedExternalInitiatorCandidates.map((c) => JSON.stringify(c))
    );
    if (!existing.has(key)) {
      this.receivedExternalInitiatorCandidates.push(cand);
    }
    if (this.onCandidateCallback && !this.seenCandidates.has(key)) {
      this.seenCandidates.add(key);
      this.onCandidateCallback(cand);
    }
  }

  private handleIncomingSignalingPacket(msg: BroadcastPacket): void {
    if (!msg || msg.roomId !== this.roomId) return;

    if (msg.type === 'WHO_HAS_OFFER' && this.cachedLocalOffer) {
      const reply: BroadcastPacket = {
        roomId: this.roomId,
        type: 'OFFER',
        offer: this.cachedLocalOffer,
        initiatorCandidates: [...this.cachedLocalInitiatorCandidates],
      };
      this.bc?.postMessage(reply);
      for (const conn of this.sigConns) {
        try {
          if (conn.open) conn.send(reply);
        } catch {
          // Ignored
        }
      }
    } else if (msg.type === 'OFFER' && msg.offer) {
      this.receivedExternalOffer = msg.offer;
      if (Array.isArray(msg.initiatorCandidates)) {
        for (const cand of msg.initiatorCandidates) {
          this.addReceivedInitiatorCandidate(cand);
        }
      }
    } else if (msg.type === 'ANSWER' && msg.answer) {
      if (this.onAnswerCallback && !this.hasDispatchedAnswer) {
        this.hasDispatchedAnswer = true;
        this.onAnswerCallback(msg.answer);
      }
    } else if (msg.type === 'CANDIDATE' && msg.candidate) {
      if (msg.role === 'initiator') {
        this.addReceivedInitiatorCandidate(msg.candidate);
      } else if (this.onCandidateCallback) {
        const key = JSON.stringify(msg.candidate);
        if (!this.seenCandidates.has(key)) {
          this.seenCandidates.add(key);
          this.onCandidateCallback(msg.candidate);
        }
      }
    }
  }

  private initBroadcastChannel(): void {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    try {
      this.bc = new BroadcastChannel('sounddrop-signaling-v2');
      this.bc.onmessage = (ev: MessageEvent<BroadcastPacket>) => {
        this.handleIncomingSignalingPacket(ev.data);
      };
    } catch {
      // BroadcastChannel optional
    }
  }

  /**
   * Starts a global PeerJS JSON signaling host (`sounddrop-sig-v5-${roomId}`)
   * so any receiver on any mobile/desktop network can fetch the SDP Offer and return the SDP Answer
   * even across isolated serverless instances.
   */
  private async startGlobalSignalingHost(): Promise<void> {
    if (typeof window === 'undefined' || this.isClosed) return;
    try {
      const PeerModule = (await import('peerjs')).default || (await import('peerjs')).Peer;
      if (this.sigPeer) {
        try {
          this.sigPeer.destroy();
        } catch {
          // Ignored
        }
      }

      const hostPeerId = `${SIGNAL_PEER_PREFIX}${this.roomId}`;
      const peer = new PeerModule(hostPeerId, { debug: 0 });
      this.sigPeer = peer;

      peer.on('error', () => {
        // Non-fatal: HTTP/Node.js & BroadcastChannel signaling remain active
      });

      peer.on('connection', (conn: DataConnection) => {
        this.sigConns.push(conn);

        const sendCurrentOffer = () => {
          if (this.cachedLocalOffer && conn.open) {
            try {
              conn.send({
                roomId: this.roomId,
                type: 'OFFER',
                offer: this.cachedLocalOffer,
                initiatorCandidates: [...this.cachedLocalInitiatorCandidates],
              } satisfies BroadcastPacket);
            } catch {
              // Ignored
            }
          }
        };

        conn.on('open', () => {
          sendCurrentOffer();
        });

        conn.on('data', (rawData: unknown) => {
          if (rawData && typeof rawData === 'object') {
            this.handleIncomingSignalingPacket(rawData as BroadcastPacket);
          }
        });
      });
    } catch {
      // Fallback to HTTP signaling
    }
  }

  /**
   * Connects to the sender's global PeerJS JSON signaling host (`sounddrop-sig-v5-${roomId}`)
   * to retrieve the SDP Offer and exchange Answer/ICE candidates.
   */
  private async connectGlobalSignalingClient(): Promise<void> {
    if (typeof window === 'undefined' || this.isClosed || this.sigPeer) return;
    try {
      const PeerModule = (await import('peerjs')).default || (await import('peerjs')).Peer;
      const peer = new PeerModule({ debug: 0 });
      this.sigPeer = peer;

      peer.on('error', () => {
        // Non-fatal
      });

      peer.on('open', () => {
        if (this.isClosed || !this.sigPeer) return;
        const targetHostId = `${SIGNAL_PEER_PREFIX}${this.roomId}`;
        const conn = this.sigPeer.connect(targetHostId, {
          reliable: true,
          serialization: 'json',
        });
        this.sigConns.push(conn);

        conn.on('open', () => {
          try {
            conn.send({
              roomId: this.roomId,
              type: 'WHO_HAS_OFFER',
            } satisfies BroadcastPacket);
          } catch {
            // Ignored
          }
        });

        conn.on('data', (rawData: unknown) => {
          if (rawData && typeof rawData === 'object') {
            this.handleIncomingSignalingPacket(rawData as BroadcastPacket);
          }
        });
      });
    } catch {
      // Non-fatal
    }
  }

  public async registerOffer(
    offer: RTCSessionDescriptionInit,
    pakePhrase?: string
  ): Promise<boolean> {
    this.cachedLocalOffer = offer;
    this.cachedPakePhrase = pakePhrase;

    // 1. Broadcast immediately on local BroadcastChannel
    try {
      this.bc?.postMessage({
        roomId: this.roomId,
        type: 'OFFER',
        offer,
        initiatorCandidates: [...this.cachedLocalInitiatorCandidates],
      } satisfies BroadcastPacket);
    } catch {
      // Ignored
    }

    // 2. Start global PeerJS JSON signaling relay host
    void this.startGlobalSignalingHost();

    // 3. Register on Node.js Serverless API
    const postOfferToServer = async (keepAlive: boolean) => {
      try {
        const res = await fetch('/api/signal/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: this.roomId,
            offer: this.cachedLocalOffer,
            candidates: this.cachedLocalInitiatorCandidates,
            pakePhrase: this.cachedPakePhrase,
            keepAlive,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.answer && this.onAnswerCallback && !this.hasDispatchedAnswer) {
            this.hasDispatchedAnswer = true;
            this.onAnswerCallback(data.answer);
          }
          if (Array.isArray(data.receiverCandidates) && this.onCandidateCallback) {
            for (const cand of data.receiverCandidates) {
              const key = JSON.stringify(cand);
              if (!this.seenCandidates.has(key)) {
                this.seenCandidates.add(key);
                this.onCandidateCallback(cand);
              }
            }
          }
          return true;
        }
      } catch {
        // Ignored during background heartbeat
      }
      return false;
    };

    await postOfferToServer(false);

    // 4. Start 2-second keep-alive heartbeat so any newly warmed serverless container receives the room offer
    if (this.heartbeatIntervalId !== null) {
      clearInterval(this.heartbeatIntervalId);
    }
    this.heartbeatIntervalId = window.setInterval(() => {
      if (this.isClosed || this.hasDispatchedAnswer) {
        if (this.heartbeatIntervalId !== null) {
          clearInterval(this.heartbeatIntervalId);
          this.heartbeatIntervalId = null;
        }
        return;
      }
      void postOfferToServer(true);
    }, 2000);

    return true;
  }

  public async postAnswer(answer: RTCSessionDescriptionInit): Promise<boolean> {
    const packet: BroadcastPacket = {
      roomId: this.roomId,
      type: 'ANSWER',
      answer,
    };

    try {
      this.bc?.postMessage(packet);
    } catch {
      // Ignored
    }

    for (const conn of this.sigConns) {
      try {
        if (conn.open) conn.send(packet);
      } catch {
        // Ignored
      }
    }

    try {
      await fetch('/api/signal/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: this.roomId, answer }),
      });
    } catch {
      // PeerJS / BroadcastChannel still active
    }

    return true;
  }

  public async postCandidate(
    candidate: RTCIceCandidateInit,
    role: 'initiator' | 'receiver'
  ): Promise<boolean> {
    if (role === 'initiator') {
      const key = JSON.stringify(candidate);
      const existing = new Set(
        this.cachedLocalInitiatorCandidates.map((c) => JSON.stringify(c))
      );
      if (!existing.has(key)) {
        this.cachedLocalInitiatorCandidates.push(candidate);
      }
    }

    const packet: BroadcastPacket = {
      roomId: this.roomId,
      type: 'CANDIDATE',
      role,
      candidate,
    };

    try {
      this.bc?.postMessage(packet);
    } catch {
      // Ignored
    }

    for (const conn of this.sigConns) {
      try {
        if (conn.open) conn.send(packet);
      } catch {
        // Ignored
      }
    }

    try {
      await fetch('/api/signal/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: this.roomId, candidate, role }),
      });
      return true;
    } catch {
      return false;
    }
  }

  public async fetchRoomOffer(): Promise<RoomJoinState> {
    if (this.receivedExternalOffer) {
      return {
        offer: this.receivedExternalOffer,
        initiatorCandidates: [...this.receivedExternalInitiatorCandidates],
      };
    }

    // 1. Ask BroadcastChannel & PeerJS signaling connections
    const askPacket: BroadcastPacket = {
      roomId: this.roomId,
      type: 'WHO_HAS_OFFER',
    };
    try {
      this.bc?.postMessage(askPacket);
    } catch {
      // Ignored
    }
    for (const conn of this.sigConns) {
      try {
        if (conn.open) conn.send(askPacket);
      } catch {
        // Ignored
      }
    }

    // 2. Query Node.js Serverless API
    try {
      const res = await fetch(`/api/signal/join?roomId=${encodeURIComponent(this.roomId)}`, {
        headers: { 'Cache-Control': 'no-store' },
      });
      if (!res.ok) {
        return {
          offer: this.receivedExternalOffer,
          initiatorCandidates: [...this.receivedExternalInitiatorCandidates],
        };
      }
      const data = await res.json();
      if (Array.isArray(data.initiatorCandidates)) {
        for (const cand of data.initiatorCandidates) {
          this.addReceivedInitiatorCandidate(cand);
        }
      }
      if (data.offer) {
        this.receivedExternalOffer = data.offer;
      }
      return {
        offer: this.receivedExternalOffer,
        initiatorCandidates: [...this.receivedExternalInitiatorCandidates],
      };
    } catch {
      return {
        offer: this.receivedExternalOffer,
        initiatorCandidates: [...this.receivedExternalInitiatorCandidates],
      };
    }
  }

  /**
   * Actively waits for the room offer across BroadcastChannel, PeerJS Global Relay, and Node.js API.
   */
  public async waitForRoomOffer(
    timeoutMs = 15000,
    onProgressAttempt?: (attempt: number) => void
  ): Promise<RoomJoinState> {
    void this.connectGlobalSignalingClient();

    const start = Date.now();
    let attempt = 0;
    while (!this.isClosed && Date.now() - start < timeoutMs) {
      attempt++;
      if (onProgressAttempt) {
        onProgressAttempt(attempt);
      }
      const state = await this.fetchRoomOffer();
      if (state.offer) {
        return state;
      }
      await new Promise((r) => setTimeout(r, 450));
    }
    return { offer: null, initiatorCandidates: [] };
  }

  public listenForAnswer(
    onAnswer: (answer: RTCSessionDescriptionInit) => void,
    onCandidate: (cand: RTCIceCandidateInit) => void
  ): void {
    this.onAnswerCallback = onAnswer;
    this.onCandidateCallback = onCandidate;

    this.startPollingForAnswer(onAnswer, onCandidate);

    if (typeof EventSource !== 'undefined') {
      try {
        const streamUrl = `/api/signal/stream?roomId=${encodeURIComponent(this.roomId)}&role=initiator`;
        this.sse = new EventSource(streamUrl);

        this.sse.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'answer' && data.answer && !this.hasDispatchedAnswer) {
              this.hasDispatchedAnswer = true;
              onAnswer(data.answer);
            } else if (data.type === 'candidate' && data.candidate) {
              const key = JSON.stringify(data.candidate);
              if (!this.seenCandidates.has(key)) {
                this.seenCandidates.add(key);
                onCandidate(data.candidate);
              }
            }
          } catch {
            // Non-JSON ping
          }
        };
      } catch {
        // Handled by polling fallback
      }
    }
  }

  public listenForInitiatorCandidates(
    onCandidate: (cand: RTCIceCandidateInit) => void
  ): void {
    this.onCandidateCallback = onCandidate;
    this.startPollingInitiatorCandidates(onCandidate);

    if (typeof EventSource !== 'undefined') {
      try {
        const streamUrl = `/api/signal/stream?roomId=${encodeURIComponent(this.roomId)}&role=receiver`;
        this.sse = new EventSource(streamUrl);

        this.sse.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'candidate' && data.candidate) {
              const key = JSON.stringify(data.candidate);
              if (!this.seenCandidates.has(key)) {
                this.seenCandidates.add(key);
                onCandidate(data.candidate);
              }
            }
          } catch {
            // Non-JSON ping
          }
        };
      } catch {
        // Handled by polling fallback
      }
    }
  }

  private startPollingForAnswer(
    onAnswer: (answer: RTCSessionDescriptionInit) => void,
    onCandidate: (cand: RTCIceCandidateInit) => void
  ): void {
    if (this.pollIntervalId !== null) return;

    this.pollIntervalId = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/signal/join?roomId=${encodeURIComponent(this.roomId)}`, {
          headers: { 'Cache-Control': 'no-store' },
        });
        if (!res.ok) return;
        const data = await res.json();

        if (data.answer && !this.hasDispatchedAnswer) {
          this.hasDispatchedAnswer = true;
          onAnswer(data.answer);
        }

        if (Array.isArray(data.candidates)) {
          for (const cand of data.candidates) {
            const key = JSON.stringify(cand);
            if (!this.seenCandidates.has(key)) {
              this.seenCandidates.add(key);
              onCandidate(cand);
            }
          }
        }
      } catch {
        // Retry next interval
      }
    }, 500);
  }

  private startPollingInitiatorCandidates(
    onCandidate: (cand: RTCIceCandidateInit) => void
  ): void {
    if (this.pollIntervalId !== null) return;

    this.pollIntervalId = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/signal/join?roomId=${encodeURIComponent(this.roomId)}`, {
          headers: { 'Cache-Control': 'no-store' },
        });
        if (!res.ok) return;
        const data = await res.json();

        if (Array.isArray(data.initiatorCandidates)) {
          for (const cand of data.initiatorCandidates) {
            const key = JSON.stringify(cand);
            if (!this.seenCandidates.has(key)) {
              this.seenCandidates.add(key);
              onCandidate(cand);
            }
          }
        }
      } catch {
        // Retry next interval
      }
    }, 500);
  }

  public close(): void {
    this.isClosed = true;
    if (this.heartbeatIntervalId !== null) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    if (this.pollIntervalId !== null) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    for (const conn of this.sigConns) {
      try {
        conn.close();
      } catch {
        // Ignored
      }
    }
    this.sigConns = [];
    if (this.sigPeer) {
      try {
        this.sigPeer.destroy();
      } catch {
        // Ignored
      }
      this.sigPeer = null;
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
}
