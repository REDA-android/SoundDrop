import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from './capabilities';

describe('capabilities', () => {
  it('toute capacité « real » référence un test existant', () => {
    for (const c of CAPABILITIES.filter((x) => x.status === 'real')) {
      expect(c.verifiedBy && existsSync(c.verifiedBy)).toBe(true);
    }
  });

  it('toutes les capacités ont un identifiant et un label valides', () => {
    for (const c of CAPABILITIES) {
      expect(c.id).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(['real', 'experimental', 'planned']).toContain(c.status);
    }
  });
});
