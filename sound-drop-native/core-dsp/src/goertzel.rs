//! Goertzel Tone Filter Bank
//! Analyzes acoustic spectral bins with high frequency resolution.

use std::f64::consts::PI;

#[derive(Debug, Clone)]
pub struct GoertzelBank {
    pub sample_rate: f64,
    pub block_size: usize,
    pub target_frequencies: Vec<f64>,
    coefficients: Vec<f64>,
}

#[derive(Debug, Clone)]
pub struct ToneDetection {
    pub detected_symbol: Option<u8>,
    pub peak_energy: f64,
    pub noise_floor: f64,
    pub snr_db: f64,
    pub confidence: f64,
    pub all_energies: Vec<f64>,
}

impl GoertzelBank {
    pub fn new(sample_rate: f64, block_size: usize, target_frequencies: Vec<f64>) -> Self {
        let coefficients = target_frequencies
            .iter()
            .map(|&f| {
                let omega = 2.0 * PI * (f / sample_rate);
                2.0 * omega.cos()
            })
            .collect();

        Self {
            sample_rate,
            block_size,
            target_frequencies,
            coefficients,
        }
    }

    /// Creates standard 16-FSK Audible filter bank (1600 Hz - 4412.5 Hz, delta = 187.5 Hz)
    pub fn audible_16fsk(sample_rate: f64, block_size: usize) -> Self {
        let mut freqs = Vec::with_capacity(16);
        for k in 0..16 {
            freqs.push(1600.0 + (k as f64) * 187.5);
        }
        Self::new(sample_rate, block_size, freqs)
    }

    /// Creates standard 16-FSK Ultrasonic filter bank (17600 Hz - 20412.5 Hz, delta = 187.5 Hz)
    pub fn ultrasonic_16fsk(sample_rate: f64, block_size: usize) -> Self {
        let mut freqs = Vec::with_capacity(16);
        for k in 0..16 {
            freqs.push(17600.0 + (k as f64) * 187.5);
        }
        Self::new(sample_rate, block_size, freqs)
    }

    /// Pure Rust Goertzel analysis loop with exact power normalization
    pub fn analyze_block(&self, samples: &[f32]) -> Vec<f64> {
        let n = samples.len().min(self.block_size);
        let mut energies = Vec::with_capacity(self.target_frequencies.len());

        for &coeff in &self.coefficients {
            let mut s0 = 0.0f64;
            let mut s1 = 0.0f64;
            let mut s2 = 0.0f64;

            for &sample in samples.iter().take(n) {
                s0 = (sample as f64) + coeff * s1 - s2;
                s2 = s1;
                s1 = s0;
            }

            let power = (s1 * s1) + (s2 * s2) - (coeff * s1 * s2);
            let normalized = if power > 0.0 {
                power / ((n as f64) * (n as f64))
            } else {
                0.0
            };
            energies.push(normalized);
        }

        energies
    }

    /// Evaluates symbol decision from computed energies based on SNR threshold
    pub fn evaluate_symbol(&self, samples: &[f32], snr_threshold_db: f64) -> ToneDetection {
        let energies = self.analyze_block(samples);
        if energies.is_empty() {
            return ToneDetection {
                detected_symbol: None,
                peak_energy: 0.0,
                noise_floor: 0.0,
                snr_db: 0.0,
                confidence: 0.0,
                all_energies: energies,
            };
        }

        let mut peak_idx = 0;
        let mut peak_val = energies[0];
        let mut sum_energy = 0.0f64;

        for (idx, &e) in energies.iter().enumerate() {
            sum_energy += e;
            if e > peak_val {
                peak_val = e;
                peak_idx = idx;
            }
        }

        // Noise floor: average energy of remaining 15 tones
        let noise_floor = if energies.len() > 1 {
            (sum_energy - peak_val) / ((energies.len() - 1) as f64)
        } else {
            1e-9
        };

        let snr_db = if noise_floor > 1e-12 {
            10.0 * (peak_val / noise_floor).log10()
        } else {
            0.0
        };

        let confidence = if peak_val > 0.0 && sum_energy > 0.0 {
            (peak_val / sum_energy).min(1.0)
        } else {
            0.0
        };

        let detected_symbol = if snr_db >= snr_threshold_db && peak_val > 1e-6 {
            Some(peak_idx as u8)
        } else {
            None
        };

        ToneDetection {
            detected_symbol,
            peak_energy: peak_val,
            noise_floor,
            snr_db,
            confidence,
            all_energies: energies,
        }
    }
}
