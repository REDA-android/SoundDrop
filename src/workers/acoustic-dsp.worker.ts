/**
 * Off-Main-Thread Acoustic DSP Worker (Comlink)
 * Executes heavy Goertzel Filter Bank, FFT, and Reed-Solomon FEC calculations
 * off the UI thread to keep the 60fps Matter.js / Framer Motion bubble radar silky smooth.
 */

import * as Comlink from 'comlink';
import { GoertzelFilterBank } from '../lib/dsp/goertzel';
import { ChirpEngine } from '../lib/dsp/chirp';
import { ReedSolomonCodec } from '../lib/protocol/fec';
import { AUDIBLE_CONFIG, ULTRASONIC_CONFIG, getFskFrequencies } from '../lib/dsp/constants';

export class AcousticDspWorkerService {
  private audibleBank: GoertzelFilterBank;
  private ultrasonicBank: GoertzelFilterBank;
  private rsCodec: ReedSolomonCodec;

  constructor() {
    this.audibleBank = new GoertzelFilterBank(getFskFrequencies(AUDIBLE_CONFIG), 48000);
    this.ultrasonicBank = new GoertzelFilterBank(getFskFrequencies(ULTRASONIC_CONFIG), 48000);
    this.rsCodec = new ReedSolomonCodec(16);
  }

  public detectGoertzel(samples: Float32Array, isUltrasonic = false) {
    const bank = isUltrasonic ? this.ultrasonicBank : this.audibleBank;
    return bank.detect(samples, 8.5);
  }

  public decodeReedSolomon(codeword: Uint8Array) {
    return this.rsCodec.decode(codeword);
  }

  public encodeReedSolomon(message: Uint8Array) {
    return this.rsCodec.encode(message);
  }
}

Comlink.expose(new AcousticDspWorkerService());
