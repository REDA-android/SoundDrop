/**
 * Mesure du niveau sonore RMS en dBFS et qualification du bruit ambiant.
 */

export type NoiseEnvironment = 'calm' | 'noisy' | 'too_noisy';

export interface NoiseStatus {
  rmsDb: number;
  environment: NoiseEnvironment;
  label: string;
  actionAdvice: string;
}

/**
 * Calcule le niveau RMS en décibels pleine échelle (dBFS) d'un tampon d'échantillons.
 * Retourne une valeur généralement comprise entre -120 dBFS et 0 dBFS.
 */
export function rmsDbfs(x: Float32Array): number {
  if (x.length === 0) return -120;
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i] * x[i];
  }
  const rms = Math.sqrt(s / x.length);
  return 20 * Math.log10(Math.max(rms, 1e-9));
}

/**
 * Qualifie l'ambiance sonore selon les seuils :
 * - < -50 dBFS : calme
 * - -50 à -35 dBFS : bruyant
 * - > -35 dBFS : trop bruyant
 */
export function evaluateNoiseLevel(rmsDb: number): NoiseStatus {
  if (rmsDb < -50) {
    return {
      rmsDb,
      environment: 'calm',
      label: 'Environnement calme',
      actionAdvice: 'Conditions optimales pour le transfert acoustique.',
    };
  }

  if (rmsDb <= -30) {
    return {
      rmsDb,
      environment: 'noisy',
      label: 'Bruit ambiant détecté',
      actionAdvice: 'Rapprochez les appareils pour assurer la réception.',
    };
  }

  return {
    rmsDb,
    environment: 'too_noisy',
    label: 'Pièce trop bruyante',
    actionAdvice: 'Éloignez-vous des sources de bruit ou utilisez le mode ultrasonique.',
  };
}

export const calculateRmsDbfs = rmsDbfs;
export function classifyNoiseLevel(rmsDb: number): NoiseEnvironment {
  return evaluateNoiseLevel(rmsDb).environment;
}

