"""
Unit tests for Payload Compression, Packet Framing & Cryptographic Envelope
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from encoder import PayloadEncoder, AcousticPacket
from crypto import encrypt_envelope, decrypt_envelope

def test_packet_framing():
    data = b"Hello Acoustic World! Testing 64-byte frame packing."
    packets = PayloadEncoder.packetize(data, session_id=42, payload_type=1)
    assert len(packets) >= 1

    # Test serialization and CRC32 verification
    raw_frame = packets[0].serialize_frame()
    recovered = AcousticPacket.deserialize_frame(raw_frame)
    assert recovered is not None
    assert recovered.session_id == 42
    assert recovered.payload_bytes == packets[0].payload_bytes
    print("[PASS] Packet Framing & CRC32 verification succeeded.")

def test_encryption_roundtrip():
    secret_text = b"TOP_SECRET_ACOUSTIC_TOKEN_9941"
    pin = "481516"
    encrypted = encrypt_envelope(secret_text, pin)
    assert encrypted != secret_text

    decrypted = decrypt_envelope(encrypted, pin)
    assert decrypted == secret_text

    # Bad pin test
    try:
        decrypt_envelope(encrypted, "wrong_pin")
        assert False, "Should have thrown ValueError"
    except ValueError:
        pass
    print("[PASS] Cryptographic envelope roundtrip & auth tag test passed.")

if __name__ == "__main__":
    test_packet_framing()
    test_encryption_roundtrip()
    print("All Python payload agent tests PASSED cleanly.")
