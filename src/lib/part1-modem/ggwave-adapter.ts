/**
 * ggwave WASM / Data-Over-Sound Adapter
 * Wrapper around Georgi Gerganov's ggwave engine for standard audible and ultrasonic profiles.
 */

export interface GGWaveInstance {
  init?: (options?: unknown) => unknown;
  encode?: (payload: string | Uint8Array, protocol: number, volume: number) => Float32Array;
  decode?: (instance: unknown, pcmChunk: Float32Array) => Uint8Array | null;
}

export class GGWaveAdapter {
  private isLoaded = false;
  private ggwaveModule: unknown = null;

  public async initialize(): Promise<boolean> {
    if (this.isLoaded) return true;

    try {
      // Dynamic import ggwave to support SSR & offline PWA
      const ggwavePkg = await import('ggwave');
      const factory = (ggwavePkg as { default?: unknown }).default || ggwavePkg;
      if (typeof factory === 'function') {
        this.ggwaveModule = await factory();
        this.isLoaded = true;
        return true;
      }
    } catch (err) {
      console.warn('ggwave WASM package not directly available, using Pure DSP fallback:', err);
    }
    return false;
  }

  public isAvailable(): boolean {
    return this.isLoaded && this.ggwaveModule !== null;
  }

  public encode(
    payload: Uint8Array | string,
    mode: 'audible' | 'ultrasonic' = 'audible',
    volume = 80
  ): Float32Array | null {
    if (!this.isAvailable()) return null;

    try {
      const g = this.ggwaveModule as {
        ProtocolId: {
          GGWAVE_PROTOCOL_AUDIBLE_FASTEST?: number;
          GGWAVE_PROTOCOL_ULTRASONIC_FASTEST?: number;
        };
        encode: (payload: Uint8Array | string, protocol: number, volume: number) => Int16Array | Float32Array;
      };

      const protocol =
        mode === 'ultrasonic'
          ? (g.ProtocolId.GGWAVE_PROTOCOL_ULTRASONIC_FASTEST || 2)
          : (g.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FASTEST || 1);

      const waveform = g.encode(payload, protocol, volume);

      if (waveform instanceof Float32Array) {
        return waveform;
      } else if (waveform instanceof Int16Array) {
        // Convert Int16 PCM to Float32 [-1.0, 1.0]
        const floatPcm = new Float32Array(waveform.length);
        for (let i = 0; i < waveform.length; i++) {
          floatPcm[i] = waveform[i] / 32768.0;
        }
        return floatPcm;
      }
    } catch (err) {
      console.error('ggwave encoding failed:', err);
    }
    return null;
  }
}

export const ggwaveAdapter = new GGWaveAdapter();
