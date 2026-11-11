/**
 * Modem MFSK 16 tons avec démodulation Goertzel (moteur secondaire expérimental).
 * Fréquences calées pour annuler la fuite spectrale à 48 000 Hz et 44 100 Hz.
 */

export interface MfskProfile {
  symbolMs: number;
  baseHz: number;
  stepHz: number;
}

export const MFSK_PROFILES = {
  robust: { symbolMs: 48, baseHz: 1500, stepHz: 62.5 },
  normal: { symbolMs: 24, baseHz: 1500, stepHz: 125 },
  fast: { symbolMs: 12, baseHz: 1500, stepHz: 250 },
} as const satisfies Record<string, MfskProfile>;

export type MfskProfileName = keyof typeof MFSK_PROFILES;

/**
 * Filtre de Goertzel par bloc : calcule l'énergie spectrale à une fréquence cible exacte.
 */
export function goertzelEnergy(x: Float32Array, freq: number, sr: number): number {
  const w = (2 * Math.PI * freq) / sr;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/**
 * Démodule un bloc de symbole parmi les 16 tons possibles et calcule le SNR local (dB).
 */
export function demodSymbol(
  block: Float32Array,
  p: MfskProfile,
  sr: number
): { symbol: number; snrDb: number } {
  let best = 0;
  let bestE = -Infinity;
  let sum = 0;

  for (let k = 0; k < 16; k++) {
    const e = goertzelEnergy(block, p.baseHz + k * p.stepHz, sr);
    sum += e;
    if (e > bestE) {
      bestE = e;
      best = k;
    }
  }

  const noise = (sum - bestE) / 15;
  const snrDb = noise > 1e-15 ? Math.min(60, 10 * Math.log10(bestE / noise)) : 60;
  return { symbol: best, snrDb };
}

/**
 * Modulation MFSK à phase continue (CPFSK).
 * Entrée : tableau de quartets (valeurs entre 0 et 15).
 */
export function modulate(nibbles: Uint8Array, p: MfskProfile, sr: number): Float32Array {
  const n = Math.round((p.symbolMs / 1000) * sr);
  const out = new Float32Array(nibbles.length * n);
  let phase = 0;

  for (let s = 0; s < nibbles.length; s++) {
    const dphi = (2 * Math.PI * (p.baseHz + nibbles[s] * p.stepHz)) / sr;
    for (let i = 0; i < n; i++) {
      out[s * n + i] = 0.5 * Math.sin(phase);
      phase += dphi;
    }
    phase %= 2 * Math.PI;
  }

  return out;
}

/**
 * Préambule : chirp linéaire fenêtré de Hann (1.5 kHz -> 5.5 kHz sur 50 ms).
 */
export function chirp(sr: number, ms = 50, f0 = 1500, f1 = 5500): Float32Array {
  const n = Math.round((ms / 1000) * sr);
  const k = (f1 - f0) / (ms / 1000);
  const out = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    out[i] = 0.5 * w * Math.sin(2 * Math.PI * (f0 * t + 0.5 * k * t * t));
  }

  return out;
}
