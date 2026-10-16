/**
 * Retaking the photo on the "New spot" screen (SYC-118) and the offline queue.
 *
 * On that screen nothing has been queued yet: the sighting only enters the
 * offline queue when the spotter presses the send button. So "Retake photo"
 * must only clear what is on screen. It must never add to, remove from or
 * rewrite the queue. That is a different path: `replacePhoto` is for a queued
 * photo the server turned down, and OfflineContext.test.tsx covers it.
 *
 * `app/` is outside vitest's render paths, so like spotCameraFailure.test.ts
 * this reads the screen's source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(__dirname, '../../app/(tabs)/spot.tsx'),
  'utf8',
);

function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1);
  expect(end, `${endMarker} not found after ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Retake photo on the New spot screen', () => {
  // SYC-415: retaking the first photo keeps the face and body photos (they are
  // re-checked against the new first photo); discarding the spot clears them.
  const retakeFirstPhoto = between('const retakeFirstPhoto = ', 'const clearPhoto = ');
  const clearPhoto = between('const clearPhoto = ', 'const choosePhoto = ');

  it('only clears the on-screen first photo, its time and its pin', () => {
    expect(retakeFirstPhoto).toMatch(/setPhoto\(null\)/);
    expect(retakeFirstPhoto).toMatch(/setCapturedAt\(null\)/);
    expect(retakeFirstPhoto).toMatch(/setFirstTakenAtMs\(null\)/);
    expect(retakeFirstPhoto).toMatch(/photoFingerprintRef\.current = undefined/);
    expect(retakeFirstPhoto).toMatch(/setPickedCoords\(null\)/);
  });

  it('SYC-415: retaking keeps the extra photos', () => {
    expect(retakeFirstPhoto).not.toMatch(/setExtras|extrasRef/);
  });

  it('SYC-415: discarding the spot (the back arrow, after sending) also clears the extras', () => {
    expect(clearPhoto).toMatch(/retakeFirstPhoto\(\)/);
    expect(clearPhoto).toMatch(/setExtras\(\{\}\)/);
  });

  it('never touches the offline queue', () => {
    for (const block of [retakeFirstPhoto, clearPhoto]) {
      for (const queueCall of ['enqueue', 'remove', 'retry', 'replacePhoto', 'syncNow']) {
        expect(block).not.toMatch(new RegExp(`\\b${queueCall}\\(`));
      }
    }
  });

  it('uses the NewSpotIntro Retake button, disabled while a save is running', () => {
    const intro = between('<NewSpotIntro', '/>');
    expect(intro).toMatch(/onRetake=\{retakeFirstPhoto\}/);
    expect(intro).toMatch(/disabled=\{submitting\}/);
    expect(intro).toMatch(/t\('retakePhoto'\)/);
    expect(intro).toMatch(/t\('spotLocationHint'\)/);
  });

  it('the back arrow, which also discards the photo, waits for a save too', () => {
    const back = between('onPress={clearPhoto}', 'name="chevron-left"');
    expect(back).toMatch(/disabled=\{submitting\}/);
    // SYC-415 review: it discards the extras too, so it is never read as
    // "Retake photo" (the visible Retake button keeps them).
    expect(back).toMatch(/accessibilityLabel=\{t\('startAgain'\)\}/);
    expect(back).not.toMatch(/t\('retakePhoto'\)/);
  });

  it('no longer shows the old "Add another photo" link', () => {
    expect(source).not.toMatch(/addAnotherPhoto|addDetailsHint/);
  });
});
