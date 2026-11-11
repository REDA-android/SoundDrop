# REGISTRE DES DÉPÔTS ET RÉFÉRENCES TECHNIQUES (50 DÉPÔTS)

> **Statut : Références techniques et documentaires (Phase 8)**  
> Ce registre sert de documentation pour les implémentations natives et de recherche. Aucun code GPL n'est copié dans le projet web. Les crates Rust et bibliothèques C++ sont gérées séparément dans le projet natif.

---

## 1. Modems Acoustiques & Audio DSP
1. **ggwave** (`https://github.com/ggerganov/ggwave`) — MIT — Base du modem acoustique FSK multi-tons et Reed-Solomon WebAssembly.
2. **libquiet** (`https://github.com/quiet/quiet`) — BSD-3 — Référence de modem logiciel acoustique.
3. **minimodem** (`https://github.com/kamalmostafa/minimodem`) — GPL-3 — *Lecture seule*, aucune copie de code.
4. **liquid-dsp** (`https://github.com/jgaeddert/liquid-dsp`) — MIT — DSP logiciel, filtres et synchronisation de phase.
5. **pocketfft** (`https://github.com/mreineck/pocketfft`) — BSD-3 — FFT rapide en C++.
6. **RustFFT** (`https://github.com/ejmahler/RustFFT`) — MIT/Apache-2.0 — Bibliothèque FFT performante en Rust pur.
7. **biquad-rs** (`https://github.com/korken89/biquad-rs`) — MIT/Apache-2.0 — Filtres biquad IIR.
8. **fundsp** (`https://github.com/SamiPerttu/fundsp`) — MIT/Apache-2.0 — Synthèse audio procédurale.

---

## 2. Audio I/O Natif
9. **cpal** (`https://github.com/RustAudio/cpal`) — Apache-2.0 — Entrée/sortie audio multiplateforme en Rust.
10. **rodio** (`https://github.com/RustAudio/rodio`) — MIT/Apache-2.0 — Lecture audio Rust de haut niveau.
11. **miniaudio** (`https://github.com/mackron/miniaudio`) — Public Domain / MIT — Moteur audio portable et léger en C.
12. **portaudio** (`https://github.com/PortAudio/portaudio`) — MIT — Audio I/O temps réel multiplateforme.
13. **oboe** (`https://github.com/google/oboe`) — Apache-2.0 — Audio haute performance sous Android (AAudio/OpenSL ES).

---

## 3. Codes Correcteurs, Compression & Aperçu
14. **reed-solomon-erasure** (`https://github.com/darrenldl/reed-solomon-erasure`) — MIT — Encodage d'effacement Reed-Solomon en Rust.
15. **zstd** (`https://github.com/facebook/zstd`) — BSD-3/GPL-2 — Algorithme de compression rapide pour petits payloads.
16. **brotli** (`https://github.com/google/brotli`) — MIT — Compression générique avec dictionnaires.
17. **blurhash** (`https://github.com/woltapp/blurhash`) — MIT — Génération et décodage de miniatures floues ultra-compactes (20-30 caractères).
18. **tweetnacl-js** (`https://github.com/dchest/tweetnacl-js`) — Public Domain — Primitives cryptographiques pour l'application web.

---

## 4. Cryptographie & Sécurité
19. **AEADs** (`https://github.com/RustCrypto/AEADs`) — MIT/Apache-2.0 — Chiffrement authentifié ChaCha20-Poly1305.
20. **x25519-dalek** (`https://github.com/dalek-cryptography/x25519-dalek`) — BSD-3 — Échange de clés Diffie-Hellman sur Curve25519.
21. **ring** (`https://github.com/briansmith/ring`) — ISC / OpenSSL / MIT — Cryptographie sécurisée basée sur BoringSSL.
22. **age** (`https://github.com/FiloSottile/age`) — BSD-3 — Outil et bibliothèque de chiffrement de fichiers moderne.
23. **hashes** (`https://github.com/RustCrypto/hashes`) — MIT/Apache-2.0 — Fonctions de hachage cryptographiques (SHA-256, BLAKE3).

---

## 5. UI Native & Rendu GPU
24. **slint** (`https://github.com/slint-ui/slint`) — GPLv3 / Commerciale gratuite — Interface graphique native GPU réactive.
25. **egui** (`https://github.com/emilk/egui`) — MIT/Apache-2.0 — Interface graphique immédiate (immediate mode).
26. **imgui** (`https://github.com/ocornut/imgui`) — MIT — Dear ImGui C++.
27. **femtovg** (`https://github.com/femtovg/femtovg`) — MIT/Apache-2.0 — Rendu vectoriel 2D accéléré GPU.
28. **tiny-skia** (`https://github.com/RazrFalcon/tiny-skia`) — BSD-3 — Moteur de rendu vectoriel 2D logiciel.
29. **cosmic-text** (`https://github.com/pop-os/cosmic-text`) — Apache-2.0 — Mise en page et rendu de texte international (dont RTL / Arabe).
30. **accesskit** (`https://github.com/AccessKit/accesskit`) — MIT/Apache-2.0 — Accessibilité et lecteurs d'écran natifs.

---

## 6. Moteurs Physiques 2D
31. **rapier** (`https://github.com/dimforge/rapier`) — Apache-2.0 — Physique 2D/3D déterministe en Rust.
32. **box2d** (`https://github.com/erincatto/box2d`) — MIT — Moteur physique 2D C++.
33. **Chipmunk2D** (`https://github.com/slembcke/Chipmunk2D`) — MIT — Moteur physique 2D rapide en C.

---

## 7. Protocoles P2P & Références Réseau
34. **localsend** (`https://github.com/localsend/localsend`) — GPL-3 — Référence de transfert LAN open-source.
35. **opendrop** (`https://github.com/seemoo-lab/opendrop`) — GPL-3 — Référence d'implémentation AWDL / AirDrop.
36. **syncthing** (`https://github.com/syncthing/syncthing`) — MPL-2.0 — Référence de synchronisation continue de fichiers (BEP).
37. **magic-wormhole** (`https://github.com/magic-wormhole/magic-wormhole`) — MIT — Référence d'échange PAKE avec codes courts.
38. **warpinator** (`https://github.com/linuxmint/warpinator`) — GPL-3 — Référence de partage de fichiers sur réseau local.
39. **webtorrent** (`https://github.com/webtorrent/webtorrent`) — MIT — Référence de transfert P2P via WebRTC dans le navigateur.
40. **Reticulum** (`https://github.com/markqvist/Reticulum`) — BSD-3 — Réseau maillé résilient pour radios et médias asynchrones.
41. **rust-libp2p** (`https://github.com/libp2p/rust-libp2p`) — MIT/Apache-2.0 — Pile réseau pair-à-pair modulaire.
42. **tailscale** (`https://github.com/tailscale/tailscale`) — BSD-3 — Réseau maillé chiffré WireGuard.

---

## 8. Systèmes, Concurrence & Runtime Natif
43. **libc** (`https://github.com/rust-lang/libc`) — MIT/Apache-2.0 — Bindings système bas-niveau.
44. **crossbeam** (`https://github.com/crossbeam-rs/crossbeam`) — MIT/Apache-2.0 — Primitives de concurrence et canaux lock-free.
45. **rtrb** (`https://github.com/m-ou-se/rtrb`) — MIT/Apache-2.0 — Ring buffer lock-free temps réel garanti sans allocation pour audio I/O.
46. **cxx** (`https://github.com/dtolnay/cxx`) — MIT/Apache-2.0 — Pont FFI bidirectionnel sûr entre Rust et C++.
47. **rust-bindgen** (`https://github.com/rust-lang/rust-bindgen`) — BSD-3 — Génération automatique de liaisons C/C++.
48. **serde** (`https://github.com/serde-rs/serde`) — MIT/Apache-2.0 — Sérialisation et désérialisation générique.
49. **clap** (`https://github.com/clap-rs/clap`) — MIT/Apache-2.0 — Analyseur d'arguments en ligne de commande.
50. **tokio** (`https://github.com/tokio-rs/tokio`) — MIT — Runtime asynchrone pour Rust.
