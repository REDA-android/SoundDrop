//! High-level coordinator for SoundDrop Orbital Relay (SOR).
//! Manages message lifecycle: Creation -> Compression -> Encryption -> Satellite Queue -> Uplink -> Downlink -> Decryption.

use crate::packet::{OrbitalError, PacketFlags, SatelliteHeader, SatellitePacket};
use crate::provider::{SatelliteNetworkStatus, SatelliteProvider, TransmissionReceipt};
use crate::queue::OrbitalStoreAndForwardQueue;
use crate::voice::{Codec2Mode, VoiceMessageCompressor};
use sounddrop_crypto::{compute_recipient_hash, decrypt_frame, encrypt_frame};

pub struct OrbitalRelayManager<P: SatelliteProvider> {
    provider: P,
    queue: OrbitalStoreAndForwardQueue,
    next_msg_id: u16,
    receipts: Vec<TransmissionReceipt>,
}

impl<P: SatelliteProvider> OrbitalRelayManager<P> {
    pub fn new(provider: P) -> Self {
        Self {
            provider,
            queue: OrbitalStoreAndForwardQueue::default(),
            next_msg_id: 1,
            receipts: Vec::new(),
        }
    }

    pub fn provider(&self) -> &P {
        &self.provider
    }

    pub fn provider_mut(&mut self) -> &mut P {
        &mut self.provider
    }

    pub fn network_status(&self) -> SatelliteNetworkStatus {
        self.provider.network_status()
    }

    pub fn queued_count(&self) -> usize {
        self.queue.len()
    }

    pub fn receipts(&self) -> &[TransmissionReceipt] {
        &self.receipts
    }

    /// Enqueue an encrypted text message for satellite transmission
    pub fn enqueue_text_message(
        &mut self,
        session_key: &[u8; 32],
        recipient_pub: &[u8; 32],
        text: &str,
        priority: bool,
    ) -> Result<u16, OrbitalError> {
        let msg_id = self.next_msg_id;
        self.next_msg_id = self.next_msg_id.wrapping_add(1);

        let recipient_hash = compute_recipient_hash(recipient_pub);
        let mut flags = PacketFlags::ENCRYPTED;
        if priority {
            flags |= PacketFlags::PRIORITY;
        }

        // Encrypt with ChaCha20-Poly1305
        let plaintext = text.as_bytes();
        let timestamp = 1731150000; // Reference timestamp
        let mut aad = [0u8; 8];
        aad[0..2].copy_from_slice(&msg_id.to_be_bytes());
        aad[2..6].copy_from_slice(&recipient_hash);
        aad[6] = flags;
        aad[7] = 0;

        let ciphertext = encrypt_frame(session_key, msg_id as u64, &aad, plaintext)
            .map_err(|e| OrbitalError::ProviderError(format!("E2EE encryption failed: {:?}", e)))?;

        let header = SatelliteHeader::new(flags, msg_id, recipient_hash, timestamp, ciphertext.len() as u16);
        let packet = SatellitePacket::new(header, ciphertext);

        self.queue.push(packet)?;
        Ok(msg_id)
    }

    /// Enqueue an encrypted compressed voice message for satellite transmission
    pub fn enqueue_voice_message(
        &mut self,
        session_key: &[u8; 32],
        recipient_pub: &[u8; 32],
        mode: Codec2Mode,
        duration_ms: u32,
        encoded_frames: &[u8],
        priority: bool,
    ) -> Result<u16, OrbitalError> {
        let msg_id = self.next_msg_id;
        self.next_msg_id = self.next_msg_id.wrapping_add(1);

        let recipient_hash = compute_recipient_hash(recipient_pub);
        let mut flags = PacketFlags::VOICE | PacketFlags::ENCRYPTED;
        if priority {
            flags |= PacketFlags::PRIORITY;
        }

        // Pack voice payload with VoiceHeader
        let voice_payload = VoiceMessageCompressor::pack_voice_payload(mode, duration_ms, encoded_frames)?;

        let timestamp = 1731150000;
        let mut aad = [0u8; 8];
        aad[0..2].copy_from_slice(&msg_id.to_be_bytes());
        aad[2..6].copy_from_slice(&recipient_hash);
        aad[6] = flags;
        aad[7] = 0;

        let ciphertext = encrypt_frame(session_key, msg_id as u64, &aad, &voice_payload)
            .map_err(|e| OrbitalError::ProviderError(format!("Voice E2EE encryption failed: {:?}", e)))?;

        let header = SatelliteHeader::new(flags, msg_id, recipient_hash, timestamp, ciphertext.len() as u16);
        let packet = SatellitePacket::new(header, ciphertext);

        self.queue.push(packet)?;
        Ok(msg_id)
    }

    /// Attempt to transmit all queued packets over the satellite link
    pub fn process_uplink_queue(&mut self) -> Result<usize, OrbitalError> {
        let mut transmitted = 0;
        while let Some(packet) = self.queue.pop_next() {
            match self.provider.transmit(&packet) {
                Ok(receipt) => {
                    self.receipts.push(receipt);
                    transmitted += 1;
                }
                Err(OrbitalError::NoPassAvailable(_)) => {
                    // Put back and wait for next pass window
                    self.queue.push(packet)?;
                    break;
                }
                Err(e) => {
                    // Re-enqueue and return error
                    self.queue.push(packet)?;
                    return Err(e);
                }
            }
        }
        Ok(transmitted)
    }

    /// Process incoming downlink packets and decrypt if addressed to recipient
    pub fn process_downlinks(
        &mut self,
        session_key: &[u8; 32],
        recipient_pub: &[u8; 32],
    ) -> Result<Vec<(SatelliteHeader, Vec<u8>)>, OrbitalError> {
        let my_hash = compute_recipient_hash(recipient_pub);
        let packets = self.provider.poll_incoming()?;
        let mut decrypted_messages = Vec::new();

        for packet in packets {
            if packet.header.recipient_hash == my_hash {
                let mut aad = [0u8; 8];
                aad[0..2].copy_from_slice(&packet.header.msg_id.to_be_bytes());
                aad[2..6].copy_from_slice(&packet.header.recipient_hash);
                aad[6] = packet.header.flags;
                aad[7] = 0;

                let plaintext = decrypt_frame(
                    session_key,
                    packet.header.msg_id as u64,
                    &aad,
                    &packet.payload,
                ).map_err(|e| OrbitalError::ProviderError(format!("Decryption failed: {:?}", e)))?;

                decrypted_messages.push((packet.header, plaintext));
            }
        }

        Ok(decrypted_messages)
    }
}
