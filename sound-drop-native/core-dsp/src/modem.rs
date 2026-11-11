//! 16-FSK Acoustic Modem Pipeline
//! Translates byte payloads into continuous phase floating-point audio waveforms.

use std::f64::consts::PI;
use crate::chirp::{LfmChirp, LfmChirpConfig};
use crate::goertzel::GoertzelBank;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModemMode {
    Audible,
    Ultrasonic,
    Whisper,
}

#[derive(Debug, Clone)]
pub struct ModemConfig {
    pub mode: ModemMode,
    pub sample_rate: f64,
    pub samples_per_symbol: usize,
    pub base_frequency: f64,
    pub delta_frequency: f64,
    pub num_tones: usize,
    pub preamble_duration_sec: f64,
}

impl ModemConfig {
    pub fn audible() -> Self {
        Self {
            mode: ModemMode::Audible,
            sample_rate: 48000.0,
            samples_per_symbol: 2048, // 42.66 ms
            base_frequency: 1600.0,
            delta_frequency: 187.5,
            num_tones: 16,
            preamble_duration_sec: 0.25,
        }
    }

    pub fn ultrasonic() -> Self {
        Self {
            mode: ModemMode::Ultrasonic,
            sample_rate: 48000.0,
            samples_per_symbol: 3072, // 64 ms
            base_frequency: 17600.0,
            delta_frequency: 187.5,
            num_tones: 16,
            preamble_duration_sec: 0.25,
        }
    }

    pub fn whisper() -> Self {
        Self {
            mode: ModemMode::Whisper,
            sample_rate: 48000.0,
            samples_per_symbol: 3072, // 64 ms
            base_frequency: 18500.0,
            delta_frequency: 106.25,
            num_tones: 16,
            preamble_duration_sec: 0.25,
        }
    }

    pub fn get_frequency(&self, symbol: u8) -> f64 {
        let sym = (symbol & 0x0F) as f64;
        self.base_frequency + sym * self.delta_frequency
    }
}

pub struct FskModulator {
    pub config: ModemConfig,
    pub chirp: LfmChirp,
}

impl FskModulator {
    pub fn new(config: ModemConfig) -> Self {
        let (f_start, f_end) = match config.mode {
            ModemMode::Audible => (1200.0, 4800.0),
            ModemMode::Ultrasonic => (17200.0, 20200.0),
            ModemMode::Whisper => (18500.0, 20200.0),
        };

        let chirp_config = LfmChirpConfig {
            sample_rate: config.sample_rate,
            f_start,
            f_end,
            duration_seconds: config.preamble_duration_sec,
        };

        let chirp = LfmChirp::new(chirp_config);
        Self { config, chirp }
    }

    /// Encodes a raw byte payload into 16-FSK PCM audio with preamble & smooth windowing
    pub fn encode_payload(&self, payload: &[u8], amplitude: f32) -> Vec<f32> {
        let mut pcm = Vec::new();

        // 1. Generate LFM Chirp Preamble (Up-Chirp + 50ms guard + Down-Chirp)
        let preamble = self.chirp.generate_preamble(0.05);
        for &s in &preamble {
            pcm.push(s * amplitude);
        }

        // 2. Modulate each byte into 2 nibbles (High nibble first, then low nibble)
        let mut current_phase = 0.0f64;
        let samples_per_sym = self.config.samples_per_symbol;
        let taper_samples = (samples_per_sym as f64 * 0.15).round() as usize; // 15% Hann taper

        for &byte in payload {
            let high_nibble = (byte >> 4) & 0x0F;
            let low_nibble = byte & 0x0F;

            for &nibble in &[high_nibble, low_nibble] {
                let freq = self.config.get_frequency(nibble);
                let phase_step = 2.0 * PI * (freq / self.config.sample_rate);

                for i in 0..samples_per_sym {
                    // Raised-cosine Hann window envelope for symbol transitions
                    let window = if i < taper_samples {
                        0.5 * (1.0 - (PI * (i as f64) / (taper_samples as f64)).cos())
                    } else if i >= samples_per_sym - taper_samples {
                        let rem = (samples_per_sym - 1 - i) as f64;
                        0.5 * (1.0 - (PI * rem / (taper_samples as f64)).cos())
                    } else {
                        1.0
                    };

                    let sample = (current_phase.sin() * window) as f32 * amplitude;
                    pcm.push(sample);

                    current_phase += phase_step;
                    if current_phase >= 2.0 * PI {
                        current_phase -= 2.0 * PI;
                    }
                }
            }
        }

        // 3. Post-transmission quiet guard (50ms)
        let guard_samples = (self.config.sample_rate * 0.05).round() as usize;
        pcm.extend(std::iter::repeat(0.0f32).take(guard_samples));

        pcm
    }
}
