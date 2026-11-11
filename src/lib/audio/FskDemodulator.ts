import {
  DSP_CONFIG,
  ACOUSTIC_BANDS,
  AcousticBandMode,
  AcousticEngineType,
  SONICNET_ALPHABET,
  MAGIC_FRAME_HEADER,
  isValidRoomToken,
} from './dsp-constants';
import { verifyCRC16 } from './crc16';

export type PayloadCallback = (decodedToken: string, engineUsed?: AcousticEngineType) => void;
export type SpectralCallback = (
  magnitudes: Float32Array,
  peakFreq: number,
  snrDb: number,
  sampleRate: number,
  timeDomainData?: Float32Array
) => void;
export type DemodulatorStatusCallback = (statusText: string, stateCode: number) => void;

export enum DemodulatorState {
  IDLE = 0,
  LISTEN_FOR_PREAMBLE = 1,
  SYMBOL_SAMPLING = 2,
  FRAME_VALIDATION = 3,
  DISPATCH_SDP_EXCHANGE = 4,
}

export class FskDemodulator {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private bandMode: AcousticBandMode = 'AUDIBLE';
  private engine: AcousticEngineType = 'GGWAVE';

  // ggwave WebAssembly instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ggwaveModule: any = null;
  private ggwaveInstance: number | null = null;

  // Callbacks
  private onPayloadReceived: PayloadCallback;
  private onSpectralData?: SpectralCallback;
  private onStatusUpdate?: DemodulatorStatusCallback;

  // FSK & SonicNet State Machine
  private state: DemodulatorState = DemodulatorState.IDLE;
  private bitBuffer: number[] = [];
  private lastSampleTime = 0;
  private preambleDetectedTime = 0;
  private sonicCharBuffer = '';
  private lastSonicChar = '';
  private lastSonicSampleTime = 0;

  constructor(
    onPayloadReceived: PayloadCallback,
    onSpectralData?: SpectralCallback,
    onStatusUpdate?: DemodulatorStatusCallback,
    bandMode: AcousticBandMode = 'AUDIBLE',
    engine: AcousticEngineType = 'GGWAVE'
  ) {
    this.onPayloadReceived = onPayloadReceived;
    this.onSpectralData = onSpectralData;
    this.onStatusUpdate = onStatusUpdate;
    this.bandMode = bandMode;
    this.engine = engine;
  }

  public setBandMode(mode: AcousticBandMode): void {
    this.bandMode = mode;
    this.resetState();
  }

  public setEngine(engine: AcousticEngineType): void {
    this.engine = engine;
    this.resetState();
  }

  private async initGgwave(sampleRate: number): Promise<void> {
    try {
      const ggwaveFactory = (await import('ggwave')).default || (await import('ggwave'));
      this.ggwaveModule = await ggwaveFactory();
      const params = this.ggwaveModule.getDefaultParameters();
      params.sampleRateInp = sampleRate;
      params.sampleRateOut = sampleRate;
      params.sampleRate = sampleRate;
      params.sampleFormatInp = this.ggwaveModule.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
      params.sampleFormatOut = this.ggwaveModule.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
      this.ggwaveInstance = this.ggwaveModule.init(params);
    } catch (e) {
      console.warn('ggwave WASM initialization warning:', e);
    }
  }

  private handlePcmFloatChunk(inputBuffer: Float32Array): void {
    if (this.state === DemodulatorState.IDLE) return;
    if (this.ggwaveModule && this.ggwaveInstance !== null) {
      const byteView = new Int8Array(
        inputBuffer.buffer,
        inputBuffer.byteOffset,
        inputBuffer.byteLength
      );
      const res = this.ggwaveModule.decode(this.ggwaveInstance, byteView);
      if (res && res.length > 0) {
        const rawDecodedText = new TextDecoder('utf-8', { fatal: false })
          .decode(res)
          .trim();
        if (rawDecodedText.startsWith('OFL:')) {
          this.transitionState(
            DemodulatorState.DISPATCH_SDP_EXCHANGE,
            `Payload Hors-Ligne Direct décodé via ggwave (Air-Gap 100% Sonore)`
          );
          this.onPayloadReceived(rawDecodedText, 'GGWAVE');
          this.resetState();
          return;
        }
        const decodedText = rawDecodedText.toUpperCase();
        if (isValidRoomToken(decodedText)) {
          this.transitionState(
            DemodulatorState.DISPATCH_SDP_EXCHANGE,
            `Décodé via ggwave (Reed-Solomon ECC OK): ${decodedText}`
          );
          this.onPayloadReceived(decodedText, 'GGWAVE');
          this.resetState();
        }
      }
    }
  }

  public async startListening(): Promise<void> {
    if (this.state !== DemodulatorState.IDLE) {
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    try {
      this.audioCtx = new AudioCtx({ sampleRate: DSP_CONFIG.SAMPLE_RATE });
    } catch {
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    await this.initGgwave(this.audioCtx.sampleRate);

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = DSP_CONFIG.FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.05;
    source.connect(this.analyser);

    // 1. AudioWorklet capture-processor (sans connexion à destination pour éliminer le larsen)
    try {
      await this.audioCtx.audioWorklet.addModule('/worklets/capture.js');
      this.workletNode = new AudioWorkletNode(this.audioCtx, 'capture-processor');
      this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (event.data) {
          this.handlePcmFloatChunk(event.data);
        }
      };
      source.connect(this.workletNode);
      // NOTE: Interdiction absolue de connecter le worklet à ctx.destination (anti-larsen)
    } catch (e) {
      console.warn('[FskDemodulator] AudioWorklet capture warning:', e);
    }

    this.transitionState(
      DemodulatorState.LISTEN_FOR_PREAMBLE,
      `Écoute multi-moteur active (ggwave Reed-Solomon + SonicNet + FSK)...`
    );
    this.processAudioLoop();
  }

  private transitionState(newState: DemodulatorState, statusMsg: string): void {
    this.state = newState;
    if (this.onStatusUpdate) {
      this.onStatusUpdate(statusMsg, newState);
    }
  }

  private processAudioLoop = (): void => {
    if (!this.analyser || !this.audioCtx || this.state === DemodulatorState.IDLE) {
      return;
    }

    const buffer = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(buffer);

    const timeDomain = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(timeDomain);

    const now = performance.now();
    const actualSampleRate = this.audioCtx.sampleRate;
    const binSize = actualSampleRate / DSP_CONFIG.FFT_SIZE;
    const band = ACOUSTIC_BANDS[this.bandMode];

    const getPowerAtFreq = (f: number): number => {
      const centerBin = Math.round(f / binSize);
      let maxP = -140;
      for (let offset = -2; offset <= 2; offset++) {
        const bin = centerBin + offset;
        if (bin >= 0 && bin < buffer.length) {
          if (buffer[bin] > maxP) maxP = buffer[bin];
        }
      }
      return maxP;
    };

    const pSync1 = getPowerAtFreq(band.PREAMBLE_FREQ_1);
    const p0 = getPowerAtFreq(band.BIT_0_FREQ);
    const p1 = getPowerAtFreq(band.BIT_1_FREQ);

    // Dynamic noise floor estimation
    let noiseSum = 0;
    let noiseSamples = 0;
    const startNoiseBin = Math.round(band.NOISE_FLOOR_MIN / binSize);
    const endNoiseBin = Math.round(band.NOISE_FLOOR_MAX / binSize);
    for (let b = startNoiseBin; b <= endNoiseBin && b < buffer.length; b++) {
      if (buffer[b] > -140) {
        noiseSum += buffer[b];
        noiseSamples++;
      }
    }
    const noiseFloor = noiseSamples > 0 ? noiseSum / noiseSamples : -95;

    // Peak detection across target band
    let peakBin = Math.round(band.SONIC_MIN_FREQ / binSize);
    let peakPower = -140;
    const maxSonicBin = Math.min(buffer.length - 1, Math.round(band.SONIC_MAX_FREQ / binSize));
    for (let b = peakBin; b <= maxSonicBin; b++) {
      if (buffer[b] > peakPower) {
        peakPower = buffer[b];
        peakBin = b;
      }
    }
    const peakFreq = peakBin * binSize;
    const snrDb = Math.max(0, peakPower - noiseFloor);

    if (this.onSpectralData) {
      this.onSpectralData(buffer, peakFreq, snrDb, actualSampleRate, timeDomain);
    }

    // 1. SonicNet M-FSK decoder (strictly requires ^SD:TOKEN$ magic header, continuous <400ms symbol cadence, and SNR >= 16dB)
    if (now - this.lastSonicSampleTime > 450 && this.sonicCharBuffer.length > 0) {
      // Expire stale noise characters if symbol stream was interrupted
      this.sonicCharBuffer = '';
      this.lastSonicChar = '';
    }

    if (
      this.engine === 'SONICNET' &&
      snrDb >= 16 &&
      now - this.lastSonicSampleTime >= DSP_CONFIG.SONIC_CHAR_DURATION * 800
    ) {
      const freqRatio =
        (peakFreq - band.SONIC_MIN_FREQ) / (band.SONIC_MAX_FREQ - band.SONIC_MIN_FREQ);
      const charIdx = Math.round(freqRatio * (SONICNET_ALPHABET.length - 1));
      if (charIdx >= 0 && charIdx < SONICNET_ALPHABET.length) {
        const detectedChar = SONICNET_ALPHABET[charIdx];
        this.lastSonicSampleTime = now;

        if (detectedChar === '^') {
          this.sonicCharBuffer = '^';
          this.lastSonicChar = '^';
        } else if (detectedChar === '$') {
          const match = this.sonicCharBuffer.match(/^\^SD:([A-Z0-9]{4,10})$/);
          if (match) {
            const token = match[1].trim().toUpperCase();
            if (isValidRoomToken(token)) {
              this.sonicCharBuffer = '';
              this.transitionState(
                DemodulatorState.DISPATCH_SDP_EXCHANGE,
                `Décodé via SonicNet M-FSK: ${token}`
              );
              this.onPayloadReceived(token, 'SONICNET');
              this.resetState();
              return;
            }
          }
          this.sonicCharBuffer = '';
        } else if (
          this.sonicCharBuffer.startsWith('^') &&
          detectedChar !== this.lastSonicChar &&
          this.sonicCharBuffer.length < 16
        ) {
          this.sonicCharBuffer += detectedChar;
          this.lastSonicChar = detectedChar;
        }
      }
    }

    // 2. Quiet-FSK + CRC-16-CCITT state machine with dual-tone sync & magic header
    switch (this.state) {
      case DemodulatorState.LISTEN_FOR_PREAMBLE: {
        const isSync1Active =
          pSync1 > noiseFloor + DSP_CONFIG.DETECTION_THRESHOLD_DB && pSync1 > -75;

        if (isSync1Active) {
          this.preambleDetectedTime = now;
          this.bitBuffer = [];
          const preambleWaitMs =
            (DSP_CONFIG.PREAMBLE_DURATION * 2 + DSP_CONFIG.GUARD_INTERVAL) * 1000 +
            DSP_CONFIG.SYMBOL_DURATION * 500;

          this.lastSampleTime = now + preambleWaitMs;
          this.transitionState(
            DemodulatorState.SYMBOL_SAMPLING,
            'Porteuse détectée ! Décodage Reed-Solomon / FSK en cours...'
          );
        }
        break;
      }

      case DemodulatorState.SYMBOL_SAMPLING: {
        if (now >= this.lastSampleTime) {
          const bit = p1 > p0 ? 1 : 0;
          this.bitBuffer.push(bit);
          this.lastSampleTime += DSP_CONFIG.SYMBOL_DURATION * 1000;

          if (this.bitBuffer.length >= 48 && this.bitBuffer.length % 8 === 0) {
            const frameBytes = this.reconstructBytes(this.bitBuffer);

            for (let offset = 0; offset <= frameBytes.length - 7; offset++) {
              if (
                frameBytes[offset] === MAGIC_FRAME_HEADER[0] &&
                frameBytes[offset + 1] === MAGIC_FRAME_HEADER[1]
              ) {
                const declaredLength = frameBytes[offset + 2];
                const totalExpectedBytes = 2 + 1 + declaredLength + 2;

                if (
                  declaredLength >= 4 &&
                  declaredLength <= 10 &&
                  frameBytes.length >= offset + totalExpectedBytes
                ) {
                  this.transitionState(
                    DemodulatorState.FRAME_VALIDATION,
                    'Validation du paquet acoustique (CRC-16-CCITT)...'
                  );

                  const signedSlice = frameBytes.slice(offset, offset + 2 + 1 + declaredLength);
                  const receivedCrc =
                    (frameBytes[offset + 2 + 1 + declaredLength] << 8) |
                    frameBytes[offset + 2 + 1 + declaredLength + 1];

                  if (verifyCRC16(signedSlice, receivedCrc)) {
                    const payloadBytes = signedSlice.slice(3);
                    const decoder = new TextDecoder('utf-8', { fatal: false });
                    const payload = decoder.decode(payloadBytes).trim().toUpperCase();

                    if (isValidRoomToken(payload)) {
                      this.transitionState(
                        DemodulatorState.DISPATCH_SDP_EXCHANGE,
                        `Jeton décodé avec succès (CRC-16 OK): ${payload}`
                      );
                      this.onPayloadReceived(payload, 'QUIET_FSK');
                      this.resetState();
                      return;
                    }
                  }
                }
              }
            }
          }

          if (this.bitBuffer.length > 256 || now - this.preambleDetectedTime > 6000) {
            this.transitionState(
              DemodulatorState.LISTEN_FOR_PREAMBLE,
              'Écoute active (ggwave Reed-Solomon + SonicNet + FSK)...'
            );
            this.resetState();
          }
        }
        break;
      }

      default:
        break;
    }

    this.animationFrameId = requestAnimationFrame(this.processAudioLoop);
  };

  private reconstructBytes(bits: number[]): Uint8Array {
    const bytesCount = Math.floor(bits.length / 8);
    const bytes = new Uint8Array(bytesCount);
    for (let i = 0; i < bytesCount; i++) {
      let val = 0;
      for (let b = 0; b < 8; b++) {
        val = (val << 1) | bits[i * 8 + b];
      }
      bytes[i] = val;
    }
    return bytes;
  }

  public resetState(): void {
    this.state = DemodulatorState.LISTEN_FOR_PREAMBLE;
    this.bitBuffer = [];
    this.lastSampleTime = 0;
    this.preambleDetectedTime = 0;
    this.sonicCharBuffer = '';
  }

  public stop(): void {
    this.state = DemodulatorState.IDLE;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  public getState(): DemodulatorState {
    return this.state;
  }
}
