# Third-Party Dependencies & Vendor References

Ce document recense les dépôts de référence (consultés pour l'architecture, les formats et l'interopérabilité) ainsi que les crates Rust utilisées dans Sound Drop v2, conformément à la règle stricte : **aucun code GPL copié dans le projet**, respect des licences d'origine (MIT / Apache-2.0).

---

## 1. Dépôts de référence (`vendor-references/`)

| Dépôt | Licence | Rôle et utilisation réelle |
| :--- | :--- | :--- |
| `ggerganov/ggwave` | MIT | Modem acoustique C++ de Phase 1. Utilisé via FFI (`cc` / FFI C) pour émission et réception 48 kHz fiables avec FEC. |
| `woltapp/blurhash` | MIT | Référence de l'algorithme BlurHash officiel (format DCT compact 20-30 caractères pour le Paquet 0). |
| `darrenldl/reed-solomon-erasure` | MIT | Référence et crate Rust pour le codage à effacement (30-50% redondance en mode diffusion). |
| `RustCrypto/AEADs` | MIT / Apache-2.0 | Spécification et référence pour `ChaCha20Poly1305` authentifié avec AAD. |
| `SamiPerttu/fundsp` | MIT / Apache-2.0 | Référence pour la synthèse audio procédurale des effets sonores UI hors transfert. |
| `AccessKit/accesskit` | MIT / Apache-2.0 | Référence et intégration pour l'accessibilité écran (lecteurs d'écran, navigation clavier). |

---

## 2. Crates Rust du workspace (`Cargo.toml`)

| Crate | Licence | Usage |
| :--- | :--- | :--- |
| `cpal` | Apache-2.0 | Capture et restitution audio multi-plateforme (ALSA / WASAPI / CoreAudio) à 48 kHz mono. |
| `rtrb` | MIT / Apache-2.0 | Ring buffer lock-free SPSC pour transfert temps-réel entre thread audio et thread DSP sans allocation. |
| `rustfft` | MIT / Apache-2.0 | FFT rapide pour détection de préambule chirp (1,5 - 5,5 kHz) et corrélation de trames. |
| `reed-solomon-erasure` | MIT | Correction d'effacement Reed-Solomon pour le protocole de diffusion (Section 4.4). |
| `crc` | MIT / Apache-2.0 | Contrôle d'intégrité de trame CRC-16 (Section 4.1). |
| `x25519-dalek` | BSD-3-Clause | Échange de clés éphémères Diffie-Hellman pour l'appairage acoustique (Section 4.3). |
| `hkdf` & `sha2` | MIT / Apache-2.0 | Dérivation de clé de session HKDF-SHA256 et calcul du code court SAS (Section 4.3). |
| `chacha20poly1305` | MIT / Apache-2.0 | Chiffrement authentifié AEAD de la charge utile (Section 4.3). |
| `argon2` | MIT / Apache-2.0 | Dérivation de clé pour le secret partagé en mode diffusion / diode (Section 4.4). |
| `zstd` | MIT | Compression des charges utiles avant chiffrement (Section 2 & 4.3). |
| `blurhash` | MIT | Encodage et décodage de miniatures visuelles 20-30 caractères (Section 4.1). |
| `slint` | GPLv3 / Commercial | Interface native accélérée GPU, design tokens métalliques, mascotte vectorielle. |
| `rapier2d` | Apache-2.0 | Moteur de simulation physique des bulles de pairs (Section 5.5). |
| `rodio` / `fundsp` | MIT / Apache-2.0 | Synthèse sonore procédurale hors transfert (Section 5.8). |

---

## 3. Conformité aux licences

- **Aucun code sous licence GPL n'est copié dans l'arborescence du projet.**
- Les bibliothèques C++ externes compilées (comme `ggwave`) sont sous licence MIT pure, et leur fichier `LICENSE` original est préservé.
