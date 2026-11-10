/// Configuration profile for the acoustic Physical Layer (PHY).
#[derive(Debug, Clone, PartialEq)]
pub struct PhyConfig {
    /// Audio sample rate in Hz (e.g. 48000.0 or 44100.0).
    pub sample_rate: f32,
    /// Base frequency for symbol 0 in Hz.
    pub base_freq: f32,
    /// Frequency spacing between adjacent M-FSK symbols in Hz.
    pub freq_step: f32,
    /// Number of distinct tones (e.g. 16 for 4-bit nibbles).
    pub num_tones: usize,
    /// Total duration of one symbol (active tone + guard interval) in seconds.
    pub symbol_duration: f32,
    /// Active tone duty cycle fraction (e.g. 0.75 means 75% tone, 25% reverberation decay guard).
    pub tone_duty_cycle: f32,
    /// Preamble up-chirp start frequency in Hz.
    pub chirp_f_start: f32,
    /// Preamble up-chirp end frequency in Hz.
    pub chirp_f_end: f32,
    /// Duration of each preamble/sync chirp in seconds.
    pub chirp_duration: f32,
    /// Number of up-chirps in preamble.
    pub preamble_up_chirps: usize,
    /// Detection threshold for normalized cross-correlation peak [0.0, 1.0].
    pub sync_threshold: f32,
}

impl Default for PhyConfig {
    /// Standard Audible Profile:
    /// - 16-FSK: 1600 Hz - 3100 Hz (100 Hz steps).
    /// - Chirp sweep: 1500 Hz to 3500 Hz.
    /// - Symbol duration: 40 ms (30 ms tone, 10 ms echo guard).
    /// - Effective raw symbol rate: 25 baud = 100 bps.
    fn default() -> Self {
        Self::audible_robust_48k()
    }
}

impl PhyConfig {
    /// Profile engineered for maximum robustness on consumer laptop speakers and microphones at 48 kHz.
    pub fn audible_robust_48k() -> Self {
        Self {
            sample_rate: 48000.0,
            base_freq: 1600.0,
            freq_step: 100.0,
            num_tones: 16,
            symbol_duration: 0.040, // 40 ms per symbol
            tone_duty_cycle: 0.75,   // 30 ms tone, 10 ms silence guard
            chirp_f_start: 1500.0,
            chirp_f_end: 3500.0,
            chirp_duration: 0.080,  // 80 ms per chirp
            preamble_up_chirps: 2,
            sync_threshold: 0.60,
        }
    }

    /// Profile for 44.1 kHz sample rate.
    pub fn audible_robust_44k() -> Self {
        let mut cfg = Self::audible_robust_48k();
        cfg.sample_rate = 44100.0;
        cfg
    }

    /// Near-Ultrasonic profile (18.0 kHz to 20.0 kHz) for stealth transmission where hardware allows.
    pub fn ultrasonic_stealth_48k() -> Self {
        Self {
            sample_rate: 48000.0,
            base_freq: 18000.0,
            freq_step: 120.0,
            num_tones: 16,
            symbol_duration: 0.040,
            tone_duty_cycle: 0.75,
            chirp_f_start: 17500.0,
            chirp_f_end: 20500.0,
            chirp_duration: 0.080,
            preamble_up_chirps: 2,
            sync_threshold: 0.55,
        }
    }

    /// Candidate frequencies for the M-FSK alphabet.
    pub fn candidate_frequencies(&self) -> Vec<f32> {
        (0..self.num_tones)
            .map(|i| self.base_freq + (i as f32 * self.freq_step))
            .collect()
    }

    pub fn symbol_total_samples(&self) -> usize {
        (self.symbol_duration * self.sample_rate).round() as usize
    }

    pub fn symbol_active_samples(&self) -> usize {
        (self.symbol_duration * self.tone_duty_cycle * self.sample_rate).round() as usize
    }

    pub fn chirp_samples(&self) -> usize {
        (self.chirp_duration * self.sample_rate).round() as usize
    }
}
