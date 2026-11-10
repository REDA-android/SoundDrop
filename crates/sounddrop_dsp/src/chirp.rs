use std::f32::consts::PI;
use crate::window::tukey_window;

/// Generates a Linear Frequency Modulated (LFM) chirp.
/// - `f_start`: Start frequency in Hz (e.g. 1500.0)
/// - `f_end`: End frequency in Hz (e.g. 3500.0 for up-chirp, 1500.0 for down-chirp)
/// - `sample_rate`: Audio sampling rate in Hz (e.g. 48000.0)
/// - `num_samples`: Total duration in samples
/// - `taper_alpha`: Tukey window taper parameter (e.g. 0.1 for gentle roll-off at edges)
pub fn generate_linear_chirp(
    f_start: f32,
    f_end: f32,
    sample_rate: f32,
    num_samples: usize,
    taper_alpha: f32,
) -> Vec<f32> {
    if num_samples == 0 {
        return Vec::new();
    }

    let duration_sec = num_samples as f32 / sample_rate;
    let k = (f_end - f_start) / duration_sec;
    let window = tukey_window(num_samples, taper_alpha);

    let mut samples = Vec::with_capacity(num_samples);
    for n in 0..num_samples {
        let t = n as f32 / sample_rate;
        // Phase integral of f(t) = f0 + k*t is phi(t) = 2*pi*(f0*t + 0.5*k*t^2)
        let phase = 2.0 * PI * (f_start * t + 0.5 * k * t * t);
        let sample = phase.sin() * window[n];
        samples.push(sample);
    }

    samples
}

/// Computes the Normalized Cross-Correlation (NCC) between `signal` and `template`.
///
/// Output length is `signal.len().saturating_sub(template.len()) + 1`.
/// The value at index `i` is the normalized correlation score in [-1.0, 1.0]
/// when the template is placed starting at `signal[i]`.
pub fn matched_filter_ncc(signal: &[f32], template: &[f32]) -> Vec<f32> {
    let m = template.len();
    let n = signal.len();
    if n < m || m == 0 {
        return Vec::new();
    }

    let template_energy: f32 = template.iter().map(|&x| x * x).sum();
    if template_energy < 1e-12 {
        return vec![0.0; n - m + 1];
    }

    let out_len = n - m + 1;
    let mut ncc = Vec::with_capacity(out_len);

    // Initial window energy
    let mut win_energy: f32 = signal[0..m].iter().map(|&x| x * x).sum();

    for i in 0..out_len {
        // Dot product between signal window and template
        let dot: f32 = signal[i..i + m]
            .iter()
            .zip(template.iter())
            .map(|(&x, &h)| x * h)
            .sum();

        let denom = (win_energy * template_energy).sqrt();
        let score = if denom > 1e-9 {
            (dot / denom).clamp(-1.0, 1.0)
        } else {
            0.0
        };
        ncc.push(score);

        // Slide window energy forward
        if i + m < n {
            let exiting = signal[i];
            let entering = signal[i + m];
            win_energy = (win_energy - exiting * exiting + entering * entering).max(0.0);
        }
    }

    ncc
}

/// Identifies prominent local peaks in a correlation vector that exceed `threshold`.
/// Ensures peaks are separated by at least `min_distance` samples.
/// Returns a list of `(sample_index, peak_score)` pairs sorted by sample index.
pub fn find_correlation_peaks(
    correlation: &[f32],
    threshold: f32,
    min_distance: usize,
) -> Vec<(usize, f32)> {
    let mut raw_peaks = Vec::new();

    if correlation.len() < 3 {
        return raw_peaks;
    }

    for i in 1..correlation.len() - 1 {
        let val = correlation[i];
        if val >= threshold && val > correlation[i - 1] && val >= correlation[i + 1] {
            raw_peaks.push((i, val));
        }
    }

    // Suppress non-maximum peaks within min_distance
    let mut filtered_peaks: Vec<(usize, f32)> = Vec::new();
    for (idx, score) in raw_peaks {
        if let Some(last) = filtered_peaks.last_mut() {
            if idx - last.0 < min_distance {
                if score > last.1 {
                    *last = (idx, score);
                }
                continue;
            }
        }
        filtered_peaks.push((idx, score));
    }

    filtered_peaks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chirp_correlation_peak() {
        let fs = 48000.0;
        let chirp_len = 960; // 20 ms
        let up_chirp = generate_linear_chirp(1500.0, 3500.0, fs, chirp_len, 0.1);
        let down_chirp = generate_linear_chirp(3500.0, 1500.0, fs, chirp_len, 0.1);

        // Construct signal: silence, up-chirp at index 500, silence, down-chirp at index 2000
        let mut signal = vec![0.0f32; 4000];
        signal[500..500 + chirp_len].copy_from_slice(&up_chirp);
        signal[2000..2000 + chirp_len].copy_from_slice(&down_chirp);

        // Correlate with up-chirp template
        let ncc_up = matched_filter_ncc(&signal, &up_chirp);
        let peaks_up = find_correlation_peaks(&ncc_up, 0.8, 100);

        assert_eq!(peaks_up.len(), 1, "Should find exactly 1 up-chirp peak");
        assert_eq!(peaks_up[0].0, 500, "Peak must be at exact insertion index 500");
        assert!(peaks_up[0].1 > 0.95, "Peak score should be > 0.95 for identical wave");

        // Correlate with down-chirp template
        let ncc_down = matched_filter_ncc(&signal, &down_chirp);
        let peaks_down = find_correlation_peaks(&ncc_down, 0.8, 100);

        assert_eq!(peaks_down.len(), 1, "Should find exactly 1 down-chirp peak");
        assert_eq!(peaks_down[0].0, 2000, "Down peak must be at exact index 2000");
        assert!(peaks_down[0].1 > 0.95, "Peak score should be > 0.95");
    }

    #[test]
    fn test_chirp_orthogonality() {
        let fs = 48000.0;
        let chirp_len = 960;
        let up_chirp = generate_linear_chirp(1500.0, 3500.0, fs, chirp_len, 0.1);
        let down_chirp = generate_linear_chirp(3500.0, 1500.0, fs, chirp_len, 0.1);

        // Correlating up-chirp with down-chirp should yield low cross-correlation
        let ncc = matched_filter_ncc(&up_chirp, &down_chirp);
        for &val in &ncc {
            assert!(val.abs() < 0.35, "Cross-correlation between up and down chirp must be low (< 0.35), got {}", val);
        }
    }
}
