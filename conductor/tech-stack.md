# Technology Stack — SoundDrop v5.0

- **Framework**: Next.js 14.2 (App Router, TypeScript 5, Edge & Node API Routes)
- **Styling & Design System**: Tailwind CSS 3.4, WCAG AA high-contrast tokens, `lucide-react`
- **File System & Compression**: Native `window.showDirectoryPicker()`, `<input webkitdirectory>` fallback, `fflate` (real ZIP archiving)
- **Cryptography**: WebCrypto API (`crypto.subtle` — ECDH P-256, AES-256-GCM, PBKDF2-HMAC-SHA256, SHA-256, SHA-1)
- **Open-Source Protocol Engines**:
  1. `lib/audio/FskModulator.ts` & `FskDemodulator.ts` (GGWave-compatible 4-FSK + Reed-Solomon GF(256))
  2. `lib/webrtc/PeerConnection.ts`, `DataChannelManager.ts`, `signaling.ts` (WebRTC SCTP + `BroadcastChannel` + SSE/REST)
  3. `lib/opendrop/OpenDropClient.ts` (OpenDrop OWL HTTP chunked binary protocol)
  4. `lib/protocols/localsend.ts` (LocalSend v2.1 REST + SHA-256 TLS fingerprint)
  5. `lib/protocols/wormhole-webtorrent.ts` (Magic-Wormhole / Croc PAKE & WebTorrent Bencode/Magnet)
  6. `lib/protocols/syncthing.ts` (Syncthing BEP 128 KB SHA-256 block indexer)
  7. `lib/protocols/reticulum-mesh.ts` (Reticulum / Meshtastic real hardware/network telemetry)
  8. `lib/protocols/qr-fountain.ts` (Luby Transform LT Fountain Codes)
