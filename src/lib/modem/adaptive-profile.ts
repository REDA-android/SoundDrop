/**
 * SoundDrop Adaptive Acoustic Profiling
 * Dynamically selects modulation parameters based on measured ambient noise (RMS dBFS)
 */

import { ProfileId } from './types';
import { evaluateNoiseLevel } from '../audio/rms';

export interface AdaptiveProfileResult {
  profile: ProfileId;
  throughputBps: number;
  durationSeconds: number;
  rationale: string;
}

export const PROFILE_THROUGHPUT: Record<ProfileId, number> = {
  'audible-fastest': 27, // ~27 bytes/sec
  'audible-fast': 15,    // ~15 bytes/sec
  'audible-normal': 7,   // ~7 bytes/sec
  'ultrasound-fastest': 20,
  'ultrasound-fast': 14,
  'ultrasound-normal': 7,
};

/**
 * Recommande automatiquement le meilleur profil acoustique selon le bruit mesuré.
 */
export function selectAdaptiveProfile(
  ambientRmsDb: number,
  mode: 'audible' | 'ultrasound' = 'audible',
  payloadBytes: number = 32
): AdaptiveProfileResult {
  const noise = evaluateNoiseLevel(ambientRmsDb);

  let profile: ProfileId;
  let rationale: string;

  if (mode === 'ultrasound') {
    if (noise.environment === 'calm') {
      profile = 'ultrasound-fastest';
      rationale = 'Environnement calme : profil ultrasonique à débit maximal (20 o/s).';
    } else {
      profile = 'ultrasound-normal';
      rationale = 'Bruit ultrasonique ou atténuation : profil ultrasonique robuste (7 o/s).';
    }
  } else {
    // Mode audible
    if (noise.environment === 'calm') {
      profile = 'audible-fastest';
      rationale = 'Pièce calme : profil rapide sélectionné (27 o/s) pour un transfert court.';
    } else if (noise.environment === 'noisy') {
      profile = 'audible-fast';
      rationale = 'Bruit ambiant modéré : profil équilibré (15 o/s) avec FEC renforcé.';
    } else {
      profile = 'audible-normal';
      rationale = 'Environnement bruyant : profil robuste (7 o/s) à dispersion spectrale maximale.';
    }
  }

  const throughput = PROFILE_THROUGHPUT[profile] || 15;
  // Durée estimée = préambule (0.6s) + données / débit + garde demi-duplex (0.3s)
  const durationSeconds = Math.max(1, Math.ceil(0.6 + payloadBytes / throughput + 0.3));

  return {
    profile,
    throughputBps: throughput,
    durationSeconds,
    rationale,
  };
}
