# C4 Architecture — Container View (Level 2)

## Containers in SoundDrop v5.0

```mermaid
flowchart LR
    subgraph BrowserClient["Browser Client Runtime (React 18 + Web APIs)"]
        UIContainer["Next.js App Router UI (Send / Receive / 9 Protocol Tabs)"]
        DirScanner["Real Directory Scanner & ZIP Bundler (fflate + SHA-256)"]
        TransportEngines["Multi-Protocol Transport Engines (WebRTC, Acoustic FSK, Wormhole, WebTorrent, Syncthing)"]
        CryptoVault["WebCrypto Vault (ECDH P-256, AES-256-GCM, PBKDF2, SHA-256)"]
    end

    subgraph EdgeServer["Next.js Edge & Node API Routes"]
        SignalAPI["WebRTC & Clipboard Signaling API (/api/signal/[...action])"]
        OpenDropAPI["OpenDrop OWL Compatible Server (/api/opendrop/discover, /ask, /upload)"]
        LocalSendAPI["LocalSend v2.1 REST API (/api/localsend/v2/info, /upload)"]
        HealthAPI["System Health & Metrics API (/api/health)"]
    end

    UIContainer --> DirScanner
    UIContainer --> TransportEngines
    DirScanner --> CryptoVault
    TransportEngines --> CryptoVault
    TransportEngines <-->|"REST / SSE / BroadcastChannel"| SignalAPI
    TransportEngines <-->|"HTTP Chunked Binary"| OpenDropAPI
    TransportEngines <-->|"HTTP Binary + Fingerprint"| LocalSendAPI
```

## Container Catalog

| Container | Technology | Responsibility |
| :--- | :--- | :--- |
| **Next.js App Router UI** | React 18, TypeScript, Tailwind CSS, Lucide | Accessible (WCAG AA) dual-column workspace with decoupled Transport Workspace and Open-Source Protocol Inspector. |
| **Real Directory Scanner** | `window.showDirectoryPicker`, `webkitdirectory`, `fflate` | Recursively traverses real local directories, computes true file counts/extensions/SHA-256, and packages on-the-fly ZIP bundles. |
| **Multi-Protocol Engines** | WebRTC `RTCPeerConnection`, WebAudio `AudioWorklet`, WebCrypto | Implements WebRTC DataChannel, GGWave 4-FSK, Magic-Wormhole PAKE, WebTorrent Bencode/InfoHash, Syncthing BEP, Reticulum, and QR Optical Fountain. |
| **WebRTC Signaling API** | Next.js Route Handlers (`/api/signal/[...action]`) | Manages SDP offers/answers, race-free ICE candidate queues, active room discovery, and encrypted clipboard payloads. |
| **OpenDrop & LocalSend APIs** | Next.js Route Handlers (`/api/opendrop/*`, `/api/localsend/v2/*`) | Provides HTTP discovery, receiver handshake acknowledgement, and binary file upload/download relay for cross-device transfers. |
