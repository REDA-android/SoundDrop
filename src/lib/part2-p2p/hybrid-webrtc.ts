/**
 * Hybrid Acoustic-to-WebRTC Bootstrapper
 * Transmits condensed WebRTC SDP offers/answers over acoustic waves
 * to open a high-speed local DataChannel without any central signaling server.
 */

import { compressAcousticPayload, decompressAcousticPayload } from '../part7-protocol/compressor';

export interface HybridHandshakeOffer {
  type: 'offer' | 'answer';
  sdp: string;
  senderId: string;
}

export class HybridWebRtcManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private onDataCallback: ((data: Uint8Array) => void) | null = null;

  public async createAcousticOffer(senderId: string): Promise<Uint8Array> {
    this.close();

    this.peerConnection = new RTCPeerConnection({
      iceServers: [], // 100% LAN / local candidates only, no STUN/TURN needed
    });

    this.dataChannel = this.peerConnection.createDataChannel('sounddrop-data', {
      ordered: true,
    });
    this.setupDataChannel(this.dataChannel);

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // Wait for local ICE gathering
    await new Promise<void>((resolve) => {
      if (this.peerConnection?.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (this.peerConnection?.iceGatheringState === 'complete') {
            this.peerConnection.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        this.peerConnection?.addEventListener('icegatheringstatechange', checkState);
        setTimeout(resolve, 800); // 800ms max wait for local candidate
      }
    });

    const fullSdp = this.peerConnection.localDescription?.sdp || '';
    // Strip non-essential SDP lines to minimize acoustic payload
    const compactSdp = fullSdp
      .split('\r\n')
      .filter((l) => l.startsWith('v=') || l.startsWith('o=') || l.startsWith('s=') || l.startsWith('t=') || l.startsWith('m=') || l.startsWith('c=') || l.startsWith('a=rtcp') || l.startsWith('a=ice-') || l.startsWith('a=fingerprint') || l.startsWith('a=candidate'))
      .join('\n');

    const offerObj: HybridHandshakeOffer = {
      type: 'offer',
      sdp: compactSdp,
      senderId,
    };

    const comp = compressAcousticPayload(JSON.stringify(offerObj));
    return comp.data;
  }

  public async acceptAcousticOffer(
    offerBytes: Uint8Array,
    senderId: string
  ): Promise<Uint8Array> {
    this.close();

    const decomp = decompressAcousticPayload(offerBytes, true, true);
    const offerObj: HybridHandshakeOffer = JSON.parse(new TextDecoder().decode(decomp));

    this.peerConnection = new RTCPeerConnection({ iceServers: [] });
    this.peerConnection.ondatachannel = (e) => {
      this.dataChannel = e.channel;
      this.setupDataChannel(this.dataChannel);
    };

    await this.peerConnection.setRemoteDescription({
      type: 'offer',
      sdp: offerObj.sdp,
    });

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    const answerObj: HybridHandshakeOffer = {
      type: 'answer',
      sdp: answer.sdp || '',
      senderId,
    };

    const comp = compressAcousticPayload(JSON.stringify(answerObj));
    return comp.data;
  }

  public async applyAcousticAnswer(answerBytes: Uint8Array): Promise<boolean> {
    if (!this.peerConnection) return false;

    try {
      const decomp = decompressAcousticPayload(answerBytes, true, true);
      const answerObj: HybridHandshakeOffer = JSON.parse(new TextDecoder().decode(decomp));

      await this.peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: answerObj.sdp,
      });
      return true;
    } catch (err) {
      console.warn('Failed to apply acoustic WebRTC answer:', err);
      return false;
    }
  }

  public sendData(data: Uint8Array): boolean {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(data.buffer as ArrayBuffer);
      return true;
    }
    return false;
  }

  public onData(callback: (data: Uint8Array) => void): void {
    this.onDataCallback = callback;
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';
    channel.onmessage = (e) => {
      const bytes = new Uint8Array(e.data as ArrayBuffer);
      this.onDataCallback?.(bytes);
    };
  }

  public close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
}

export const hybridWebRtc = new HybridWebRtcManager();
