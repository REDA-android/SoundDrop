/**
 * Lecture audio sécurisée d'échantillons PCM sans clics ni écrêtage.
 */

export interface PlaybackOptions {
  volume?: number;
  onStart?: () => void;
  onEnded?: () => void;
}

/**
 * Vérifie si le tampon d'échantillons présente un écrêtage (> 1.0 ou < -1.0).
 */
export function checkClipping(samples: Float32Array): { hasClipping: boolean; maxAbs: number } {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  return {
    hasClipping: maxAbs > 1.0,
    maxAbs,
  };
}

/**
 * Joue des échantillons Float32Array via AudioBufferSourceNode
 * avec fondu d'entrée et de sortie de 5 ms pour éviter les clics audibles.
 */
export async function playSamples(
  ctx: AudioContext,
  samples: Float32Array,
  options: PlaybackOptions = {}
): Promise<void> {
  const { volume = 0.8, onStart, onEnded } = options;

  if (samples.length === 0) return;

  // Reprendre le contexte si suspendu (ex: gesture utilisateur)
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  // Vérification de sécurité écrêtage
  const { hasClipping, maxAbs } = checkClipping(samples);
  let safeSamples = samples;
  if (hasClipping && maxAbs > 0) {
    console.warn(`[AudioPlayback] Écrêtage détecté (crête=${maxAbs.toFixed(2)}), normalisation appliquée.`);
    safeSamples = new Float32Array(samples.length);
    const scale = 0.98 / maxAbs;
    for (let i = 0; i < samples.length; i++) {
      safeSamples[i] = samples[i] * scale;
    }
  }

  const buffer = ctx.createBuffer(1, safeSamples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(safeSamples);

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const gain = ctx.createGain();
  const t0 = ctx.currentTime;
  const dur = safeSamples.length / ctx.sampleRate;
  const safeVolume = Math.min(1.0, Math.max(0.0, volume));

  // Rampe de gain 5ms : élimination des clics de commutation
  const rampTime = Math.min(0.005, dur / 4);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(safeVolume, t0 + rampTime);
  gain.gain.setValueAtTime(safeVolume, Math.max(t0 + rampTime, t0 + dur - rampTime));
  gain.gain.linearRampToValueAtTime(0, t0 + dur);

  src.connect(gain).connect(ctx.destination);

  return new Promise<void>((resolve) => {
    src.onended = () => {
      onEnded?.();
      src.disconnect();
      gain.disconnect();
      resolve();
    };

    onStart?.();
    src.start();
  });
}
