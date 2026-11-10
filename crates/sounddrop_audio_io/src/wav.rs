use std::path::Path;
use hound::{WavReader, WavSpec, WavWriter};

#[derive(Debug, thiserror::Error)]
pub enum WavIoError {
    #[error("Hound WAV error: {0}")]
    Hound(#[from] hound::Error),
    #[error("Unsupported bits per sample: {0}")]
    UnsupportedBits(u16),
}

/// Writes floating-point audio samples (normalized [-1.0, 1.0]) to a 16-bit PCM WAV file.
pub fn write_wav_file<P: AsRef<Path>>(
    path: P,
    samples: &[f32],
    sample_rate: u32,
) -> Result<(), WavIoError> {
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = WavWriter::create(path, spec)?;
    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let sample_i16 = (clamped * 32767.0).round() as i16;
        writer.write_sample(sample_i16)?;
    }
    writer.finalize()?;
    Ok(())
}

/// Reads a mono or stereo WAV file into normalized floating-point samples [-1.0, 1.0].
/// Automatically mixes down multi-channel audio to mono.
pub fn read_wav_file<P: AsRef<Path>>(path: P) -> Result<(Vec<f32>, u32), WavIoError> {
    let mut reader = WavReader::open(path)?;
    let spec = reader.spec();
    let channels = spec.channels as usize;

    let mut raw_samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .map(|s| s.unwrap_or(0.0))
            .collect(),
        hound::SampleFormat::Int => {
            let max_val = match spec.bits_per_sample {
                16 => 32768.0,
                24 => 8388608.0,
                32 => 2147483648.0,
                bits => return Err(WavIoError::UnsupportedBits(bits)),
            };
            reader
                .samples::<i32>()
                .map(|s| (s.unwrap_or(0) as f32) / max_val)
                .collect()
        }
    };

    // If multi-channel, average into mono
    if channels > 1 {
        let num_frames = raw_samples.len() / channels;
        let mut mono = Vec::with_capacity(num_frames);
        for f in 0..num_frames {
            let mut sum = 0.0f32;
            for ch in 0..channels {
                sum += raw_samples[f * channels + ch];
            }
            mono.push(sum / channels as f32);
        }
        raw_samples = mono;
    }

    Ok((raw_samples, spec.sample_rate))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wav_roundtrip() {
        let tmp_path = "/tmp/sounddrop_test_roundtrip.wav";
        let original_samples: Vec<f32> = (0..4800)
            .map(|i| (i as f32 * 0.05).sin() * 0.8)
            .collect();
        let sample_rate = 48000;

        write_wav_file(tmp_path, &original_samples, sample_rate)
            .expect("Writing WAV must succeed");

        let (read_samples, read_fs) = read_wav_file(tmp_path)
            .expect("Reading WAV must succeed");

        assert_eq!(read_fs, sample_rate);
        assert_eq!(read_samples.len(), original_samples.len());

        // Check 16-bit quantization fidelity (within 1 / 32768 ~ 0.0001)
        for (&orig, &read) in original_samples.iter().zip(read_samples.iter()) {
            assert!((orig - read).abs() < 0.001);
        }

        let _ = std::fs::remove_file(tmp_path);
    }
}
