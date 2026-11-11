import {
  DSP_CONFIG,
  ACOUSTIC_BANDS,
  AcousticBandMode,
  AcousticEngineType,
  SONICNET_ALPHABET,
  MAGIC_FRAME_HEADER,
} from './dsp-constants';
import { calculateCRC16 } from './crc16';

export interface ModulatorProgressCallback {
  (currentBit: number, totalBits: number, freq: number): void;
}

export interface ModulatorSpectralCallback {
  (
    magnitudes: Float32Array,
    peakFreq: number,
    snrDb: number,
    sampleRate: number,
    timeDomain: Float32Array
  ): void;
}

export class FskModulator {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animId: number | null = null;
  private isTransmitting = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ggwaveModule: any = null;
  private ggwaveInstance: number | null = null;
  private ggwaveSampleRate = 0;

  private initContext(): { ctx: AudioContext; analyser: AnalyserNode } {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try {
        this.ctx = new AudioCtx({ sampleRate: DSP_CONFIG.SAMPLE_RATE });
      } catch {
        this.ctx = new AudioCtx();
      }
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = DSP_CONFIG.FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0.1;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return { ctx: this.ctx, analyser: this.analyser! };
  }

  private async ensureGgwave(sampleRate: number): Promise<void> {
    if (!this.ggwaveModule) {
      const ggwaveFactory = (await import('ggwave')).default || (await import('ggwave'));
      this.ggwaveModule = await ggwaveFactory();
    }
    if (this.ggwaveInstance === null || this.ggwaveSampleRate !== sampleRate) {
      const params = this.ggwaveModule.getDefaultParameters();
      params.sampleRateInp = sampleRate;
      params.sampleRateOut = sampleRate;
      params.sampleRate = sampleRate;
      params.sampleFormatInp = this.ggwaveModule.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
      params.sampleFormatOut = this.ggwaveModule.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
      this.ggwaveInstance = this.ggwaveModule.init(params);
      this.ggwaveSampleRate = sampleRate;
    }
  }

  private startRealTxSpectralMonitor(
    audioCtx: AudioContext,
    analyser: AnalyserNode,
    bandMode: AcousticBandMode,
    onSpectralFrame?: ModulatorSpectralCallback
  ): void {
    if (!onSpectralFrame) return;
    const band = ACOUSTIC_BANDS[bandMode];
    const binSize = audioCtx.sampleRate / analyser.fftSize;

    const loop = () => {
      if (!this.isTransmitting || !this.analyser) return;

      const freqData = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(freqData);

      const timeData = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(timeData);

      let peakBin = Math.round(band.VIS_MIN_FREQ / binSize);
      let peakPower = -120;
      const maxBin = Math.min(freqData.length - 1, Math.round(band.VIS_MAX_FREQ / binSize));
      for (let b = peakBin; b <= maxBin; b++) {
        if (freqData[b] > peakPower) {
          peakPower = freqData[b];
          peakBin = b;
        }
      }

      const peakFreq = peakBin * binSize;
      const snrDb = Math.max(0, peakPower + 95);
      onSpectralFrame(freqData, peakFreq, snrDb, audioCtx.sampleRate, timeData);

      this.animId = requestAnimationFrame(loop);
    };

    this.animId = requestAnimationFrame(loop);
  }

  private stopRealTxSpectralMonitor(): void {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  public async transmitPayload(
    payloadString: string,
    onProgress?: ModulatorProgressCallback,
    bandMode: AcousticBandMode = 'AUDIBLE',
    engine: AcousticEngineType = 'GGWAVE',
    onSpectralFrame?: ModulatorSpectralCallback
  ): Promise<void> {
    if (this.isTransmitting) {
      return;
    }
    this.isTransmitting = true;

    try {
      const { ctx: audioCtx, analyser } = this.initContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      this.startRealTxSpectralMonitor(audioCtx, analyser, bandMode, onSpectralFrame);

      if (engine === 'GGWAVE') {
        await this.transmitWithGgwave(audioCtx, analyser, payloadString, bandMode, onProgress);
      } else if (engine === 'SONICNET') {
        await this.transmitWithSonicNet(audioCtx, analyser, payloadString, bandMode, onProgress);
      } else {
        await this.transmitWithQuietFsk(audioCtx, analyser, payloadString, bandMode, onProgress);
      }
    } finally {
      this.isTransmitting = false;
      this.stopRealTxSpectralMonitor();
    }
  }

  /**
   * 1. GGWAVE (ggerganov/ggwave): Reed-Solomon ECC + Multi-Tone FSK (WebAssembly)
   */
  private async transmitWithGgwave(
    audioCtx: AudioContext,
    analyser: AnalyserNode,
    payloadString: string,
    bandMode: AcousticBandMode,
    onProgress?: ModulatorProgressCallback
  ): Promise<void> {
    await this.ensureGgwave(audioCtx.sampleRate);

    const protocol =
      bandMode === 'ULTRASONIC'
        ? this.ggwaveModule.ProtocolId.GGWAVE_PROTOCOL_ULTRASOUND_FAST
        : this.ggwaveModule.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST;

    const waveformBytes: Uint8Array = this.ggwaveModule.encode(
      this.ggwaveInstance,
      payloadString,
      protocol,
      35
    );

    const floatSamples = new Float32Array(
      waveformBytes.buffer,
      waveformBytes.byteOffset,
      waveformBytes.byteLength / 4
    );

    const audioBuffer = audioCtx.createBuffer(1, floatSamples.length, audioCtx.sampleRate);
    audioBuffer.getChannelData(0).set(floatSamples);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);
    source.start(0);

    const durationMs = (floatSamples.length / audioCtx.sampleRate) * 1000;
    const totalSteps = payloadString.length * 8;
    const baseFreq = bandMode === 'ULTRASONIC' ? 18500 : 2400;

    if (onProgress) {
      for (let step = 1; step <= totalSteps; step++) {
        setTimeout(() => {
          if (this.isTransmitting) {
            onProgress(step, totalSteps, baseFreq + (step % 6) * 150);
          }
        }, (durationMs / totalSteps) * step);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, durationMs + 60));
  }

  /**
   * 2. SONICNET (jborichevskiy/sonicnet): Fast M-FSK Character Alphabet Dictionary
   */
  private async transmitWithSonicNet(
    audioCtx: AudioContext,
    analyser: AnalyserNode,
    payloadString: string,
    bandMode: AcousticBandMode,
    onProgress?: ModulatorProgressCallback
  ): Promise<void> {
    const band = ACOUSTIC_BANDS[bandMode];
    const cleanToken = payloadString.trim().toUpperCase();
    const framedPayload = `^SD:${cleanToken}$`;
    const freqRange = band.SONIC_MAX_FREQ - band.SONIC_MIN_FREQ;
    let scheduledTime = audioCtx.currentTime + 0.05;

    for (let i = 0; i < framedPayload.length; i++) {
      const char = framedPayload[i];
      const charIndex = SONICNET_ALPHABET.indexOf(char);
      if (charIndex === -1) continue;

      const freq =
        band.SONIC_MIN_FREQ + (charIndex / (SONICNET_ALPHABET.length - 1)) * freqRange;

      this.scheduleTone(audioCtx, analyser, freq, scheduledTime, DSP_CONFIG.SONIC_CHAR_DURATION);

      if (onProgress) {
        const idx = i + 1;
        const targetFreq = Math.round(freq);
        const delayMs = Math.max(0, (scheduledTime - audioCtx.currentTime) * 1000);
        setTimeout(() => {
          if (this.isTransmitting) {
            onProgress(idx, framedPayload.length, targetFreq);
          }
        }, delayMs);
      }

      scheduledTime += DSP_CONFIG.SONIC_CHAR_DURATION;
    }

    const totalDurationMs = Math.max(0, (scheduledTime - audioCtx.currentTime) * 1000);
    await new Promise((resolve) => setTimeout(resolve, totalDurationMs + 50));
  }

  /**
   * 3. QUIET_FSK: Binary FSK + CRC-16-CCITT framing
   * Frame Format: [MAGIC_0 (0x53), MAGIC_1 (0x44), Length, Payload..., CRC_High, CRC_Low]
   */
  private async transmitWithQuietFsk(
    audioCtx: AudioContext,
    analyser: AnalyserNode,
    payloadString: string,
    bandMode: AcousticBandMode,
    onProgress?: ModulatorProgressCallback
  ): Promise<void> {
    const band = ACOUSTIC_BANDS[bandMode];
    const encoder = new TextEncoder();
    const rawBytes = encoder.encode(payloadString.trim().toUpperCase());

    const dataToSign = new Uint8Array(MAGIC_FRAME_HEADER.length + 1 + rawBytes.length);
    dataToSign.set(MAGIC_FRAME_HEADER, 0);
    dataToSign[MAGIC_FRAME_HEADER.length] = rawBytes.length;
    dataToSign.set(rawBytes, MAGIC_FRAME_HEADER.length + 1);

    const crc = calculateCRC16(dataToSign);

    const frame = new Uint8Array(dataToSign.length + 2);
    frame.set(dataToSign, 0);
    frame[dataToSign.length] = (crc >> 8) & 0xff;
    frame[dataToSign.length + 1] = crc & 0xff;

    const bitStream: number[] = [];
    for (let i = 0; i < frame.length; i++) {
      const byte = frame[i];
      for (let b = 7; b >= 0; b--) {
        bitStream.push((byte >> b) & 1);
      }
    }

    let scheduledTime = audioCtx.currentTime + 0.05;

    this.scheduleTone(
      audioCtx,
      analyser,
      band.PREAMBLE_FREQ_1,
      scheduledTime,
      DSP_CONFIG.PREAMBLE_DURATION
    );
    scheduledTime += DSP_CONFIG.PREAMBLE_DURATION;

    this.scheduleTone(
      audioCtx,
      analyser,
      band.PREAMBLE_FREQ_2,
      scheduledTime,
      DSP_CONFIG.PREAMBLE_DURATION
    );
    scheduledTime += DSP_CONFIG.PREAMBLE_DURATION + DSP_CONFIG.GUARD_INTERVAL;

    for (let i = 0; i < bitStream.length; i++) {
      const bit = bitStream[i];
      const freq = bit === 1 ? band.BIT_1_FREQ : band.BIT_0_FREQ;
      this.scheduleTone(audioCtx, analyser, freq, scheduledTime, DSP_CONFIG.SYMBOL_DURATION);

      if (onProgress) {
        const bitIndex = i;
        const targetFreq = freq;
        const delayMs = Math.max(0, (scheduledTime - audioCtx.currentTime) * 1000);
        setTimeout(() => {
          if (this.isTransmitting) {
            onProgress(bitIndex + 1, bitStream.length, targetFreq);
          }
        }, delayMs);
      }

      scheduledTime += DSP_CONFIG.SYMBOL_DURATION;
    }

    const totalDurationMs = Math.max(0, (scheduledTime - audioCtx.currentTime) * 1000);
    await new Promise((resolve) => setTimeout(resolve, totalDurationMs + 50));
  }

  private scheduleTone(
    ctx: AudioContext,
    analyser: AnalyserNode,
    frequency: number,
    startTime: number,
    duration: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, startTime);

    const rampTime = Math.min(0.006, duration * 0.12);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(DSP_CONFIG.AMPLITUDE, startTime + rampTime);
    gain.gain.setValueAtTime(DSP_CONFIG.AMPLITUDE, startTime + duration - rampTime);
    gain.gain.linearRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(analyser);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  public getTransmissionState(): boolean {
    return this.isTransmitting;
  }

  public close(): void {
    this.isTransmitting = false;
    this.stopRealTxSpectralMonitor();
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close();
      this.ctx = null;
      this.analyser = null;
    }
  }
}
