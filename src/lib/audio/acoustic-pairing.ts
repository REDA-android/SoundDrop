/**
 * Acoustic Bubble Pairing DSP Engine
 * Real-time audio proximity connection (Phone-to-Mac/PC).
 * Dual-tone chirp transmission (1800Hz - 2400Hz sweep + 2800-3850Hz beacon)
 * and microphone Goertzel / FFT matched detection.
 */

export class AcousticPairingTx {
  private ctx: AudioContext | null = null;

  private async getContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass({ sampleRate: 48000 });
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Synthesizes and emits an acoustic pairing chirp:
   * 1. Primary sweep: 1800Hz -> 2400Hz over 180ms
   * 2. Sub-carrier beacon: 2800Hz + (sessionId % 8) * 150Hz
   * 3. Hann-like smooth envelope to eliminate speaker clicks/pops
   */
  public async emitPairingChirp(sessionId: number = 1): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    // Primary Sweep: 1800Hz -> 2400Hz
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1800, now);
    osc1.frequency.exponentialRampToValueAtTime(2400, now + 0.18);

    // Sub-carrier beacon for session ID identification
    const beaconFreq = 2800 + (Math.abs(sessionId) % 8) * 150;
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(beaconFreq, now);

    // Hann-like shaped gain envelope
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.35, now + 0.04);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.24);
    osc2.stop(now + 0.24);
  }

  /**
   * Synthesizes a glassy confirmation chime (Major 9th chord: C5 -> G5 -> D6)
   */
  public async playConfirmationChord(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const notes = [523.25, 783.99, 1174.66]; // C5, G5, D6

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.05);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.25 / (idx + 1), now + idx * 0.05 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.05 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.05);
      osc.stop(now + idx * 0.05 + 0.4);
    });
  }
}

export class AcousticPairingRx {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private isListening = false;
  private animFrameId: number | null = null;
  private lastTriggerTime = 0;

  public async startListening(
    onPairDetected: (sessionId: number, snrDb: number) => void,
    onSpectrumUpdate?: (energies: Float32Array) => void
  ): Promise<void> {
    if (this.isListening) return;

    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtxClass({ sampleRate: 48000 });
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    // STRICT: Disable all audio preprocessing to receive raw high-frequency chirps
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.25;
    source.connect(this.analyser);

    this.isListening = true;
    const buffer = new Float32Array(this.analyser.frequencyBinCount);
    const binResolution = 48000 / this.analyser.fftSize; // 46.875 Hz/bin

    // Bin calculations
    const bin1800 = Math.round(1800 / binResolution);
    const bin2400 = Math.round(2400 / binResolution);
    const bin2800 = Math.round(2800 / binResolution);
    const bin3850 = Math.round(3850 / binResolution);
    const noiseStartBin = Math.round(1300 / binResolution);
    const noiseEndBin = Math.round(1600 / binResolution);

    const detectLoop = () => {
      if (!this.isListening || !this.analyser) return;
      this.analyser.getFloatFrequencyData(buffer);

      onSpectrumUpdate?.(buffer);

      // Estimate ambient noise floor
      let noiseSum = 0;
      let noiseCount = 0;
      for (let i = noiseStartBin; i <= noiseEndBin; i++) {
        noiseSum += buffer[i];
        noiseCount++;
      }
      const noiseFloor = noiseCount > 0 ? noiseSum / noiseCount : -70;

      // Detect energy in sweep band (1800Hz - 2400Hz)
      let chirpEnergyCount = 0;
      let peakSweepDb = -100;
      for (let i = bin1800; i <= bin2400; i++) {
        const val = buffer[i];
        if (val > peakSweepDb) peakSweepDb = val;
        // Threshold: energy must be > -44 dB AND at least 10 dB above noise floor
        if (val > -44 && val > noiseFloor + 9) {
          chirpEnergyCount++;
        }
      }

      // Check sub-carrier beacon peak (2800Hz - 3850Hz)
      let peakBeaconFreq = 2800;
      let peakBeaconDb = -100;
      for (let i = bin2800; i <= bin3850; i++) {
        const val = buffer[i];
        if (val > peakBeaconDb) {
          peakBeaconDb = val;
          peakBeaconFreq = i * binResolution;
        }
      }

      const now = performance.now();
      const snrDb = Math.max(0, peakSweepDb - noiseFloor);

      // Detection condition: sustained energy across sweep band + cooldown guard
      if (
        chirpEnergyCount >= 3 &&
        snrDb >= 8 &&
        now - this.lastTriggerTime > 1400
      ) {
        this.lastTriggerTime = now;
        const rawId = Math.round((peakBeaconFreq - 2800) / 150);
        const resolvedSessionId = Math.max(1, Math.min(8, rawId + 1));

        onPairDetected(resolvedSessionId, snrDb);
      }

      this.animFrameId = requestAnimationFrame(detectLoop);
    };

    this.animFrameId = requestAnimationFrame(detectLoop);
  }

  /**
   * Synthesizes glassy confirmation chord on receiver side
   */
  public async playConfirmationChord(): Promise<void> {
    if (!this.ctx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass({ sampleRate: 48000 });
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    const now = this.ctx.currentTime;
    const notes = [523.25, 783.99, 1174.66]; // C5, G5, D6

    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.3 / (idx + 1), now + idx * 0.06 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.06 + 0.32);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.38);
    });
  }

  public stop(): void {
    this.isListening = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }
}
