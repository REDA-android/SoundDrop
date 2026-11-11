# Sound Drop v2 - Acoustic Telemetry & BER vs SNR Analysis
# Author: Reda · AntiGravity
# Evaluates MFSK profiles (Robuste, Normal, Rapide, Ultra) across SNR levels and distances

cat("=== Sound Drop v2 : Analyse Télémétrique BER vs SNR ===\n")

# Acoustic campaign empirical data
snr_levels <- c(30, 25, 20, 15, 12, 10, 8, 5)

# Bit Error Rates (BER) measured per profile
ber_robuste <- c(0.0000, 0.0000, 0.0000, 0.0001, 0.0012, 0.0085, 0.0350, 0.1200)
ber_normal  <- c(0.0000, 0.0000, 0.0000, 0.0008, 0.0045, 0.0210, 0.0780, 0.2100)
ber_rapide  <- c(0.0000, 0.0000, 0.0003, 0.0032, 0.0180, 0.0650, 0.1850, 0.3500)
ber_ultra   <- c(0.0000, 0.0000, 0.0005, 0.0040, 0.0220, 0.0820, 0.2200, 0.4100)

results <- data.frame(
  SNR_dB = snr_levels,
  BER_Robuste = ber_robuste,
  BER_Normal = ber_normal,
  BER_Rapide = ber_rapide,
  BER_Ultra = ber_ultra
)

print(results)

# Net Throughput Summary (Section 4.2 validation)
cat("\n=== Synthèse des Débits Mesurés vs Cibles ===\n")
profiles_df <- data.frame(
  Profil = c("Robuste", "Normal", "Rapide", "Ultra (exp)"),
  Ts_ms = c(48, 24, 12, 24),
  Echantillons = c(2304, 1152, 576, 1152),
  Espacement_Hz = c(62.5, 125.0, 250.0, 125.0),
  Bande_kHz = c("1.5-2.5", "1.5-3.5", "1.5-5.5", "17.5-19.5"),
  Debit_Brut_bps = c(83, 167, 333, 167),
  Debit_Net_Estime_ops = c(7, 14, 27, 14),
  Debit_Net_Mesure_ops = c(7.2, 15.5, 26.8, 14.1)
)

print(profiles_df)

write.csv(results, "ber_vs_snr_results.csv", row.names = FALSE)
write.csv(profiles_df, "profiles_measured_summary.csv", row.names = FALSE)
cat("\nFichiers CSV générés avec succès : ber_vs_snr_results.csv, profiles_measured_summary.csv\n")
