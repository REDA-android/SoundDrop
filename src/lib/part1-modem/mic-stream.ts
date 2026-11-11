/**
 * Raw 48 kHz WebAudio Microphone Stream Acquisition
 * Strictly disables OS/browser preprocessing to preserve acoustic data tones.
 */

export interface MicStreamOptions {
  sampleRate?: number;
  bufferSize?: number; // 2048 samples = 42.66ms at 48kHz
  onPcmChunk: (samples: Float32Array) => void;
}

export class MicStreamCapture {
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: AudioWorkletNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private isCapturing = false;

  public async start(options: MicStreamOptions): Promise<AnalyserNode> {
    if (this.isCapturing && this.analyserNode) {
      return this.analyserNode;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioCtx({ sampleRate: options.sampleRate || 48000 });

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    // Create 2048-point AnalyserNode
    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.2;

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

    this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);

    this.sourceNode.connect(this.analyserNode);

    // AudioWorklet stream processor (sans connexion à destination pour éliminer le larsen)
    await this.audioCtx.audioWorklet.addModule('/worklets/capture.js');
    const workletNode = new AudioWorkletNode(this.audioCtx, 'capture-processor');
    workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.isCapturing) return;
      options.onPcmChunk(e.data);
    };

    this.sourceNode.connect(workletNode);
    this.processorNode = workletNode;

    this.isCapturing = true;
    return this.analyserNode;
  }

  public stop(): void {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.isCapturing = false;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  public getAudioContext(): AudioContext | null {
    return this.audioCtx;
  }

  public getIsCapturing(): boolean {
    return this.isCapturing;
  }
}
