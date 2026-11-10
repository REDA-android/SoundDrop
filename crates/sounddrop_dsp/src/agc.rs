/// Adaptive Automatic Gain Control for real-time acoustic input streams.
#[derive(Debug, Clone)]
pub struct Agc {
    target_rms: f32,
    current_gain: f32,
    min_gain: f32,
    max_gain: f32,
    attack_rate: f32,
    decay_rate: f32,
}

impl Agc {
    pub fn new(target_rms: f32, min_gain: f32, max_gain: f32) -> Self {
        Self {
            target_rms: target_rms.clamp(0.01, 0.9),
            current_gain: 1.0,
            min_gain,
            max_gain,
            attack_rate: 0.05, // Fast response to loud inputs
            decay_rate: 0.005, // Slower gain recovery
        }
    }

    /// Processes a block of samples in-place, updating gain smoothly.
    pub fn process(&mut self, samples: &mut [f32]) {
        if samples.is_empty() {
            return;
        }

        let energy: f32 = samples.iter().map(|&x| x * x).sum();
        let rms = (energy / samples.len() as f32).sqrt().max(1e-6);

        // Desired gain to bring rms to target_rms
        let desired_gain = (self.target_rms / rms).clamp(self.min_gain, self.max_gain);

        // Exponential smoothing
        let rate = if desired_gain < self.current_gain {
            self.attack_rate
        } else {
            self.decay_rate
        };
        self.current_gain += rate * (desired_gain - self.current_gain);

        // Apply gain and soft-limit with tanh to prevent overflow
        for s in samples.iter_mut() {
            *s = (*s * self.current_gain).tanh();
        }
    }

    pub fn current_gain(&self) -> f32 {
        self.current_gain
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agc_boosts_quiet_signal() {
        let mut agc = Agc::new(0.3, 0.1, 50.0);
        let mut block = vec![0.005f32; 100];

        // Process multiple fresh quiet blocks to let gain ramp up
        for _ in 0..100 {
            block.fill(0.005);
            agc.process(&mut block);
        }

        assert!(agc.current_gain() > 5.0, "Gain should have adapted upwards for quiet signal, got {}", agc.current_gain());
        let final_amp = block[50].abs();
        assert!(final_amp > 0.1, "Processed signal should be amplified towards target");
    }
}
