import { describe, expect, it } from 'vitest';
import {
  LOCATION_CHOICE_KEY,
  clearLocationChoice,
  readLocationChoice,
  writeLocationChoice,
} from '../locationChoice';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: async (k: string) => {
      m.delete(k);
    },
  };
}

describe('locationChoice (SYC-524)', () => {
  it('reads null when nothing is stored', async () => {
    expect(await readLocationChoice(memoryStorage())).toBeNull();
  });

  it.each(['map', 'shared'] as const)('round-trips %s', async (c) => {
    const s = memoryStorage();
    await writeLocationChoice(s, c);
    expect(await readLocationChoice(s)).toBe(c);
  });

  it('reads an unknown stored value as null', async () => {
    const s = memoryStorage();
    s.m.set(LOCATION_CHOICE_KEY, 'banana');
    expect(await readLocationChoice(s)).toBeNull();
  });

  it('clear removes the key', async () => {
    const s = memoryStorage();
    await writeLocationChoice(s, 'map');
    await clearLocationChoice(s);
    expect(s.m.has(LOCATION_CHOICE_KEY)).toBe(false);
    expect(await readLocationChoice(s)).toBeNull();
  });
});
