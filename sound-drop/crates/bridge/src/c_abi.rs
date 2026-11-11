//! C-ABI Foreign Function Interface (FFI) for SoundDrop Core.
//! Allows native integration with C, C++, Kotlin (JNI), Swift, and Dart/Flutter.

use libc::{c_char, c_int, c_uchar, size_t};
use sounddrop_crypto::{compute_recipient_hash, derive_session_key, EphemeralKeyPair};
use sounddrop_protocol::relay::{RelayHeader, RelayPacket};
use sounddrop_protocol::{Frame, FrameHeader, FrameType};

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct SoundDropKeypairC {
    pub public_key: [u8; 32],
    pub recipient_hash: [u8; 4],
}

/// Generate an ephemeral X25519 keypair and return public key + recipient hash
#[no_mangle]
pub unsafe extern "C" fn sounddrop_generate_identity(out_keys: *mut SoundDropKeypairC) -> c_int {
    if out_keys.is_null() {
        return -1;
    }

    let keypair = EphemeralKeyPair::generate();
    let pub_bytes = keypair.public_bytes();
    let hash = compute_recipient_hash(&pub_bytes);

    (*out_keys).public_key = pub_bytes;
    (*out_keys).recipient_hash = hash;
    0
}

/// Derive a 32-byte session key from shared secret using HKDF-SHA256
#[no_mangle]
pub unsafe extern "C" fn sounddrop_derive_key(
    shared_secret: *const c_uchar,
    session_id: u16,
    out_session_key: *mut c_uchar,
) -> c_int {
    if shared_secret.is_null() || out_session_key.is_null() {
        return -1;
    }

    let mut secret = [0u8; 32];
    std::ptr::copy_nonoverlapping(shared_secret, secret.as_mut_ptr(), 32);

    let derived = derive_session_key(&secret, None, session_id);
    std::ptr::copy_nonoverlapping(derived.as_ptr(), out_session_key, 32);
    0
}

/// Encrypt and serialize an emergency relay packet: returns length written, or -1 on error
#[no_mangle]
pub unsafe extern "C" fn sounddrop_build_relay_packet(
    session_id: u16,
    recipient_hash: *const c_uchar,
    ttl: u8,
    payload_ptr: *const c_uchar,
    payload_len: size_t,
    out_buf: *mut c_uchar,
    out_buf_capacity: size_t,
) -> c_int {
    if recipient_hash.is_null() || payload_ptr.is_null() || out_buf.is_null() {
        return -1;
    }

    let mut r_hash = [0u8; 4];
    std::ptr::copy_nonoverlapping(recipient_hash, r_hash.as_mut_ptr(), 4);

    let payload = std::slice::from_raw_parts(payload_ptr, payload_len).to_vec();
    let frame_header = FrameHeader::new(session_id, FrameType::Data, 1, 1);
    let relay_hdr = RelayHeader::new(ttl, r_hash, RelayHeader::FLAG_ENCRYPTED);

    let packet = RelayPacket::new(relay_hdr, Frame::new(frame_header, payload));
    let serialized = packet.serialize();

    if serialized.len() > out_buf_capacity {
        return -2; // Buffer too small
    }

    std::ptr::copy_nonoverlapping(serialized.as_ptr(), out_buf, serialized.len());
    serialized.len() as c_int
}

/// Verify and advance one hop on a relay packet
#[no_mangle]
pub unsafe extern "C" fn sounddrop_relay_hop_step(
    packet_ptr: *const c_uchar,
    packet_len: size_t,
    out_buf: *mut c_uchar,
    out_capacity: size_t,
) -> c_int {
    if packet_ptr.is_null() || out_buf.is_null() {
        return -1;
    }

    let bytes = std::slice::from_raw_parts(packet_ptr, packet_len);
    let mut packet = match RelayPacket::deserialize(bytes) {
        Ok(p) => p,
        Err(_) => return -3, // Corrupted packet or bad CRC
    };

    if packet.forward_step().is_err() {
        return -4; // TTL expired
    }

    let serialized = packet.serialize();
    if serialized.len() > out_capacity {
        return -2;
    }

    std::ptr::copy_nonoverlapping(serialized.as_ptr(), out_buf, serialized.len());
    serialized.len() as c_int
}

/// Return library version string
#[no_mangle]
pub unsafe extern "C" fn sounddrop_version() -> *const c_char {
    static VERSION: &str = "SoundDrop Core 0.2.0 (Rust/C-ABI)\0";
    VERSION.as_ptr() as *const c_char
}
