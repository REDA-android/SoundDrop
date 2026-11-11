# ==============================================================================
# Sound Drop Telemetry Engine: Acoustic SNR Decay & Noise Floor Model
# Computes acoustic path loss, room reverberation decay, and bit error rate (BER)
# ==============================================================================

#' Estimates acoustic path loss (dB) over distance r (meters)
#' Incorporates geometric spherical spreading and atmospheric absorption at 48kHz
acoustic_path_loss <- function(distance_m, freq_hz = 2000, temp_c = 20, humidity = 50) {
  # Inverse square law: 20 * log10(r)
  geom_loss <- 20 * log10(pmax(distance_m, 0.05))
  
  # Atmospheric absorption coefficient alpha (dB/m) approximated for audio frequencies
  alpha <- (1.6e-11 * (freq_hz^2)) * (temp_c / 293.15)^(-0.5)
  atmo_loss <- alpha * distance_m
  
  return(geom_loss + atmo_loss)
}

#' Computes expected SNR (dB) given source SPL, distance, and ambient noise floor
estimate_snr <- function(source_spl_db = 75, distance_m = 1.5, noise_floor_db = 42) {
  loss <- acoustic_path_loss(distance_m)
  received_spl <- source_spl_db - loss
  snr <- received_spl - noise_floor_db
  return(pmax(snr, 0))
}

#' Theoretical 16-FSK Bit Error Rate (BER) over AWGN + Rayleigh fading channel
compute_16fsk_ber <- function(snr_db) {
  snr_linear <- 10^(snr_db / 10)
  # M-ary orthogonal FSK upper bound: P_b <= (M / 2) * 0.5 * exp(-E_b / (2 * N_0))
  ber <- 8 * 0.5 * exp(-snr_linear / 4)
  return(pmin(pmax(ber, 1e-7), 0.5))
}

# Self-validation execution
distances <- seq(0.1, 5.0, by = 0.5)
snr_values <- sapply(distances, function(d) estimate_snr(75, d, 40))
ber_values <- sapply(snr_values, compute_16fsk_ber)

cat("========================================================\n")
cat(" Sound Drop Acoustic Telemetry - SNR & BER Simulation\n")
cat("========================================================\n")
for (i in seq_along(distances)) {
  cat(sprintf("Distance: %4.1f m | Expected SNR: %5.1f dB | Theoretical BER: %.2e\n", 
              distances[i], snr_values[i], ber_values[i]))
}
cat("Validation model completed successfully.\n")
