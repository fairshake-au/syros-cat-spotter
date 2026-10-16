import { describe, expect, it } from 'vitest';
import {
  PHOTO_TIPS_SEEN_KEY,
  clearPhotoTipsSeen,
  hasSeenPhotoTips,
  markPhotoTipsSeen,
} from '../photoTipsSeen';

function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
    removeItem: async (k: string) => void m.delete(k),
  };
}

describe('photo tips seen mark', () => {
  it('is unseen until marked, then seen, then unseen after clearing', async () => {
    const s = memory();
    expect(await hasSeenPhotoTips(s)).toBe(false);
    await markPhotoTipsSeen(s);
    expect(s.m.get(PHOTO_TIPS_SEEN_KEY)).toBe('1');
    expect(await hasSeenPhotoTips(s)).toBe(true);
    await clearPhotoTipsSeen(s);
    expect(await hasSeenPhotoTips(s)).toBe(false);
  });

  it('treats a storage error as "seen", so a broken store never shows the card on every visit', async () => {
    const broken = {
      getItem: async () => { throw new Error('boom'); },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    };
    expect(await hasSeenPhotoTips(broken)).toBe(true);
  });
});
