/**
 * Custom Software-Defined 16-FSK Acoustic Modem
 * Modulator + Demodulator with LFM Chirp Preamble Synchronization & Goertzel Filter Bank
 */

import { AcousticTelemetry, AcousticPacket } from '@/types/sound-drop';
import { ModemConfig } from '@/types/acoustic';
import { AUDIBLE_CONFIG, ULTRASONIC_CONFIG, getFskFrequencies } from '../dsp/constants';
import { ModulatorEngine } from '../dsp/modulator';
import { ChirpEngine } from '../dsp/chirp';
import { GoertzelFilterBank } from '../dsp/goertzel';
import { decodePacketFrame } from '../part7-protocol/packet-codec';

export interface CustomMfskCallbacks {
  onTelemetry?: (t: AcousticTelemetry) => void;
  onPacketDecoded?: (packet: AcousticPacket, healed: boolean) => void;
  onPreambleDetected?: () => void;
}

export class CustomMfskModem {
  private config: ModemConfig;
  private modulator: ModulatorEngine;
  private chirpEngine: ChirpEngine;
  private filterBank: GoertzelFilterBank;
  private callbacks: CustomMfskCallbacks;

  // RX State Machine
  private state: 'IDLE' | 'SCANNING' | 'LOCKED' | 'RECEIVING' = 'IDLE';
  private ringBuffer: Float32Array;
  private ringIndex = 0;
  private samplesAvailable = 0;

  private nibbleBuffer: number[] = [];
  private byteBuffer: number[] = [];

  private framesDecoded = 0;
  private crcErrors = 0;
  private fecCorrections = 0;

  constructor(isUltrasonic = false, callbacks: CustomMfskCallbacks = {}) {
    this.config = isUltrasonic ? ULTRASONIC_CONFIG : AUDIBLE_CONFIG;
    this.callbacks = callbacks;
    this.modulator = new ModulatorEngine(this.config);
    this.chirpEngine = new ChirpEngine(this.config);
    this.filterBank = new GoertzelFilterBank(getFskFrequencies(this.config), this.config.sampleRate);

    this.ringBuffer = new Float32Array(this.config.sampleRate * 2);
  }

  public setMode(isUltrasonic: boolean): void {
    this.config = isUltrasonic ? ULTRASONIC_CONFIG : AUDIBLE_CONFIG;
    this.modulator.setConfig(this.config);
    this.chirpEngine = new ChirpEngine(this.config);
    this.filterBank = new GoertzelFilterBank(getFskFrequencies(this.config), this.config.sampleRate);
    this.resetRx();
  }

  public resetRx(): void {
    this.state = 'SCANNING';
    this.ringIndex = 0;
    this.samplesAvailable = 0;
    this.nibbleBuffer = [];
    this.byteBuffer = [];
  }

  public startListening(): void {
    this.resetRx();
  }

  public stopListening(): void {
    this.state = 'IDLE';
  }

  public getState(): string {
    return this.state;
  }

  /**
   * Transmit: Synthesizes PCM Float32Array audio samples for an array of packets
   */
  public synthesizePackets(packets: AcousticPacket[]): Float32Array {
    // Adapt packets for the modulator engine
    const adapted = packets.map((p) => ({
      syncWord: p.syncWord,
      header: {
        versionAndMode: (p.rawBytes[2] || 0x01),
        sessionId: p.sessionId,
        packetIndex: p.packetIndex,
        totalPackets: p.totalPackets,
        payloadLength: p.payloadLength,
        flags: p.flags,
      },
      payload: p.payload,
      fecParity: p.fecParity,
      crc32: p.crc32,
      rawBytes: p.rawBytes,
    }));

    return this.modulator.synthesizeTransmission(adapted, {
      amplitude: this.config.band === 'ultrasonic' ? 0.95 : 0.85,
      includePreamble: true,
    });
  }

  /**
   * Receive: Ingest incoming PCM float samples from microphone
   */
  public processPcmChunk(chunk: Float32Array): void {
    if (this.state === 'IDLE') return;

    const N = chunk.length;
    const capacity = this.ringBuffer.length;

    for (let i = 0; i < N; i++) {
      this.ringBuffer[this.ringIndex] = chunk[i];
      this.ringIndex = (this.ringIndex + 1) % capacity;
      if (this.samplesAvailable < capacity) {
        this.samplesAvailable++;
      }
    }

    if (this.state === 'SCANNING') {
      this.scanForPreamble();
    } else if (this.state === 'LOCKED' || this.state === 'RECEIVING') {
      this.decodeSymbols();
    }
  }

  private scanForPreamble(): void {
    const preambleLen = this.chirpEngine.getReferencePreamble().length;
    if (this.samplesAvailable < preambleLen) return;

    const linear = this.getLinearRecent(preambleLen + 2048);
    const detection = this.chirpEngine.detectPreamble(linear, 0.40);

    if (detection.detected) {
      this.state = 'LOCKED';
      this.callbacks.onPreambleDetected?.();

      const remainingInLinear = linear.length - (detection.peakIndex + preambleLen);
      this.samplesAvailable = Math.max(0, remainingInLinear);
      this.nibbleBuffer = [];
      this.byteBuffer = [];
      this.state = 'RECEIVING';
    }
  }

  private decodeSymbols(): void {
    const symbolSamples = this.config.samplesPerSymbol;

    while (this.samplesAvailable >= symbolSamples) {
      const window = this.getLinearOldest(symbolSamples);
      this.samplesAvailable -= symbolSamples;

      const detection = this.filterBank.detect(window, 8.5);

      const telemetry: AcousticTelemetry = {
        snrDb: detection.snrDb,
        noiseFloor: detection.noiseFloor,
        peakEnergy: detection.peakEnergy,
        detectedSymbol: detection.isValid ? detection.symbol : null,
        goertzelEnergies: Array.from(detection.allEnergies),
        confidence: detection.confidence,
        activeFrequency: detection.peakFrequency,
        state: this.state,
        framesDecoded: this.framesDecoded,
        crcErrors: this.crcErrors,
        fecCorrections: this.fecCorrections,
      };
      this.callbacks.onTelemetry?.(telemetry);

      // Accumulate nibbles
      this.nibbleBuffer.push(detection.symbol);

      if (this.nibbleBuffer.length >= 2) {
        const high = this.nibbleBuffer.shift()!;
        const low = this.nibbleBuffer.shift()!;
        const byte = ((high & 0x0F) << 4) | (low & 0x0F);
        this.byteBuffer.push(byte);

        this.checkFrame();
      }

      if (this.byteBuffer.length > 512) {
        this.byteBuffer.splice(0, 128);
      }
    }
  }

  private checkFrame(): void {
    if (this.byteBuffer.length < 8) return;

    let syncIdx = -1;
    for (let i = 0; i < this.byteBuffer.length - 1; i++) {
      if (this.byteBuffer[i] === 0xAA && this.byteBuffer[i + 1] === 0x55) {
        syncIdx = i;
        break;
      }
    }

    if (syncIdx === -1) {
      if (this.byteBuffer.length > 64) {
        this.byteBuffer.splice(0, this.byteBuffer.length - 2);
      }
      return;
    }

    if (syncIdx > 0) {
      this.byteBuffer.splice(0, syncIdx);
    }

    if (this.byteBuffer.length < 8) return;
    const payloadLen = this.byteBuffer[2 + 4];
    if (payloadLen < 1 || payloadLen > 64) {
      this.byteBuffer.shift();
      return;
    }

    const totalLen = 2 + 6 + payloadLen + 16 + 4;
    if (this.byteBuffer.length < totalLen) return;

    const frameBytes = new Uint8Array(this.byteBuffer.slice(0, totalLen));
    const result = decodePacketFrame(frameBytes);

    if (result.crcValid && result.packet) {
      this.framesDecoded++;
      if (result.healed) this.fecCorrections++;
      this.callbacks.onPacketDecoded?.(result.packet, result.healed);
      this.byteBuffer.splice(0, totalLen);
    } else {
      this.crcErrors++;
      this.byteBuffer.shift();
    }
  }

  private getLinearRecent(count: number): Float32Array {
    const len = Math.min(count, this.samplesAvailable);
    const out = new Float32Array(len);
    const cap = this.ringBuffer.length;
    let pos = (this.ringIndex - len + cap) % cap;
    for (let i = 0; i < len; i++) {
      out[i] = this.ringBuffer[pos];
      pos = (pos + 1) % cap;
    }
    return out;
  }

  private getLinearOldest(count: number): Float32Array {
    const len = Math.min(count, this.samplesAvailable);
    const out = new Float32Array(len);
    const cap = this.ringBuffer.length;
    let pos = (this.ringIndex - this.samplesAvailable + cap) % cap;
    for (let i = 0; i < len; i++) {
      out[i] = this.ringBuffer[pos];
      pos = (pos + 1) % cap;
    }
    return out;
  }
}
