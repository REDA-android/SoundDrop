/// Real-time symbol timing recovery and sampling frequency offset (SFO) tracking.
///
/// Hardware sound cards on consumer devices (smartphones, laptops) exhibit oscillator drift
/// typically between ±10 PPM and ±100 PPM. Over long acoustic transmissions, nominal
/// sample counting causes symbol boundary misalignment.
///
/// This tracker uses an Early-Prompt-Late energy discriminator to dynamically center the
/// demodulation window on the true symbol energy centroid, compensating for clock drift.
#[derive(Debug, Clone)]
pub struct SymbolTimingTracker {
    nominal_symbol_len: usize,
    accumulated_drift_samples: isize,
    symbols_tracked: usize,
}

impl SymbolTimingTracker {
    pub fn new(nominal_symbol_len: usize) -> Self {
        Self {
            nominal_symbol_len,
            accumulated_drift_samples: 0,
            symbols_tracked: 0,
        }
    }

    /// Finds the optimal symbol start sample around `expected_start`.
    ///
    /// Evaluates signal energy at Early (-offset), Prompt (0), and Late (+offset) offsets
    /// to determine whether symbol energy is leading or lagging, adjusting the tracking window.
    pub fn align_symbol_window(
        &mut self,
        pcm: &[f32],
        expected_start: usize,
        active_len: usize,
    ) -> usize {
        let search_radius = 4isize;
        let base_start = (expected_start as isize + self.accumulated_drift_samples).max(0);

        // Energy at the current (prompt) position. The tracker only moves when another
        // offset is clearly better; on a flat energy profile (clean tones with a wide
        // plateau) this prevents a spurious random-walk drift estimate.
        let prompt_energy = if base_start as usize + active_len <= pcm.len() {
            Self::compute_energy(&pcm[base_start as usize..base_start as usize + active_len])
        } else {
            0.0
        };
        let mut best_offset = 0isize;
        let mut best_energy = prompt_energy * 1.02;

        for offset in -search_radius..=search_radius {
            let start = base_start + offset;
            if start < 0 || (start as usize + active_len) > pcm.len() {
                continue;
            }
            let energy = Self::compute_energy(&pcm[start as usize..start as usize + active_len]);
            if energy > best_energy {
                best_energy = energy;
                best_offset = offset;
            }
        }

        self.accumulated_drift_samples += best_offset;
        self.symbols_tracked += 1;

        (expected_start as isize + self.accumulated_drift_samples).max(0) as usize
    }

    /// Returns the accumulated sample drift offset.
    pub fn accumulated_drift(&self) -> isize {
        self.accumulated_drift_samples
    }

    /// Estimates the relative clock drift between transmitter and receiver in Parts Per Million (PPM).
    pub fn estimated_drift_ppm(&self) -> f32 {
        if self.symbols_tracked == 0 || self.nominal_symbol_len == 0 {
            return 0.0;
        }
        let total_samples = (self.symbols_tracked * self.nominal_symbol_len) as f32;
        (self.accumulated_drift_samples as f32 / total_samples) * 1_000_000.0
    }

    pub fn reset(&mut self) {
        self.accumulated_drift_samples = 0;
        self.symbols_tracked = 0;
    }

    fn compute_energy(slice: &[f32]) -> f32 {
        slice.iter().map(|&x| x * x).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timing_tracker_tracks_late_drift() {
        let mut tracker = SymbolTimingTracker::new(200);
        let symbol_len = 200;
        let active_len = 160;

        // Generate a synthetic buffer where pulses arrive 2 samples later each step
        let total_symbols = 10;
        let mut pcm = vec![0.0f32; total_symbols * (symbol_len + 5)];

        for s in 0..total_symbols {
            // Intentionally delayed pulse (+2 samples per symbol)
            let true_start = s * symbol_len + (s * 2) + 10;
            for i in 0..active_len {
                if true_start + i < pcm.len() {
                    pcm[true_start + i] = 1.0;
                }
            }
        }

        // Trace tracking performance
        for s in 0..total_symbols {
            let nominal_start = s * symbol_len + 10;
            let aligned = tracker.align_symbol_window(&pcm, nominal_start, active_len);
            let true_start = s * symbol_len + (s * 2) + 10;
            // The tracker should follow the positive drift direction
            let error = (aligned as isize - true_start as isize).abs();
            assert!(error <= 4, "Tracker error too large: {} at symbol {}", error, s);
        }

        assert!(tracker.accumulated_drift() > 0, "Tracker must record positive drift");
        assert!(tracker.estimated_drift_ppm() > 0.0);
    }
}
