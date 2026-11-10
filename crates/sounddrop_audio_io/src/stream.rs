use crate::device::AudioIoError;
use miniaudio::{Context, Device, DeviceConfig, DeviceType, Format, ShareMode};
use ringbuf::traits::{Consumer, Producer, Split};
use ringbuf::HeapRb;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Native platform audio operating profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlatformAudioProfile {
    /// Default desktop OS audio configuration.
    DesktopDefault,
    /// Low-latency, raw direct audio stream (WASAPI raw / ALSA direct / PipeWire bypass).
    DesktopLowLatencyRaw,
    /// Android Google Oboe / AAudio low-latency, unprocessed input preset.
    AndroidOboeLowLatency,
    /// iOS CoreAudio measurement mode (AVAudioSessionModeMeasurement) disabling system AGC & speech filters.
    IosMeasurementMode,
}

impl Default for PlatformAudioProfile {
    fn default() -> Self {
        #[cfg(target_os = "android")]
        {
            PlatformAudioProfile::AndroidOboeLowLatency
        }
        #[cfg(target_os = "ios")]
        {
            PlatformAudioProfile::IosMeasurementMode
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            PlatformAudioProfile::DesktopLowLatencyRaw
        }
    }
}

/// Configuration settings for a native audio stream.
#[derive(Debug, Clone)]
pub struct AudioStreamConfig {
    pub sample_rate: u32,
    pub channels: u16,
    pub buffer_frames: u32,
    pub profile: PlatformAudioProfile,
}

impl Default for AudioStreamConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000,
            channels: 1,
            buffer_frames: 480, // 10ms at 48kHz
            profile: PlatformAudioProfile::default(),
        }
    }
}

/// Real-time audio signal levels and health metrics.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AudioMeter {
    /// Peak amplitude in decibels relative to full scale (-inf to 0.0 dBFS)
    pub peak_dbfs: f32,
    /// Root Mean Square (RMS) energy in decibels (-inf to 0.0 dBFS)
    pub rms_dbfs: f32,
    /// True if digital clipping (>= 0.999 amplitude) was detected
    pub is_clipping: bool,
}

impl Default for AudioMeter {
    fn default() -> Self {
        Self {
            peak_dbfs: -96.0,
            rms_dbfs: -96.0,
            is_clipping: false,
        }
    }
}

impl AudioMeter {
    pub fn compute_from_samples(samples: &[f32]) -> Self {
        if samples.is_empty() {
            return Self::default();
        }

        let mut peak = 0.0f32;
        let mut sum_sq = 0.0f32;
        let mut clipping = false;

        for &s in samples {
            let abs_s = s.abs();
            if abs_s > peak {
                peak = abs_s;
            }
            if abs_s >= 0.999 {
                clipping = true;
            }
            sum_sq += s * s;
        }

        let rms = (sum_sq / samples.len() as f32).sqrt();

        let peak_dbfs = if peak > 1e-5 {
            20.0 * peak.log10()
        } else {
            -96.0
        };

        let rms_dbfs = if rms > 1e-5 {
            20.0 * rms.log10()
        } else {
            -96.0
        };

        Self {
            peak_dbfs: peak_dbfs.clamp(-96.0, 0.0),
            rms_dbfs: rms_dbfs.clamp(-96.0, 0.0),
            is_clipping: clipping,
        }
    }
}

/// Real-time continuous audio capture engine feeding a lock-free ring buffer.
pub struct ContinuousAudioCapture {
    consumer: <HeapRb<f32> as Split>::Cons,
    device: Option<Device>,
    is_active: Arc<AtomicBool>,
    sample_rate: u32,
    meter: Arc<std::sync::Mutex<AudioMeter>>,
}

impl ContinuousAudioCapture {
    /// Starts a continuous microphone capture stream using low-latency platform settings.
    pub fn start(config: AudioStreamConfig) -> Result<Self, AudioIoError> {
        let context = Context::new(&[], None)?;
        let mut has_capture = false;
        context.with_devices(|_, cap| {
            has_capture = !cap.is_empty();
        })?;

        if !has_capture {
            return Err(AudioIoError::NoDevicesAvailable);
        }

        // 1-second capacity ringbuffer for real-time sample buffering
        let ring_capacity = config.sample_rate as usize;
        let rb = HeapRb::<f32>::new(ring_capacity);
        let (mut producer, consumer) = rb.split();

        let mut dev_cfg = DeviceConfig::new(DeviceType::Capture);
        dev_cfg.capture_mut().set_format(Format::F32);
        dev_cfg.capture_mut().set_channels(config.channels as u32);
        dev_cfg.set_sample_rate(config.sample_rate);
        dev_cfg.set_period_size_in_frames(config.buffer_frames);

        match config.profile {
            PlatformAudioProfile::DesktopLowLatencyRaw => {
                dev_cfg.capture_mut().set_share_mode(ShareMode::Shared);
            }
            PlatformAudioProfile::AndroidOboeLowLatency | PlatformAudioProfile::IosMeasurementMode => {
                dev_cfg.capture_mut().set_share_mode(ShareMode::Shared);
            }
            PlatformAudioProfile::DesktopDefault => {
                dev_cfg.capture_mut().set_share_mode(ShareMode::Shared);
            }
        }

        let is_active = Arc::new(AtomicBool::new(true));
        let is_active_cb = Arc::clone(&is_active);

        let meter = Arc::new(std::sync::Mutex::new(AudioMeter::default()));
        let meter_cb = Arc::clone(&meter);

        let mut device = Device::new(Some(context), &dev_cfg)?;

        device.set_data_callback(move |_device, _output, input| {
            if !is_active_cb.load(Ordering::Relaxed) {
                return;
            }

            let in_slice = input.as_samples::<f32>();
            if !in_slice.is_empty() {
                // Update live meter
                let m = AudioMeter::compute_from_samples(in_slice);
                if let Ok(mut current_meter) = meter_cb.try_lock() {
                    *current_meter = m;
                }

                // Push samples into lock-free ringbuffer
                for &sample in in_slice {
                    let _ = producer.try_push(sample);
                }
            }
        });

        device.start()?;

        Ok(Self {
            consumer,
            device: Some(device),
            is_active,
            sample_rate: config.sample_rate,
            meter,
        })
    }

    /// Reads all currently available samples from the lock-free ringbuffer without blocking.
    pub fn read_available(&mut self) -> Vec<f32> {
        let mut samples = Vec::new();
        while let Some(s) = self.consumer.try_pop() {
            samples.push(s);
        }
        samples
    }

    /// Reads up to `max_samples` into a caller-provided destination slice.
    pub fn read_into(&mut self, out: &mut [f32]) -> usize {
        let mut count = 0;
        for target in out.iter_mut() {
            if let Some(s) = self.consumer.try_pop() {
                *target = s;
                count += 1;
            } else {
                break;
            }
        }
        count
    }

    /// Returns the latest real-time audio meter measurement (Peak dBFS, RMS dBFS, clipping).
    pub fn meter(&self) -> AudioMeter {
        self.meter.lock().map(|m| *m).unwrap_or_default()
    }

    pub fn is_active(&self) -> bool {
        self.is_active.load(Ordering::Relaxed)
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Stops the capture stream and releases native device hardware resources.
    pub fn stop(&mut self) {
        self.is_active.store(false, Ordering::Relaxed);
        if let Some(dev) = self.device.take() {
            let _ = dev.stop();
        }
    }
}

impl Drop for ContinuousAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_meter_computation() {
        // Silence
        let silence = vec![0.0f32; 480];
        let m_silence = AudioMeter::compute_from_samples(&silence);
        assert_eq!(m_silence.peak_dbfs, -96.0);
        assert_eq!(m_silence.rms_dbfs, -96.0);
        assert!(!m_silence.is_clipping);

        // Half-scale sine tone
        let mut half_scale = Vec::with_capacity(480);
        for i in 0..480 {
            let s = 0.5 * (2.0 * std::f32::consts::PI * 1000.0 * (i as f32 / 48000.0)).sin();
            half_scale.push(s);
        }
        let m_half = AudioMeter::compute_from_samples(&half_scale);
        assert!(m_half.peak_dbfs > -6.5 && m_half.peak_dbfs < -5.5);
        assert!(m_half.rms_dbfs > -9.5 && m_half.rms_dbfs < -8.5);
        assert!(!m_half.is_clipping);

        // Clipping pulse
        let clipping_signal = vec![1.0f32, -1.0f32, 0.5f32];
        let m_clip = AudioMeter::compute_from_samples(&clipping_signal);
        assert!(m_clip.is_clipping);
        assert_eq!(m_clip.peak_dbfs, 0.0);
    }

    #[test]
    fn test_ringbuf_sample_exchange() {
        let rb = HeapRb::<f32>::new(1024);
        let (mut producer, mut consumer) = rb.split();

        let samples = [0.1f32, 0.2, 0.3, 0.4, 0.5];
        for &s in &samples {
            assert!(producer.try_push(s).is_ok());
        }

        let mut read_buf = [0.0f32; 10];
        let mut read_count = 0;
        for slot in read_buf.iter_mut() {
            if let Some(val) = consumer.try_pop() {
                *slot = val;
                read_count += 1;
            } else {
                break;
            }
        }

        assert_eq!(read_count, 5);
        assert_eq!(&read_buf[..5], &samples);
    }
}
