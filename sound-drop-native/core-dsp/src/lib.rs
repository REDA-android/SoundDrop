//! Sound Drop Native Acoustic DSP Core
//! High-performance real-time software-defined acoustic PHY modem.

pub mod chirp;
pub mod goertzel;
pub mod modem;

use std::slice;
use libc::{c_double, c_float, c_int, size_t};
use crate::chirp::{LfmChirp, LfmChirpConfig};
use crate::goertzel::GoertzelBank;
use crate::modem::{FskModulator, ModemConfig, ModemMode};

/// High-level safe Rust API for acoustic encoding
pub fn encode_to_pcm(payload: &[u8], mode: ModemMode, amplitude: f32) -> Vec<f32> {
    let config = match mode {
        ModemMode::Audible => ModemConfig::audible(),
        ModemMode::Ultrasonic => ModemConfig::ultrasonic(),
        ModemMode::Whisper => ModemConfig::whisper(),
    };
    let modulator = FskModulator::new(config);
    modulator.encode_payload(payload, amplitude)
}

/// High-level safe Rust API for Goertzel spectral detection
pub fn analyze_spectrum(samples: &[f32], mode: ModemMode) -> (Option<u8>, f64, f64) {
    let sample_rate = 48000.0;
    let block_size = match mode {
        ModemMode::Audible => 2048,
        ModemMode::Ultrasonic | ModemMode::Whisper => 3072,
    };
    let bank = match mode {
        ModemMode::Audible => GoertzelBank::audible_16fsk(sample_rate, block_size),
        ModemMode::Ultrasonic | ModemMode::Whisper => GoertzelBank::ultrasonic_16fsk(sample_rate, block_size),
    };
    let detection = bank.evaluate_symbol(samples, 9.0);
    (detection.detected_symbol, detection.snr_db, detection.confidence)
}

// ---------------------------------------------------------------------------
// C-FFI Exports for C++, Go, and Native Desktop Bindings
// ---------------------------------------------------------------------------

#[no_mangle]
pub unsafe extern "C" fn sound_drop_encode_payload(
    payload_ptr: *const u8,
    payload_len: size_t,
    mode_raw: c_int,
    amplitude: c_float,
    out_pcm_ptr: *mut *mut f32,
    out_pcm_len: *mut size_t,
) -> c_int {
    if payload_ptr.is_null() || out_pcm_ptr.is_null() || out_pcm_len.is_null() {
        return -1;
    }

    let payload = slice::from_raw_parts(payload_ptr, payload_len);
    let mode = match mode_raw {
        1 => ModemMode::Ultrasonic,
        2 => ModemMode::Whisper,
        _ => ModemMode::Audible,
    };

    let pcm = encode_to_pcm(payload, mode, amplitude);
    let len = pcm.len();
    let mut boxed_slice = pcm.into_boxed_slice();
    *out_pcm_ptr = boxed_slice.as_mut_ptr();
    *out_pcm_len = len;
    std::mem::forget(boxed_slice);

    0
}

#[no_mangle]
pub unsafe extern "C" fn sound_drop_free_pcm(ptr: *mut f32, len: size_t) {
    if !ptr.is_null() && len > 0 {
        let _ = Box::from_raw(slice::from_raw_parts_mut(ptr, len));
    }
}
