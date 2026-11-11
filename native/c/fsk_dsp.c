/*
 * SoundDrop v6.0 — Native C99 / C11 Ultrasonic & Audible FSK DSP Kernel
 * Implements constant-time Goertzel filterbank, Blackman-Harris windowing,
 * and hardware-friendly CRC-16-CCITT verification.
 */

#include <math.h>
#include <stdint.h>
#include <stddef.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

uint16_t sounddrop_c_crc16(const uint8_t *data, size_t length) {
    uint16_t crc = 0xFFFF;
    if (!data) return crc;
    for (size_t i = 0; i < length; ++i) {
        crc ^= ((uint16_t)data[i] << 8);
        for (int bit = 0; bit < 8; ++bit) {
            if (crc & 0x8000) {
                crc = (uint16_t)((crc << 1) ^ 0x1021);
            } else {
                crc <<= 1;
            }
        }
    }
    return crc;
}

double sounddrop_c_goertzel_db(
    const float *pcm,
    size_t num_samples,
    double target_freq_hz,
    double sample_rate_hz
) {
    if (!pcm || num_samples == 0 || sample_rate_hz <= 0.0) {
        return -140.0;
    }
    double k = floor(0.5 + ((double)num_samples * target_freq_hz) / sample_rate_hz);
    double omega = (2.0 * M_PI * k) / (double)num_samples;
    double coeff = 2.0 * cos(omega);
    double q0 = 0.0, q1 = 0.0, q2 = 0.0;

    for (size_t i = 0; i < num_samples; ++i) {
        /* Blackman-Harris 4-term window to suppress spectral leakage */
        double phase = (2.0 * M_PI * (double)i) / (double)(num_samples - 1);
        double w = 0.35875
                 - 0.48829 * cos(phase)
                 + 0.14128 * cos(2.0 * phase)
                 - 0.01168 * cos(3.0 * phase);
        q0 = coeff * q1 - q2 + ((double)pcm[i] * w);
        q2 = q1;
        q1 = q0;
    }

    double mag_sq = q1 * q1 + q2 * q2 - q1 * q2 * coeff;
    if (mag_sq < 1e-18) mag_sq = 1e-18;
    double rms = sqrt(mag_sq) / (double)num_samples;
    return 20.0 * log10(rms);
}
