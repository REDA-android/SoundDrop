//! Audio I/O layer for Sound Drop v2
//! Compliant with:
//! - 48 kHz mono capture / playback
//! - Lock-free zero-allocation audio callbacks via `rtrb::RingBuffer`
//! - Software Reception-Only mode (Data Diode: no output stream opened)
//! - Loopback and hardware stream management

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleRate, Stream, StreamConfig};
use rtrb::{Consumer, Producer, RingBuffer};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AudioError {
    #[error("Default input device not found")]
    NoInputDevice,
    #[error("Default output device not found")]
    NoOutputDevice,
    #[error("CPAL device error: {0}")]
    CpalDeviceError(#[from] cpal::DevicesError),
    #[error("CPAL stream error: {0}")]
    CpalStreamError(#[from] cpal::BuildStreamError),
    #[error("CPAL play error: {0}")]
    CpalPlayError(#[from] cpal::PlayStreamError),
    #[error("Software diode active: output stream creation is forbidden")]
    SoftwareDiodeActive,
}

pub const DEFAULT_SAMPLE_RATE: u32 = 48000;
pub const RING_BUFFER_CAPACITY: usize = 48000 * 2; // 2 seconds of 48 kHz f32 audio

/// Creates a lock-free SPSC ring buffer for audio samples
pub fn create_audio_ring_buffer(capacity: usize) -> (Producer<f32>, Consumer<f32>) {
    RingBuffer::new(capacity)
}

/// Software Data Diode setting: strictly guarantees reception-only mode by never opening an output stream
#[derive(Clone, Debug)]
pub struct SoftwareDiode {
    rx_only: Arc<AtomicBool>,
}

impl SoftwareDiode {
    pub fn new(rx_only: bool) -> Self {
        Self {
            rx_only: Arc::new(AtomicBool::new(rx_only)),
        }
    }

    pub fn is_rx_only(&self) -> bool {
        self.rx_only.load(Ordering::SeqCst)
    }

    pub fn set_rx_only(&self, rx_only: bool) {
        self.rx_only.store(rx_only, Ordering::SeqCst);
    }
}

pub struct AudioEngine {
    host: cpal::Host,
    sample_rate: u32,
    diode: SoftwareDiode,
    input_stream: Option<Stream>,
    output_stream: Option<Stream>,
}

impl AudioEngine {
    pub fn new(sample_rate: u32, diode: SoftwareDiode) -> Self {
        let host = cpal::default_host();
        Self {
            host,
            sample_rate,
            diode,
            input_stream: None,
            output_stream: None,
        }
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn diode(&self) -> &SoftwareDiode {
        &self.diode
    }

    /// Start 48 kHz mono capture into lock-free rtrb producer
    /// Zero allocation inside the audio thread callback
    pub fn start_capture(&mut self, mut producer: Producer<f32>) -> Result<(), AudioError> {
        let device = self
            .host
            .default_input_device()
            .ok_or(AudioError::NoInputDevice)?;

        let config = StreamConfig {
            channels: 1,
            sample_rate: SampleRate(self.sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let err_fn = |err| eprintln!("Audio input error: {}", err);

        let stream = device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                for &sample in data {
                    // Lock-free push into ringbuffer; drops samples if full (no allocation!)
                    let _ = producer.push(sample);
                }
            },
            err_fn,
            None,
        )?;

        stream.play()?;
        self.input_stream = Some(stream);
        Ok(())
    }

    /// Start 48 kHz mono playback from lock-free rtrb consumer
    /// Refuses to open if Software Diode is active!
    pub fn start_playback(&mut self, mut consumer: Consumer<f32>) -> Result<(), AudioError> {
        if self.diode.is_rx_only() {
            return Err(AudioError::SoftwareDiodeActive);
        }

        let device = self
            .host
            .default_output_device()
            .ok_or(AudioError::NoOutputDevice)?;

        let config = StreamConfig {
            channels: 1,
            sample_rate: SampleRate(self.sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let err_fn = |err| eprintln!("Audio output error: {}", err);

        let stream = device.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                for sample in data.iter_mut() {
                    *sample = consumer.pop().unwrap_or(0.0);
                }
            },
            err_fn,
            None,
        )?;

        stream.play()?;
        self.output_stream = Some(stream);
        Ok(())
    }

    pub fn stop(&mut self) {
        self.input_stream = None;
        self.output_stream = None;
    }
}

/// Simulated lock-free acoustic loopback pipeline for automated tests (Phase 0)
pub struct VirtualAcousticLoopback {
    producer: Producer<f32>,
    consumer: Consumer<f32>,
}

impl VirtualAcousticLoopback {
    pub fn new(capacity: usize) -> Self {
        let (producer, consumer) = RingBuffer::new(capacity);
        Self { producer, consumer }
    }

    /// Push audio samples through the virtual speaker
    pub fn emit(&mut self, samples: &[f32]) {
        for &s in samples {
            let _ = self.producer.push(s);
        }
    }

    /// Read captured audio samples through the virtual mic
    pub fn capture_chunk(&mut self, size: usize) -> Vec<f32> {
        let mut chunk = Vec::with_capacity(size);
        for _ in 0..size {
            if let Ok(s) = self.consumer.pop() {
                chunk.push(s);
            } else {
                break;
            }
        }
        chunk
    }

    pub fn available(&self) -> usize {
        self.consumer.slots()
    }
}
