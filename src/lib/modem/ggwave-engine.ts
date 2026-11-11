/**
 * Adaptateur de modem acoustique pour ggwave (WebAssembly).
 * Gère l'encodage et le décodage par flux en tranches de Float32Array.
 */

import type { AcousticModem, ProfileId } from './types';

const PROTOCOL_MAP: Record<ProfileId, string> = {
  'audible-normal': 'GGWAVE_PROTOCOL_AUDIBLE_NORMAL',
  'audible-fast': 'GGWAVE_PROTOCOL_AUDIBLE_FAST',
  'audible-fastest': 'GGWAVE_PROTOCOL_AUDIBLE_FASTEST',
  'ultrasound-normal': 'GGWAVE_PROTOCOL_ULTRASOUND_NORMAL',
  'ultrasound-fast': 'GGWAVE_PROTOCOL_ULTRASOUND_FAST',
  'ultrasound-fastest': 'GGWAVE_PROTOCOL_ULTRASOUND_FASTEST',
};

export async function createGgwaveModem(sampleRate = 48000): Promise<AcousticModem> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ggwaveModule = await import('ggwave');
  const ggwaveFactory = ggwaveModule.default || ggwaveModule;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = await (typeof ggwaveFactory === 'function' ? ggwaveFactory() : ggwaveFactory);

  const params = g.getDefaultParameters();
  params.sampleRateInp = sampleRate;
  params.sampleRateOut = sampleRate;
  params.sampleRate = sampleRate;
  params.sampleFormatInp = g.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
  params.sampleFormatOut = g.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;

  const instance = g.init(params);
  try {
    if (typeof g.disableLog === 'function') {
      g.disableLog();
    }
  } catch {
    // Ignorer si disableLog non supporté
  }

  const frameSamples = params.samplesPerFrame || 1024;
  let pendingSamples = new Float32Array(0);

  return {
    maxPayloadBytes: 140,

    encode(payload: Uint8Array, profile: ProfileId, volume = 0.8): Float32Array {
      const protoName = PROTOCOL_MAP[profile] || 'GGWAVE_PROTOCOL_AUDIBLE_FAST';
      const protoId = g.ProtocolId[protoName] ?? g.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST;
      // Volume ggwave : échelle 1..100 (volume 0.8 => ~20)
      const ggwaveVol = Math.max(1, Math.min(100, Math.round(volume * 25)));

      const waveBytes: Uint8Array = g.encode(instance, payload, protoId, ggwaveVol);
      if (!waveBytes || waveBytes.byteLength === 0) {
        return new Float32Array(0);
      }

      // Copie sûre des échantillons Float32 avec silence de tête (2048 = 42ms) et queue (10240 = 213ms)
      const numSamples = Math.floor(waveBytes.byteLength / 4);
      const leadIn = 2048;
      const leadOut = 14336;
      const rawTotal = leadIn + numSamples + leadOut;
      const paddedTotal = Math.ceil(rawTotal / frameSamples) * frameSamples;
      const out = new Float32Array(paddedTotal);
      const view = new Float32Array(waveBytes.buffer, waveBytes.byteOffset, numSamples);
      out.set(view, leadIn);
      return out;
    },

    feed(samples: Float32Array): Uint8Array[] {
      const totalLen = pendingSamples.length + samples.length;
      const merged = new Float32Array(totalLen);
      merged.set(pendingSamples, 0);
      merged.set(samples, pendingSamples.length);

      const usableSamples = Math.floor(totalLen / frameSamples) * frameSamples;
      pendingSamples = merged.slice(usableSamples);

      const decodedMessages: Uint8Array[] = [];

      for (let offset = 0; offset < usableSamples; offset += frameSamples) {
        const frameSlice = merged.slice(offset, offset + frameSamples);
        const frameBytes = new Uint8Array(frameSlice.buffer, 0, frameSlice.byteLength);
        const result = g.decode(instance, frameBytes);
        if (result && result.length > 0) {
          const u8 = new Uint8Array(result.length);
          for (let i = 0; i < result.length; i++) {
            u8[i] = result[i] & 0xFF;
          }
          decodedMessages.push(u8);
        }
      }

      return decodedMessages;
    },

    dispose() {
      try {
        if (instance !== null) {
          g.free(instance);
        }
      } catch {
        // Ignorer les erreurs de libération
      }
    },
  };
}
