# C4 Architecture — System Context (Level 1)

## System Overview

**SoundDrop v5.0 (Open-Source P2P & Multi-Protocol File Transfer Hub)** is a zero-mock, end-to-end encrypted, multi-transport file and directory sharing platform running in modern browsers and Next.js Edge runtimes.

It unifies **10 open-source protocols** into a single cohesive workbench with a **Mandatory Empty State** (`NO MOCK DATA`) and native local directory analysis via the **File System Access API** (`window.showDirectoryPicker()`) and `<input type="file" webkitdirectory>` fallback.

```mermaid
flowchart TD
    UserSender["Sender User (Browser / PWA)"]
    UserReceiver["Receiver User (Browser / Mobile / CLI)"]

    subgraph SoundDropSystem["SoundDrop v5.0 Unified Platform"]
        WebApp["SoundDrop Next.js 14 Web App & Edge Runtime"]
    end

    LocalFS["Local File System (window.showDirectoryPicker / webkitdirectory)"]
    WebRTCStun["Public STUN/ICE Servers & PeerJS Cloud"]
    AcousticMedium["Air / Acoustic Medium (GGWave FSK 1875Hz - 6375Hz)"]
    LANBroadcast["Local Network / BroadcastChannel / mDNS / HTTP REST"]

    UserSender -->|"Selects files or local directory"| LocalFS
    LocalFS -->|"Streams real FileSystemDirectoryHandle & File blobs"| WebApp
    UserSender -->|"Initiates transfer & inspects telemetry"| WebApp
    WebApp <-->|"SDP Offer/Answer & ICE Candidates"| WebRTCStun
    WebApp <-->|"Direct SCTP DataChannel (AES-256-GCM)"| UserReceiver
    WebApp -->|"Ultrasonic / Audible 4-FSK Audio Frames"| AcousticMedium
    AcousticMedium -->|"Microphone WebAudio FFT Demodulation"| UserReceiver
    WebApp <-->|"OpenDrop OWL / LocalSend v2.1 / Syncthing BEP"| LANBroadcast
    LANBroadcast <-->|"Chunked Binary Transfer"| UserReceiver
```

## External Actors & Systems

| Actor / External System | Type | Description |
| :--- | :--- | :--- |
| **Sender / Receiver Users** | Person | Engineers or end-users transferring files, directories, or encrypted clipboard payloads across devices. |
| **Local File System** | Browser Native API | Accessed strictly on user gesture via `window.showDirectoryPicker()` or `<input type="file" webkitdirectory>`. |
| **WebRTC STUN / PeerJS** | External Network | Assists in NAT traversal (`stun:stun.l.google.com:19302`, `stun:global.stun.twilio.com:3478`) and optional PeerJS signaling. |
| **Acoustic Medium** | Physical Layer | Air-gapped speaker-to-microphone channel using GGWave-compatible 4-FSK modulation (`48000 Hz` sample rate, Reed-Solomon ECC). |
| **LAN / Edge Relay** | Network Layer | Supports OpenDrop (`OWL`), LocalSend v2.1 REST API, and low-latency WebRTC signaling (`BroadcastChannel` + SSE + Edge routes). |
