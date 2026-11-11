import { describe, expect, it } from 'vitest';
import { rmsDbfs, evaluateNoiseLevel } from './rms';
import { checkClipping } from './playback';
import { mapMediaError } from './capture';

describe('Phase 2 — Audio I/O & Diagnostics', () => {
  describe('Mesure RMS dBFS', () => {
    it('calcule correctement le silence (<-100 dBFS)', () => {
      const silence = new Float32Array(1024).fill(0);
      const db = rmsDbfs(silence);
      expect(db).toBeLessThan(-100);
    });

    it('calcule correctement une onde pleine échelle de 1.0 (-3 dBFS pour sinusoïde pure)', () => {
      const n = 1000;
      const sine = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        sine[i] = Math.sin((2 * Math.PI * i) / 50); // RMS théorique = 1 / sqrt(2) ≈ 0.707 => -3.01 dBFS
      }
      const db = rmsDbfs(sine);
      expect(db).toBeGreaterThan(-3.5);
      expect(db).toBeLessThan(-2.5);
    });

    it('évalue les paliers de bruit ambiant selon les critères', () => {
      expect(evaluateNoiseLevel(-60).environment).toBe('calm');
      expect(evaluateNoiseLevel(-45).environment).toBe('noisy');
      expect(evaluateNoiseLevel(-20).environment).toBe('too_noisy');
    });
  });

  describe('Détection d’écrêtage', () => {
    it('détecte un signal nominal sans écrêtage', () => {
      const normal = new Float32Array([0.1, 0.5, -0.8, 0.95]);
      const res = checkClipping(normal);
      expect(res.hasClipping).toBe(false);
      expect(res.maxAbs).toBeCloseTo(0.95);
    });

    it('détecte un signal écrêté (> 1.0)', () => {
      const clipped = new Float32Array([0.2, 1.05, -0.9]);
      const res = checkClipping(clipped);
      expect(res.hasClipping).toBe(true);
      expect(res.maxAbs).toBeCloseTo(1.05);
    });
  });

  describe('Gestion des erreurs microphone', () => {
    it('mappe NotAllowedError avec guidage utilisateur', () => {
      const err = mapMediaError({ name: 'NotAllowedError', message: 'User denied' });
      expect(err.code).toBe('NOT_ALLOWED');
      expect(err.userMessage).toContain('bloqué');
    });

    it('mappe NotFoundError', () => {
      const err = mapMediaError({ name: 'NotFoundError' });
      expect(err.code).toBe('NOT_FOUND');
      expect(err.userMessage).toContain('Aucun microphone');
    });

    it('mappe NotReadableError', () => {
      const err = mapMediaError({ name: 'NotReadableError' });
      expect(err.code).toBe('NOT_READABLE');
      expect(err.userMessage).toContain('autre application');
    });
  });
});
