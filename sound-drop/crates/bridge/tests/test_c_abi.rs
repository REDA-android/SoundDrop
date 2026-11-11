use libc::c_uchar;
use sounddrop_bridge::{
    sounddrop_build_relay_packet, sounddrop_derive_key, sounddrop_generate_identity,
    sounddrop_relay_hop_step, sounddrop_version, SoundDropKeypairC,
};
use std::ffi::CStr;

#[test]
fn test_c_abi_version_string() {
    unsafe {
        let v_ptr = sounddrop_version();
        assert!(!v_ptr.is_null());
        let c_str = CStr::from_ptr(v_ptr);
        let rust_str = c_str.to_str().expect("valid utf-8");
        assert!(rust_str.contains("SoundDrop Core 0.2.0 (Rust/C-ABI)"));
        println!("[C-ABI Test] Version: {}", rust_str);
    }
}

#[test]
fn test_c_abi_identity_generation_and_key_derivation() {
    unsafe {
        let mut keypair = SoundDropKeypairC {
            public_key: [0; 32],
            recipient_hash: [0; 4],
        };

        let ret = sounddrop_generate_identity(&mut keypair);
        assert_eq!(ret, 0);
        assert_ne!(keypair.public_key, [0; 32]);
        assert_ne!(keypair.recipient_hash, [0; 4]);

        println!(
            "[C-ABI Test] Public Key: {:02x?}, Recipient Hash: {:02x?}",
            &keypair.public_key[0..4],
            keypair.recipient_hash
        );

        // Derive session key
        let shared = [0x55u8; 32];
        let mut session_key = [0u8; 32];
        let ret_derive = sounddrop_derive_key(
            shared.as_ptr() as *const c_uchar,
            0x4242,
            session_key.as_mut_ptr() as *mut c_uchar,
        );
        assert_eq!(ret_derive, 0);
        assert_ne!(session_key, [0; 32]);
    }
}

#[test]
fn test_c_abi_relay_packet_build_and_hop_step() {
    unsafe {
        let recipient_hash = [0xAA, 0xBB, 0xCC, 0xDD];
        let payload = b"ALERTE SECOURS ITZER";
        let mut out_buf = [0u8; 256];

        // 1. Build packet via C-ABI
        let written = sounddrop_build_relay_packet(
            0x1234,
            recipient_hash.as_ptr() as *const c_uchar,
            3, /* TTL = 3 */
            payload.as_ptr() as *const c_uchar,
            payload.len(),
            out_buf.as_mut_ptr() as *mut c_uchar,
            out_buf.len(),
        );

        assert!(written > 0);
        let packet_len = written as usize;
        println!("[C-ABI Test] Relay Packet built: {} bytes", packet_len);

        // 2. Advance Hop 1 (TTL 3 -> 2)
        let mut hop1_buf = [0u8; 256];
        let hop1_len = sounddrop_relay_hop_step(
            out_buf.as_ptr() as *const c_uchar,
            packet_len,
            hop1_buf.as_mut_ptr() as *mut c_uchar,
            hop1_buf.len(),
        );
        assert!(hop1_len > 0);

        // 3. Advance Hop 2 (TTL 2 -> 1)
        let mut hop2_buf = [0u8; 256];
        let hop2_len = sounddrop_relay_hop_step(
            hop1_buf.as_ptr() as *const c_uchar,
            hop1_len as usize,
            hop2_buf.as_mut_ptr() as *mut c_uchar,
            hop2_buf.len(),
        );
        assert!(hop2_len > 0);

        // 4. Advance Hop 3 (TTL 1 -> 0: Expired)
        let mut hop3_buf = [0u8; 256];
        let hop3_len = sounddrop_relay_hop_step(
            hop2_buf.as_ptr() as *const c_uchar,
            hop2_len as usize,
            hop3_buf.as_mut_ptr() as *mut c_uchar,
            hop3_buf.len(),
        );
        assert_eq!(hop3_len, -4, "Must return -4 when TTL expires");
        println!("[C-ABI Test] SUCCESS: Relay hop decrement and expiration verified through C-ABI!");
    }
}
