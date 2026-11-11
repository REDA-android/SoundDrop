/**
 * Web Audio API Manager Singleton
 * Manages AudioContext lifecycle, microphone capture with noiseSuppression disabled,
 * TX playback, AnalyserNode for visualizers, and Loopback Self-Testing.
 */

import { ModemConfig, Telemetry, Packet, DropResult } from '@/types/acoustic';
import { AUDIBLE_CONFIG, ULTRASONIC_CONFIG } from '../dsp/constants';
import { ModulatorEngine } from '../dsp/modulator';
import { DemodulatorEngine } from '../dsp/demodulator';

export class AudioManager {
  private static instance: AudioManager | null = null;

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private processorNode: AudioWorkletNode | null = null;

  private currentSourceNode: AudioBufferSourceNode | null = null;

  private modulator: ModulatorEngine;
  private demodulator: DemodulatorEngine;

  private isTransmitting = false;
  private isListening = false;
  private isLoopback = false;

  private constructor() {
    this.modulator = new ModulatorEngine(AUDIBLE_CONFIG);
    this.demodulator = new DemodulatorEngine(AUDIBLE_CONFIG);
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public getModulator(): ModulatorEngine {
    return this.modulator;
  }

  public getDemodulator(): DemodulatorEngine {
    return this.demodulator;
  }

  public setConfig(config: ModemConfig): void {
    this.modulator.setConfig(config);
    this.demodulator.setConfig(config);
  }

  /**
   * Initializes or resumes the AudioContext
   */
  public async ensureAudioContext(): Promise<AudioContext> {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass({ sampleRate: 48000 });
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.2;
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    return this.audioCtx;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Starts microphone acquisition with STRICT acoustic DSP constraints:
   * echoCancellation: false, noiseSuppression: false, autoGainControl: false.
   */
  public async startListening(callbacks: {
    onTelemetry?: (t: Telemetry) => void;
    onPacketReceived?: (p: Packet, healed: boolean) => void;
    onDropCompleted?: (d: DropResult) => void;
  }): Promise<void> {
    if (this.isListening) return;

    const ctx = await this.ensureAudioContext();

    // Configure Demodulator callbacks
    this.demodulator = new DemodulatorEngine(this.modulator.getConfig(), callbacks);
    this.demodulator.start();

    // Strictly disable browser preprocessing
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
        channelCount: 1,
      },
      video: false,
    };

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.micSource = ctx.createMediaStreamSource(this.mediaStream);

      // Connect mic to analyser for live spectrogram
      if (this.analyser) {
        this.micSource.connect(this.analyser);
      }

      // AudioWorklet avec tampon de 2048 échantillons (sans connexion à destination pour éliminer le larsen)
      await ctx.audioWorklet.addModule('/worklets/capture.js');
      const workletNode = new AudioWorkletNode(ctx, 'capture-processor');
      workletNode.port.onmessage = (evt: MessageEvent<Float32Array>) => {
        this.demodulator.processAudioChunk(evt.data);
      };

      this.micSource.connect(workletNode);
      // NOTE: Ne JAMAIS connecter à ctx.destination (anti-larsen)
      this.processorNode = workletNode;

      this.isListening = true;
    } catch (err) {
      console.error('Microphone acquisition error:', err);
      throw err;
    }
  }

  /**
   * Stops listening and releases microphone track
   */
  public stopListening(): void {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }

    this.demodulator.stop();
    this.isListening = false;
  }

  /**
   * Plays synthesized PCM audio samples out through speaker (and into analyser for visualizer)
   */
  public async playPcm(
    pcmSamples: Float32Array,
    onEnded?: () => void
  ): Promise<void> {
    const ctx = await this.ensureAudioContext();
    this.stopPlayback();

    const audioBuffer = ctx.createBuffer(1, pcmSamples.length, ctx.sampleRate);
    audioBuffer.getChannelData(0).set(pcmSamples);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    // Connect: Source -> Analyser -> Destination
    if (this.analyser) {
      source.connect(this.analyser);
      this.analyser.connect(ctx.destination);
    } else {
      source.connect(ctx.destination);
    }

    this.currentSourceNode = source;
    this.isTransmitting = true;

    // Loopback testing: Feed samples directly to demodulator if in loopback mode
    if (this.isLoopback && this.isListening) {
      this.feedLoopbackPcm(pcmSamples);
    }

    source.onended = () => {
      this.isTransmitting = false;
      this.currentSourceNode = null;
      onEnded?.();
    };

    source.start();
  }

  public stopPlayback(): void {
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch {
        // Ignore if already stopped
      }
      this.currentSourceNode = null;
    }
    this.isTransmitting = false;
  }

  public setLoopback(enabled: boolean): void {
    this.isLoopback = enabled;
  }

  public getIsLoopback(): boolean {
    return this.isLoopback;
  }

  public getIsTransmitting(): boolean {
    return this.isTransmitting;
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  /**
   * Simulates microphone ingestion of transmitted samples for offline loopback self-testing
   */
  private feedLoopbackPcm(pcmSamples: Float32Array): void {
    const chunkSize = 2048;
    let offset = 0;

    const interval = setInterval(() => {
      if (offset >= pcmSamples.length || !this.isListening) {
        clearInterval(interval);
        return;
      }
      const end = Math.min(offset + chunkSize, pcmSamples.length);
      const chunk = pcmSamples.subarray(offset, end);
      this.demodulator.processAudioChunk(chunk);
      offset += chunkSize;
    }, (chunkSize / 48000) * 1000);
  }
}
