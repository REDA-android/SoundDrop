# ARCHITECTURE NATIVE & DESIGN SYSTEM SOUNDDROP

> **Statut : Document de conception (hors chemin critique de l'application web)**  
> Ce document décrit les spécifications et concepts prévus pour les implémentations natives (Rust, Slint, mobile) de SoundDrop. Il a été extrait de l'interface web afin de garantir l'honnêteté et la légèreté de l'application déployée.

---

## 1. Principes Fondamentaux de la Version Native
1. **Zéro allocation sur le thread audio** : capture et restitution sans malloc ni locks via ring-buffer sans verrou (`rtrb`).
2. **Interface native GPU** : moteur graphique Slint avec shaders vectoriels légers (tiny-skia / femtovg / opengl).
3. **Mascotte vectorielle réactive** : oscillateur physique harmonique du 2nd ordre modélisant les micro-interactions ($m\ddot{x} + c\dot{x} + kx = F(t)$).
4. **Physique des bulles** : intégration du moteur de collisions Rapier2D à 60 FPS.
5. **Couche DSP & Modem** :
   - Phase 1 : `ggwave` (C++ via bindings FFI) pour émission/réception immédiate et robuste.
   - Phase 2 : MFSK 16 tons avec démodulation Goertzel native 48 kHz.
   - Preamble chirp linéaire (1,5 kHz $\to$ 5,5 kHz) avec corrélation croisée FFT pour synchronisation et absorption de la dérive d'horloge.
6. **Vérification de proximité** : Short Authentication String (SAS) à 6 chiffres avec protocole Commit-Reveal sur clés éphémères X25519 / HKDF-SHA256.

---

## 2. Diode Matérielle vs Réception Seule Logicielle
- **Réception Seule Logicielle** : l'application n'ouvre aucun flux audio de sortie (`AudioContext` en mode capture pure).
- **Diode Matérielle** : câble jack/adaptateur physique sans canal haut-parleur.
- **Note de sécurité** : le mode diode matérielle n'autorisant aucune émission acoustique en retour, il est incompatible avec le protocole interactif SAS (qui nécessite un échange bidirectionnel). Il s'appuie donc sur un secret partagé pré-établi (phrase de passe + Argon2id).

---

## 3. Relais Multi-Sauts et Nœuds Passerelles (Store-and-Forward)

### 3.1 Séparation stricte des couches & Préservation de l'Air-Gap
* **Terminaux Utilisateurs (Extrémités A et B)** : Mode avion complet exigé. Le terminal communique exclusivement via ses transducteurs acoustiques (haut-parleur / micro) ou optiques. Zéro onde radio émise par les téléphones.
* **Nœuds Relais Intermédiaires (Transit Inter-Maisons)** :
  1. **Mode A — Relais Humain / DTN (Zéro Radio)** : Les fragments chiffrés sont stockés dans un nœud intermédiaire mobile (smartphone d'un tiers) et rediffusés par le son dès que le tiers s'approche du destinataire.
  2. **Mode B — Passerelle Radio Sub-GHz (LoRa / Meshtastic 868 MHz)** : Le nœud de bordure (ex: boîtier autonome sur le toit ou près d'une fenêtre) capte le signal acoustique local, l'encapsule dans un paquet radio Sub-GHz longue portée pour traverser le béton et les collines sur plusieurs kilomètres, puis le nœud de destination restitue le paquet par le son au terminal B.

### 3.2 Format de l'Enveloppe Relais (`RelayEnvelope`)
Chaque trame relayée encapsule les données sous forme opaque :
* **`TTL` (Time-To-Live)** : 1 octet. Décrémenté à chaque saut (relais) ; paquet détruit si $TTL = 0$ pour éviter les boucles infinies.
* **`RecipientHash`** : 4 octets tronqués de $\text{SHA-256}(pub_{\text{destinataire}})$. Permet aux nœuds relais de router vers la bonne cible sans révéler son identité publique complète.
* **`OriginHash`** : 4 octets tronqués de $\text{SHA-256}(pub_{\text{emetteur}})$.
* **`InnerPayload`** : Chiffré de bout en bout en ChaCha20-Poly1305 (ou TweetNaCl secretbox). **Aucun relais intermédiaire ne possède la clé de session et ne peut lire le contenu.**

### 3.3 Protocole ARQ Saut-par-Saut (Hop-by-Hop Selective Repeat)
* Chaque saut confirme la réception d'une fenêtre de trames par un bitmap ACK court (acoustique ou radio).
* En cas d'échec sur le premier saut acoustique (bruit, vent), l'émetteur réessaie localement sur un profil robuste avant engagement du relais longue portée.

