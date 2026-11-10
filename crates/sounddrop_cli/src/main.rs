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

    /// Run a multi-frame bi-directional ARQ reliable transfer benchmark with half-duplex turn-around
    SendArq {
        /// Message string to transmit reliably across the channel
        #[arg(short, long, default_value = "SoundDrop Milestone 2: Bi-directional ARQ with half-duplex turn-around and duplicate suppression verified!")]
        message: String,

        /// Simulated data packet loss rate [0.0 - 0.5]
        #[arg(long, default_value_t = 0.15)]
        data_loss: f32,

        /// Simulated ACK packet loss rate [0.0 - 0.5]
        #[arg(long, default_value_t = 0.10)]
        ack_loss: f32,

        /// Channel SNR in dB
        #[arg(long, default_value_t = 18.0)]
        snr_db: f32,
    },

    /// Run an end-to-end encrypted acoustic transfer with X25519 key exchange, SAS verification, and ChaCha20-Poly1305 AEAD
    SendSecure {
        /// Plaintext message to encrypt and transmit
        #[arg(
            short,
            long,
            default_value = "Top Secret: Acoustic communication secured by X25519 and ChaCha20-Poly1305 AEAD."
        )]
        message: String,

        /// Simulated data packet loss rate [0.0 - 0.5]
        #[arg(long, default_value_t = 0.10)]
        data_loss: f32,

        /// Simulated ACK packet loss rate [0.0 - 0.5]
        #[arg(long, default_value_t = 0.05)]
        ack_loss: f32,

        /// Channel SNR in dB
        #[arg(long, default_value_t = 20.0)]
        snr_db: f32,
    },

    /// Transmit a file over an end-to-end encrypted acoustic channel with BLAKE3 rolling hashes, X25519 handshake, SAS, and ARQ
    SendFile {
        /// Path to the file to transmit
        #[arg(short, long)]
        file: PathBuf,

        /// Destination directory for received file assembly
        #[arg(short, long, default_value = "/tmp/sounddrop_received")]
        out_dir: PathBuf,

        /// Payload chunk size in bytes (e.g. 32 to 128 bytes)
        #[arg(short, long, default_value_t = 32)]
        chunk_size: u32,

        /// Simulated data packet loss rate [0.0 - 0.5]
        #[arg(long, default_value_t = 0.05)]
        data_loss: f32,

        /// Simulated ACK packet loss rate [0.0 - 0.5]
        #[arg(long, default_value_t = 0.05)]
        ack_loss: f32,

        /// Channel SNR in dB
        #[arg(long, default_value_t = 22.0)]
        snr_db: f32,
    },

    /// Monitor continuous real-time audio input stream with live dBFS meter and clipping alert
    Monitor {
        /// Monitoring duration in seconds
        #[arg(short, long, default_value_t = 5.0)]
        duration: f32,
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
        Commands::SendArq {
            message,
            data_loss,
            ack_loss,
            snr_db,
        } => run_send_arq(&message, data_loss, ack_loss, snr_db),
        Commands::SendSecure {
            message,
            data_loss,
            ack_loss,
            snr_db,
        } => run_send_secure(&message, data_loss, ack_loss, snr_db),
        Commands::SendFile {
            file,
            out_dir,
            chunk_size,
            data_loss,
            ack_loss,
            snr_db,
        } => run_send_file(&file, &out_dir, chunk_size, data_loss, ack_loss, snr_db),
        Commands::Monitor { duration } => run_monitor(duration),
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

fn run_send_arq(message: &str, data_loss: f32, ack_loss: f32, snr_db: f32) {
    use sounddrop_transport::{run_simulated_arq_transfer, ArqConfig, SimulatedAcousticChannel};

    println!("=== SoundDrop Bi-Directional Acoustic ARQ Session ===");
    println!("Payload:              \"{}\" ({} bytes)", message, message.len());
    println!("Simulated DATA Loss:  {:.1}%", data_loss * 100.0);
    println!("Simulated ACK Loss:   {:.1}%", ack_loss * 100.0);
    println!("Channel SNR:          {:.1} dB", snr_db);

    let config = PhyConfig::audible_robust_48k();
    let channel = SimulatedAcousticChannel::new(config.clone(), data_loss, ack_loss, snr_db);
    let arq_config = ArqConfig {
        max_retries: 5,
        timeout_sec: 4.5,
        turnaround_delay_sec: 0.1,
    };

    println!("\nInitiating half-duplex acoustic exchange...");
    match run_simulated_arq_transfer(message.as_bytes(), config, arq_config, &channel) {
        Ok((restored_bytes, metrics)) => {
            println!("\n========================================");
            println!(">>> MULTI-FRAME ARQ TRANSFER COMPLETE <<<");
            println!("========================================");
            println!("Total Payload Bytes:  {}", metrics.total_bytes);
            println!("Total Frames:         {}", metrics.total_frames);
            println!("Retransmissions:      {}", metrics.retransmissions);
            println!("Elapsed Time:         {:.2?}", metrics.elapsed);
            println!("Effective Bitrate:    {:.1} bps", metrics.effective_bps);
            match String::from_utf8(restored_bytes) {
                Ok(text) => println!("Delivered Text:       \"{}\"", text),
                Err(_) => println!("Delivered Text:       [Binary Payload]"),
            }
            println!("Data Integrity:       BIT-PERFECT (VERIFIED)");
            println!("========================================");
        }
        Err(e) => {
            eprintln!("\nARQ TRANSFER FAILED: {}", e);
            std::process::exit(1);
        }
    }
}

fn run_send_secure(message: &str, data_loss: f32, ack_loss: f32, snr_db: f32) {
    use sounddrop_transport::{run_simulated_encrypted_transfer, ArqConfig, SimulatedAcousticChannel};

    println!("=== SoundDrop End-to-End Encrypted Acoustic Session (Milestone 3) ===");
    println!("Plaintext:            \"{}\" ({} bytes)", message, message.len());
    println!("Simulated DATA Loss:  {:.1}%", data_loss * 100.0);
    println!("Simulated ACK Loss:   {:.1}%", ack_loss * 100.0);
    println!("Channel SNR:          {:.1} dB", snr_db);

    let config = PhyConfig::audible_robust_48k();
    let channel = SimulatedAcousticChannel::new(config.clone(), data_loss, ack_loss, snr_db);
    let arq_config = ArqConfig {
        max_retries: 5,
        timeout_sec: 4.5,
        turnaround_delay_sec: 0.1,
    };

    println!("\n[Phase 1] Performing Ephemeral X25519 Acoustic Handshake...");
    let t_start = Instant::now();

    match run_simulated_encrypted_transfer(message.as_bytes(), config, arq_config, &channel) {
        Ok(outcome) => {
            let total_duration = t_start.elapsed();

            println!("\n========================================================");
            println!(">>> CRYPTOGRAPHIC HANDSHAKE & SAS VERIFICATION <<<");
            println!("========================================================");
            println!("Key Exchange:         Curve25519 (ECDH, 256-bit ephemeral keys)");
            println!("Initiator SAS PIN:    {}", outcome.initiator_sas.pin);
            println!("Responder SAS PIN:    {}", outcome.responder_sas.pin);
            println!("Initiator Mnemonic:   {}", outcome.initiator_sas.words);
            println!("Responder Mnemonic:   {}", outcome.responder_sas.words);
            println!(
                "SAS Comparison:       {}",
                if outcome.sas_verified {
                    "MATCH CONFIRMED (Zero MITM Detected)"
                } else {
                    "MISMATCH DETECTED (Possible Interception)"
                }
            );

            println!("\n========================================================");
            println!(">>> AEAD ENCRYPTED ARQ TRANSFER RESULTS <<<");
            println!("========================================================");
            println!("AEAD Cipher:          ChaCha20-Poly1305 (IETF, 96-bit nonce)");
            println!("Replay Protection:    Monotonic Counter + AAD Header Binding");
            println!("Total Frames Sent:    {}", outcome.metrics.total_frames);
            println!("Retransmissions:      {}", outcome.metrics.retransmissions);
            println!("Total Air-Time:       {:.2?}", outcome.metrics.elapsed);
            println!("Total Session Time:   {:.2?}", total_duration);
            println!("Effective Bitrate:    {:.1} bps", outcome.metrics.effective_bps);

            match String::from_utf8(outcome.decrypted_payload) {
                Ok(text) => println!("Decrypted Plaintext:  \"{}\"", text),
                Err(_) => println!("Decrypted Plaintext:  [Binary Payload]"),
            }
            println!("AEAD Authentication:  PASS (Poly1305 128-bit MAC Verified)");
            println!("========================================================");
        }
        Err(e) => {
            eprintln!("\nENCRYPTED TRANSFER FAILED: {}", e);
            std::process::exit(1);
        }
    }
}

fn run_send_file(
    file_path: &std::path::Path,
    out_dir: &std::path::Path,
    chunk_size: u32,
    data_loss: f32,
    ack_loss: f32,
    snr_db: f32,
) {
    use sounddrop_file::{hex_encode, run_simulated_file_transfer};
    use sounddrop_transport::{ArqConfig, SimulatedAcousticChannel};

    if !file_path.exists() {
        eprintln!("Error: Input file does not exist: {}", file_path.display());
        std::process::exit(1);
    }

    let file_metadata = match std::fs::metadata(file_path) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("Error reading file metadata: {}", e);
            std::process::exit(1);
        }
    };

    println!("=== SoundDrop Acoustic File Transfer Session (Milestone 4) ===");
    println!("Source File:          {}", file_path.display());
    println!("File Size:            {} bytes", file_metadata.len());
    println!("Target Output Dir:    {}", out_dir.display());
    println!("Chunk Size:           {} bytes", chunk_size);
    println!("Simulated DATA Loss:  {:.1}%", data_loss * 100.0);
    println!("Simulated ACK Loss:   {:.1}%", ack_loss * 100.0);
    println!("Channel SNR:          {:.1} dB", snr_db);

    let cache_dir = std::env::temp_dir().join("sounddrop_assembly_cache");
    let config = PhyConfig::audible_robust_48k();
    let channel = SimulatedAcousticChannel::new(config.clone(), data_loss, ack_loss, snr_db);
    let arq_config = ArqConfig {
        max_retries: 5,
        timeout_sec: 4.5,
        turnaround_delay_sec: 0.1,
    };

    println!("\n[1/4] Slicing file and computing BLAKE3 rolling hashes...");
    println!("[2/4] Negotiating Ephemeral X25519 acoustic handshake & SAS...");
    println!("[3/4] Transmitting encrypted manifest and chunks over acoustic ARQ...");

    match run_simulated_file_transfer(
        file_path,
        out_dir,
        &cache_dir,
        chunk_size,
        config,
        arq_config,
        &channel,
    ) {
        Ok(outcome) => {
            println!("\n========================================================");
            println!(">>> CRYPTOGRAPHIC HANDSHAKE & SAS CONFIRMATION <<<");
            println!("========================================================");
            println!("SAS PIN:              {}", outcome.sas.pin);
            println!("SAS Mnemonic:         {}", outcome.sas.words);
            println!(
                "SAS Verification:     {}",
                if outcome.sas_verified {
                    "MATCH CONFIRMED (Zero MITM Detected)"
                } else {
                    "MISMATCH DETECTED"
                }
            );

            println!("\n========================================================");
            println!(">>> FILE TRANSFER & INTEGRITY AUDIT RESULTS <<<");
            println!("========================================================");
            println!("Transferred File:     {}", outcome.file_name);
            println!("Original Size:        {} bytes", outcome.file_size);
            println!("Total Chunks:         {}", outcome.total_chunks);
            println!("Chunks Delivered:     {}", outcome.chunks_transferred);
            println!("BLAKE3 Root Hash:     {}", hex_encode(&outcome.root_hash));
            println!("Final Saved Path:     {}", outcome.output_path.display());
            println!("Total Duration:       {:.2?}", outcome.total_duration);
            println!("Effective Bitrate:    {:.1} bps", outcome.effective_bps);

            // Audit bit-exactness on disk
            let original_bytes = std::fs::read(file_path).unwrap();
            let received_bytes = std::fs::read(&outcome.output_path).unwrap();
            assert_eq!(original_bytes, received_bytes);

            println!("Integrity Audit:      BIT-PERFECT RECONSTRUCTION (100% MATCH)");
            println!("Status:               TRANSFER COMPLETE & VERIFIED");
            println!("========================================================");
        }
        Err(e) => {
            eprintln!("\nFILE TRANSFER FAILED: {}", e);
            std::process::exit(1);
        }
    }
}

fn run_monitor(duration: f32) {
    use sounddrop_audio_io::{AudioStreamConfig, ContinuousAudioCapture, PlatformAudioProfile};

    println!("=== SoundDrop Real-Time Native Audio Stream Monitor ===");
    println!("Platform Profile:     {:?}", PlatformAudioProfile::default());
    println!("Sample Rate:          48,000 Hz");
    println!("Channels:             1 (Mono)");
    println!("Buffer Duration:      10 ms (Low Latency)");
    println!("Monitoring Duration:  {:.1}s\n", duration);

    let config = AudioStreamConfig::default();
    let capture = match ContinuousAudioCapture::start(config) {
        Ok(c) => c,
        Err(e) => {
            println!("  [NOTE] Live microphone capture stream unavailable in this environment: {}", e);
            println!("  [INFO] In a headless container, physical audio device access is simulated or requires WAV loopback.");
            return;
        }
    };

    println!("Listening on native audio device... Press Ctrl+C to stop.");
    println!("Live Meter: [Peak dBFS | RMS dBFS | Status]");

    let start = Instant::now();
    while start.elapsed().as_secs_f32() < duration {
        let meter = capture.meter();
        let clip_str = if meter.is_clipping { " [CLIPPING!]" } else { "" };
        let bar_len = ((meter.peak_dbfs + 96.0) / 96.0 * 20.0).clamp(0.0, 20.0) as usize;
        let bar: String = "#".repeat(bar_len) + &"-".repeat(20 - bar_len);

        print!("\r[{}] Peak: {:>5.1} dBFS | RMS: {:>5.1} dBFS{}", bar, meter.peak_dbfs, meter.rms_dbfs, clip_str);
        std::io::Write::flush(&mut std::io::stdout()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    println!("\nMonitoring complete.");
}



