# GESTION DES DÉPENDANCES TIERCES (THIRD_PARTY.md)

Ce fichier consigne l'inventaire exhaustif des dépendances tierces du projet web SoundDrop Studio, avec leur rôle précis, leur licence et leur justification.  
**Règle absolue** : Aucune dépendance non justifiée. Aucun code sous licence GPL n'est incorporé ou copié dans le code source du projet.

---

## 1. Dépendances de Production (Runtime Web)

| Paquet | Version | Licence | Rôle & Justification |
| :--- | :--- | :--- | :--- |
| **`ggwave`** | ^0.4.0 | MIT | Modem acoustique WebAssembly : encodage multi-tons FSK et décodage avec correction d'erreur Reed-Solomon. |
| **`tweetnacl`** | ^1.0.3 | Public Domain | Primitives cryptographiques E2EE légères (chiffrement authentifié `secretbox` XSalsa20-Poly1305, paires de clés X25519). |
| **`blurhash`** | ^2.0.5 | MIT | Calcul et décodage de miniatures visuelles ultra-compactes (20-30 caractères) pour prévisualisation immédiate en paquet 0. |
| **`fflate`** | ^0.8.3 | MIT | Compression et décompression Deflate ultra-rapide pour minification des offres SDP WebRTC hors-ligne. |
| **`qrcode.react`** | ^4.2.0 | ISC | Génération de codes QR SVG pour échange de signal WebRTC LAN sans accès Internet. |
| **`lucide-react`** | ^0.453.0 | ISC | Bibliothèque d'icônes SVG légères et accessibles pour l'interface utilisateur. |
| **`clsx`** | ^2.1.1 | MIT | Utilitaire de composition conditionnelle de classes CSS. |
| **`tailwind-merge`** | ^2.5.4 | MIT | Fusion sans conflit des classes utilitaires Tailwind CSS. |
| **`next`** | 14.2.15 | MIT | Framework React pour rendu statique et routage optimisé. |
| **`react`** | ^18.3.1 | MIT | Bibliothèque centrale d'interface utilisateur réactive. |
| **`react-dom`** | ^18.3.1 | MIT | Point d'ancrage DOM pour React. |
| **`framer-motion`** | ^14.10.1 | MIT | Animations d'interface fluides respectant `prefers-reduced-motion`. |
| **`browser-fs-access`** | ^0.38.0 | Apache-2.0 | API moderne File System Access avec repli transparent pour téléchargement local. |
| **`peerjs`** | ^1.5.5 | MIT | Bibliothèque client WebRTC DataChannels pour négociation réseau local. |
| **`streamsaver`** | ^2.0.6 | MIT | Sauvegarde directe en flux mémoire vers le disque pour gros transferts WebRTC. |
| **`dexie`** | ^4.4.7 | Apache-2.0 | Wrapper IndexedDB typé pour stockage local hors-ligne. |
| **`idb-keyval`** | ^6.3.0 | Apache-2.0 | Stockage clé-valeur IndexedDB ultra-léger pour persistance de session. |
| **`localforage`** | ^1.10.0 | Apache-2.0 | Stockage hors-ligne polyfill pour compatibilité navigateurs anciens. |
| **`matter-js`** | ^0.20.0 | MIT | Moteur physique 2D utilisé dans le radar de bulles interactif. |
| **`d3-force`** | ^3.0.1 | ISC | Simulation de forces physiques pour la disposition des nœuds de pairs. |
| **`crc-32`** | ^1.2.2 | Apache-2.0 | Calcul de sommes de contrôle CRC-32 (en complément du CRC-16 CCITT). |
| **`lz-string`** | ^1.5.0 | MIT | Compression de chaînes textuelles pour jetons URL. |
| **`tone`** | ^15.1.22 | MIT | Synthèse audio interactive pour retours sonores de l'interface utilisateur. |
| **`wavesurfer.js`** | ^8.0.5 | BSD-3 | Visualisation interactive de formes d'onde audio. |
| **`zustand`** | ^5.1.0 | MIT | Gestionnaire d'état réactif léger et sans dépendances lourdes. |

---

## 2. Dépendances de Développement & Tests

| Paquet | Version | Licence | Rôle & Justification |
| :--- | :--- | :--- | :--- |
| **`vitest`** | ^2.1.8 | MIT | Exécuteur de tests unitaires et d'intégration ultra-rapide (44 tests automatisés validant la conformité mathématique, acoustique et cryptographique). |
| **`typescript`** | ^5.6.3 | Apache-2.0 | Typage statique strict garantissant la fiabilité sans erreurs à l'exécution. |
| **`tailwindcss`** | ^3.4.14 | MIT | Moteur CSS utilitaire sans CSS mort en production. |
| **`postcss`** | ^8.4.47 | MIT | Post-processeur CSS pour préfixes navigateurs automatiques. |
| **`autoprefixer`** | ^10.4.20 | MIT | Ajout automatique des préfixes CSS pour compatibilité Safari / Firefox / Chrome. |
