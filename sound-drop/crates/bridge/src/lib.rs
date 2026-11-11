//! SoundDrop Bridge — C-ABI, JNI, and multi-language FFI layer.

pub mod c_abi;
pub mod jni;

pub use c_abi::{
    sounddrop_build_relay_packet, sounddrop_derive_key, sounddrop_generate_identity,
    sounddrop_relay_hop_step, sounddrop_version, SoundDropKeypairC,
};
