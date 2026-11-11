/**
 * AudioWorkletProcessor for high-frequency acoustic modem reception.
 * Runs in the dedicated audio rendering thread for zero-lag DSP.
 */
class UltrasonicWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    if (!channelData) return true;

    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.writeIndex++] = channelData[i];

      if (this.writeIndex >= this.bufferSize) {
        // Post buffer snapshot to main thread
        const snapshot = new Float32Array(this.buffer);
        this.port.postMessage({
          type: 'AUDIO_CHUNK',
          buffer: snapshot.buffer,
          timestamp: currentTime
        }, [snapshot.buffer]);

        this.writeIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('ultrasonic-processor', UltrasonicWorkletProcessor);
