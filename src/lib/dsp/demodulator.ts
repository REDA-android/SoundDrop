/**
 * Acoustic Demodulator Engine (Receiver Pipeline)
 * Continuous real-time stream ingestion -> Chirp preamble detection -> Clock sync ->
 * Goertzel filter bank -> Byte assembly -> FEC correction -> Packet reassembly.
 */

import { ModemConfig, Packet, DemodState, Telemetry, DropResult } from '@/types/acoustic';
import { AUDIBLE_CONFIG, getFskFrequencies } from './constants';
import { ChirpEngine } from './chirp';
import { GoertzelFilterBank } from './goertzel';
import { parsePacketFrame, PacketAssembler, SYNC_WORD, HEADER_SIZE, FEC_PARITY_SIZE, CRC_SIZE } from '../protocol/packetizer';

export interface DemodulatorCallbacks {
  onTelemetry?: (telemetry: Telemetry) => void;
  onStateChange?: (state: DemodState) => void;
  onPacketReceived?: (packet: Packet, healed: boolean) => void;
  onDropCompleted?: (drop: DropResult) => void;
  onError?: (err: string) => void;
}

export class DemodulatorEngine {
  private config: ModemConfig;
  private chirpEngine: ChirpEngine;
  private filterBank: GoertzelFilterBank;
  private assembler: PacketAssembler;
  private callbacks: DemodulatorCallbacks;

  private state: DemodState = 'IDLE';

  // Ring buffer for incoming PCM samples
  private ringBuffer: Float32Array;
  private ringWriteIndex = 0;
  private samplesAvailable = 0;

  // Decoding tracking
  private syncSampleIndex = -1;
  private currentNibbleIndex = 0;
  private nibbleBuffer: number[] = [];
  private byteBuffer: number[] = [];

  // Telemetry stats
  private framesDecoded = 0;
  private crcErrors = 0;
  private fecCorrections = 0;

  constructor(config: ModemConfig = AUDIBLE_CONFIG, callbacks: DemodulatorCallbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;
    this.chirpEngine = new ChirpEngine(config);
    this.filterBank = new GoertzelFilterBank(getFskFrequencies(config), config.sampleRate);
    this.assembler = new PacketAssembler();

    // 2-second circular buffer capacity
    const ringCapacity = config.sampleRate * 2;
    this.ringBuffer = new Float32Array(ringCapacity);
  }

  public setConfig(config: ModemConfig): void {
    this.config = config;
    this.chirpEngine = new ChirpEngine(config);
    this.filterBank = new GoertzelFilterBank(getFskFrequencies(config), config.sampleRate);
    this.reset();
  }

  public reset(): void {
    this.state = 'LISTENING_FOR_CHIRP';
    this.ringWriteIndex = 0;
    this.samplesAvailable = 0;
    this.syncSampleIndex = -1;
    this.currentNibbleIndex = 0;
    this.nibbleBuffer = [];
    this.byteBuffer = [];
    this.assembler.reset();
    this.callbacks.onStateChange?.(this.state);
  }

  public start(): void {
    this.reset();
  }

  public stop(): void {
    this.state = 'IDLE';
    this.callbacks.onStateChange?.('IDLE');
  }

  public getState(): DemodState {
    return this.state;
  }

  public getAssembler(): PacketAssembler {
    return this.assembler;
  }

  /**
   * Primary streaming entry point: Ingests chunks of PCM float32 samples from microphone
   */
  public processAudioChunk(chunk: Float32Array): void {
    if (this.state === 'IDLE') return;

    // Push into circular buffer
    const N = chunk.length;
    const capacity = this.ringBuffer.length;

    for (let i = 0; i < N; i++) {
      this.ringBuffer[this.ringWriteIndex] = chunk[i];
      this.ringWriteIndex = (this.ringWriteIndex + 1) % capacity;
      if (this.samplesAvailable < capacity) {
        this.samplesAvailable++;
      }
    }

    // Process state machine
    if (this.state === 'LISTENING_FOR_CHIRP') {
      this.scanForChirp();
    } else if (this.state === 'LOCKED_ON_SIGNAL' || this.state === 'DECODING_SYMBOLS') {
      this.decodeSymbolStream();
    }
  }

  /**
   * Scans available audio in the ring buffer for the LFM preamble chirp
   */
  private scanForChirp(): void {
    const preambleLen = this.chirpEngine.getReferencePreamble().length;
    if (this.samplesAvailable < preambleLen) return;

    // Extract contiguous window for correlation check
    const linear = this.extractRecentSamples(preambleLen + 2048);
    const detection = this.chirpEngine.detectPreamble(linear, 0.40);

    if (detection.detected) {
      this.state = 'LOCKED_ON_SIGNAL';
      this.callbacks.onStateChange?.(this.state);

      // Preamble ends detection.peakIndex + preambleLen samples in linear
      // Guard interval is included in reference preamble waveform
      const remainingInLinear = linear.length - (detection.peakIndex + preambleLen);

      // Reset symbol decoding state
      this.currentNibbleIndex = 0;
      this.nibbleBuffer = [];
      this.byteBuffer = [];

      // Align sample count
      this.samplesAvailable = Math.max(0, remainingInLinear);
      this.state = 'DECODING_SYMBOLS';
      this.callbacks.onStateChange?.(this.state);
    }
  }

  /**
   * Slices audio into Ts-length symbol windows and evaluates Goertzel filter bank
   */
  private decodeSymbolStream(): void {
    const symbolLen = this.config.samplesPerSymbol;

    while (this.samplesAvailable >= symbolLen) {
      // Extract the current symbol window from the circular buffer
      const symbolSamples = this.extractOldestSamples(symbolLen);
      this.samplesAvailable -= symbolLen;

      // Run Goertzel filter bank
      const detection = this.filterBank.detect(symbolSamples, 8.5);

      // Emit telemetry for UI visualizers
      const telemetry: Telemetry = {
        snrDb: detection.snrDb,
        noiseFloor: detection.noiseFloor,
        peakEnergy: detection.peakEnergy,
        detectedSymbol: detection.isValid ? detection.symbol : null,
        goertzelEnergies: Array.from(detection.allEnergies),
        confidence: detection.confidence,
        activeFrequency: detection.peakFrequency,
        lockedState: this.state,
        framesDecoded: this.framesDecoded,
        crcErrors: this.crcErrors,
        fecCorrections: this.fecCorrections,
      };
      this.callbacks.onTelemetry?.(telemetry);

      // Store detected nibble (fallback to peak symbol if marginal)
      const nibble = detection.symbol;
      this.nibbleBuffer.push(nibble);

      // Every 2 nibbles make 1 byte
      if (this.nibbleBuffer.length >= 2) {
        const highNibble = this.nibbleBuffer.shift()!;
        const lowNibble = this.nibbleBuffer.shift()!;
        const byte = ((highNibble & 0x0F) << 4) | (lowNibble & 0x0F);
        this.byteBuffer.push(byte);

        // Check if we have accumulated enough bytes for a potential frame
        this.checkFrameBuffer();
      }

      // Timeout watchdog: If buffer grows excessively without sync, reset to chirp listening
      if (this.byteBuffer.length > 512) {
        this.byteBuffer.splice(0, 128);
      }
    }
  }

  /**
   * Scans accumulated bytes for Sync Word (0xAA 0x55) and parses packet frames
   */
  private checkFrameBuffer(): void {
    if (this.byteBuffer.length < 8) return;

    // Scan for sync word 0xAA 0x55
    let syncIdx = -1;
    for (let i = 0; i < this.byteBuffer.length - 1; i++) {
      if (this.byteBuffer[i] === 0xAA && this.byteBuffer[i + 1] === 0x55) {
        syncIdx = i;
        break;
      }
    }

    if (syncIdx === -1) {
      // Retain only the last byte in case it's 0xAA
      if (this.byteBuffer.length > 64) {
        this.byteBuffer.splice(0, this.byteBuffer.length - 2);
      }
      return;
    }

    // Discard any noise bytes preceding the sync word
    if (syncIdx > 0) {
      this.byteBuffer.splice(0, syncIdx);
    }

    // Need at least Sync (2B) + Header (6B) = 8 bytes to determine payload length
    if (this.byteBuffer.length < 2 + HEADER_SIZE) return;

    const payloadLen = this.byteBuffer[2 + 4];
    if (payloadLen < 1 || payloadLen > 64) {
      // False sync or corrupted length byte; shift past this sync byte
      this.byteBuffer.shift();
      return;
    }

    const totalFrameLen = 2 + HEADER_SIZE + payloadLen + FEC_PARITY_SIZE + CRC_SIZE;
    if (this.byteBuffer.length < totalFrameLen) {
      // Waiting for remaining bytes of this frame to arrive
      return;
    }

    // Full frame candidate ready
    const frameCandidate = new Uint8Array(this.byteBuffer.slice(0, totalFrameLen));
    const parseResult = parsePacketFrame(frameCandidate);

    if (parseResult.crcValid && parseResult.packet) {
      this.framesDecoded++;
      if (parseResult.healed) {
        this.fecCorrections++;
      }

      const p = parseResult.packet;
      this.callbacks.onPacketReceived?.(p, parseResult.healed);

      // Add to packet assembler
      const added = this.assembler.addPacket(p, parseResult.healed);

      // Check if all packets in the drop session have been received
      if (this.assembler.isComplete()) {
        const drop = this.assembler.assemble();
        if (drop) {
          this.callbacks.onDropCompleted?.(drop);
          // Return to listening for new chirps
          this.reset();
        }
      }

      // Consume this frame from byteBuffer
      this.byteBuffer.splice(0, totalFrameLen);
    } else {
      this.crcErrors++;
      // Skip bad sync word to keep searching
      this.byteBuffer.shift();
    }
  }

  /**
   * Helper to extract the most recent N samples from the ring buffer
   */
  private extractRecentSamples(count: number): Float32Array {
    const len = Math.min(count, this.samplesAvailable);
    const out = new Float32Array(len);
    const capacity = this.ringBuffer.length;
    let readPos = (this.ringWriteIndex - len + capacity) % capacity;

    for (let i = 0; i < len; i++) {
      out[i] = this.ringBuffer[readPos];
      readPos = (readPos + 1) % capacity;
    }
    return out;
  }

  /**
   * Helper to extract the oldest N samples currently available
   */
  private extractOldestSamples(count: number): Float32Array {
    const len = Math.min(count, this.samplesAvailable);
    const out = new Float32Array(len);
    const capacity = this.ringBuffer.length;
    let readPos = (this.ringWriteIndex - this.samplesAvailable + capacity) % capacity;

    for (let i = 0; i < len; i++) {
      out[i] = this.ringBuffer[readPos];
      readPos = (readPos + 1) % capacity;
    }
    return out;
  }
}
