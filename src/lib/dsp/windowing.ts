/**
 * DSP Window Functions & Envelope Shaping
 * Eliminates spectral leakage, acoustic clicking, and abrupt phase transients.
 */

export function createHannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  const factor = (2 * Math.PI) / (length - 1);
  for (let n = 0; n < length; n++) {
    window[n] = 0.5 * (1 - Math.cos(factor * n));
  }
  return window;
}

export function createHammingWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  const factor = (2 * Math.PI) / (length - 1);
  for (let n = 0; n < length; n++) {
    window[n] = 0.54 - 0.46 * Math.cos(factor * n);
  }
  return window;
}

/**
 * Tukey (Tapered Cosine) Window
 * @param length Total length N
 * @param alpha Taper ratio (0.0 to 1.0, default 0.25)
 */
export function createTukeyWindow(length: number, alpha = 0.25): Float32Array {
  const window = new Float32Array(length);
  if (alpha <= 0) {
    window.fill(1.0);
    return window;
  }
  if (alpha >= 1) {
    return createHannWindow(length);
  }

  const edgeSamples = (alpha * (length - 1)) / 2;
  for (let n = 0; n < length; n++) {
    if (n < edgeSamples) {
      window[n] = 0.5 * (1 + Math.cos(Math.PI * (n / edgeSamples - 1)));
    } else if (n <= (length - 1) - edgeSamples) {
      window[n] = 1.0;
    } else {
      window[n] = 0.5 * (1 + Math.cos(Math.PI * ((n - (length - 1) + edgeSamples) / edgeSamples)));
    }
  }
  return window;
}

/**
 * Applies a smooth raised-cosine fade-in and fade-out to a buffer in-place
 * @param buffer PCM sample buffer
 * @param fadeSamples Number of samples for fade-in and fade-out (e.g. 5ms = 240 samples at 48kHz)
 */
export function applyRaisedCosineEnvelope(buffer: Float32Array, fadeSamples: number): void {
  const len = buffer.length;
  const f = Math.min(fadeSamples, Math.floor(len / 2));
  for (let i = 0; i < f; i++) {
    const ramp = 0.5 * (1 - Math.cos((Math.PI * i) / f));
    buffer[i] *= ramp;
    buffer[len - 1 - i] *= ramp;
  }
}
