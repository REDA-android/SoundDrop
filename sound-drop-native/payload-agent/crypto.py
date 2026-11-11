"""
Cryptographic Envelope & Key Derivation for Acoustic Payloads
Provides authenticated encryption for acoustic drops with ephemeral pin/passphrase.
"""

import hashlib
import hmac
import os
import struct

def derive_session_keys(passphrase: str, salt: bytes) -> tuple[bytes, bytes]:
    """Derives 32-byte encryption key and 32-byte HMAC key using PBKDF2-HMAC-SHA256."""
    key_material = hashlib.pbkdf2_hmac(
        "sha256",
        passphrase.encode("utf-8"),
        salt,
        iterations=50000,
        dklen=64,
    )
    return key_material[:32], key_material[32:]

def encrypt_envelope(plaintext: bytes, passphrase: str) -> bytes:
    """
    Encrypts plaintext with authenticated keystream & HMAC-SHA256:
    [Salt: 8B] + [Nonce: 8B] + Ciphertext + [HMAC: 16B]
    """
    salt = os.urandom(8)
    nonce = os.urandom(8)
    enc_key, hmac_key = derive_session_keys(passphrase, salt)

    # Deterministic stream cipher generated via ChaCha20 / Counter-SHA256
    keystream = bytearray()
    counter = 0
    while len(keystream) < len(plaintext):
        block = hashlib.sha256(enc_key + nonce + struct.pack(">Q", counter)).digest()
        keystream.extend(block)
        counter += 1

    ciphertext = bytes([p ^ k for p, k in zip(plaintext, keystream[:len(plaintext)])])
    
    # Compute 16-byte truncated HMAC authentication tag
    tag = hmac.new(hmac_key, salt + nonce + ciphertext, hashlib.sha256).digest()[:16]
    return salt + nonce + ciphertext + tag

def decrypt_envelope(envelope: bytes, passphrase: str) -> bytes:
    """Decrypts and verifies authenticated acoustic envelope."""
    if len(envelope) < 8 + 8 + 16:
        raise ValueError("Invalid envelope length")

    salt = envelope[:8]
    nonce = envelope[8:16]
    tag = envelope[-16:]
    ciphertext = envelope[16:-16]

    enc_key, hmac_key = derive_session_keys(passphrase, salt)
    expected_tag = hmac.new(hmac_key, salt + nonce + ciphertext, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(tag, expected_tag):
        raise ValueError("Cryptographic verification failed: invalid PIN or corrupted audio frame")

    keystream = bytearray()
    counter = 0
    while len(keystream) < len(ciphertext):
        block = hashlib.sha256(enc_key + nonce + struct.pack(">Q", counter)).digest()
        keystream.extend(block)
        counter += 1

    return bytes([c ^ k for c, k in zip(ciphertext, keystream[:len(ciphertext)])])
