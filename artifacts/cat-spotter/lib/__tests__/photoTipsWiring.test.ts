/**
 * How the photo tips are wired into the app (SYC-415 PR 1, spec §3.2).
 *
 * `app/` and the delete-my-data context are outside vitest's render paths, so
 * like spotRetake.test.ts this reads their source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8');
const spot = read('../../app/(tabs)/spot.tsx');
const review = read('../../app/review.tsx');
const wipe = read('../../context/DeleteMyDataContext.tsx');

describe('photo tips wiring', () => {
  it('spot.tsx shows the card once, only if unseen', () => {
    expect(spot).toMatch(/import \{ PhotoTipsCard \}/);
    expect(spot).toMatch(/hasSeenPhotoTips\(/);
  });

  it('closing the card marks it seen and never opens a camera or picker by itself', () => {
    const start = spot.indexOf('const closeTips = ');
    expect(start, 'closeTips not found').toBeGreaterThan(-1);
    const end = spot.indexOf('};', start);
    const handler = spot.slice(start, end);
    expect(handler).toContain('markPhotoTipsSeen(');
    // Browsers only open a picker from a direct tap on the shutter.
    expect(handler).not.toContain('launchCameraAsync');
    expect(handler).not.toContain('launchImageLibraryAsync');
    expect(handler).not.toContain('captureLivePhoto');
    expect(handler).not.toContain('pickPhoto');
  });

  it('spot.tsx has a Photo tips link on the capture screen that reopens the card', () => {
    expect(spot).toContain('testID="photo-tips-link"');
    expect(spot).toMatch(/setTipsOpen\(true\)/);
  });

  it('the "no cat" screen shows the tips', () => {
    const start = review.indexOf('if (!data.isCatPhoto)');
    const startBlock = review.indexOf('// ----- Not a cat -----');
    expect(start).toBeGreaterThan(-1);
    const end = review.indexOf('// -----', startBlock + 10);
    const block = review.slice(startBlock, end);
    expect(block).toContain('<PhotoTips');
    expect(block.indexOf('<PhotoTips')).toBeLessThan(block.indexOf('tryAgain'));
  });

  it('"Delete my data" clears the seen mark', () => {
    expect(wipe).toContain('clearPhotoTipsSeen(');
  });
});
