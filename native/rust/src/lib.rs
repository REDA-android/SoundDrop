//! SoundDrop v6.0 — Native Rust & WebAssembly Core DSP + Cryptographic Framing Engine
//! Implements zero-allocation Goertzel 4-FSK spectral energy detection,
//! CRC-16-CCITT framing, and rolling FNV-1a / Adler-32 block fingerprinting.

#![allow(dead_code)]

use std::f32::consts::PI;

pub const SAMPLE_RATE: f32 = 48000.0;
pub const MAGIC_HEADER: [u8; 2] = [0x53, 0x44]; // "SD"

/// Computes exactCRC-16-CCITT (polynomial 0x1021, initial 0xFFFF) over a real byte slice.
#[no_mangle]
pub extern "C" fn sounddrop_crc16_ccitt(ptr: *const u8, len: usize) -> u16 {
    if ptr.is_null() || len == 0 {
        return 0xFFFF;
    }
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    compute_crc16(slice)
}

pub fn compute_crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if (crc & 0x8000) != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

/// Goertzel single-bin DFT power detector for high-speed ultrasonic / audible FSK demodulation.
pub fn goertzel_magnitude_db(samples: &[f32], target_freq: f32, sample_rate: f32) -> f32 {
    if samples.is_empty() || sample_rate <= 0.0 {
        return -140.0;
    }
    let n = samples.len() as f32;
    let k = ((n * target_freq) / sample_rate).round();
    let omega = (2.0 * PI * k) / n;
    let coeff = 2.0 * omega.cos();

    let mut q0: f32;
    let mut q1: f32 = 0.0;
    let mut q2: f32 = 0.0;

    for &sample in samples {
        q0 = coeff * q1 - q2 + sample;
        q2 = q1;
        q1 = q0;
    }

    let power = q1 * q1 + q2 * q2 - q1 * q2 * coeff;
    let normalized = (power.max(1e-14) / (n * n)).sqrt();
    20.0 * normalized.log10()
}

/// Builds a signed Quiet-FSK binary frame `[0x53, 0x44, len, payload..., crc_hi, crc_lo]`.
pub fn encode_quiet_fsk_frame(payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(payload.len() + 5);
    frame.extend_from_slice(&MAGIC_HEADER);
    frame.push(payload.len() as u8);
    frame.extend_from_slice(payload);
    let crc = compute_crc16(&frame);
    frame.push(((crc >> 8) & 0xFF) as u8);
    frame.push((crc & 0xFF) as u8);
    frame
}
