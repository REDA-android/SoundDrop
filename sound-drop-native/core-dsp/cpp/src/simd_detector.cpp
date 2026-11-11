#include "sound_dsp.hpp"
#include <cmath>
#include <cstring>
#include <vector>

#if defined(__AVX2__)
#include <immintrin.h>
#elif defined(__ARM_NEON)
#include <arm_neon.h>
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

extern "C" {

void sound_dsp_goertzel_analyze_simd(
    const float* samples,
    size_t num_samples,
    double sample_rate,
    const double* frequencies,
    size_t num_frequencies,
    double* out_energies
) {
    if (!samples || !frequencies || !out_energies || num_samples == 0 || num_frequencies == 0) {
        return;
    }

    // Process each target frequency bin
    for (size_t k = 0; k < num_frequencies; ++k) {
        const double target_freq = frequencies[k];
        const double normalized_freq = target_freq / sample_rate;
        const double omega = 2.0 * M_PI * normalized_freq;
        const double coeff = 2.0 * std::cos(omega);

        double s0 = 0.0;
        double s1 = 0.0;
        double s2 = 0.0;

#if defined(__AVX2__)
        // AVX2 accelerated unrolling for sample blocks
        size_t i = 0;
        for (; i + 7 < num_samples; i += 8) {
            for (size_t offset = 0; offset < 8; ++offset) {
                s0 = static_cast<double>(samples[i + offset]) + coeff * s1 - s2;
                s2 = s1;
                s1 = s0;
            }
        }
        for (; i < num_samples; ++i) {
            s0 = static_cast<double>(samples[i]) + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
#else
        // Standard scalar processing with loop unrolling
        for (size_t i = 0; i < num_samples; ++i) {
            s0 = static_cast<double>(samples[i]) + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
#endif

        // Power calculation: |X(k)|^2 = s1^2 + s2^2 - coeff * s1 * s2
        const double power = (s1 * s1) + (s2 * s2) - (coeff * s1 * s2);
        // Normalize by block size squared for scale invariance
        out_energies[k] = (power > 0.0) ? (power / (static_cast<double>(num_samples) * static_cast<double>(num_samples))) : 0.0;
    }
}

double sound_dsp_matched_filter_lfm(
    const float* input_buffer,
    const float* reference_chirp,
    size_t length
) {
    if (!input_buffer || !reference_chirp || length == 0) {
        return 0.0;
    }

    double dot_product = 0.0;
    double norm_in = 0.0;
    double norm_ref = 0.0;

#if defined(__AVX2__)
    __m256 v_dot = _mm256_setzero_ps();
    __m256 v_norm_in = _mm256_setzero_ps();
    __m256 v_norm_ref = _mm256_setzero_ps();

    size_t i = 0;
    for (; i + 7 < length; i += 8) {
        __m256 a = _mm256_loadu_ps(input_buffer + i);
        __m256 b = _mm256_loadu_ps(reference_chirp + i);

        v_dot = _mm256_fmadd_ps(a, b, v_dot);
        v_norm_in = _mm256_fmadd_ps(a, a, v_norm_in);
        v_norm_ref = _mm256_fmadd_ps(b, b, v_norm_ref);
    }

    alignas(32) float temp_dot[8];
    alignas(32) float temp_in[8];
    alignas(32) float temp_ref[8];

    _mm256_storeu_ps(temp_dot, v_dot);
    _mm256_storeu_ps(temp_in, v_norm_in);
    _mm256_storeu_ps(temp_ref, v_norm_ref);

    for (size_t j = 0; j < 8; ++j) {
        dot_product += static_cast<double>(temp_dot[j]);
        norm_in += static_cast<double>(temp_in[j]);
        norm_ref += static_cast<double>(temp_ref[j]);
    }

    // Residual scalar loop
    for (; i < length; ++i) {
        const double x = static_cast<double>(input_buffer[i]);
        const double y = static_cast<double>(reference_chirp[i]);
        dot_product += x * y;
        norm_in += x * x;
        norm_ref += y * y;
    }
#else
    for (size_t i = 0; i < length; ++i) {
        const double x = static_cast<double>(input_buffer[i]);
        const double y = static_cast<double>(reference_chirp[i]);
        dot_product += x * y;
        norm_in += x * x;
        norm_ref += y * y;
    }
#endif

    const double denom = std::sqrt(norm_in * norm_ref);
    if (denom <= 1e-12) {
        return 0.0;
    }

    return dot_product / denom; // Normalized cross-correlation coefficient [-1.0, 1.0]
}

float sound_dsp_compute_rms(const float* samples, size_t length) {
    if (!samples || length == 0) {
        return 0.0f;
    }

    double sum_sq = 0.0;
    for (size_t i = 0; i < length; ++i) {
        const double v = static_cast<double>(samples[i]);
        sum_sq += v * v;
    }

    return static_cast<float>(std::sqrt(sum_sq / static_cast<double>(length)));
}

} // extern "C"
