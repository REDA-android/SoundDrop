//! Acoustic modem implementations: ggwave FFI and native MFSK modem.

pub mod ggwave;
pub mod mfsk;

pub use ggwave::{GgwaveModem, ProtocolId, SampleFormat};
pub use mfsk::{
    demod_symbol, demodulate_bytes, demodulate_frame, detect_chirp_preamble,
    generate_chirp_preamble, goertzel_energy, modulate_bytes, modulate_frame, MfskProfile,
};
