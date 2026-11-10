use crate::config::PhyConfig;
use sounddrop_dsp::{generate_linear_chirp, generate_tone};

/// Acoustic Physical Layer Modulator.
pub struct Modulator {
    config: PhyConfig,
    up_chirp: Vec<f32>,
    down_chirp: Vec<f32>,
    tones: Vec<Vec<f32>>,
}

impl Modulator {
    pub fn new(config: PhyConfig) -> Self {
        let chirp_samples = config.chirp_samples();
        let up_chirp = generate_linear_chirp(
            config.chirp_f_start,
            config.chirp_f_end,
            config.sample_rate,
            chirp_samples,
            0.1,
        );
        let down_chirp = generate_linear_chirp(
            config.chirp_f_end,
            config.chirp_f_start,
            config.sample_rate,
            chirp_samples,
            0.1,
        );

        let active_samples = config.symbol_active_samples();
        let candidate_freqs = config.candidate_frequencies();
        let mut tones = Vec::with_capacity(candidate_freqs.len());

        for &freq in &candidate_freqs {
            let tone = generate_tone(freq, config.sample_rate, active_samples, 0.15);
            tones.push(tone);
        }

        Self {
            config,
            up_chirp,
            down_chirp,
            tones,
        }
    }

    pub fn config(&self) -> &PhyConfig {
        &self.config
    }

    /// Modulates a sequence of symbols (values in `0..num_tones`) into PCM audio samples.
    pub fn modulate(&self, symbols: &[u8]) -> Vec<f32> {
        let guard_samples = self.config.symbol_total_samples() - self.config.symbol_active_samples();
        let sync_guard_samples = (0.020 * self.config.sample_rate).round() as usize; // 20 ms
        let trail_samples = (0.040 * self.config.sample_rate).round() as usize;      // 40 ms

        let total_est = (self.config.preamble_up_chirps + 1) * self.up_chirp.len()
            + sync_guard_samples
            + symbols.len() * self.config.symbol_total_samples()
            + trail_samples;

        let mut output = Vec::with_capacity(total_est);

        // 1. Preamble up-chirps
        for _ in 0..self.config.preamble_up_chirps {
            output.extend_from_slice(&self.up_chirp);
        }

        // 2. Sync down-chirp
        output.extend_from_slice(&self.down_chirp);

        // 3. Post-sync guard silence
        output.resize(output.len() + sync_guard_samples, 0.0);

        // 4. M-FSK symbols with reverberation decay guard intervals
        for &sym in symbols {
            let sym_idx = (sym as usize) % self.tones.len();
            output.extend_from_slice(&self.tones[sym_idx]);
            output.resize(output.len() + guard_samples, 0.0);
        }

        // 5. Trailing silence
        output.resize(output.len() + trail_samples, 0.0);

        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_modulator_output_length() {
        let cfg = PhyConfig::audible_robust_48k();
        let mod_engine = Modulator::new(cfg);
        let symbols = vec![0, 1, 2, 3, 15];
        let pcm = mod_engine.modulate(&symbols);

        assert!(!pcm.is_empty(), "Modulated PCM must not be empty");
        // Verify peak values are normalized within [-1.0, 1.0]
        for &s in &pcm {
            assert!(s.abs() <= 1.0, "Sample amplitude exceeds 1.0: {}", s);
        }
    }
}
