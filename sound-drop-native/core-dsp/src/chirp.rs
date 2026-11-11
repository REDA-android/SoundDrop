//! Linear Frequency Modulated (LFM) Chirp & Matched Filter Synchronizer
//! Provides sub-millisecond acoustic clock locking under ambient reverberation.

use std::f64::consts::PI;

#[derive(Debug, Clone)]
pub struct LfmChirpConfig {
    pub sample_rate: f64,
    pub f_start: f64,
    pub f_end: f64,
    pub duration_seconds: f64,
}

impl Default for LfmChirpConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000.0,
            f_start: 1200.0,
            f_end: 4800.0,
            duration_seconds: 0.25, // 250ms
        }
    }
}

pub struct LfmChirp {
    pub config: LfmChirpConfig,
    pub reference_waveform: Vec<f32>,
}

impl LfmChirp {
    pub fn new(config: LfmChirpConfig) -> Self {
        let reference_waveform = Self::synthesize_chirp(&config);
        Self {
            config,
            reference_waveform,
        }
    }

    /// Synthesizes a Linear Frequency Modulated chirp:
    /// f(t) = f0 + (f1 - f0) * (t / T)
    /// phi(t) = 2*pi * (f0*t + 0.5 * (f1 - f0) / T * t^2)
    pub fn synthesize_chirp(config: &LfmChirpConfig) -> Vec<f32> {
        let num_samples = (config.sample_rate * config.duration_seconds).round() as usize;
        let mut samples = Vec::with_capacity(num_samples);
        let t_total = config.duration_seconds;
        let chirp_rate = (config.f_end - config.f_start) / t_total;

        for i in 0..num_samples {
            let t = (i as f64) / config.sample_rate;
            // Phase integration for linear chirp
            let phase = 2.0 * PI * (config.f_start * t + 0.5 * chirp_rate * t * t);
            
            // Apply Tukey / Raised-Cosine taper window at edges (10% taper)
            let taper_len = (num_samples as f64 * 0.1).round() as usize;
            let window = if i < taper_len {
                0.5 * (1.0 - (PI * (i as f64) / (taper_len as f64)).cos())
            } else if i >= num_samples - taper_len {
                let rem = (num_samples - 1 - i) as f64;
                0.5 * (1.0 - (PI * rem / (taper_len as f64)).cos())
            } else {
                1.0
            };

            samples.push((phase.sin() * window) as f32);
        }

        samples
    }

    /// Generates full Dual-Chirp Preamble: Up-Chirp + Guard Interval + Down-Chirp
    pub fn generate_preamble(&self, guard_seconds: f64) -> Vec<f32> {
        let mut preamble = Vec::new();
        
        // 1. Up-Chirp
        preamble.extend_from_slice(&self.reference_waveform);

        // 2. Guard silence interval
        let guard_samples = (self.config.sample_rate * guard_seconds).round() as usize;
        preamble.extend(std::iter::repeat(0.0f32).take(guard_samples));

        // 3. Down-Chirp (Reverse frequency sweep)
        let down_config = LfmChirpConfig {
            f_start: self.config.f_end,
            f_end: self.config.f_start,
            ..self.config.clone()
        };
        let down_chirp = Self::synthesize_chirp(&down_config);
        preamble.extend_from_slice(&down_chirp);

        preamble
    }

    /// Computes normalized cross-correlation matched filter against a sample window
    pub fn cross_correlate(&self, window: &[f32]) -> f64 {
        if window.len() != self.reference_waveform.len() {
            return 0.0;
        }

        let mut dot = 0.0f64;
        let mut norm_in = 0.0f64;
        let mut norm_ref = 0.0f64;

        for (a, b) in window.iter().zip(self.reference_waveform.iter()) {
            let x = *a as f64;
            let y = *b as f64;
            dot += x * y;
            norm_in += x * x;
            norm_ref += y * y;
        }

        let denom = (norm_in * norm_ref).sqrt();
        if denom <= 1e-9 {
            0.0
        } else {
            dot / denom
        }
    }
}
