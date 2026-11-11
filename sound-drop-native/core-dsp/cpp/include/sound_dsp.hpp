#ifndef SOUND_DSP_HPP
#define SOUND_DSP_HPP

#include <cstddef>
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

// Modem operational modes
typedef enum {
    MODEM_MODE_AUDIBLE = 0,    // 1500 Hz - 5500 Hz (f0 = 1600 Hz, delta = 187.5 Hz)
    MODEM_MODE_ULTRASONIC = 1, // 17500 Hz - 20500 Hz (f0 = 17600 Hz, delta = 187.5 Hz)
    MODEM_MODE_WHISPER = 2     // 18500 Hz - 20200 Hz (f0 = 18500 Hz, delta = 106.25 Hz)
} ModemMode_t;

// Filter bank configuration descriptor
typedef struct {
    double sample_rate;
    size_t block_size;
    size_t num_frequencies;
    const double* target_frequencies;
} GoertzelBankConfig_t;

// Detection result structure
typedef struct {
    int detected_symbol;     // 0x0 to 0xF, or -1 if no tone detected
    double peak_energy;      // Maximum squared magnitude across bins
    double noise_floor;      // Mean baseline noise energy across guard bands
    double snr_db;           // Signal-to-noise ratio in decibels (10 * log10(peak / noise))
    double confidence;       // 0.0 to 1.0 confidence score
} DetectionResult_t;

// SIMD-accelerated Goertzel Filter Bank analysis
void sound_dsp_goertzel_analyze_simd(
    const float* samples,
    size_t num_samples,
    double sample_rate,
    const double* frequencies,
    size_t num_frequencies,
    double* out_energies
);

// Cross-correlation matched filter for LFM Chirp detection
double sound_dsp_matched_filter_lfm(
    const float* input_buffer,
    const float* reference_chirp,
    size_t length
);

// High-speed block normalization & RMS energy
float sound_dsp_compute_rms(const float* samples, size_t length);

#ifdef __cplusplus
}
#endif

#endif // SOUND_DSP_HPP
