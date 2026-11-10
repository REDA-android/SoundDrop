use std::f32::consts::PI;
use crate::window::tukey_window;

/// Evaluates signal power at a target frequency `target_freq` using the Goertzel algorithm.
pub fn goertzel_power(samples: &[f32], target_freq: f32, sample_rate: f32) -> f32 {
    let n = samples.len();
    if n == 0 {
        return 0.0;
    }

    let omega = 2.0 * PI * target_freq / sample_rate;
    let coeff = 2.0 * omega.cos();

    let mut s_prev = 0.0f32;
    let mut s_prev2 = 0.0f32;

    for &x in samples {
        let s = x + coeff * s_prev - s_prev2;
        s_prev2 = s_prev;
        s_prev = s;
    }

    let power = s_prev * s_prev + s_prev2 * s_prev2 - coeff * s_prev * s_prev2;
    power.max(0.0) / (n as f32 * n as f32)
}

/// Generates a single-frequency tone with smooth envelope taper.
pub fn generate_tone(
    frequency: f32,
    sample_rate: f32,
    num_samples: usize,
    taper_alpha: f32,
) -> Vec<f32> {
    if num_samples == 0 {
        return Vec::new();
    }
    let window = tukey_window(num_samples, taper_alpha);
    let mut out = Vec::with_capacity(num_samples);

    for n in 0..num_samples {
        let t = n as f32 / sample_rate;
        let phase = 2.0 * PI * frequency * t;
        out.push(phase.sin() * window[n]);
    }
    out
}

/// Result of demodulating an M-ary FSK symbol.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SymbolDetection {
    /// Index of the winning frequency bin in `0..candidate_freqs.len()`.
    pub symbol_index: usize,
    /// Energy measured in the winning bin.
    pub peak_power: f32,
    /// Ratio of the winning power to the second-highest power. Higher indicates higher confidence.
    pub snr_margin: f32,
}

/// Demodulates an M-FSK symbol from `samples` by testing against `candidate_freqs`.
pub fn detect_mfsk_symbol(
    samples: &[f32],
    candidate_freqs: &[f32],
    sample_rate: f32,
) -> SymbolDetection {
    assert!(!candidate_freqs.is_empty(), "candidate_freqs must not be empty");

    let mut max_idx = 0;
    let mut max_power = -1.0f32;
    let mut second_max_power = 0.0f32;

    for (i, &freq) in candidate_freqs.iter().enumerate() {
        let power = goertzel_power(samples, freq, sample_rate);
        if power > max_power {
            second_max_power = max_power.max(0.0);
            max_power = power;
            max_idx = i;
        } else if power > second_max_power {
            second_max_power = power;
        }
    }

    let snr_margin = if second_max_power > 1e-12 {
        max_power / second_max_power
    } else {
        100.0 // Arbitrary high ceiling when runner-up has zero energy
    };

    SymbolDetection {
        symbol_index: max_idx,
        peak_power: max_power,
        snr_margin,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_goertzel_discrimination() {
        let fs = 48000.0;
        let n_samples = 960; // 20 ms
        let freqs = [1600.0, 1700.0, 1800.0, 1900.0, 2000.0];

        // Synthesize a pure 1800 Hz tone (index 2)
        let tone = generate_tone(1800.0, fs, n_samples, 0.2);

        let det = detect_mfsk_symbol(&tone, &freqs, fs);
        assert_eq!(det.symbol_index, 2, "Must detect 1800 Hz (index 2)");
        assert!(det.snr_margin > 5.0, "SNR margin should be high for clean tone");
    }

    #[test]
    fn test_goertzel_under_noise() {
        let fs = 48000.0;
        let n_samples = 960;
        let freqs = [1600.0, 1800.0, 2000.0, 2200.0];

        // Generate 2000 Hz tone + pseudo-random noise
        let mut tone = generate_tone(2000.0, fs, n_samples, 0.2);

        // Add deterministic perturbation
        for (i, s) in tone.iter_mut().enumerate() {
            let noise = ((i as f32 * 17.0).sin() * 0.3) * 0.2;
            *s += noise;
        }

        let det = detect_mfsk_symbol(&tone, &freqs, fs);
        assert_eq!(det.symbol_index, 2, "Must correctly identify 2000 Hz despite noise");
    }
}
