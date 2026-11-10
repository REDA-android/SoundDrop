use num_complex::Complex;
use rustfft::FftPlanner;
use sounddrop_audio_io::{list_capture_devices, list_playback_devices, AudioMeter};
use sounddrop_core::{AcousticReceiver, AcousticTransmitter};
use sounddrop_crypto::SasCode;
use sounddrop_file::{hex_encode, run_simulated_file_transfer, FileChunker};
use sounddrop_phy::PhyConfig;
use sounddrop_transport::{ArqConfig, SimulatedAcousticChannel};
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_float};
use std::path::Path;
use std::sync::Mutex;

static LAST_ERROR: Mutex<String> = Mutex::new(String::new());

fn set_error(msg: &str) {
    if let Ok(mut lock) = LAST_ERROR.lock() {
        *lock = msg.to_string();
    }
}

/// Returns the last error message string. Must be freed with `sounddrop_ffi_free_string`.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_get_last_error() -> *mut c_char {
    let err = LAST_ERROR.lock().map(|g| g.clone()).unwrap_or_default();
    CString::new(err).unwrap_or_default().into_raw()
}

/// Returns SoundDrop C-FFI version.
#[no_mangle]
pub extern "C" fn sounddrop_ffi_version() -> *const c_char {
    static VERSION: &[u8] = b"0.1.0-sounddrop-native\0";
    VERSION.as_ptr() as *const c_char
}

/// Modulates a UTF-8 text message into 48kHz audio PCM samples.
/// `out_pcm` receives pointer to heap-allocated `f32` array; must be freed with `sounddrop_ffi_free_pcm`.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_encode_message(
    message: *const c_char,
    seq_num: u8,
    ultrasonic: u8,
    out_pcm: *mut *mut c_float,
    out_len: *mut u32,
) -> i32 {
    if message.is_null() || out_pcm.is_null() || out_len.is_null() {
        set_error("Null pointer argument passed to encode_message");
        return -1;
    }

    let c_str = CStr::from_ptr(message);
    let msg_bytes = match c_str.to_str() {
        Ok(s) => s.as_bytes(),
        Err(e) => {
            set_error(&format!("Invalid UTF-8 message: {}", e));
            return -2;
        }
    };

    let config = if ultrasonic != 0 {
        PhyConfig::ultrasonic_stealth_48k()
    } else {
        PhyConfig::audible_robust_48k()
    };

    let tx = AcousticTransmitter::new(config);
    match tx.encode_payload(msg_bytes, seq_num) {
        Ok(pcm) => {
            let mut boxed_slice = pcm.into_boxed_slice();
            *out_len = boxed_slice.len() as u32;
            *out_pcm = boxed_slice.as_mut_ptr();
            std::mem::forget(boxed_slice);
            0
        }
        Err(e) => {
            set_error(&format!("Encoding error: {}", e));
            -3
        }
    }
}

/// Frees audio PCM buffer allocated by `sounddrop_ffi_encode_message`.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_free_pcm(pcm: *mut c_float, len: u32) {
    if !pcm.is_null() && len > 0 {
        let _ = Box::from_raw(std::slice::from_raw_parts_mut(pcm, len as usize));
    }
}

/// Demodulates 48kHz audio PCM samples into a decoded text message.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_decode_pcm(
    pcm: *const c_float,
    len: u32,
    ultrasonic: u8,
    out_buf: *mut c_char,
    max_buf_len: u32,
    out_snr: *mut c_float,
    out_corr: *mut c_float,
    out_fec_corrected: *mut u32,
) -> i32 {
    if pcm.is_null() || len == 0 || out_buf.is_null() || max_buf_len == 0 {
        set_error("Invalid arguments to decode_pcm");
        return -1;
    }

    let pcm_slice = std::slice::from_raw_parts(pcm, len as usize);
    let config = if ultrasonic != 0 {
        PhyConfig::ultrasonic_stealth_48k()
    } else {
        PhyConfig::audible_robust_48k()
    };

    let rx = AcousticReceiver::new(config);
    match rx.decode_pcm(pcm_slice) {
        Ok(report) => {
            let payload = report.frame.payload;
            let copy_len = std::cmp::min(payload.len(), (max_buf_len - 1) as usize);

            let out_slice = std::slice::from_raw_parts_mut(out_buf as *mut u8, max_buf_len as usize);
            out_slice[..copy_len].copy_from_slice(&payload[..copy_len]);
            out_slice[copy_len] = 0; // null terminator

            if !out_snr.is_null() {
                *out_snr = report.avg_symbol_snr_margin;
            }
            if !out_corr.is_null() {
                *out_corr = report.sync_correlation;
            }
            if !out_fec_corrected.is_null() {
                *out_fec_corrected = report.errors_corrected_by_fec as u32;
            }

            0
        }
        Err(e) => {
            set_error(&format!("Demodulation error: {}", e));
            -2
        }
    }
}

/// Computes genuine FFT frequency spectrum bins from audio samples for the Waterfall UI.
/// `num_samples` should be a power of 2 (e.g. 512, 1024). `num_bins` = `num_samples / 2`.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_compute_spectrum(
    samples: *const c_float,
    num_samples: u32,
    out_magnitudes: *mut c_float,
    num_bins: u32,
) -> i32 {
    if samples.is_null() || num_samples == 0 || out_magnitudes.is_null() || num_bins == 0 {
        return -1;
    }

    let n = num_samples as usize;
    let expected_bins = n / 2;
    if (num_bins as usize) < expected_bins {
        return -2;
    }

    let in_slice = std::slice::from_raw_parts(samples, n);
    let out_slice = std::slice::from_raw_parts_mut(out_magnitudes, num_bins as usize);

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);

    // Apply Hann window and convert to complex
    let mut buffer: Vec<Complex<f32>> = in_slice
        .iter()
        .enumerate()
        .map(|(i, &s)| {
            let w = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos());
            Complex::new(s * w, 0.0)
        })
        .collect();

    fft.process(&mut buffer);

    // Compute normalized log magnitude (dBFS: -96.0 to 0.0)
    for i in 0..expected_bins {
        let mag = buffer[i].norm() / (n as f32 / 2.0);
        let db = if mag > 1e-5 {
            20.0 * mag.log10()
        } else {
            -96.0
        };
        out_slice[i] = db.clamp(-96.0, 0.0);
    }

    0
}

/// Computes Peak dBFS, RMS dBFS, and clipping indicator from an audio sample buffer.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_compute_meter(
    samples: *const c_float,
    len: u32,
    out_peak: *mut c_float,
    out_rms: *mut c_float,
    out_clipping: *mut u8,
) -> i32 {
    if samples.is_null() || len == 0 {
        return -1;
    }

    let slice = std::slice::from_raw_parts(samples, len as usize);
    let meter = AudioMeter::compute_from_samples(slice);

    if !out_peak.is_null() {
        *out_peak = meter.peak_dbfs;
    }
    if !out_rms.is_null() {
        *out_rms = meter.rms_dbfs;
    }
    if !out_clipping.is_null() {
        *out_clipping = if meter.is_clipping { 1 } else { 0 };
    }

    0
}

/// Generates a Short Authentication String (SAS) 6-digit PIN and 4-word mnemonic from a 32-byte digest.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_generate_sas(
    digest32: *const u8,
    out_pin: *mut c_char,
    max_pin_len: u32,
    out_words: *mut c_char,
    max_words_len: u32,
) -> i32 {
    if digest32.is_null() || out_pin.is_null() || out_words.is_null() {
        return -1;
    }

    let mut d = [0u8; 32];
    std::ptr::copy_nonoverlapping(digest32, d.as_mut_ptr(), 32);

    let sas = SasCode::from_digest(&d);

    let pin_bytes = sas.pin.as_bytes();
    let words_bytes = sas.words.as_bytes();

    if (max_pin_len as usize) <= pin_bytes.len() || (max_words_len as usize) <= words_bytes.len() {
        return -2;
    }

    let pin_slice = std::slice::from_raw_parts_mut(out_pin as *mut u8, max_pin_len as usize);
    pin_slice[..pin_bytes.len()].copy_from_slice(pin_bytes);
    pin_slice[pin_bytes.len()] = 0;

    let words_slice = std::slice::from_raw_parts_mut(out_words as *mut u8, max_words_len as usize);
    words_slice[..words_bytes.len()].copy_from_slice(words_bytes);
    words_slice[words_bytes.len()] = 0;

    0
}

/// Queries count of available physical playback and capture devices.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_get_device_counts(
    out_playback: *mut u32,
    out_capture: *mut u32,
) -> i32 {
    let p_count = list_playback_devices().map(|d| d.len()).unwrap_or(0) as u32;
    let c_count = list_capture_devices().map(|d| d.len()).unwrap_or(0) as u32;

    if !out_playback.is_null() {
        *out_playback = p_count;
    }
    if !out_capture.is_null() {
        *out_capture = c_count;
    }

    0
}

/// Slices a file on disk and outputs metadata manifest properties.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_file_manifest_create(
    filepath: *const c_char,
    chunk_size: u32,
    out_file_id_hex: *mut c_char,
    out_file_size: *mut u64,
    out_total_chunks: *mut u32,
    out_root_hash_hex: *mut c_char,
) -> i32 {
    if filepath.is_null() || out_file_id_hex.is_null() || out_root_hash_hex.is_null() {
        return -1;
    }

    let path_str = match CStr::from_ptr(filepath).to_str() {
        Ok(s) => s,
        Err(_) => return -2,
    };

    match FileChunker::slice_file(Path::new(path_str), chunk_size) {
        Ok((manifest, _)) => {
            let id_hex = hex_encode(&manifest.file_id);
            let root_hex = hex_encode(&manifest.root_hash);

            let id_slice = std::slice::from_raw_parts_mut(out_file_id_hex as *mut u8, 33);
            id_slice[..32].copy_from_slice(id_hex.as_bytes());
            id_slice[32] = 0;

            let root_slice = std::slice::from_raw_parts_mut(out_root_hash_hex as *mut u8, 65);
            root_slice[..64].copy_from_slice(root_hex.as_bytes());
            root_slice[64] = 0;

            if !out_file_size.is_null() {
                *out_file_size = manifest.file_size;
            }
            if !out_total_chunks.is_null() {
                *out_total_chunks = manifest.total_chunks;
            }

            0
        }
        Err(e) => {
            set_error(&format!("Manifest creation failed: {}", e));
            -3
        }
    }
}

/// Executes simulated end-to-end encrypted acoustic file transfer.
/// Returns JSON-formatted execution outcome string. Must be freed with `sounddrop_ffi_free_string`.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_run_file_transfer(
    filepath: *const c_char,
    out_dir: *const c_char,
    cache_dir: *const c_char,
    chunk_size: u32,
    data_loss: c_float,
    ack_loss: c_float,
    snr_db: c_float,
) -> *mut c_char {
    if filepath.is_null() || out_dir.is_null() || cache_dir.is_null() {
        return std::ptr::null_mut();
    }

    let file_p = match CStr::from_ptr(filepath).to_str() {
        Ok(s) => Path::new(s),
        Err(_) => return std::ptr::null_mut(),
    };
    let out_p = match CStr::from_ptr(out_dir).to_str() {
        Ok(s) => Path::new(s),
        Err(_) => return std::ptr::null_mut(),
    };
    let cache_p = match CStr::from_ptr(cache_dir).to_str() {
        Ok(s) => Path::new(s),
        Err(_) => return std::ptr::null_mut(),
    };

    let config = PhyConfig::audible_robust_48k();
    let channel = SimulatedAcousticChannel::new(config.clone(), data_loss, ack_loss, snr_db);
    let arq_cfg = ArqConfig {
        max_retries: 5,
        timeout_sec: 4.5,
        turnaround_delay_sec: 0.1,
    };

    match run_simulated_file_transfer(
        file_p,
        out_p,
        cache_p,
        chunk_size,
        config,
        arq_cfg,
        &channel,
    ) {
        Ok(outcome) => {
            let json = format!(
                r#"{{"status":"ok","fileName":"{}","fileSize":{},"totalChunks":{},"chunksDelivered":{},"rootHash":"{}","outputPath":"{}","sasPin":"{}","sasWords":"{}","sasVerified":{},"durationMs":{},"effectiveBps":{:.1}}}"#,
                outcome.file_name,
                outcome.file_size,
                outcome.total_chunks,
                outcome.chunks_transferred,
                hex_encode(&outcome.root_hash),
                outcome.output_path.display(),
                outcome.sas.pin,
                outcome.sas.words,
                outcome.sas_verified,
                outcome.total_duration.as_millis(),
                outcome.effective_bps
            );
            CString::new(json).unwrap_or_default().into_raw()
        }
        Err(e) => {
            let json = format!(r#"{{"status":"error","message":"{}"}}"#, e);
            CString::new(json).unwrap_or_default().into_raw()
        }
    }
}

/// Frees a C-string returned by Rust FFI.
#[no_mangle]
pub unsafe extern "C" fn sounddrop_ffi_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        let _ = CString::from_raw(ptr);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    #[test]
    fn test_ffi_version() {
        let v = sounddrop_ffi_version();
        let s = unsafe { CStr::from_ptr(v).to_str().unwrap() };
        assert_eq!(s, "0.1.0-sounddrop-native");
    }

    #[test]
    fn test_ffi_modulation_roundtrip() {
        let msg = CString::new("FFI_ACOUSTIC_TEST").unwrap();
        let mut pcm_ptr: *mut c_float = std::ptr::null_mut();
        let mut pcm_len: u32 = 0;

        unsafe {
            let res = sounddrop_ffi_encode_message(
                msg.as_ptr(),
                0,
                0,
                &mut pcm_ptr,
                &mut pcm_len,
            );
            assert_eq!(res, 0);
            assert!(!pcm_ptr.is_null());
            assert!(pcm_len > 0);

            let mut out_buf = [0u8; 128];
            let mut snr = 0.0f32;
            let mut corr = 0.0f32;
            let mut fec = 0u32;

            let dec_res = sounddrop_ffi_decode_pcm(
                pcm_ptr,
                pcm_len,
                0,
                out_buf.as_mut_ptr() as *mut c_char,
                128,
                &mut snr,
                &mut corr,
                &mut fec,
            );

            assert_eq!(dec_res, 0);
            let decoded_str = CStr::from_ptr(out_buf.as_ptr() as *const c_char).to_str().unwrap();
            assert_eq!(decoded_str, "FFI_ACOUSTIC_TEST");
            assert!(corr > 0.8);

            sounddrop_ffi_free_pcm(pcm_ptr, pcm_len);
        }
    }

    #[test]
    fn test_ffi_spectrum_computation() {
        let mut samples = vec![0.0f32; 512];
        // 1 kHz sine at 48kHz
        for i in 0..512 {
            samples[i] = (2.0 * std::f32::consts::PI * 1000.0 * (i as f32 / 48000.0)).sin();
        }

        let mut bins = vec![0.0f32; 256];
        unsafe {
            let res = sounddrop_ffi_compute_spectrum(
                samples.as_ptr(),
                512,
                bins.as_mut_ptr(),
                256,
            );
            assert_eq!(res, 0);

            // Bin index for 1000 Hz with 512-point FFT at 48kHz:
            // bin = 1000 * 512 / 48000 = 10.66 -> bin 10 or 11
            let peak_bin = bins.iter().enumerate().max_by(|a, b| a.1.partial_cmp(b.1).unwrap()).unwrap().0;
            assert!(peak_bin == 10 || peak_bin == 11);
        }
    }

    #[test]
    fn test_ffi_sas_generation() {
        let digest = [0x55u8; 32];
        let mut pin = [0u8; 16];
        let mut words = [0u8; 128];

        unsafe {
            let res = sounddrop_ffi_generate_sas(
                digest.as_ptr(),
                pin.as_mut_ptr() as *mut c_char,
                16,
                words.as_mut_ptr() as *mut c_char,
                128,
            );
            assert_eq!(res, 0);

            let pin_str = CStr::from_ptr(pin.as_ptr() as *const c_char).to_str().unwrap();
            let words_str = CStr::from_ptr(words.as_ptr() as *const c_char).to_str().unwrap();

            assert_eq!(pin_str.len(), 7); // "XXX-XXX"
            assert!(words_str.contains(" - "));
        }
    }
}
