# Product Specification — SoundDrop v5.0

## Vision
SoundDrop v5.0 is an open-source, zero-mock multi-protocol file and directory transfer hub combining **Acoustic FSK (`ggwave`)**, **WebRTC Direct DataChannels**, **OpenDrop (`AirDrop OWL`)**, **LocalSend v2.1**, **Magic-Wormhole / Croc PAKE**, **WebTorrent (`Magnet / Bencode`)**, **Syncthing BEP**, **Reticulum Mesh**, **QR Optical Fountain**, and **Shared Room Clipboard**.

## Mandatory Execution Rules (`@[user_global]`)
1. **NO MOCK DATA**: Every metric, SHA-256 block digest, InfoHash, peer list, battery reading, and audio spectrum bar comes exclusively from real user files, real WebCrypto calculations, and real browser/OS APIs.
2. **MANDATORY EMPTY STATE**: On startup, the workspace starts in a clean Empty State (`0 fichiers`, `0 octets`) waiting for the user to select local files or a local directory.
3. **REAL FILE SYSTEM ACCESS API & FALLBACK**: Local directory selection uses `window.showDirectoryPicker()` with automatic fallback to `<input type="file" webkitdirectory multiple>`.
