/**
 * SoundDrop — Firmware C pour Micro-Relais Solaire Autonome (ESP32 / ESP-IDF)
 *
 * Fonction :
 * 1. Écoute passive d'ondes acoustiques via microphone analogique / I2S (INMP441)
 * 2. Sommeil profond Ultra-Low-Power (Deep Sleep : < 15 µA)
 * 3. Réveil immédiat sur préambule chirp (Wake-on-Chirp)
 * 4. Relais automatique par paquet LoRa 868 MHz ou réémission acoustique
 */

#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "sounddrop.h"

// Configuration matérielle ESP32
#define PIN_I2S_SCK     14
#define PIN_I2S_WS      15
#define PIN_I2S_SD      32
#define PIN_LORA_CS     5
#define PIN_LORA_RST    4
#define PIN_LORA_DIO0   2

// Buffer de trame acoustique
static uint8_t g_rx_buffer[512];
static uint8_t g_fwd_buffer[512];

/**
 * Calcul du CRC-16 CCITT rapide sur microcontrôleur
 */
static uint16_t esp32_crc16(const uint8_t *data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= ((uint16_t)data[i] << 8);
        for (int j = 0; j < 8; j++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    return crc;
}

/**
 * Traitement d'un paquet acoustique capté par le micro du toit
 */
void process_incoming_acoustic_packet(const uint8_t *raw_bytes, size_t len) {
    if (len < 17) {
        printf("[ESP32 Relais] Paquet trop court ignoré (%d octets)\n", (int)len);
        return;
    }

    printf("[ESP32 Relais] Paquet acoustique capté ! Vérification via SoundDrop Core...\n");

    // Appel à la fonction C-ABI native
    int fwd_len = sounddrop_relay_hop_step(raw_bytes, len, g_fwd_buffer, sizeof(g_fwd_buffer));

    if (fwd_len > 0) {
        printf("[ESP32 Relais] Paquet intègre ! Nouveau TTL décrémenté. Longueur = %d octets\n", fwd_len);
        // Transmission par l'émetteur LoRa 868 MHz vers la montagne
        printf("[ESP32 Relais] Émission radio LoRa 868 MHz vers le col...\n");
    } else if (fwd_len == -4) {
        printf("[ESP32 Relais] Paquet expiré (TTL = 0), purge de la file.\n");
    } else {
        printf("[ESP32 Relais] Erreur CRC ou paquet corrompu (%d)\n", fwd_len);
    }
}

/**
 * Point d'entrée du microcontrôleur ESP32
 */
void app_main(void) {
    printf("====================================================\n");
    printf("  SoundDrop ESP32 Solar Relay Node v0.2.0 (Itzer)\n");
    printf("  Cœur logiciel : %s\n", sounddrop_version());
    printf("====================================================\n");

    // Exemple de test de génération d'identité locale sur la puce
    SoundDropKeypairC node_keys;
    if (sounddrop_generate_identity(&node_keys) == 0) {
        printf("[ESP32] Clé Publique générée : %02x%02x%02x%02x...\n",
               node_keys.public_key[0], node_keys.public_key[1],
               node_keys.public_key[2], node_keys.public_key[3]);
        printf("[ESP32] Hash Nœud Relais    : %02x%02x%02x%02x\n",
               node_keys.recipient_hash[0], node_keys.recipient_hash[1],
               node_keys.recipient_hash[2], node_keys.recipient_hash[3]);
    }

    printf("[ESP32] Mise en veille Ultra-Low-Power active. En attente d'ondes...\n");
}
