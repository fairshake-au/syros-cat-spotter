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
  const clearPhoto = between('const clearPhoto = ', 'const choosePhoto = ');

  it('only clears the on-screen photo, its time and its pin', () => {
    expect(clearPhoto).toMatch(/setPhoto\(null\)/);
    expect(clearPhoto).toMatch(/setCapturedAt\(null\)/);
    expect(clearPhoto).toMatch(/setPickedCoords\(null\)/);
  });

  it('never touches the offline queue', () => {
    for (const queueCall of ['enqueue', 'remove', 'retry', 'replacePhoto', 'syncNow']) {
      expect(clearPhoto).not.toMatch(new RegExp(`\\b${queueCall}\\(`));
    }
  });

  it('uses the NewSpotIntro Retake button, disabled while a save is running', () => {
    const intro = between('<NewSpotIntro', '/>');
    expect(intro).toMatch(/onRetake=\{clearPhoto\}/);
    expect(intro).toMatch(/disabled=\{submitting\}/);
    expect(intro).toMatch(/t\('retakePhoto'\)/);
    expect(intro).toMatch(/t\('spotLocationHint'\)/);
  });

  it('the back arrow, which also discards the photo, waits for a save too', () => {
    const back = between('onPress={clearPhoto}', 'name="chevron-left"');
    expect(back).toMatch(/disabled=\{submitting\}/);
  });

  it('no longer shows the old "Add another photo" link', () => {
    expect(source).not.toMatch(/addAnotherPhoto|addDetailsHint/);
  });
});
