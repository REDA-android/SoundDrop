use crate::config::PhyConfig;
use sounddrop_dsp::{
    find_correlation_peaks, generate_linear_chirp, matched_filter_ncc,
    detect_mfsk_symbol, SymbolDetection, SymbolTimingTracker,
};

/// Result of a physical layer demodulation.
#[derive(Debug, Clone)]
pub struct DemodulationOutput {
    /// Demodulated raw symbol values in `0..num_tones`.
    pub symbols: Vec<u8>,
    /// Sample offset where the sync chirp started.
    pub sync_sample_index: usize,
    /// Normalized cross-correlation score of the detected sync chirp.
    pub sync_correlation: f32,
    /// Relative clock drift between transmitter and receiver in Parts Per Million (PPM).
    pub clock_drift_ppm: f32,
    /// Per-symbol detection metrics (peak power, SNR margin).
    pub metrics: Vec<SymbolDetection>,
}

/// Acoustic Physical Layer Demodulator.
pub struct Demodulator {
    config: PhyConfig,
    down_chirp: Vec<f32>,
    candidate_freqs: Vec<f32>,
}

impl Demodulator {
    pub fn new(config: PhyConfig) -> Self {
        let chirp_samples = config.chirp_samples();
        let down_chirp = generate_linear_chirp(
            config.chirp_f_end,
            config.chirp_f_start,
            config.sample_rate,
            chirp_samples,
            0.1,
        );
        let candidate_freqs = config.candidate_frequencies();

        Self {
            config,
            down_chirp,
            candidate_freqs,
        }
    }

    pub fn config(&self) -> &PhyConfig {
        &self.config
    }

    /// Attempts to detect the sync chirp and demodulate up to `num_symbols` from `pcm_buffer`.
    pub fn demodulate_buffer(
        &self,
        pcm_buffer: &[f32],
        num_symbols: usize,
    ) -> Option<DemodulationOutput> {
        let m = self.down_chirp.len();
        if pcm_buffer.len() < m {
            return None;
        }

        // 1. Matched filter cross-correlation with down-chirp template
        let ncc = matched_filter_ncc(pcm_buffer, &self.down_chirp);

        // Find correlation peaks exceeding threshold
        let min_dist = self.config.chirp_samples() / 2;
        let peaks = find_correlation_peaks(&ncc, self.config.sync_threshold, min_dist);
        if peaks.is_empty() {
            return None;
        }

        // Use the highest-scoring peak
        let best_peak = peaks
            .into_iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))?;

        let sync_start = best_peak.0;
        let sync_score = best_peak.1;

        let sync_guard_samples = (0.020 * self.config.sample_rate).round() as usize;
        let first_symbol_start = sync_start + m + sync_guard_samples;

        let symbol_total = self.config.symbol_total_samples();
        let symbol_active = self.config.symbol_active_samples();

        let mut symbols = Vec::with_capacity(num_symbols);
        let mut metrics = Vec::with_capacity(num_symbols);
        let mut tracker = SymbolTimingTracker::new(symbol_total);

        for s in 0..num_symbols {
            let nominal_start = first_symbol_start + s * symbol_total;
            let sym_start = tracker.align_symbol_window(pcm_buffer, nominal_start, symbol_active);
            let sym_end = sym_start + symbol_active;

            if sym_end > pcm_buffer.len() {
                // Not enough samples remaining in buffer
                break;
            }

            let slice = &pcm_buffer[sym_start..sym_end];
            let det = detect_mfsk_symbol(slice, &self.candidate_freqs, self.config.sample_rate);

            symbols.push(det.symbol_index as u8);
            metrics.push(det);
        }

        if symbols.is_empty() {
            return None;
        }

        Some(DemodulationOutput {
            symbols,
            sync_sample_index: sync_start,
            sync_correlation: sync_score,
            clock_drift_ppm: tracker.estimated_drift_ppm(),
            metrics,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modulator::Modulator;

    #[test]
    fn test_loopback_phy_clean() {
        let cfg = PhyConfig::audible_robust_48k();
        let modulator = Modulator::new(cfg.clone());
        let demodulator = Demodulator::new(cfg);

        let input_symbols = vec![0, 1, 2, 3, 4, 5, 10, 12, 14, 15];
        let pcm = modulator.modulate(&input_symbols);

        // Prepend some silence to simulate lead-in
        let mut full_pcm = vec![0.0f32; 2400]; // 50 ms silence
        full_pcm.extend_from_slice(&pcm);

        let result = demodulator.demodulate_buffer(&full_pcm, input_symbols.len())
            .expect("Demodulation should succeed on clean modulated PCM");

        assert_eq!(result.symbols, input_symbols, "Demodulated symbols must match input exactly");
        assert!(result.sync_correlation > 0.90, "Sync correlation should be high");
    }

    #[test]
    fn test_loopback_phy_with_awgn_noise() {
        let cfg = PhyConfig::audible_robust_48k();
        let modulator = Modulator::new(cfg.clone());
        let demodulator = Demodulator::new(cfg);

        let input_symbols = vec![15, 14, 13, 12, 7, 8, 3, 2, 1, 0];
        let pcm = modulator.modulate(&input_symbols);

        let mut noisy_pcm = pcm.clone();
        // Add pseudo-random deterministic noise (SNR approx 10 dB)
        for (i, s) in noisy_pcm.iter_mut().enumerate() {
            let n = ((i as f32 * 31.7).sin() * 43758.5453).fract() - 0.5;
            *s += n * 0.15;
        }

        let result = demodulator.demodulate_buffer(&noisy_pcm, input_symbols.len())
            .expect("Demodulation should succeed with 10 dB SNR");

        assert_eq!(result.symbols, input_symbols, "Symbols must withstand 10 dB SNR noise");
    }
}
