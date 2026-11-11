"""
Payload Analytics, Micro-Compression & Chunking Engine
Transforms arbitrary binary data, text, or images into 64-byte acoustic packets.
"""

import zlib
import struct
import math
from typing import List, Dict, Any, Optional

CHUNK_SIZE = 64

class AcousticPacket:
    def __init__(
        self,
        session_id: int,
        packet_index: int,
        total_packets: int,
        payload_type: int,
        flags: int,
        payload_bytes: bytes,
    ):
        self.session_id = session_id & 0xFF
        self.packet_index = packet_index & 0xFF
        self.total_packets = total_packets & 0xFF
        self.payload_type = payload_type & 0xFF
        self.flags = flags & 0xFF
        self.payload_bytes = payload_bytes
        self.payload_length = len(payload_bytes)

    def serialize_frame(self) -> bytes:
        """
        Packs header + payload into binary frame:
        [SyncWord: 0xAA55 (2B)] + [Type(1B), Session(1B), Index(1B), Total(1B), Len(1B), Flags(1B)] + Payload + CRC32(4B)
        """
        header = struct.pack(
            ">HBBBBBB",
            0xAA55,
            self.payload_type,
            self.session_id,
            self.packet_index,
            self.total_packets,
            self.payload_length,
            self.flags,
        )
        content = header + self.payload_bytes
        crc = zlib.crc32(content) & 0xFFFFFFFF
        return content + struct.pack(">I", crc)

    @classmethod
    def deserialize_frame(cls, data: bytes) -> Optional["AcousticPacket"]:
        if len(data) < 8 + 4: # header (8B) + CRC (4B)
            return None
        sync, p_type, s_id, p_idx, t_pkts, p_len, flags = struct.unpack(">HBBBBBB", data[:8])
        if sync != 0xAA55:
            return None
        
        expected_crc, = struct.unpack(">I", data[-4:])
        computed_crc = zlib.crc32(data[:-4]) & 0xFFFFFFFF
        if expected_crc != computed_crc:
            return None # CRC integrity failed

        payload = data[8:8 + p_len]
        return cls(s_id, p_idx, t_pkts, p_type, flags, payload)

class PayloadEncoder:
    @staticmethod
    def compress_payload(data: bytes) -> tuple[bytes, bool]:
        """Compresses using deflate if beneficial, otherwise returns original."""
        if len(data) < 40:
            return data, False
        compressed = zlib.compress(data, level=9)[2:-4] # raw deflate
        if len(compressed) < len(data):
            return compressed, True
        return data, False

    @staticmethod
    def decompress_payload(data: bytes, is_compressed: bool) -> bytes:
        if not is_compressed:
            return data
        return zlib.decompress(data, -15)

    @classmethod
    def packetize(
        cls,
        raw_data: bytes,
        session_id: int,
        payload_type: int = 1,
        blurhash: Optional[str] = None
    ) -> List[AcousticPacket]:
        compressed_data, is_compressed = cls.compress_payload(raw_data)
        flags = 0x01 if is_compressed else 0x00

        total_bytes = len(compressed_data)
        num_packets = max(1, math.ceil(total_bytes / CHUNK_SIZE))

        packets = []
        for idx in range(num_packets):
            start = idx * CHUNK_SIZE
            end = min(start + CHUNK_SIZE, total_bytes)
            chunk = compressed_data[start:end]

            pkt = AcousticPacket(
                session_id=session_id,
                packet_index=idx,
                total_packets=num_packets,
                payload_type=payload_type,
                flags=flags,
                payload_bytes=chunk,
            )
            packets.append(pkt)

        return packets
