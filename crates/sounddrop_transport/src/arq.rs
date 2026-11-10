use crate::segment::{segment_payload, MessageReassembler, SegmentError};
use sounddrop_link::{Frame, FrameType};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ArqError {
    #[error("Exceeded maximum retransmission attempts ({0})")]
    ExceededMaxRetries(usize),
    #[error("Segmentation error: {0}")]
    Segmentation(#[from] SegmentError),
    #[error("ARQ session already completed")]
    AlreadyCompleted,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ArqConfig {
    pub max_retries: usize,
    pub timeout_sec: f32,
    pub turnaround_delay_sec: f32,
}

impl Default for ArqConfig {
    fn default() -> Self {
        Self {
            max_retries: 4,
            timeout_sec: 4.5,
            turnaround_delay_sec: 0.1, // 100 ms acoustic decay pause
        }
    }
}

/// Event emitted by ArqSender when processing events.
#[derive(Debug, Clone, PartialEq)]
pub enum ArqSenderEvent {
    /// Frame was acknowledged; advanced to the next frame.
    Advanced { next_seq: u8, frame_index: usize, total_frames: usize },
    /// All frames in sequence have been successfully delivered and acknowledged.
    AllDelivered,
    /// Timeout or NACK occurred; retransmitting current frame.
    Retransmit { seq_num: u8, retries_used: usize },
    /// Outdated or duplicate ACK was received; ignored.
    Ignored,
}

/// Stop-and-Wait ARQ Transmitter State Machine.
pub struct ArqSender {
    config: ArqConfig,
    frames: Vec<Frame>,
    current_idx: usize,
    retries_used: usize,
    completed: bool,
}

impl ArqSender {
    pub fn new(message: &[u8], start_seq: u8, config: ArqConfig) -> Result<Self, ArqError> {
        let frames = segment_payload(message, start_seq)?;
        Ok(Self {
            config,
            frames,
            current_idx: 0,
            retries_used: 0,
            completed: false,
        })
    }

    pub fn is_completed(&self) -> bool {
        self.completed
    }

    pub fn total_frames(&self) -> usize {
        self.frames.len()
    }

    pub fn current_index(&self) -> usize {
        self.current_idx
    }

    /// Returns the frame that should currently be transmitted over the air.
    pub fn current_frame(&self) -> Option<&Frame> {
        if self.completed {
            None
        } else {
            self.frames.get(self.current_idx)
        }
    }

    /// Handles an incoming ACK frame.
    pub fn handle_ack(&mut self, ack_seq: u8) -> ArqSenderEvent {
        if self.completed {
            return ArqSenderEvent::Ignored;
        }

        if let Some(expected) = self.current_frame() {
            if ack_seq == expected.seq_num {
                self.current_idx += 1;
                self.retries_used = 0;

                if self.current_idx >= self.frames.len() {
                    self.completed = true;
                    ArqSenderEvent::AllDelivered
                } else {
                    let next_seq = self.frames[self.current_idx].seq_num;
                    ArqSenderEvent::Advanced {
                        next_seq,
                        frame_index: self.current_idx,
                        total_frames: self.frames.len(),
                    }
                }
            } else {
                ArqSenderEvent::Ignored
            }
        } else {
            ArqSenderEvent::Ignored
        }
    }

    /// Handles an incoming NACK frame (receiver requests retransmit of a missing sequence).
    pub fn handle_nack(&mut self, nack_seq: u8) -> Result<ArqSenderEvent, ArqError> {
        if let Some(expected) = self.current_frame() {
            if nack_seq == expected.seq_num {
                self.trigger_retransmit()
            } else {
                Ok(ArqSenderEvent::Ignored)
            }
        } else {
            Ok(ArqSenderEvent::Ignored)
        }
    }

    /// Handles an acknowledgment timeout.
    pub fn handle_timeout(&mut self) -> Result<ArqSenderEvent, ArqError> {
        self.trigger_retransmit()
    }

    fn trigger_retransmit(&mut self) -> Result<ArqSenderEvent, ArqError> {
        if self.completed {
            return Err(ArqError::AlreadyCompleted);
        }

        self.retries_used += 1;
        if self.retries_used > self.config.max_retries {
            return Err(ArqError::ExceededMaxRetries(self.config.max_retries));
        }

        let seq_num = self.frames[self.current_idx].seq_num;
        Ok(ArqSenderEvent::Retransmit {
            seq_num,
            retries_used: self.retries_used,
        })
    }
}

/// Action to be executed by the receiver node.
#[derive(Debug, Clone, PartialEq)]
pub enum ArqReceiverAction {
    /// Send an ACK frame back to the transmitter.
    SendAck(Frame),
    /// Send an ACK frame and the message has been completely reassembled.
    SendAckAndComplete { ack_frame: Frame, message: Vec<u8> },
    /// Send a NACK frame requesting the missing expected sequence.
    SendNack(Frame),
    /// Frame was unparseable or irrelevant; no acoustic transmission required.
    Ignore,
}

/// Stop-and-Wait ARQ Receiver State Machine with duplicate suppression.
pub struct ArqReceiver {
    expected_seq: u8,
    reassembler: MessageReassembler,
    completed_message: Option<Vec<u8>>,
}

impl ArqReceiver {
    pub fn new(expected_start_seq: u8) -> Self {
        Self {
            expected_seq: expected_start_seq,
            reassembler: MessageReassembler::new(expected_start_seq),
            completed_message: None,
        }
    }

    pub fn is_completed(&self) -> bool {
        self.completed_message.is_some()
    }

    pub fn completed_message(&self) -> Option<&[u8]> {
        self.completed_message.as_deref()
    }

    /// Processes an incoming frame from the acoustic physical layer.
    pub fn process_frame(&mut self, frame: &Frame) -> ArqReceiverAction {
        if frame.frame_type != FrameType::Data && frame.frame_type != FrameType::DataEnd {
            return ArqReceiverAction::Ignore;
        }

        if frame.seq_num == self.expected_seq {
            // In-order expected frame
            let _ = self.reassembler.push_frame(frame);
            let ack_frame = Frame {
                frame_type: FrameType::Ack,
                seq_num: frame.seq_num,
                payload: Vec::new(),
            };

            self.expected_seq = self.expected_seq.wrapping_add(1);

            if self.reassembler.is_completed() {
                let msg = self.reassembler.payload().unwrap_or_default().to_vec();
                self.completed_message = Some(msg.clone());
                ArqReceiverAction::SendAckAndComplete {
                    ack_frame,
                    message: msg,
                }
            } else {
                ArqReceiverAction::SendAck(ack_frame)
            }
        } else {
            // Sequence mismatch: check if duplicate
            let diff = self.expected_seq.wrapping_sub(frame.seq_num);
            if diff < 128 {
                // Older sequence: DUPLICATE! Transmitter missed our previous ACK.
                // Re-send ACK so transmitter unblocks, but do not re-add duplicate payload!
                let ack_frame = Frame {
                    frame_type: FrameType::Ack,
                    seq_num: frame.seq_num,
                    payload: Vec::new(),
                };
                ArqReceiverAction::SendAck(ack_frame)
            } else {
                // Newer sequence: missed an earlier frame. Send NACK for the missing sequence.
                let nack_frame = Frame {
                    frame_type: FrameType::Nack,
                    seq_num: self.expected_seq,
                    payload: Vec::new(),
                };
                ArqReceiverAction::SendNack(nack_frame)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_arq_clean_transmission() {
        let msg = b"TEST_ARQ_DELIVERY_CLEAN";
        let mut sender = ArqSender::new(msg, 0, ArqConfig::default()).unwrap();
        let mut receiver = ArqReceiver::new(0);

        while !sender.is_completed() {
            let frame = sender.current_frame().unwrap().clone();
            let action = receiver.process_frame(&frame);

            match action {
                ArqReceiverAction::SendAck(ack) => {
                    let ev = sender.handle_ack(ack.seq_num);
                    assert!(matches!(ev, ArqSenderEvent::Advanced { .. }));
                }
                ArqReceiverAction::SendAckAndComplete { ack_frame, message } => {
                    let ev = sender.handle_ack(ack_frame.seq_num);
                    assert_eq!(ev, ArqSenderEvent::AllDelivered);
                    assert_eq!(&message, msg);
                }
                _ => panic!("Unexpected receiver action on clean link"),
            }
        }

        assert!(sender.is_completed());
        assert!(receiver.is_completed());
        assert_eq!(receiver.completed_message().unwrap(), msg);
    }

    #[test]
    fn test_arq_recovers_from_dropped_ack() {
        let msg = b"SHORT_MSG";
        let mut sender = ArqSender::new(msg, 5, ArqConfig::default()).unwrap();
        let mut receiver = ArqReceiver::new(5);

        let frame = sender.current_frame().unwrap().clone();

        // 1. Receiver gets frame, emits ACK
        let action1 = receiver.process_frame(&frame);
        let ack1 = match action1 {
            ArqReceiverAction::SendAckAndComplete { ack_frame, .. } => ack_frame,
            _ => panic!("Expected SendAckAndComplete"),
        };

        // 2. ACK1 is dropped by acoustic noise! (Sender never receives it)
        // Sender times out:
        let timeout_ev = sender.handle_timeout().expect("Should retransmit");
        assert_eq!(timeout_ev, ArqSenderEvent::Retransmit { seq_num: 5, retries_used: 1 });

        // 3. Sender retransmits frame 5
        let action2 = receiver.process_frame(&frame);
        // Receiver must identify duplicate, reject duplicate data, and re-emit ACK
        let ack2 = match action2 {
            ArqReceiverAction::SendAck(ack) => ack,
            _ => panic!("Receiver should emit ACK for duplicate"),
        };
        assert_eq!(ack1.seq_num, ack2.seq_num);

        // 4. Sender receives retransmitted ACK
        let ack_ev = sender.handle_ack(ack2.seq_num);
        assert_eq!(ack_ev, ArqSenderEvent::AllDelivered);
        assert!(sender.is_completed());
        assert_eq!(receiver.completed_message().unwrap(), msg);
    }

    #[test]
    fn test_arq_exceeds_max_retries_on_dead_channel() {
        let mut sender = ArqSender::new(b"FAIL_TEST", 0, ArqConfig {
            max_retries: 2,
            ..Default::default()
        }).unwrap();

        assert!(sender.handle_timeout().is_ok()); // retry 1
        assert!(sender.handle_timeout().is_ok()); // retry 2
        let err = sender.handle_timeout().unwrap_err(); // retry 3 -> exceeds max 2
        assert_eq!(err, ArqError::ExceededMaxRetries(2));
    }
}
