//! Safe Rust wrapper around the ggwave C API for Phase 1 acoustic modulation/demodulation.

use std::sync::Mutex;

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub enum SampleFormat {
    Undefined = 0,
    U8 = 1,
    I8 = 2,
    U16 = 3,
    I16 = 4,
    F32 = 5,
}

#[repr(C)]
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum ProtocolId {
    AudibleNormal = 0,
    AudibleFast = 1,
    AudibleFastest = 2,
    UltrasoundNormal = 3,
    UltrasoundFast = 4,
    UltrasoundFastest = 5,
    DtNormal = 6,
    DtFast = 7,
    DtFastest = 8,
    MtNormal = 9,
    MtFast = 10,
    MtFastest = 11,
}

pub const OPERATING_MODE_RX: i32 = 1 << 1;
pub const OPERATING_MODE_TX: i32 = 1 << 2;
pub const OPERATING_MODE_RX_AND_TX: i32 = OPERATING_MODE_RX | OPERATING_MODE_TX;

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct GgwaveParameters {
    pub payload_length: i32,
    pub sample_rate_inp: f32,
    pub sample_rate_out: f32,
    pub sample_rate: f32,
    pub samples_per_frame: i32,
    pub sound_marker_threshold: f32,
    pub sample_format_inp: SampleFormat,
    pub sample_format_out: SampleFormat,
    pub operating_mode: i32,
}

extern "C" {
    fn ggwave_getDefaultParameters() -> GgwaveParameters;
    fn ggwave_init(parameters: GgwaveParameters) -> i32;
    fn ggwave_free(instance: i32);
    fn ggwave_encode(
        instance: i32,
        payload_buffer: *const u8,
        payload_size: i32,
        protocol_id: ProtocolId,
        volume: i32,
        waveform_buffer: *mut u8,
        query: i32,
    ) -> i32;
    fn ggwave_ndecode(
        instance: i32,
        waveform_buffer: *const u8,
        waveform_size: i32,
        payload_buffer: *mut u8,
        payload_size: i32,
    ) -> i32;
    fn ggwave_setLogFile(fptr: *mut std::ffi::c_void);
}

pub struct GgwaveModem {
    instance: i32,
    _lock: Mutex<()>,
}

// ggwave instances can be moved between threads, guarded by mutex for operations
unsafe impl Send for GgwaveModem {}
unsafe impl Sync for GgwaveModem {}

impl GgwaveModem {
    pub fn new(sample_rate: f32) -> Result<Self, String> {
        let mut params = unsafe { ggwave_getDefaultParameters() };
        params.sample_rate = sample_rate;
        params.sample_rate_inp = sample_rate;
        params.sample_rate_out = sample_rate;
        params.sample_format_inp = SampleFormat::F32;
        params.sample_format_out = SampleFormat::F32;
        params.operating_mode = OPERATING_MODE_RX_AND_TX;

        let instance = unsafe { ggwave_init(params) };
        if instance < 0 {
            return Err("Failed to initialize ggwave instance".into());
        }

        Ok(Self {
            instance,
            _lock: Mutex::new(()),
        })
    }

    /// Disable ggwave C++ stdout/stderr logging
    pub fn disable_logging() {
        unsafe {
            ggwave_setLogFile(std::ptr::null_mut());
        }
    }

    /// Encode payload bytes into 48 kHz mono f32 samples
    pub fn encode(&self, payload: &[u8], protocol: ProtocolId, volume: i32) -> Result<Vec<f32>, String> {
        let _guard = self._lock.lock().unwrap();
        let bytes_needed = unsafe {
            ggwave_encode(
                self.instance,
                payload.as_ptr(),
                payload.len() as i32,
                protocol,
                volume,
                std::ptr::null_mut(),
                1,
            )
        };

        if bytes_needed <= 0 {
            return Err(format!("ggwave encode query returned {}", bytes_needed));
        }

        let num_samples = bytes_needed as usize / std::mem::size_of::<f32>();
        let mut samples: Vec<f32> = vec![0.0; num_samples];

        let written = unsafe {
            ggwave_encode(
                self.instance,
                payload.as_ptr(),
                payload.len() as i32,
                protocol,
                volume,
                samples.as_mut_ptr() as *mut u8,
                0,
            )
        };

        if written != bytes_needed {
            return Err(format!("ggwave encode wrote {} bytes, expected {}", written, bytes_needed));
        }

        Ok(samples)
    }

    /// Feed audio samples and attempt to decode a packet
    pub fn decode(&self, samples: &[f32]) -> Result<Option<Vec<u8>>, String> {
        let _guard = self._lock.lock().unwrap();
        let mut output_buf = vec![0u8; 1024];

        let ret = unsafe {
            ggwave_ndecode(
                self.instance,
                samples.as_ptr() as *const u8,
                (samples.len() * std::mem::size_of::<f32>()) as i32,
                output_buf.as_mut_ptr(),
                output_buf.len() as i32,
            )
        };

        if ret > 0 {
            output_buf.truncate(ret as usize);
            Ok(Some(output_buf))
        } else if ret == 0 {
            Ok(None)
        } else if ret == -2 {
            Err("Buffer too small for decoded payload".into())
        } else {
            // Noise or partial frame
            Ok(None)
        }
    }
}

impl Drop for GgwaveModem {
    fn drop(&mut self) {
        unsafe {
            ggwave_free(self.instance);
        }
    }
}
