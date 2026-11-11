import { describe, expect, it } from 'vitest';
import {
  isLanCandidate,
  encodeOfflineSdpToken,
  decodeOfflineSdpToken,
  WEBRTC_LAN_FAILED_MESSAGE,
} from './offline-sdp';

describe('Phase 7 — WebRTC Réseau Local (LAN) & Échange de Signal', () => {
  describe('Filtrage Strict des Candidats ICE Réseau Local', () => {
    it('accepte les adresses IPv4 privées locales (192.168.x, 10.x, 172.16-31.x) et mDNS .local', () => {
      const cand192 = 'candidate:1 1 UDP 2122260223 192.168.1.42 54321 typ host';
      const cand10 = 'candidate:2 1 UDP 2122260223 10.0.0.15 54321 typ host';
      const cand172 = 'candidate:3 1 UDP 2122260223 172.20.10.8 54321 typ host';
      const candMdns = 'candidate:4 1 UDP 2122260223 d7e8f9-laptop.local 54321 typ host';

      expect(isLanCandidate(cand192)).toBe(true);
      expect(isLanCandidate(cand10)).toBe(true);
      expect(isLanCandidate(cand172)).toBe(true);
      expect(isLanCandidate(candMdns)).toBe(true);
    });

    it('rejette formellement les adresses IP publiques, relais TURN et srflx', () => {
      const publicHost = 'candidate:5 1 UDP 2122260223 142.250.190.46 54321 typ host';
      const srflxCand = 'candidate:6 1 UDP 1686052607 192.168.1.42 54321 typ srflx raddr 192.168.1.42';
      const relayCand = 'candidate:7 1 UDP 41885439 10.0.0.1 54321 typ relay raddr 10.0.0.1';

      expect(isLanCandidate(publicHost)).toBe(false);
      expect(isLanCandidate(srflxCand)).toBe(false);
      expect(isLanCandidate(relayCand)).toBe(false);
      expect(isLanCandidate('')).toBe(false);
    });
  });

  describe('Compression SDP & Échange de Signal Acoustique / QR', () => {
    it('compresse une offre SDP + candidats LAN en un jeton compact (< 500 octets)', () => {
      const dummySdp = `v=0
o=- 41829182 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:testufrag
a=ice-pwd:testpassword1234567890
a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
`;
      const candidates: RTCIceCandidateInit[] = [
        { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.100 54321 typ host' },
        { candidate: 'candidate:2 1 UDP 2122260223 8.8.8.8 54321 typ host' }, // Doit être exclu
      ];

      const token = encodeOfflineSdpToken(
        { type: 'offer', sdp: dummySdp },
        candidates
      );

      expect(token.startsWith('SDO1:')).toBe(true);
      // Taille compacte pour échange sonore (< 500 octets)
      expect(token.length).toBeLessThan(500);

      // Décodage et vérification
      const decoded = decodeOfflineSdpToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.description.type).toBe('offer');
      expect(decoded?.candidates.length).toBe(1); // Le candidat public a été exclu
      expect(decoded?.candidates[0].candidate).toContain('192.168.1.100');
    });
  });

  describe('Message d’Échec Honnête', () => {
    it('définit un message d’erreur honnête et explicite en cas d’échec sans faux fallback', () => {
      expect(WEBRTC_LAN_FAILED_MESSAGE).toContain('Échec de la connexion directe');
      expect(WEBRTC_LAN_FAILED_MESSAGE).toContain('sous-réseaux différents ou le pare-feu bloque l’UDP');
    });
  });
});
