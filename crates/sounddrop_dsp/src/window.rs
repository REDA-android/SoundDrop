use std::f32::consts::PI;

/// Generates a Hann window of length `n`.
pub fn hann_window(n: usize) -> Vec<f32> {
    if n == 0 {
        return Vec::new();
    }
    if n == 1 {
        return vec![1.0];
    }
    (0..n)
        .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f32 / (n - 1) as f32).cos()))
        .collect()
}

/// Generates a Tukey (tapered cosine) window of length `n` with taper ratio `alpha` in [0, 1].
/// - `alpha = 0` corresponds to a rectangular window.
/// - `alpha = 1` corresponds to a Hann window.
/// - A typical value like 0.1 or 0.2 provides smooth onset/offset without attenuating the body.
pub fn tukey_window(n: usize, alpha: f32) -> Vec<f32> {
    if n == 0 {
        return Vec::new();
    }
    if n == 1 {
        return vec![1.0];
    }
    let alpha = alpha.clamp(0.0, 1.0);
    if alpha <= 0.0 {
        return vec![1.0; n];
    }

    let edge_len = (alpha * (n - 1) as f32 / 2.0).round() as usize;
    let mut w = vec![1.0; n];

    for i in 0..edge_len {
        let val = 0.5 * (1.0 - (PI * i as f32 / edge_len as f32).cos());
        w[i] = val;
        w[n - 1 - i] = val;
    }

    w
}

/// Applies a window in-place to a slice of audio samples.
pub fn apply_window(samples: &mut [f32], window: &[f32]) {
    assert_eq!(samples.len(), window.len(), "Sample buffer and window length must match");
    for (s, w) in samples.iter_mut().zip(window.iter()) {
        *s *= *w;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hann_symmetry() {
        let w = hann_window(101);
        assert_eq!(w.len(), 101);
        assert!((w[0] - 0.0).abs() < 1e-6);
        assert!((w[100] - 0.0).abs() < 1e-6);
        assert!((w[50] - 1.0).abs() < 1e-6);
        for i in 0..50 {
            assert!((w[i] - w[100 - i]).abs() < 1e-6);
        }
    }

    #[test]
    fn test_tukey_window() {
        let w = tukey_window(100, 0.2);
        assert_eq!(w.len(), 100);
        // Center portion should be 1.0
        assert_eq!(w[50], 1.0);
        assert_eq!(w[30], 1.0);
        assert_eq!(w[70], 1.0);
        // Edges should taper toward 0.0
        assert!(w[0] < 0.1);
        assert!(w[99] < 0.1);
    }
}
