use crate::arq::{ArqConfig, ArqError, ArqReceiver, ArqReceiverAction, ArqSender};
use sounddrop_core::CoreError;
use sounddrop_link::{Frame, LinkEngine};
use sounddrop_phy::{Modulator, PhyConfig};
use std::time::{Duration, Instant};

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("ARQ protocol error: {0}")]
    Arq(#[from] ArqError),
    #[error("Core acoustic error: {0}")]
    Core(#[from] CoreError),
    #[error("Framing error: {0}")]
    Frame(#[from] sounddrop_link::FrameError),
}

/// Statistics and metrics for an acoustic multi-frame ARQ transfer.
#[derive(Debug, Clone)]
pub struct TransferMetrics {
    pub total_bytes: usize,
    pub total_frames: usize,
    pub retransmissions: usize,
    pub elapsed: Duration,
    pub effective_bps: f32,
}

/// Simulated half-duplex acoustic link for deterministic integration testing.
pub struct SimulatedAcousticChannel {
    pub data_loss_rate: f32,
    pub ack_loss_rate: f32,
    pub snr_db: f32,
    packet_counter: std::sync::atomic::AtomicUsize,
    tx_engine: LinkEngine,
    rx_engine: LinkEngine,
    modulator: Modulator,
    demodulator: sounddrop_phy::Demodulator,
}

impl SimulatedAcousticChannel {
    pub fn new(config: PhyConfig, data_loss_rate: f32, ack_loss_rate: f32, snr_db: f32) -> Self {
        Self {
            data_loss_rate,
            ack_loss_rate,
            snr_db,
            packet_counter: std::sync::atomic::AtomicUsize::new(0),
            tx_engine: LinkEngine::default(),
            rx_engine: LinkEngine::default(),
            modulator: Modulator::new(config.clone()),
            demodulator: sounddrop_phy::Demodulator::new(config),
        }
    }

    /// Transmits a frame across the simulated acoustic channel.
    /// Modulates to PCM samples, adds noise, and demodulates back to a Frame.
    pub fn exchange_frame(&self, frame: &Frame, is_ack: bool) -> Result<Option<Frame>, SessionError> {
        // Check simulated packet drop
        let drop_prob = if is_ack {
            self.ack_loss_rate
        } else {
            self.data_loss_rate
        };

        if drop_prob > 0.0 {
            let count = self.packet_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let hash = ((count as f32 * 107.31 + frame.seq_num as f32 * 17.3).sin() * 43758.5453).abs().fract();
            if hash < drop_prob {
                return Ok(None); // Dropped by simulated acoustic channel
            }
        }

        // 1. Link Layer: Frame to symbols
        let symbols = self.tx_engine.frame_to_symbols(frame)?;

        // 2. Physical Layer: Modulate to PCM
        let mut pcm = self.modulator.modulate(&symbols);

        // 3. Channel Simulation: Add AWGN noise
        if self.snr_db < 40.0 {
            let sig_power: f32 = pcm.iter().map(|&x| x * x).sum::<f32>() / pcm.len() as f32;
            let noise_power = sig_power / 10.0f32.powf(self.snr_db / 10.0);
            let noise_std = noise_power.sqrt();

            for (i, s) in pcm.iter_mut().enumerate() {
                let n = (((i as f32 * 23.9).sin() * 43758.5453).fract() - 0.5) * 2.0 * noise_std;
                *s += n;
            }
        }

        // Add 50 ms lead-in silence
        let mut channel_pcm = vec![0.0f32; 2400];
        channel_pcm.extend_from_slice(&pcm);
        channel_pcm.resize(channel_pcm.len() + 2400, 0.0);

        // 4. Physical Layer: Demodulate PCM
        let max_symbols = symbols.len() + 20;
        let output = match self.demodulator.demodulate_buffer(&channel_pcm, max_symbols) {
            Some(out) => out,
            None => return Ok(None), // Failed preamble detection
        };

        // 5. Link Layer: Symbols to Frame
        match self.rx_engine.symbols_to_frame(&output.symbols) {
            Ok((decoded, _)) => Ok(Some(decoded)),
            Err(_) => Ok(None), // Corrupted frame rejected by FEC/CRC
        }
    }
}

/// Executes a complete multi-frame ARQ exchange between a sender and receiver over a simulated channel.
pub fn run_simulated_arq_transfer(
    message: &[u8],
    _config: PhyConfig,
    arq_config: ArqConfig,
    channel: &SimulatedAcousticChannel,
) -> Result<(Vec<u8>, TransferMetrics), SessionError> {
    let start_time = Instant::now();
    let mut sender = ArqSender::new(message, 0, arq_config)?;
    let mut receiver = ArqReceiver::new(0);

    let mut retransmissions = 0usize;
    let total_frames = sender.total_frames();
    let mut completed_msg = Vec::new();

    while !sender.is_completed() {
        let current_frame = sender.current_frame().unwrap().clone();

        // 1. Sender transmits DATA frame over channel
        let rx_data = channel.exchange_frame(&current_frame, false)?;

        if let Some(frame) = rx_data {
            // Receiver processes incoming DATA frame
            let rx_action = receiver.process_frame(&frame);

            match rx_action {
                ArqReceiverAction::SendAck(ack_frame) => {
                    // Receiver transmits ACK frame back to sender
                    let rx_ack = channel.exchange_frame(&ack_frame, true)?;
                    if let Some(ack) = rx_ack {
                        let _ = sender.handle_ack(ack.seq_num);
                    } else {
                        // ACK was lost in air
                        retransmissions += 1;
                        let _ = sender.handle_timeout()?;
                    }
                }
                ArqReceiverAction::SendAckAndComplete { ack_frame, message } => {
                    // Final chunk received! Send final ACK back to sender
                    completed_msg = message;
                    let rx_ack = channel.exchange_frame(&ack_frame, true)?;
                    if let Some(ack) = rx_ack {
                        let _ = sender.handle_ack(ack.seq_num);
                    } else {
                        retransmissions += 1;
                        let _ = sender.handle_timeout()?;
                    }
                }
                ArqReceiverAction::SendNack(nack_frame) => {
                    let rx_nack = channel.exchange_frame(&nack_frame, true)?;
                    if let Some(nack) = rx_nack {
                        retransmissions += 1;
                        let _ = sender.handle_nack(nack.seq_num)?;
                    }
                }
                ArqReceiverAction::Ignore => {}
            }
        } else {
            // DATA frame was lost in air
            retransmissions += 1;
            let _ = sender.handle_timeout()?;
        }
    }

    let elapsed = start_time.elapsed();
    let elapsed_sec = elapsed.as_secs_f32().max(0.001);
    let effective_bps = (message.len() * 8) as f32 / elapsed_sec;

    Ok((
        completed_msg,
        TransferMetrics {
            total_bytes: message.len(),
            total_frames,
            retransmissions,
            elapsed,
            effective_bps,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_multi_frame_lossless_simulation() {
        let config = PhyConfig::audible_robust_48k();
        let channel = SimulatedAcousticChannel::new(config.clone(), 0.0, 0.0, 25.0);
        let arq_cfg = ArqConfig::default();

        let test_message = b"SoundDrop Milestone 2: Multi-frame ARQ data link proven across acoustic physical layers with automatic segmentation and reassembly!";
        let (restored, metrics) = run_simulated_arq_transfer(test_message, config, arq_cfg, &channel)
            .expect("Transfer failed");

        assert_eq!(&restored, test_message);
        assert_eq!(metrics.retransmissions, 0, "No retransmissions on clean link");
        assert!(metrics.total_frames >= 3, "Message should be segmented into at least 3 frames");
    }

    #[test]
    fn test_session_recovers_with_20_percent_loss() {
        let config = PhyConfig::audible_robust_48k();
        // 20% data frame loss, 15% ACK loss, 15 dB SNR
        let channel = SimulatedAcousticChannel::new(config.clone(), 0.20, 0.15, 15.0);
        let arq_cfg = ArqConfig {
            max_retries: 6,
            ..Default::default()
        };

        let test_message = b"RESILIENT_DATA_ACROSS_LOSSY_AIR_CHANNEL";
        let (restored, metrics) = run_simulated_arq_transfer(test_message, config, arq_cfg, &channel)
            .expect("Transfer should recover across lossy channel");

        assert_eq!(&restored, test_message);
        assert!(metrics.retransmissions > 0, "Lossy channel should trigger retransmissions");
    }
}
