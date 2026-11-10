use sounddrop_audio_io::{play_samples_blocking, record_samples_blocking, write_wav_file, read_wav_file, AudioIoError, WavIoError};
use sounddrop_link::{Frame, FrameError, FrameType, LinkEngine};
use sounddrop_phy::{Demodulator, Modulator, PhyConfig};
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("Framing or link error: {0}")]
    Link(#[from] FrameError),
    #[error("Audio I/O error: {0}")]
    AudioIo(#[from] AudioIoError),
    #[error("WAV file error: {0}")]
    Wav(#[from] WavIoError),
    #[error("No acoustic preamble/sync detected in audio stream")]
    SyncNotFound,
}

/// Metadata and payload of a verified frame received over acoustic physical channel.
#[derive(Debug, Clone)]
pub struct ReceptionReport {
    pub frame: Frame,
    pub errors_corrected_by_fec: usize,
    pub sync_correlation: f32,
    pub avg_symbol_snr_margin: f32,
    pub clock_drift_ppm: f32,
}

/// Top-level SoundDrop Transmitter.
pub struct AcousticTransmitter {
    config: PhyConfig,
    modulator: Modulator,
    link_engine: LinkEngine,
}

impl AcousticTransmitter {
    pub fn new(config: PhyConfig) -> Self {
        let modulator = Modulator::new(config.clone());
        let link_engine = LinkEngine::default();
        Self {
            config,
            modulator,
            link_engine,
        }
    }

    pub fn config(&self) -> &PhyConfig {
        &self.config
    }

    /// Encodes a data payload into PCM audio samples.
    pub fn encode_payload(&self, payload: &[u8], seq_num: u8) -> Result<Vec<f32>, CoreError> {
        let frame = Frame {
            frame_type: FrameType::Data,
            seq_num,
            payload: payload.to_vec(),
        };

        let symbols = self.link_engine.frame_to_symbols(&frame)?;
        let pcm = self.modulator.modulate(&symbols);
        Ok(pcm)
    }

    /// Encodes and plays the acoustic frame directly through physical speaker hardware.
    pub fn transmit_airgap(&self, payload: &[u8], seq_num: u8) -> Result<(), CoreError> {
        let pcm = self.encode_payload(payload, seq_num)?;
        play_samples_blocking(&pcm, self.config.sample_rate as u32)?;
        Ok(())
    }

    /// Encodes and exports the acoustic signal as a WAV file.
    pub fn transmit_to_wav<P: AsRef<Path>>(
        &self,
        payload: &[u8],
        seq_num: u8,
        path: P,
    ) -> Result<(), CoreError> {
        let pcm = self.encode_payload(payload, seq_num)?;
        write_wav_file(path, &pcm, self.config.sample_rate as u32)?;
        Ok(())
    }
}

/// Top-level SoundDrop Receiver.
pub struct AcousticReceiver {
    config: PhyConfig,
    demodulator: Demodulator,
    link_engine: LinkEngine,
}

impl AcousticReceiver {
    pub fn new(config: PhyConfig) -> Self {
        let demodulator = Demodulator::new(config.clone());
        let link_engine = LinkEngine::default();
        Self {
            config,
            demodulator,
            link_engine,
        }
    }

    pub fn config(&self) -> &PhyConfig {
        &self.config
    }

    /// Demodulates and verifies a frame from a PCM audio buffer.
    pub fn decode_pcm(&self, pcm: &[f32]) -> Result<ReceptionReport, CoreError> {
        // Upper bound on symbols: (MAX_PAYLOAD_LEN + Header + CRC + Parity + Padding) * 2
        let max_symbols = 120;
        let output = self
            .demodulator
            .demodulate_buffer(pcm, max_symbols)
            .ok_or(CoreError::SyncNotFound)?;

        let (frame, errors_fixed) = self.link_engine.symbols_to_frame(&output.symbols)?;

        let avg_snr = if !output.metrics.is_empty() {
            output.metrics.iter().map(|m| m.snr_margin).sum::<f32>() / output.metrics.len() as f32
        } else {
            0.0
        };

        Ok(ReceptionReport {
            frame,
            errors_corrected_by_fec: errors_fixed,
            sync_correlation: output.sync_correlation,
            avg_symbol_snr_margin: avg_snr,
            clock_drift_ppm: output.clock_drift_ppm,
        })
    }

    /// Reads and decodes an acoustic signal from a WAV file.
    pub fn decode_wav<P: AsRef<Path>>(&self, path: P) -> Result<ReceptionReport, CoreError> {
        let (samples, sample_rate) = read_wav_file(path)?;
        if (sample_rate as f32 - self.config.sample_rate).abs() > 1.0 {
            log::warn!(
                "Sample rate mismatch: WAV is {} Hz, receiver configured for {} Hz",
                sample_rate,
                self.config.sample_rate
            );
        }
        self.decode_pcm(&samples)
    }

    /// Records audio from physical microphone hardware for `duration_sec` and decodes any received frame.
    pub fn receive_airgap(&self, duration_sec: f32) -> Result<ReceptionReport, CoreError> {
        let samples = record_samples_blocking(duration_sec, self.config.sample_rate as u32)?;
        self.decode_pcm(&samples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_core_end_to_end_transmission() {
        let cfg = PhyConfig::audible_robust_48k();
        let tx = AcousticTransmitter::new(cfg.clone());
        let rx = AcousticReceiver::new(cfg);

        let test_message = b"SOUNDDROP_AIRGAP_TEST";
        let pcm = tx.encode_payload(test_message, 7).expect("Encoding failed");

        // Prepend and append silence to simulate realistic capture lead-in/lead-out
        let mut air_pcm = vec![0.0f32; 4800]; // 100 ms silence
        air_pcm.extend_from_slice(&pcm);
        air_pcm.resize(air_pcm.len() + 4800, 0.0);

        let report = rx.decode_pcm(&air_pcm).expect("Decoding failed");

        assert_eq!(report.frame.payload, test_message);
        assert_eq!(report.frame.seq_num, 7);
        assert_eq!(report.errors_corrected_by_fec, 0);
        assert!(report.sync_correlation > 0.85);
    }

    #[test]
    fn test_core_wav_persistence_roundtrip() {
        let tmp_wav = "/tmp/sounddrop_core_test.wav";
        let cfg = PhyConfig::audible_robust_48k();
        let tx = AcousticTransmitter::new(cfg.clone());
        let rx = AcousticReceiver::new(cfg);

        let test_message = b"FILE_WAV_ROUNDTRIP_OK";
        tx.transmit_to_wav(test_message, 42, tmp_wav).expect("WAV write failed");

        let report = rx.decode_wav(tmp_wav).expect("WAV decode failed");
        assert_eq!(report.frame.payload, test_message);
        assert_eq!(report.frame.seq_num, 42);

        let _ = std::fs::remove_file(tmp_wav);
    }

    #[test]
    fn test_core_recovers_from_acoustic_click_burst() {
        let cfg = PhyConfig::audible_robust_48k();
        let tx = AcousticTransmitter::new(cfg.clone());
        let rx = AcousticReceiver::new(cfg);

        let test_message = b"RESILIENT_BURST_MSG";
        let mut pcm = tx.encode_payload(test_message, 12).unwrap();

        // Simulate a loud acoustic click/spike halfway through the audio
        let mid = pcm.len() / 2;
        for i in mid..mid + 200 {
            if i < pcm.len() {
                pcm[i] = 1.0; // Hard saturation click
            }
        }

        let report = rx.decode_pcm(&pcm).expect("Should recover despite burst click");
        assert_eq!(report.frame.payload, test_message);
        assert_eq!(report.frame.seq_num, 12);
    }
}
