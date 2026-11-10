use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum BootstrapError {
    #[error("Buffer too short for bootstrap payload")]
    BufferTooShort,
    #[error("Invalid bootstrap magic")]
    InvalidMagic,
    #[error("Unsupported address family: {0}")]
    UnsupportedAddressFamily(u8),
    #[error("Invalid IP address bytes")]
    InvalidIpAddress,
}

const BOOTSTRAP_MAGIC: &[u8; 2] = b"SH"; // SoundDrop Hybrid

/// Advertised local network endpoint for high-speed Wi-Fi / P2P handover.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NetworkEndpoint {
    pub ip: IpAddr,
    pub port: u16,
}

impl NetworkEndpoint {
    pub fn new(ip: IpAddr, port: u16) -> Self {
        Self { ip, port }
    }

    pub fn to_socket_addr(&self) -> SocketAddr {
        SocketAddr::new(self.ip, self.port)
    }
}

/// Compact acoustic bootstrap payload advertised over acoustic frames.
/// Carries the local network socket and mutual authentication token derived from the acoustic handshake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcousticBootstrapPayload {
    pub endpoint: NetworkEndpoint,
    pub auth_token: [u8; 16],
}

impl AcousticBootstrapPayload {
    pub fn new(endpoint: NetworkEndpoint, auth_token: [u8; 16]) -> Self {
        Self {
            endpoint,
            auth_token,
        }
    }

    /// Serializes the bootstrap payload into a compact wire format fitting inside an acoustic frame.
    /// Format:
    /// [MAGIC(2), IP_FAMILY(1: 4=IPv4, 6=IPv6), IP_BYTES(4 or 16), PORT(2), AUTH_TOKEN(16)]
    /// Total IPv4: 2 + 1 + 4 + 2 + 16 = 25 bytes.
    /// Total IPv6: 2 + 1 + 16 + 2 + 16 = 37 bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(48);
        buf.extend_from_slice(BOOTSTRAP_MAGIC);

        match self.endpoint.ip {
            IpAddr::V4(v4) => {
                buf.push(4); // IPv4
                buf.extend_from_slice(&v4.octets());
            }
            IpAddr::V6(v6) => {
                buf.push(6); // IPv6
                buf.extend_from_slice(&v6.octets());
            }
        }

        buf.extend_from_slice(&self.endpoint.port.to_be_bytes());
        buf.extend_from_slice(&self.auth_token);

        buf
    }

    /// Deserializes bootstrap payload from raw bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, BootstrapError> {
        if bytes.len() < 2 + 1 + 4 + 2 + 16 {
            return Err(BootstrapError::BufferTooShort);
        }

        if &bytes[0..2] != BOOTSTRAP_MAGIC {
            return Err(BootstrapError::InvalidMagic);
        }

        let family = bytes[2];
        let (ip, offset) = match family {
            4 => {
                let octets = [bytes[3], bytes[4], bytes[5], bytes[6]];
                (IpAddr::V4(Ipv4Addr::from(octets)), 7)
            }
            6 => {
                if bytes.len() < 2 + 1 + 16 + 2 + 16 {
                    return Err(BootstrapError::BufferTooShort);
                }
                let mut octets = [0u8; 16];
                octets.copy_from_slice(&bytes[3..19]);
                (IpAddr::V6(Ipv6Addr::from(octets)), 19)
            }
            other => return Err(BootstrapError::UnsupportedAddressFamily(other)),
        };

        let port = u16::from_be_bytes(bytes[offset..offset + 2].try_into().unwrap());
        let mut auth_token = [0u8; 16];
        auth_token.copy_from_slice(&bytes[offset + 2..offset + 18]);

        Ok(Self {
            endpoint: NetworkEndpoint::new(ip, port),
            auth_token,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bootstrap_ipv4_roundtrip() {
        let endpoint = NetworkEndpoint::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 150)), 8443);
        let auth_token = [0xAA; 16];

        let payload = AcousticBootstrapPayload::new(endpoint, auth_token);
        let bytes = payload.to_bytes();
        assert_eq!(bytes.len(), 25);
        assert!(bytes.len() <= 48);

        let decoded = AcousticBootstrapPayload::from_bytes(&bytes).unwrap();
        assert_eq!(payload, decoded);
    }

    #[test]
    fn test_bootstrap_ipv6_roundtrip() {
        let endpoint = NetworkEndpoint::new(
            IpAddr::V6(Ipv6Addr::new(0xfe80, 0, 0, 0, 0x0202, 0xb3ff, 0xfe1e, 0x8329)),
            9000,
        );
        let auth_token = [0x11; 16];

        let payload = AcousticBootstrapPayload::new(endpoint, auth_token);
        let bytes = payload.to_bytes();
        assert_eq!(bytes.len(), 37);
        assert!(bytes.len() <= 48);

        let decoded = AcousticBootstrapPayload::from_bytes(&bytes).unwrap();
        assert_eq!(payload, decoded);
    }
}
