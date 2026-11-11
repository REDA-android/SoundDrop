import { describe, expect, it } from 'vitest';
import { createGgwaveModem } from './ggwave-engine';
import { MFSK_PROFILES, modulate, demodSymbol, chirp } from './mfsk';

describe('Phase 3 — Modems Acoustiques (ggwave & MFSK)', () => {
  describe('Modem MFSK 16 tons (Goertzel exact)', () => {
    it('génère un chirp Hann avec des valeurs bornées dans [-0.5, 0.5]', () => {
      const c = chirp(48000, 50, 1500, 5500);
      expect(c.length).toBe(2400); // 50ms @ 48kHz
      let maxAbs = 0;
      for (let i = 0; i < c.length; i++) {
        if (Math.abs(c[i]) > maxAbs) maxAbs = Math.abs(c[i]);
      }
      expect(maxAbs).toBeLessThanOrEqual(0.5);
      expect(maxAbs).toBeGreaterThan(0.4);
    });

    // Test des 3 profils à 48 000 Hz et 44 100 Hz : 0 erreur sur 10 000 quartets sans bruit
    for (const sr of [48000, 44100]) {
      for (const [profName, profile] of Object.entries(MFSK_PROFILES)) {
        it(`module et démodule 10 000 quartets sans bruit (${profName} @ ${sr} Hz) = 0 erreur`, () => {
          const count = 10000;
          const nibbles = new Uint8Array(count);
          for (let i = 0; i < count; i++) {
            nibbles[i] = i % 16;
          }

          const signal = modulate(nibbles, profile, sr);
          const samplesPerSym = Math.round((profile.symbolMs / 1000) * sr);

          let errors = 0;
          for (let s = 0; s < count; s++) {
            const block = signal.subarray(s * samplesPerSym, (s + 1) * samplesPerSym);
            const { symbol, snrDb } = demodSymbol(block, profile, sr);
            if (symbol !== nibbles[s]) {
              errors++;
            }
            if (s % 500 === 0) {
              expect(snrDb).toBeGreaterThan(15);
            }
          }

          expect(errors).toBe(0);
        });
      }
    }
  });

  describe('Modem ggwave WebAssembly (Loopback sans micro)', () => {
    it('encode et décode avec succès 25 charges utiles binaires aléatoires (1 à 80 octets)', async () => {
      const modem = await createGgwaveModem(48000);
      const numTrials = 25;

      for (let trial = 0; trial < numTrials; trial++) {
        const len = 1 + Math.floor(Math.random() * 64);
        const payload = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          payload[i] = Math.floor(Math.random() * 256);
        }

        const audioSamples = modem.encode(payload, 'audible-fast', 0.8);
        expect(audioSamples.length).toBeGreaterThan(0);

        const decoded = modem.feed(audioSamples);
        expect(decoded.length).toBeGreaterThanOrEqual(1);
        expect(Array.from(decoded[0])).toEqual(Array.from(payload));
      }

      modem.dispose();
    }, 15000);
  });

  describe('Modem Acoustique Adaptatif (Sélection dynamique)', () => {
    it('sélectionne audible-fastest en environnement calme (-60 dBFS)', async () => {
      const { selectAdaptiveProfile } = await import('./adaptive-profile');
      const res = selectAdaptiveProfile(-60, 'audible', 32);
      expect(res.profile).toBe('audible-fastest');
      expect(res.throughputBps).toBe(27);
      expect(res.durationSeconds).toBeGreaterThan(0);
    });

    it('sélectionne audible-fast en environnement moyennement bruyant (-40 dBFS)', async () => {
      const { selectAdaptiveProfile } = await import('./adaptive-profile');
      const res = selectAdaptiveProfile(-40, 'audible', 32);
      expect(res.profile).toBe('audible-fast');
      expect(res.throughputBps).toBe(15);
    });

    it('sélectionne audible-normal en environnement très bruyant (-25 dBFS)', async () => {
      const { selectAdaptiveProfile } = await import('./adaptive-profile');
      const res = selectAdaptiveProfile(-25, 'audible', 32);
      expect(res.profile).toBe('audible-normal');
      expect(res.throughputBps).toBe(7);
    });

    it('adapte correctement les profils en mode ultrasonique', async () => {
      const { selectAdaptiveProfile } = await import('./adaptive-profile');
      const calm = selectAdaptiveProfile(-60, 'ultrasound', 16);
      expect(calm.profile).toBe('ultrasound-fastest');

      const noisy = selectAdaptiveProfile(-20, 'ultrasound', 16);
      expect(noisy.profile).toBe('ultrasound-normal');
    });
  });
});

