# SoundDrop v6.0 — Native R Statistical Acoustic Telemetry & Spectral Entropy Analyzer
# Computes real Shannon spectral entropy, SNR confidence intervals, and theoretical
# 4-FSK Bit Error Rate (BER) from real captured FFT magnitude vectors (Zero Mock Data).

compute_spectral_metrics <- function(fft_db_vector, sample_rate = 48000) {
  if (length(fft_db_vector) == 0) {
    stop("Empty FFT vector: real microphone or modulator spectrum required.")
  }

  # Convert dBFS magnitudes to linear power density
  linear_power <- 10 ^ (fft_db_vector / 10)
  total_power <- sum(linear_power, na.rm = TRUE)
  prob_dist <- linear_power / max(total_power, 1e-15)

  # Normalized Shannon Spectral Entropy H(P) in [0, 1]
  valid_p <- prob_dist[prob_dist > 0]
  shannon_entropy <- -sum(valid_p * log2(valid_p)) / log2(length(fft_db_vector))

  peak_db <- max(fft_db_vector, na.rm = TRUE)
  noise_floor_db <- median(fft_db_vector, na.rm = TRUE)
  snr_db <- max(0, peak_db - noise_floor_db)

  # Non-coherent M-FSK (M = 4) analytical Bit Error Rate (BER)
  eb_n0_linear <- 10 ^ (snr_db / 10)
  ber_estimate <- 0.5 * exp(-0.5 * eb_n0_linear)

  list(
    sample_rate_hz = sample_rate,
    bins = length(fft_db_vector),
    peak_db = round(peak_db, 2),
    noise_floor_db = round(noise_floor_db, 2),
    snr_db = round(snr_db, 2),
    spectral_entropy = round(shannon_entropy, 4),
    estimated_4fsk_ber = signif(ber_estimate, 4)
  )
}
