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

  it('spot.tsx renders the card, shown only while there is no photo', () => {
    expect(spot).toContain('<PhotoTipsCard visible={tipsOpen && !photo} onClose={closeTips} />');
  });

  it('the first-visit check uses the pure helper and the synchronous session flag', () => {
    expect(spot).toMatch(/shouldOpenPhotoTips\(\{\s*seen,\s*hasPhoto: false,\s*seenThisSession: seenThisSessionRef\.current/);
    const start = spot.indexOf('const closeTips = ');
    const handler = spot.slice(start, spot.indexOf('};', start));
    expect(handler).toContain('seenThisSessionRef.current = true');
    expect(handler.indexOf('seenThisSessionRef.current = true')).toBeLessThan(
      handler.indexOf('markPhotoTipsSeen('),
    );
  });

  it('a photo arriving closes the open card without marking it seen', () => {
    const m = spot.match(/React\.useEffect\(\(\) => \{\s*if \(photo\) \{[^}]*setTipsOpen\(false\);/);
    expect(m, 'effect that closes the card when a photo is set').not.toBeNull();
  });

  it('the Photo tips link reopens the card, and sits below the viewfinder, not in its top row', () => {
    const linkAt = spot.indexOf('testID="photo-tips-link"');
    expect(linkAt).toBeGreaterThan(-1);
    const pressableStart = spot.lastIndexOf('<Pressable', linkAt);
    const pressableEnd = spot.indexOf('</Pressable>', linkAt);
    const link = spot.slice(pressableStart, pressableEnd);
    expect(link).toContain('onPress={() => setTipsOpen(true)}');
    expect(link).toContain('accessibilityRole="button"');
    // Not inside the viewfinder's top row (it collided with the location chip at 390px).
    const topRow = spot.slice(
      spot.indexOf('<View style={styles.viewfinderTopRow}>'),
      spot.indexOf('<View style={styles.framingRect}'),
    );
    expect(topRow).not.toContain('photo-tips-link');
    // And it comes after the viewfinder's shutter controls.
    expect(linkAt).toBeGreaterThan(spot.indexOf('<CaptureControls'));
  });

  it('the "no cat" screen shows the tips', () => {
    // SYC-503: a failed look-alike check never reaches the "no cat" screen.
    const start = review.indexOf('if (!checkFailed && !data.isCatPhoto)');
    const startBlock = review.indexOf('// ----- Not a cat -----');
    expect(start).toBeGreaterThan(-1);
    const end = review.indexOf('// -----', startBlock + 10);
    const block = review.slice(startBlock, end);
    expect(block).toContain('<PhotoTips');
    // SYC-508 D1 A: the button is now "Take another photo"; the tips still come first.
    expect(block.indexOf('notACatRetake')).toBeGreaterThan(-1);
    expect(block.indexOf('<PhotoTips')).toBeLessThan(block.indexOf('notACatRetake'));
  });

  it('"Delete my data" clears the seen mark', () => {
    expect(wipe).toContain('clearPhotoTipsSeen(');
  });
});
