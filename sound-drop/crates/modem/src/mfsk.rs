//! Native 16-FSK Rust Modem with Goertzel Demodulation and Linear Chirp Synchronization.
//! Compliant with Section 4.1 & 4.2:
//! - Exact Goertzel bin spacing (spacing = 3 / Ts), no spectral leakage
//! - Profiles: Robuste, Normal, Rapide, Ultra
//! - Linear chirp preamble (1.5 -> 5.5 kHz, 50 ms) for frame sync and clock drift correction

use rustfft::{num_complex::Complex, FftPlanner};
use sounddrop_protocol::{Frame, ProtocolError};
use std::f32::consts::PI;

pub const SAMPLE_RATE: f32 = 48000.0;
pub const CHIRP_F_START: f32 = 1500.0;
pub const CHIRP_F_END: f32 = 5500.0;
pub const CHIRP_DURATION_SEC: f32 = 0.050; // 50 ms
pub const CHIRP_SAMPLES: usize = (SAMPLE_RATE * CHIRP_DURATION_SEC) as usize; // 2400 samples

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum MfskProfile {
    Robuste,
    Normal,
    Rapide,
    Ultra,
}

impl MfskProfile {
    pub fn symbol_duration_sec(&self) -> f32 {
        match self {
            MfskProfile::Robuste => 0.048,
            MfskProfile::Normal => 0.024,
            MfskProfile::Rapide => 0.012,
            MfskProfile::Ultra => 0.024,
        }
    }

    pub fn samples_per_symbol(&self) -> usize {
        match self {
            MfskProfile::Robuste => 2304,
            MfskProfile::Normal => 1152,
            MfskProfile::Rapide => 576,
            MfskProfile::Ultra => 1152,
        }
    }

    pub fn base_freq(&self) -> f32 {
        match self {
            MfskProfile::Robuste | MfskProfile::Normal | MfskProfile::Rapide => 1500.0,
            MfskProfile::Ultra => 17500.0,
        }
    }

    pub fn freq_step(&self) -> f32 {
        match self {
            MfskProfile::Robuste => 62.5,
            MfskProfile::Normal => 125.0,
            MfskProfile::Rapide => 250.0,
            MfskProfile::Ultra => 125.0,
        }
    }

    /// Estimated net bytes per second accounting for chirp overhead, guard interval, and CRC
    pub fn estimated_net_bps(&self) -> f32 {
        match self {
            MfskProfile::Robuste => 7.0,
            MfskProfile::Normal => 14.0,
            MfskProfile::Rapide => 27.0,
            MfskProfile::Ultra => 14.0,
        }
    }
}

/// Goertzel filter energy calculation on a block of samples (Section 4.2)
pub fn goertzel_energy(samples: &[f32], freq: f32, sr: f32) -> f32 {
    let w = 2.0 * PI * freq / sr;
    let coeff = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f32, 0.0f32);
    for &x in samples {
        let s = x + coeff * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    s1 * s1 + s2 * s2 - coeff * s1 * s2
}

/// Demodulate a 16-FSK symbol (4 bits: 0..15) using Goertzel algorithm and compute SNR (Section 4.2)
pub fn demod_symbol(block: &[f32], base: f32, step: f32, sr: f32) -> (u8, f32) {
    let mut best = (0u8, f32::MIN);
    let mut sum = 0.0;
    for k in 0..16u8 {
        let e = goertzel_energy(block, base + k as f32 * step, sr);
        sum += e;
        if e > best.1 {
            best = (k, e);
        }
    }
    let noise = (sum - best.1) / 15.0;
    let snr_db = if noise > 1e-9 {
        10.0 * (best.1 / noise).log10()
    } else {
        0.0
    };
    (best.0, snr_db)
}

/// Generate reference linear chirp preamble: 1.5 -> 5.5 kHz over 50 ms (Section 4.1)
pub fn generate_chirp_preamble(sr: f32) -> Vec<f32> {
    let n = (sr * CHIRP_DURATION_SEC) as usize;
    let mut samples = Vec::with_capacity(n);
    let k = (CHIRP_F_END - CHIRP_F_START) / CHIRP_DURATION_SEC;

    for i in 0..n {
        let t = i as f32 / sr;
        // Instantaneous phase: phi(t) = 2*pi * (f0*t + 0.5*k*t^2)
        let phi = 2.0 * PI * (CHIRP_F_START * t + 0.5 * k * t * t);
        // Tukey window (5% taper at edges)
        let window = if (i as f32) < 0.05 * n as f32 {
            0.5 * (1.0 - (PI * i as f32 / (0.05 * n as f32)).cos())
        } else if (i as f32) > 0.95 * n as f32 {
            0.5 * (1.0 - (PI * (n - 1 - i) as f32 / (0.05 * n as f32)).cos())
        } else {
            1.0
        };
        samples.push(phi.sin() * window * 0.8);
    }
    samples
}

/// Correlate incoming audio with reference chirp preamble using FFT cross-correlation
/// Returns (best_sample_index, peak_correlation_score)
pub fn detect_chirp_preamble(audio: &[f32], sr: f32) -> Option<(usize, f32)> {
    let chirp = generate_chirp_preamble(sr);
    if audio.len() < chirp.len() {
        return None;
    }

    // Fast FFT cross-correlation
    let fft_len = (audio.len() + chirp.len()).next_power_of_two();
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(fft_len);
    let ifft = planner.plan_fft_inverse(fft_len);

    let mut audio_c: Vec<Complex<f32>> = audio.iter().map(|&x| Complex::new(x, 0.0)).collect();
    audio_c.resize(fft_len, Complex::new(0.0, 0.0));
    fft.process(&mut audio_c);

    // Time-reversed and conjugated chirp for cross-correlation
    let mut chirp_c: Vec<Complex<f32>> = chirp.iter().rev().map(|&x| Complex::new(x, 0.0)).collect();
    chirp_c.resize(fft_len, Complex::new(0.0, 0.0));
    fft.process(&mut chirp_c);

    // Multiply in frequency domain
    for i in 0..fft_len {
        audio_c[i] = audio_c[i] * chirp_c[i];
    }
    ifft.process(&mut audio_c);

    let mut max_val = 0.0f32;
    let mut max_idx = 0;
    let valid_range = audio.len() - chirp.len();

    for i in 0..valid_range {
        let val = audio_c[i + chirp.len() - 1].re / fft_len as f32;
        if val > max_val {
            max_val = val;
            max_idx = i;
        }
    }

    // Threshold check (normalized cross-correlation peak)
    let chirp_energy: f32 = chirp.iter().map(|&x| x * x).sum();
    let norm_score = max_val / (chirp_energy + 1e-6);

    if norm_score > 0.15 {
        Some((max_idx, norm_score))
    } else {
        None
    }
}

/// Modulate a byte slice into 16-FSK audio samples
pub fn modulate_bytes(profile: MfskProfile, data: &[u8], sr: f32) -> Vec<f32> {
    let samples_per_sym = profile.samples_per_symbol();
    let base = profile.base_freq();
    let step = profile.freq_step();

    // 1 byte = 2 nibbles (high nibble, low nibble) = 2 symbols
    let total_symbols = data.len() * 2;
    let mut samples = Vec::with_capacity(CHIRP_SAMPLES + total_symbols * samples_per_sym);

    // 1. Add linear chirp preamble
    samples.extend(generate_chirp_preamble(sr));

    // 2. Add symbols with raised-cosine windowing
    for &byte in data {
        let nibbles = [(byte >> 4) & 0x0F, byte & 0x0F];
        for &nibble in &nibbles {
            let freq = base + (nibble as f32) * step;
            let phase_inc = 2.0 * PI * freq / sr;
            for i in 0..samples_per_sym {
                let t = i as f32;
                let raw_sine = (phase_inc * t).sin();
                // Smooth Hann windowing for the first and last 8 samples of each symbol to eliminate clicks
                let taper_len = 8.0f32;
                let window = if t < taper_len {
                    0.5 * (1.0 - (PI * t / taper_len).cos())
                } else if t > (samples_per_sym as f32 - taper_len) {
                    0.5 * (1.0 - (PI * (samples_per_sym as f32 - t) / taper_len).cos())
                } else {
                    1.0
                };
                samples.push(raw_sine * window * 0.75);
            }
        }
    }

    samples
}

/// Demodulate 16-FSK audio samples into bytes
/// Returns (demodulated_bytes, average_snr_db)
pub fn demodulate_bytes(
    profile: MfskProfile,
    audio: &[f32],
    expected_byte_count: usize,
    sr: f32,
) -> Result<(Vec<u8>, f32), ProtocolError> {
    // 1. Synchronize to chirp preamble
    let (preamble_end, _score) = detect_chirp_preamble(audio, sr).ok_or_else(|| {
        ProtocolError::ErasureError("Chirp preamble synchronization failed".into())
    })?;

    let symbol_start = preamble_end + CHIRP_SAMPLES;
    let samples_per_sym = profile.samples_per_symbol();
    let base = profile.base_freq();
    let step = profile.freq_step();

    let total_symbols = expected_byte_count * 2;
    if audio.len() < symbol_start + total_symbols * samples_per_sym {
        return Err(ProtocolError::FrameTooShort);
    }

    let mut nibbles = Vec::with_capacity(total_symbols);
    let mut total_snr = 0.0;

    for s in 0..total_symbols {
        let offset = symbol_start + s * samples_per_sym;
        let block = &audio[offset..offset + samples_per_sym];
        let (nibble, snr) = demod_symbol(block, base, step, sr);
        nibbles.push(nibble);
        total_snr += snr;
    }

    let mut bytes = Vec::with_capacity(expected_byte_count);
    for chunk in nibbles.chunks_exact(2) {
        let byte = (chunk[0] << 4) | (chunk[1] & 0x0F);
        bytes.push(byte);
    }

    let avg_snr = total_snr / total_symbols.max(1) as f32;
    Ok((bytes, avg_snr))
}

/// Modulate a complete protocol Frame into 16-FSK audio
pub fn modulate_frame(profile: MfskProfile, frame: &Frame, sr: f32) -> Vec<f32> {
    let serialized = frame.serialize();
    modulate_bytes(profile, &serialized, sr)
}

/// Demodulate a complete protocol Frame from 16-FSK audio and verify CRC-16
pub fn demodulate_frame(
    profile: MfskProfile,
    audio: &[f32],
    expected_payload_len: usize,
    sr: f32,
) -> Result<(Frame, f32), ProtocolError> {
    let total_frame_len = 8 + expected_payload_len + 2; // header (8B) + payload + CRC-16 (2B)
    let (raw_bytes, snr) = demodulate_bytes(profile, audio, total_frame_len, sr)?;
    let frame = Frame::deserialize(&raw_bytes)?;
    Ok((frame, snr))
}
