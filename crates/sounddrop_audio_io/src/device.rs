use miniaudio::{Context, Device, DeviceConfig, DeviceType, Format, ShareMode};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum AudioIoError {
    #[error("Miniaudio error: {0}")]
    Miniaudio(String),
    #[error("Audio device not found: {0}")]
    DeviceNotFound(String),
    #[error("No audio devices available on this system")]
    NoDevicesAvailable,
    #[error("Audio stream error: {0}")]
    StreamError(String),
}

impl From<miniaudio::Error> for AudioIoError {
    fn from(err: miniaudio::Error) -> Self {
        AudioIoError::Miniaudio(format!("{:?}", err))
    }
}

#[derive(Debug, Clone)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

/// Enumerates physical playback devices (speakers, headphones).
pub fn list_playback_devices() -> Result<Vec<AudioDeviceInfo>, AudioIoError> {
    let context = Context::new(&[], None)?;
    let mut result = Vec::new();

    context.with_devices(|playback_devices, _capture_devices| {
        for (i, d) in playback_devices.iter().enumerate() {
            result.push(AudioDeviceInfo {
                name: d.name().to_string(),
                is_default: i == 0,
            });
        }
    })?;

    Ok(result)
}

/// Enumerates physical capture devices (microphones, line-in).
pub fn list_capture_devices() -> Result<Vec<AudioDeviceInfo>, AudioIoError> {
    let context = Context::new(&[], None)?;
    let mut result = Vec::new();

    context.with_devices(|_playback_devices, capture_devices| {
        for (i, d) in capture_devices.iter().enumerate() {
            result.push(AudioDeviceInfo {
                name: d.name().to_string(),
                is_default: i == 0,
            });
        }
    })?;

    Ok(result)
}

/// Plays audio samples through physical speaker hardware synchronously.
pub fn play_samples_blocking(samples: &[f32], sample_rate: u32) -> Result<(), AudioIoError> {
    if samples.is_empty() {
        return Ok(());
    }

    let context = Context::new(&[], None)?;
    let mut has_playback = false;
    context.with_devices(|pb, _| {
        has_playback = !pb.is_empty();
    })?;

    if !has_playback {
        return Err(AudioIoError::NoDevicesAvailable);
    }

    let mut config = DeviceConfig::new(DeviceType::Playback);
    config.playback_mut().set_format(Format::F32);
    config.playback_mut().set_channels(2); // Native Windows stereo
    config.set_sample_rate(sample_rate);
    config.playback_mut().set_share_mode(ShareMode::Shared);

    let samples_arc = Arc::new(samples.to_vec());
    let play_head = Arc::new(Mutex::new(0usize));

    let samples_cb = Arc::clone(&samples_arc);
    let head_cb = Arc::clone(&play_head);

    let mut device = Device::new(Some(context), &config)?;

    let total_samples = samples.len();

    device.set_data_callback(move |_device, output, _input| {
        let Ok(mut head) = head_cb.lock() else { return };
        let bytes = output.as_bytes_mut();
        if bytes.is_empty() {
            return;
        }

        // Each F32 sample is 4 bytes. In stereo, 1 frame = 2 channels * 4 bytes = 8 bytes.
        let bytes_per_frame = 8usize;
        let frames = bytes.len() / bytes_per_frame;

        // Fill buffer directly in native IEEE float32 stereo
        let f32_slice: &mut [f32] = unsafe {
            std::slice::from_raw_parts_mut(bytes.as_mut_ptr() as *mut f32, bytes.len() / 4)
        };

        for f in 0..frames {
            let sample = if *head < samples_cb.len() {
                let s = samples_cb[*head];
                *head += 1;
                s
            } else {
                0.0
            };
            // Duplicate mono signal to both Left and Right channels
            let left_idx = f * 2;
            let right_idx = f * 2 + 1;
            if right_idx < f32_slice.len() {
                f32_slice[left_idx] = sample;
                f32_slice[right_idx] = sample;
            }
        }
    });

    device.start()?;

    // Wait until playback finishes
    loop {
        let current_head = *play_head.lock().unwrap();
        if current_head >= total_samples {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    std::thread::sleep(Duration::from_millis(50));
    device.stop()?;
    Ok(())
}

/// Records audio from physical microphone hardware for `duration_sec`.
pub fn record_samples_blocking(
    duration_sec: f32,
    sample_rate: u32,
) -> Result<Vec<f32>, AudioIoError> {
    let context = Context::new(&[], None)?;
    let mut has_capture = false;
    context.with_devices(|_, cap| {
        has_capture = !cap.is_empty();
    })?;

    if !has_capture {
        return Err(AudioIoError::NoDevicesAvailable);
    }

    let mut config = DeviceConfig::new(DeviceType::Capture);
    config.capture_mut().set_format(Format::F32);
    config.capture_mut().set_channels(1);
    config.set_sample_rate(sample_rate);
    config.capture_mut().set_share_mode(ShareMode::Shared);

    let captured = Arc::new(Mutex::new(Vec::with_capacity(
        (duration_sec * sample_rate as f32) as usize + sample_rate as usize,
    )));

    let captured_cb = Arc::clone(&captured);
    let mut device = Device::new(Some(context), &config)?;

    device.set_data_callback(move |_device, _output, input| {
        let in_slice = input.as_samples::<f32>();
        let mut buf = captured_cb.lock().unwrap();
        buf.extend_from_slice(in_slice);
    });

    device.start()?;
    std::thread::sleep(Duration::from_secs_f32(duration_sec));
    device.stop()?;

    let result = captured.lock().unwrap().clone();
    Ok(result)
}
