use sounddrop_link::{Frame, FrameType};
use std::fmt;

pub const MESH_HEADER_LEN: usize = 9;
pub const MAX_MESH_PAYLOAD_LEN: usize = 39; // 9 + 39 = 48 (MAX_PAYLOAD_LEN)

pub const FLAG_NONE: u8 = 0x00;
pub const FLAG_DIRECTED: u8 = 0x01;
pub const FLAG_FLOOD: u8 = 0x02;
pub const FLAG_ACK_REQ: u8 = 0x04;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId(pub u16);

impl NodeId {
    pub const BROADCAST: NodeId = NodeId(0xFFFF);

    pub fn new(id: u16) -> Self {
        Self(id)
    }

    pub fn is_broadcast(&self) -> bool {
        self.0 == 0xFFFF
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_broadcast() {
            write!(f, "Node[BROADCAST]")
        } else {
            write!(f, "Node[0x{:04X}]", self.0)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeshHeader {
    pub src: NodeId,
    pub dst: NodeId,
    pub packet_id: u16,
    pub ttl: u8,
    pub hop_count: u8,
    pub flags: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeshPacket {
    pub header: MeshHeader,
    pub payload: Vec<u8>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PacketError {
    #[error("Packet too short: expected at least {MESH_HEADER_LEN} bytes, got {0}")]
    PacketTooShort(usize),
    #[error("Payload exceeds maximum capacity {MAX_MESH_PAYLOAD_LEN}: got {0}")]
    PayloadTooLarge(usize),
    #[error("Invalid link frame type for mesh packet: {0:?}")]
    InvalidFrameType(FrameType),
}

impl MeshPacket {
    pub fn new(
        src: NodeId,
        dst: NodeId,
        packet_id: u16,
        ttl: u8,
        flags: u8,
        payload: Vec<u8>,
    ) -> Result<Self, PacketError> {
        if payload.len() > MAX_MESH_PAYLOAD_LEN {
            return Err(PacketError::PayloadTooLarge(payload.len()));
        }

        Ok(Self {
            header: MeshHeader {
                src,
                dst,
                packet_id,
                ttl,
                hop_count: 0,
                flags,
            },
            payload,
        })
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(MESH_HEADER_LEN + self.payload.len());
        buf.extend_from_slice(&self.header.src.0.to_be_bytes());
        buf.extend_from_slice(&self.header.dst.0.to_be_bytes());
        buf.extend_from_slice(&self.header.packet_id.to_be_bytes());
        buf.push(self.header.ttl);
        buf.push(self.header.hop_count);
        buf.push(self.header.flags);
        buf.extend_from_slice(&self.payload);
        buf
    }

    pub fn from_bytes(slice: &[u8]) -> Result<Self, PacketError> {
        if slice.len() < MESH_HEADER_LEN {
            return Err(PacketError::PacketTooShort(slice.len()));
        }

        let src = NodeId(u16::from_be_bytes([slice[0], slice[1]]));
        let dst = NodeId(u16::from_be_bytes([slice[2], slice[3]]));
        let packet_id = u16::from_be_bytes([slice[4], slice[5]]);
        let ttl = slice[6];
        let hop_count = slice[7];
        let flags = slice[8];

        let payload = slice[MESH_HEADER_LEN..].to_vec();
        if payload.len() > MAX_MESH_PAYLOAD_LEN {
            return Err(PacketError::PayloadTooLarge(payload.len()));
        }

        Ok(Self {
            header: MeshHeader {
                src,
                dst,
                packet_id,
                ttl,
                hop_count,
                flags,
            },
            payload,
        })
    }

    pub fn to_link_frame(&self, seq_num: u8) -> Frame {
        Frame {
            frame_type: FrameType::MeshRelay,
            seq_num,
            payload: self.to_bytes(),
        }
    }

    pub fn from_link_frame(frame: &Frame) -> Result<Self, PacketError> {
        if frame.frame_type != FrameType::MeshRelay {
            return Err(PacketError::InvalidFrameType(frame.frame_type));
        }
        Self::from_bytes(&frame.payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mesh_packet_roundtrip() {
        let packet = MeshPacket::new(
            NodeId(0x1001),
            NodeId(0x2002),
            42,
            5,
            FLAG_FLOOD,
            b"Hello Mesh!".to_vec(),
        )
        .unwrap();

        let bytes = packet.to_bytes();
        assert_eq!(bytes.len(), MESH_HEADER_LEN + 11);

        let decoded = MeshPacket::from_bytes(&bytes).unwrap();
        assert_eq!(decoded, packet);
    }

    #[test]
    fn test_mesh_packet_link_frame_roundtrip() {
        let packet = MeshPacket::new(
            NodeId(0x0001),
            NodeId::BROADCAST,
            999,
            3,
            FLAG_DIRECTED,
            b"Acoustic relay packet".to_vec(),
        )
        .unwrap();

        let frame = packet.to_link_frame(7);
        assert_eq!(frame.frame_type, FrameType::MeshRelay);
        assert_eq!(frame.seq_num, 7);

        let decoded = MeshPacket::from_link_frame(&frame).unwrap();
        assert_eq!(decoded, packet);
    }
}
