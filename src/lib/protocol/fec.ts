/**
 * Forward Error Correction (FEC) Engine:
 * 1. Reed-Solomon GF(2^8) Codec (up to 8 byte error correction with 16 parity symbols)
 * 2. Hamming(7,4) Codec (single bit error correction per 4-bit nibble)
 */

// ==========================================
// 1. REED-SOLOMON GF(2^8) IMPLEMENTATION
// Field Polynomial: 0x11D (x^8 + x^4 + x^3 + x^2 + 1)
// Primitive Element: alpha = 2
// ==========================================

const GF_SIZE = 256;
const PRIMITIVE_POLY = 0x11D;

const gfExp = new Uint8Array(GF_SIZE * 2);
const gfLog = new Uint8Array(GF_SIZE);

// Initialize Galois Field Log & Exp tables
(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= PRIMITIVE_POLY;
    }
  }
  for (let i = 255; i < GF_SIZE * 2; i++) {
    gfExp[i] = gfExp[i - 255];
  }
  gfLog[0] = 0; // Not strictly defined, but sentinel
})();

function gfAdd(a: number, b: number): number {
  return a ^ b;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return gfExp[gfLog[a] + gfLog[b]];
}

function gfDiv(a: number, b: number): number {
  if (a === 0) return 0;
  if (b === 0) throw new Error('Division by zero in GF(2^8)');
  return gfExp[(gfLog[a] - gfLog[b] + 255) % 255];
}

function gfPolyMul(p1: Uint8Array, p2: Uint8Array): Uint8Array {
  const result = new Uint8Array(p1.length + p2.length - 1);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= gfMul(p1[i], p2[j]);
    }
  }
  return result;
}

/**
 * Builds generator polynomial of degree nroots:
 * g(x) = (x - alpha^0)(x - alpha^1)...(x - alpha^(nroots-1))
 */
function buildGeneratorPolynomial(nroots: number): Uint8Array {
  let g: Uint8Array = new Uint8Array([1]);
  for (let i = 0; i < nroots; i++) {
    const factor = new Uint8Array([1, gfExp[i]]);
    g = gfPolyMul(g, factor);
  }
  return g;
}

export class ReedSolomonCodec {
  private nroots: number;
  private genPoly: Uint8Array;

  constructor(nroots = 16) {
    this.nroots = nroots;
    this.genPoly = buildGeneratorPolynomial(nroots);
  }

  /**
   * Encodes a message array and returns the `nroots` parity bytes.
   */
  public encode(message: Uint8Array): Uint8Array {
    const parity = new Uint8Array(this.nroots);
    for (let i = 0; i < message.length; i++) {
      const feedback = message[i] ^ parity[0];
      for (let j = 0; j < this.nroots - 1; j++) {
        parity[j] = parity[j + 1] ^ gfMul(feedback, this.genPoly[j + 1]);
      }
      parity[this.nroots - 1] = gfMul(feedback, this.genPoly[this.nroots]);
    }
    return parity;
  }

  /**
   * Verifies syndromes of received codeword. Returns true if valid with 0 errors.
   */
  public verify(codeword: Uint8Array): boolean {
    for (let i = 0; i < this.nroots; i++) {
      let sum = 0;
      const alpha = gfExp[i];
      for (let j = 0; j < codeword.length; j++) {
        sum = codeword[j] ^ gfMul(sum, alpha);
      }
      if (sum !== 0) return false;
    }
    return true;
  }

  /**
   * Decodes a message + parity codeword and corrects up to nroots / 2 byte errors.
   * Returns: { success: boolean, corrected: Uint8Array, errorsCorrected: number }
   */
  public decode(codeword: Uint8Array): { success: boolean; corrected: Uint8Array; errorsCorrected: number } {
    const work = new Uint8Array(codeword);
    const syndromes = new Uint8Array(this.nroots);
    let hasErrors = false;

    for (let i = 0; i < this.nroots; i++) {
      let sum = 0;
      const alpha = gfExp[i];
      for (let j = 0; j < work.length; j++) {
        sum = work[j] ^ gfMul(sum, alpha);
      }
      syndromes[i] = sum;
      if (sum !== 0) hasErrors = true;
    }

    if (!hasErrors) {
      return { success: true, corrected: new Uint8Array(work.subarray(0, work.length - this.nroots)), errorsCorrected: 0 };
    }

    // Berlekamp-Massey algorithm for error locator polynomial
    let c = new Uint8Array([1]);
    let b = new Uint8Array([1]);
    let l = 0;
    let m = 1;
    let bVal = 1;

    for (let n = 0; n < this.nroots; n++) {
      let d = syndromes[n];
      for (let i = 1; i <= l; i++) {
        if (i < c.length && n - i >= 0) {
          d ^= gfMul(c[i], syndromes[n - i]);
        }
      }

      if (d === 0) {
        m++;
      } else if (2 * l <= n) {
        const t = new Uint8Array(c);
        const factor = gfDiv(d, bVal);
        const shiftB = new Uint8Array(b.length + m);
        for (let k = 0; k < b.length; k++) {
          shiftB[k + m] = gfMul(factor, b[k]);
        }
        const maxLen = Math.max(c.length, shiftB.length);
        const newC = new Uint8Array(maxLen);
        for (let k = 0; k < c.length; k++) newC[k] ^= c[k];
        for (let k = 0; k < shiftB.length; k++) newC[k] ^= shiftB[k];
        c = newC;
        l = n + 1 - l;
        b = t;
        bVal = d;
        m = 1;
      } else {
        const factor = gfDiv(d, bVal);
        const shiftB = new Uint8Array(b.length + m);
        for (let k = 0; k < b.length; k++) {
          shiftB[k + m] = gfMul(factor, b[k]);
        }
        const maxLen = Math.max(c.length, shiftB.length);
        const newC = new Uint8Array(maxLen);
        for (let k = 0; k < c.length; k++) newC[k] ^= c[k];
        for (let k = 0; k < shiftB.length; k++) newC[k] ^= shiftB[k];
        c = newC;
        m++;
      }
    }

    if (l > this.nroots / 2) {
      // Uncorrectable: too many errors
      return { success: false, corrected: new Uint8Array(work.subarray(0, work.length - this.nroots)), errorsCorrected: -1 };
    }

    // Chien search to find error positions
    const errorPositions: number[] = [];
    const len = work.length;
    for (let i = 0; i < len; i++) {
      const xInv = gfExp[(255 - (len - 1 - i) % 255) % 255];
      let sum = 0;
      let power = 1;
      for (let j = 0; j < c.length; j++) {
        sum ^= gfMul(c[j], power);
        power = gfMul(power, xInv);
      }
      if (sum === 0) {
        errorPositions.push(i);
      }
    }

    if (errorPositions.length !== l) {
      return { success: false, corrected: new Uint8Array(work.subarray(0, work.length - this.nroots)), errorsCorrected: -1 };
    }

    // Forney algorithm to compute error values
    // Omega(x) = S(x) * C(x) mod x^nroots
    const omega = new Uint8Array(this.nroots);
    for (let i = 0; i < this.nroots; i++) {
      for (let j = 0; j < c.length; j++) {
        if (i + j < this.nroots) {
          omega[i + j] ^= gfMul(syndromes[i], c[j]);
        }
      }
    }

    for (const pos of errorPositions) {
      const xi = gfExp[(len - 1 - pos) % 255];
      const xiInv = gfExp[(255 - (len - 1 - pos) % 255) % 255];

      // Evaluate Omega(X_i^-1)
      let num = 0;
      let pNum = 1;
      for (let i = 0; i < this.nroots; i++) {
        num ^= gfMul(omega[i], pNum);
        pNum = gfMul(pNum, xiInv);
      }

      // Evaluate formal derivative of C'(X_i^-1)
      let den = 0;
      let pDen = 1;
      for (let i = 1; i < c.length; i += 2) {
        den ^= gfMul(c[i], pDen);
        pDen = gfMul(pDen, gfMul(xiInv, xiInv));
      }

      if (den === 0) {
        return { success: false, corrected: new Uint8Array(work.subarray(0, work.length - this.nroots)), errorsCorrected: -1 };
      }

      const errVal = gfMul(xi, gfDiv(num, den));
      work[pos] ^= errVal;
    }

    // Re-verify after correction
    const verified = this.verify(work);
    return {
      success: verified,
      corrected: new Uint8Array(work.subarray(0, work.length - this.nroots)),
      errorsCorrected: errorPositions.length,
    };
  }
}

// Global default RS(80, 64) instance (16 parity bytes)
export const rsCodec = new ReedSolomonCodec(16);

// ==========================================
// 2. HAMMING(7,4) IMPLEMENTATION
// Encodes 4-bit nibbles into 7-bit words + 1 parity bit = 8-bit byte
// ==========================================

export function hammingEncodeNibble(d: number): number {
  const d1 = (d >> 3) & 1;
  const d2 = (d >> 2) & 1;
  const d3 = (d >> 1) & 1;
  const d4 = d & 1;

  const p1 = d1 ^ d2 ^ d4;
  const p2 = d1 ^ d3 ^ d4;
  const p3 = d2 ^ d3 ^ d4;

  const code7 = (p1 << 6) | (p2 << 5) | (d1 << 4) | (p3 << 3) | (d2 << 2) | (d3 << 1) | d4;
  // Compute 8th overall parity bit (SECDED - Single Error Correction, Double Error Detection)
  let parity8 = 0;
  for (let i = 0; i < 7; i++) {
    parity8 ^= (code7 >> i) & 1;
  }
  return (code7 << 1) | parity8;
}

export function hammingDecodeByte(code: number): { nibble: number; corrected: boolean; doubleError: boolean } {
  const code7 = (code >> 1) & 0x7F;
  const pOverall = code & 1;

  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum ^= (code7 >> i) & 1;
  }
  const overallParityCheck = (sum ^ pOverall) !== 0;

  const b7 = (code7 >> 6) & 1; // p1
  const b6 = (code7 >> 5) & 1; // p2
  const b5 = (code7 >> 4) & 1; // d1
  const b4 = (code7 >> 3) & 1; // p3
  const b3 = (code7 >> 2) & 1; // d2
  const b2 = (code7 >> 1) & 1; // d3
  const b1 = code7 & 1;        // d4

  const s1 = b7 ^ b5 ^ b3 ^ b1;
  const s2 = b6 ^ b5 ^ b2 ^ b1;
  const s3 = b4 ^ b3 ^ b2 ^ b1;

  const syndrome = (s3 << 2) | (s2 << 1) | s1;

  let correctedCode7 = code7;
  let corrected = false;
  let doubleError = false;

  if (syndrome !== 0) {
    if (overallParityCheck) {
      // Single bit error at bit (8 - syndrome)
      const bitPos = 7 - syndrome;
      correctedCode7 ^= (1 << bitPos);
      corrected = true;
    } else {
      // Double bit error detected
      doubleError = true;
    }
  }

  const d1 = (correctedCode7 >> 4) & 1;
  const d2 = (correctedCode7 >> 2) & 1;
  const d3 = (correctedCode7 >> 1) & 1;
  const d4 = correctedCode7 & 1;
  const nibble = (d1 << 3) | (d2 << 2) | (d3 << 1) | d4;

  return { nibble, corrected, doubleError };
}
