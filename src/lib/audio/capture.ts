/**
 * Capture microphone fiable, brute (sans suppression de bruit ni AEC) et sécurisée contre le larsen.
 */

export interface CaptureHandle {
  ctx: AudioContext;
  stream: MediaStream;
  applied: MediaTrackSettings;
  stop(): void;
}

export type CaptureErrorCode =
  | 'NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'NOT_READABLE'
  | 'INSECURE_CONTEXT'
  | 'UNSUPPORTED_WORKLET'
  | 'UNKNOWN';

export class AudioCaptureError extends Error {
  constructor(
    public readonly code: CaptureErrorCode,
    message: string,
    public readonly userMessage: string,
    public readonly actionAdvice: string
  ) {
    super(message);
    this.name = 'AudioCaptureError';
  }
}

/**
 * Mappe les erreurs DOMException standards en messages utilisateur explicites.
 */
export function mapMediaError(err: unknown): AudioCaptureError {
  if (err instanceof AudioCaptureError) return err;

  const error = err as { name?: string; message?: string };
  const name = error.name || '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new AudioCaptureError(
      'NOT_ALLOWED',
      'Microphone permission denied',
      'Le micro est bloqué par le navigateur.',
      'Ouvrez les réglages du site pour autoriser l’accès au microphone.'
    );
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new AudioCaptureError(
      'NOT_FOUND',
      'No microphone detected',
      'Aucun microphone détecté sur cet appareil.',
      'Branchez un micro ou vérifiez les périphériques d’entrée audio.'
    );
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new AudioCaptureError(
      'NOT_READABLE',
      'Microphone is locked or in use',
      'Le micro est utilisé par une autre application.',
      'Fermez les autres applications utilisant l’audio et réessayez.'
    );
  }

  return new AudioCaptureError(
    'UNKNOWN',
    error.message || 'Unknown media error',
    'Impossible d’initialiser l’entrée audio.',
    'Vérifiez la connexion du micro et rechargez la page.'
  );
}

/**
 * Démarre la capture microphone via AudioWorklet.
 * IMPORTANT: Ne connecte JAMAIS le processeur à ctx.destination (anti-larsen absolu).
 */
export async function startCapture(
  onSamples: (samples: Float32Array, sampleRate: number) => void
): Promise<CaptureHandle> {
  // 1. Vérification HTTPS / contexte sécurisé
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new AudioCaptureError(
      'INSECURE_CONTEXT',
      'getUserMedia is not available in insecure context',
      'Le navigateur ne permet pas l’accès au micro ici.',
      'L’application requiert un contexte HTTPS sécurisé pour accéder au micro.'
    );
  }

  // 2. Gestion de session audio Safari iPhone si disponible
  if ('audioSession' in navigator) {
    try {
      (navigator as unknown as { audioSession: { type: string } }).audioSession.type = 'play-and-record';
    } catch {
      // Ignorer si non supporté
    }
  }

  // 3. Demande de flux brut sans traitement destructeur
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  } catch (err) {
    throw mapMediaError(err);
  }

  // 4. Initialisation AudioContext (48 kHz interactif)
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  // 5. Chargement de l'AudioWorklet
  if (!ctx.audioWorklet) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw new AudioCaptureError(
      'UNSUPPORTED_WORKLET',
      'AudioWorklet not supported',
      'Votre navigateur ne supporte pas AudioWorklet.',
      'Veuillez mettre à jour votre navigateur pour utiliser le transfert acoustique.'
    );
  }

  try {
    await ctx.audioWorklet.addModule('/worklets/capture.js');
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw new AudioCaptureError(
      'UNKNOWN',
      `Failed to load AudioWorklet module: ${String(err)}`,
      'Erreur de chargement du module de capture audio.',
      'Rechargez la page pour réinitialiser le sous-système audio.'
    );
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'capture-processor');

  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    onSamples(e.data, ctx.sampleRate);
  };

  // SOURCE -> NODE (SANS ctx.destination POUR ÉVITER LE LARSEN)
  source.connect(node);

  const tracks = stream.getAudioTracks();
  const applied = tracks.length > 0 ? tracks[0].getSettings() : {};
  if (applied.echoCancellation || applied.noiseSuppression || applied.autoGainControl) {
    console.warn('[AudioCapture] Traitements audio encore actifs selon le pilote:', applied);
  }

  return {
    ctx,
    stream,
    applied,
    stop() {
      try {
        node.disconnect();
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      } catch {
        // Ignorer les erreurs lors de la fermeture
      }
    },
  };
}
