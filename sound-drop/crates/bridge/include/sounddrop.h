/**
 * SoundDrop — C Header file for foreign language integration
 * Compatible with C, C++, Objective-C, Swift, Dart (dart:ffi), and Python (ctypes).
 */

#ifndef SOUNDDROP_CORE_H
#define SOUNDDROP_CORE_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint8_t public_key[32];
    uint8_t recipient_hash[4];
} SoundDropKeypairC;

/**
 * Generate an ephemeral X25519 identity keypair
 * Returns 0 on success, -1 on NULL pointer.
 */
int sounddrop_generate_identity(SoundDropKeypairC* out_keys);

/**
 * Derive 32-byte session key from Diffie-Hellman shared secret
 * Returns 0 on success, -1 on error.
 */
int sounddrop_derive_key(
    const uint8_t* shared_secret,
    uint16_t session_id,
    uint8_t* out_session_key
);

/**
 * Build and serialize an emergency relay packet with CRC-16
 * Returns positive length written, -1 on invalid argument, -2 if buffer too small.
 */
int sounddrop_build_relay_packet(
    uint16_t session_id,
    const uint8_t* recipient_hash,
    uint8_t ttl,
    const uint8_t* payload_ptr,
    size_t payload_len,
    uint8_t* out_buf,
    size_t out_buf_capacity
);

/**
 * Verify packet integrity and advance one relay hop (decrements TTL)
 * Returns positive length written, -3 if corrupted, -4 if TTL expired.
 */
int sounddrop_relay_hop_step(
    const uint8_t* packet_ptr,
    size_t packet_len,
    uint8_t* out_buf,
    size_t out_capacity
);

/**
 * Get library version string
 */
const char* sounddrop_version(void);

#ifdef __cplusplus
}
#endif

#endif /* SOUNDDROP_CORE_H */
