use crate::stream::AudioMeter;
use ringbuf::traits::{Consumer, Producer, Split};
use ringbuf::HeapRb;
use std::sync::Mutex;

/// Opaque C-compatible handle for native Android (Oboe) and iOS (CoreAudio) stream integration.
pub struct SoundDropStreamHandle {
    producer: Mutex<<HeapRb<f32> as Split>::Prod>,
    consumer: Mutex<<HeapRb<f32> as Split>::Cons>,
    meter: Mutex<AudioMeter>,
    sample_rate: u32,
}

#[no_mangle]
pub unsafe extern "C" fn sounddrop_stream_create(
    sample_rate: u32,
    capacity: u32,
) -> *mut SoundDropStreamHandle {
    let cap = if capacity == 0 {
        sample_rate as usize
    } else {
        capacity as usize
    };

    let rb = HeapRb::<f32>::new(cap);
    let (producer, consumer) = rb.split();

    let handle = Box::new(SoundDropStreamHandle {
        producer: Mutex::new(producer),
        consumer: Mutex::new(consumer),
        meter: Mutex::new(AudioMeter::default()),
        sample_rate,
    });

    Box::into_raw(handle)
}

#[no_mangle]
pub unsafe extern "C" fn sounddrop_stream_push_samples(
    handle: *mut SoundDropStreamHandle,
    samples: *const f32,
    count: usize,
) -> u32 {
    if handle.is_null() || samples.is_null() || count == 0 {
        return 0;
    }

    let stream = &*handle;
    let slice = std::slice::from_raw_parts(samples, count);

    // Update real-time meter
    let m = AudioMeter::compute_from_samples(slice);
    if let Ok(mut meter_guard) = stream.meter.try_lock() {
        *meter_guard = m;
    }

    let mut pushed = 0u32;
    if let Ok(mut prod) = stream.producer.lock() {
        for &s in slice {
            if prod.try_push(s).is_ok() {
                pushed += 1;
            } else {
                break;
            }
        }
    }

    pushed
}

#[no_mangle]
pub unsafe extern "C" fn sounddrop_stream_pull_samples(
    handle: *mut SoundDropStreamHandle,
    out_buffer: *mut f32,
    max_count: usize,
) -> u32 {
    if handle.is_null() || out_buffer.is_null() || max_count == 0 {
        return 0;
    }

    let stream = &*handle;
    let out_slice = std::slice::from_raw_parts_mut(out_buffer, max_count);

    let mut pulled = 0u32;
    if let Ok(mut cons) = stream.consumer.lock() {
        for target in out_slice.iter_mut() {
            if let Some(s) = cons.try_pop() {
                *target = s;
                pulled += 1;
            } else {
                break;
            }
        }
    }

    pulled
}

#[no_mangle]
pub unsafe extern "C" fn sounddrop_stream_get_meter(
    handle: *mut SoundDropStreamHandle,
    out_peak_dbfs: *mut f32,
    out_rms_dbfs: *mut f32,
    out_clipping: *mut u8,
) -> i32 {
    if handle.is_null() {
        return -1;
    }

    let stream = &*handle;
    let m = stream.meter.lock().map(|g| *g).unwrap_or_default();

    if !out_peak_dbfs.is_null() {
        *out_peak_dbfs = m.peak_dbfs;
    }
    if !out_rms_dbfs.is_null() {
        *out_rms_dbfs = m.rms_dbfs;
    }
    if !out_clipping.is_null() {
        *out_clipping = if m.is_clipping { 1 } else { 0 };
    }

    0
}

#[no_mangle]
pub unsafe extern "C" fn sounddrop_stream_get_sample_rate(handle: *mut SoundDropStreamHandle) -> u32 {
    if handle.is_null() {
        return 0;
    }
    let stream = &*handle;
    stream.sample_rate
}

#[no_mangle]
pub unsafe extern "C" fn sounddrop_stream_destroy(handle: *mut SoundDropStreamHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_c_ffi_stream_lifecycle() {
        unsafe {
            let handle = sounddrop_stream_create(48000, 1024);
            assert!(!handle.is_null());

            let input_samples = [0.25f32, -0.5f32, 0.75f32, -0.1f32];
            let pushed = sounddrop_stream_push_samples(handle, input_samples.as_ptr(), input_samples.len());
            assert_eq!(pushed, 4);

            let mut peak = 0.0f32;
            let mut rms = 0.0f32;
            let mut clip = 0u8;
            let res = sounddrop_stream_get_meter(handle, &mut peak, &mut rms, &mut clip);
            assert_eq!(res, 0);
            assert!(peak > -3.0 && peak < -2.0);
            assert_eq!(clip, 0);

            let mut output_samples = [0.0f32; 10];
            let pulled = sounddrop_stream_pull_samples(handle, output_samples.as_mut_ptr(), output_samples.len());
            assert_eq!(pulled, 4);
            assert_eq!(&output_samples[..4], &input_samples);

            sounddrop_stream_destroy(handle);
        }
    }
}
