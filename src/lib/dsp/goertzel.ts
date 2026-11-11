/**
 * Goertzel Algorithm & Filter Bank
 * Computes exact discrete Fourier component energy at target FSK frequencies.
 * Mathematical equations:
 *   s[n] = x[n] + 2*cos(omega_0)*s[n-1] - s[n-2]
 *   |Y(omega_0)|^2 = s[N-1]^2 + s[N-2]^2 - 2*cos(omega_0)*s[N-1]*s[N-2]
 */

export interface GoertzelDetection {
  symbol: number;             // 0x0 to 0xF (0..15)
  peakFrequency: number;      // Exact Hz of the peak tone
  peakEnergy: number;         // Magnitude squared
  noiseFloor: number;         // Ambient median energy
  snrDb: number;              // Signal-to-noise ratio in decibels
  confidence: number;         // 0.0 to 1.0 confidence score
  allEnergies: Float32Array;  // 16 bin energies
  isValid: boolean;           // True if SNR > threshold and above noise floor
}

export class GoertzelFilterBank {
  private sampleRate: number;
  private frequencies: number[];
  private numTones: number;
  private coeff: Float32Array;
  private cosOmega: Float32Array;

  constructor(frequencies: number[], sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.frequencies = frequencies;
    this.numTones = frequencies.length;
    this.coeff = new Float32Array(this.numTones);
    this.cosOmega = new Float32Array(this.numTones);

    // Precompute coefficients: coeff = 2 * cos(2 * pi * f / Fs)
    for (let i = 0; i < this.numTones; i++) {
      const omega = (2 * Math.PI * this.frequencies[i]) / this.sampleRate;
      this.cosOmega[i] = Math.cos(omega);
      this.coeff[i] = 2 * this.cosOmega[i];
    }
  }

  /**
   * Computes the energy at a single target frequency over sample window x.
   */
  public computeToneEnergy(samples: Float32Array, toneIndex: number): number {
    const coeff = this.coeff[toneIndex];
    const cosOm = this.cosOmega[toneIndex];
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;

    const N = samples.length;
    for (let n = 0; n < N; n++) {
      s0 = samples[n] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    // Power magnitude squared: s1^2 + s2^2 - 2 * cos(omega) * s1 * s2
    const power = s1 * s1 + s2 * s2 - 2 * cosOm * s1 * s2;
    return Math.max(0, power);
  }

  /**
   * Evaluates all 16 FSK frequencies on the sample window.
   * Returns complete GoertzelDetection with SNR, peak bin, and adaptive noise floor.
   */
  public detect(samples: Float32Array, snrThresholdDb = 9.0): GoertzelDetection {
    const energies = new Float32Array(this.numTones);
    let maxEnergy = 0;
    let peakIndex = 0;

    for (let i = 0; i < this.numTones; i++) {
      const p = this.computeToneEnergy(samples, i);
      energies[i] = p;
      if (p > maxEnergy) {
        maxEnergy = p;
        peakIndex = i;
      }
    }

    // Calculate adaptive noise floor via median of sorted energies
    const sorted = Array.from(energies).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianNoise = (sorted[mid - 1] + sorted[mid]) / 2;
    const noiseFloor = Math.max(1e-12, medianNoise);

    // Second peak for ratio test
    let secondMax = 0;
    for (let i = 0; i < this.numTones; i++) {
      if (i !== peakIndex && energies[i] > secondMax) {
        secondMax = energies[i];
      }
    }

    const snrDb = 10 * Math.log10(Math.max(1e-12, maxEnergy) / noiseFloor);
    const peakToSecondRatio = secondMax > 0 ? maxEnergy / secondMax : 10.0;
    const isValid = snrDb >= snrThresholdDb && peakToSecondRatio >= 1.5 && maxEnergy > 1e-6;

    // Confidence score scaled between 0 and 1
    const confidence = Math.min(1.0, Math.max(0.0, (snrDb - snrThresholdDb) / 20.0 + 0.3));

    return {
      symbol: peakIndex,
      peakFrequency: this.frequencies[peakIndex],
      peakEnergy: maxEnergy,
      noiseFloor,
      snrDb: +snrDb.toFixed(1),
      confidence: +confidence.toFixed(2),
      allEnergies: energies,
      isValid,
    };
  }
}

/**
 * Radix-2 Cooley-Tukey Fast Fourier Transform (FFT) helper
 * @param realIn Input real samples (length must be power of 2)
 */
export function computeFftMagnitudes(realIn: Float32Array): Float32Array {
  const N = realIn.length;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  real.set(realIn);

  // Bit reversal
  let j = 0;
  for (let i = 0; i < N - 1; i++) {
    if (i < j) {
      const tempR = real[i];
      real[i] = real[j];
      real[j] = tempR;
    }
    let k = N >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly computation
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wR = Math.cos(angle);
    const wI = Math.sin(angle);

    for (let i = 0; i < N; i += len) {
      let uR = 1.0;
      let uI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const idx = i + k;
        const pair = idx + halfLen;

        const vR = real[pair] * uR - imag[pair] * uI;
        const vI = real[pair] * uI + imag[pair] * uR;

        real[pair] = real[idx] - vR;
        imag[pair] = imag[idx] - vI;
        real[idx] += vR;
        imag[idx] += vI;

        const nextUR = uR * wR - uI * wI;
        uI = uR * wI + uI * wR;
        uR = nextUR;
      }
    }
  }

  // Magnitude spectrum (first N/2 bins)
  const halfN = N >> 1;
  const magnitudes = new Float32Array(halfN);
  for (let i = 0; i < halfN; i++) {
    magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / N;
  }
  return magnitudes;
}
