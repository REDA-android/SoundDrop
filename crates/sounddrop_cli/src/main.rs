use clap::{Parser, Subcommand};
use sounddrop_audio_io::{list_capture_devices, list_playback_devices};
use sounddrop_core::{AcousticReceiver, AcousticTransmitter, ReceptionReport};
use sounddrop_phy::PhyConfig;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Parser, Debug)]
#[command(name = "sounddrop", author, version, about = "SoundDrop Acoustic Core CLI", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Transmit a message over sound waves
    Tx {
        /// Text message or payload to transmit
        #[arg(short, long)]
        message: String,

        /// Frame sequence number (0-255)
        #[arg(short, long, default_value_t = 0)]
        seq: u8,

        /// Export modulated acoustic signal to a WAV file instead of playing on speaker
        #[arg(short, long)]
        wav: Option<PathBuf>,

        /// Use near-ultrasonic frequency band (18 kHz - 20 kHz)
        #[arg(long, default_value_t = false)]
        ultrasonic: bool,
    },

    /// Receive and decode a message from sound waves
    Rx {
        /// Read and decode acoustic signal from a WAV file instead of microphone
        #[arg(short, long)]
        wav: Option<PathBuf>,

        /// Recording duration in seconds when listening to physical microphone
        #[arg(short, long, default_value_t = 5.0)]
        duration: f32,

        /// Use near-ultrasonic frequency band (18 kHz - 20 kHz)
        #[arg(long, default_value_t = false)]
        ultrasonic: bool,
    },

    /// List physical audio hardware devices (speakers & microphones)
    Devices,

    /// Run an automated physical layer benchmark across synthetic air-gap conditions
    Bench {
        /// Payload string to benchmark
        #[arg(short, long, default_value = "SOUNDDROP_AIRGAP_BENCHMARK")]
        message: String,

        /// Injected additive white Gaussian noise SNR in dB
        #[arg(long, default_value_t = 15.0)]
        snr_db: f32,

        /// Inject acoustic transient click/pop spike noise
        #[arg(long, default_value_t = true)]
        click_noise: bool,
    },
}

fn main() {
    env_logger::init();
    let cli = Cli::parse();

    match cli.command {
        Commands::Devices => run_devices(),
        Commands::Tx {
            message,
            seq,
            wav,
            ultrasonic,
        } => run_tx(&message, seq, wav, ultrasonic),
        Commands::Rx {
            wav,
            duration,
            ultrasonic,
        } => run_rx(wav, duration, ultrasonic),
        Commands::Bench {
            message,
            snr_db,
            click_noise,
        } => run_bench(&message, snr_db, click_noise),
    }
}

fn run_devices() {
    println!("=== SoundDrop Audio Hardware Inspection ===");

    println!("\n[Playback Devices (Speakers/Output)]:");
    match list_playback_devices() {
        Ok(devs) if devs.is_empty() => {
            println!("  (No physical playback devices detected by OS)");
        }
        Ok(devs) => {
            for (i, d) in devs.iter().enumerate() {
                let default_tag = if d.is_default { " [DEFAULT]" } else { "" };
                println!("  {}. {}{}", i + 1, d.name, default_tag);
            }
        }
        Err(e) => println!("  Error querying playback devices: {}", e),
    }

    println!("\n[Capture Devices (Microphones/Input)]:");
    match list_capture_devices() {
        Ok(devs) if devs.is_empty() => {
            println!("  (No physical capture devices detected by OS)");
        }
        Ok(devs) => {
            for (i, d) in devs.iter().enumerate() {
                let default_tag = if d.is_default { " [DEFAULT]" } else { "" };
                println!("  {}. {}{}", i + 1, d.name, default_tag);
            }
        }
        Err(e) => println!("  Error querying capture devices: {}", e),
    }
}

fn run_tx(message: &str, seq: u8, wav: Option<PathBuf>, ultrasonic: bool) {
    let payload = message.as_bytes();
    let config = if ultrasonic {
        PhyConfig::ultrasonic_stealth_48k()
    } else {
        PhyConfig::audible_robust_48k()
    };

    println!("=== SoundDrop Acoustic Transmitter ===");
    println!("Payload:      \"{}\" ({} bytes)", message, payload.len());
    println!("Sequence No:  {}", seq);
    println!(
        "Frequency:    {:.0} Hz - {:.0} Hz (Band: {})",
        config.chirp_f_start,
        config.chirp_f_end,
        if ultrasonic { "Near-Ultrasonic" } else { "Audible Robust" }
    );
    println!("Sample Rate:  {:.0} Hz", config.sample_rate);

    let tx = AcousticTransmitter::new(config);

    if let Some(path) = wav {
        println!("\n[Mode] Exporting acoustic signal to WAV file: {:?}", path);
        let start = Instant::now();
        match tx.transmit_to_wav(payload, seq, &path) {
            Ok(()) => {
                println!(
                    "SUCCESS: Acoustic signal generated in {:.2?} and saved to {:?}",
                    start.elapsed(),
                    path
                );
            }
            Err(e) => {
                eprintln!("FAILURE: Error writing WAV: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        println!("\n[Mode] Transmitting through physical speaker hardware...");
        let start = Instant::now();
        match tx.transmit_airgap(payload, seq) {
            Ok(()) => {
                println!(
                    "SUCCESS: Acoustic frame transmitted in {:.2?}",
                    start.elapsed()
                );
            }
            Err(e) => {
                eprintln!("\nHARDWARE ERROR: Could not transmit through speaker: {}", e);
                eprintln!("Hint: If running on a headless server without physical speakers, export with --wav <FILE> to transfer to a physical device.");
                std::process::exit(1);
            }
        }
    }
}

fn run_rx(wav: Option<PathBuf>, duration: f32, ultrasonic: bool) {
    let config = if ultrasonic {
        PhyConfig::ultrasonic_stealth_48k()
    } else {
        PhyConfig::audible_robust_48k()
    };

    println!("=== SoundDrop Acoustic Receiver ===");
    println!(
        "Listening:    {:.0} Hz - {:.0} Hz (Band: {})",
        config.chirp_f_start,
        config.chirp_f_end,
        if ultrasonic { "Near-Ultrasonic" } else { "Audible Robust" }
    );

    let rx = AcousticReceiver::new(config);

    let report_res = if let Some(path) = wav {
        println!("[Mode] Reading acoustic signal from WAV: {:?}", path);
        rx.decode_wav(&path)
    } else {
        println!(
            "[Mode] Recording from physical microphone for {:.1} seconds...",
            duration
        );
        rx.receive_airgap(duration)
    };

    match report_res {
        Ok(report) => print_reception_report(&report),
        Err(e) => {
            eprintln!("\nRECEPTION FAILED: {}", e);
            std::process::exit(1);
        }
    }
}

fn print_reception_report(report: &ReceptionReport) {
    println!("\n========================================");
    println!(">>> FRAME RECEIVED & VERIFIED <<<");
    println!("========================================");
    println!("Sequence Number:      {}", report.frame.seq_num);
    println!("Frame Type:           {:?}", report.frame.frame_type);
    println!("Payload Length:       {} bytes", report.frame.payload.len());
    match String::from_utf8(report.frame.payload.clone()) {
        Ok(text) => println!("Payload (UTF-8):      \"{}\"", text),
        Err(_) => println!("Payload (Hex):        {:02X?}", report.frame.payload),
    }
    println!("Sync Correlation:     {:.3} (Match Quality)", report.sync_correlation);
    println!("Avg SNR Margin:       {:.2}x", report.avg_symbol_snr_margin);
    println!("Reed-Solomon Fixes:   {} symbols corrected", report.errors_corrected_by_fec);
    println!("CRC-32 Integrity:     VERIFIED (PASS)");
    println!("========================================");
}

fn run_bench(message: &str, snr_db: f32, click_noise: bool) {
    println!("=== SoundDrop Acoustic Physical Channel Benchmark ===");
    println!("Payload:      \"{}\" ({} bytes)", message, message.len());
    println!("Target SNR:   {:.1} dB", snr_db);
    println!("Click Noise:  {}", if click_noise { "ENABLED" } else { "DISABLED" });

    let cfg = PhyConfig::audible_robust_48k();
    let tx = AcousticTransmitter::new(cfg.clone());
    let rx = AcousticReceiver::new(cfg);

    let t0 = Instant::now();
    let mut pcm = tx.encode_payload(message.as_bytes(), 1).expect("Encode failed");
    let encode_duration = t0.elapsed();

    // Calculate signal power
    let sig_power: f32 = pcm.iter().map(|&x| x * x).sum::<f32>() / pcm.len() as f32;
    // SNR = 10 * log10(P_sig / P_noise) => P_noise = P_sig / 10^(SNR/10)
    let noise_power = sig_power / 10.0f32.powf(snr_db / 10.0);
    let noise_std = noise_power.sqrt();

    // Inject AWGN noise
    for (i, s) in pcm.iter_mut().enumerate() {
        let n = (((i as f32 * 41.7).sin() * 43758.5453).fract() - 0.5) * 2.0 * noise_std;
        *s += n;
    }

    // Inject transient click spikes
    if click_noise {
        let spike_idx = pcm.len() / 3;
        for i in spike_idx..spike_idx + 150 {
            if i < pcm.len() {
                pcm[i] = 1.0; // Click saturation
            }
        }
    }

    // Lead-in and lead-out silence
    let mut channel_pcm = vec![0.0f32; 2400]; // 50 ms
    channel_pcm.extend_from_slice(&pcm);
    channel_pcm.resize(channel_pcm.len() + 2400, 0.0);

    let t1 = Instant::now();
    let report = rx.decode_pcm(&channel_pcm).expect("Benchmark decoding failed");
    let decode_duration = t1.elapsed();

    assert_eq!(report.frame.payload, message.as_bytes());

    println!("\n=== Benchmark Results ===");
    println!("Frame Status:         DELIVERED & VERIFIED");
    println!("Encode Time:          {:.2?}", encode_duration);
    println!("Decode Time:          {:.2?}", decode_duration);
    println!("Acoustic Air-Time:    {:.2} seconds", pcm.len() as f32 / 48000.0);
    println!("Sync Correlation:     {:.3}", report.sync_correlation);
    println!("FEC Corrections:      {} symbols", report.errors_corrected_by_fec);
    println!("Symbol SNR Margin:    {:.2}x", report.avg_symbol_snr_margin);
    println!("Bit Error Rate (BER): 0.00% (Post-FEC)");
    println!("Packet Error Rate:    0.00%");
    println!("========================");
}
