/**
 * SYC-574 (design-review-fixes-oct22.md §2.2, §2.4): how the Spot screen
 * wires the hint. `app/` is outside vitest's render paths, so like
 * spotRetake.test.ts this reads the screen's source. The behaviour itself is
 * tested in spotHint.test.ts and hooks/__tests__/useSpotHint.test.tsx, and the
 * request bodies in sightingPayload.test.ts (6a, 6b) and OfflineContext.test.tsx.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../../app/(tabs)/spot.tsx'), 'utf8');

function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1);
  expect(end, `${endMarker} not found after ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the Spot screen and its hint', () => {
  it('holds the hint through useSpotHint, told whether a photo is staged', () => {
    expect(source).toMatch(/useSpotHint\(photo !== null\)/);
  });

  it('"Start again" (clearPhoto) drops the hint; "Retake photo" keeps it', () => {
    expect(between('const clearPhoto = ', 'const choosePhoto = ')).toMatch(
      /dispatchHint\(\{ kind: 'startAgain' \}\)/,
    );
    expect(between('const retakeFirstPhoto = ', 'const clearPhoto = ')).not.toMatch(/dispatchHint/);
  });

  it('the upload request never mentions the hint', () => {
    const request = between('sightingRequest({', '}),');
    expect(request).not.toMatch(/hint/i);
  });

  it('a queued spot gets hintCatId set AFTER queuedSighting builds it (enqueue\'s option)', () => {
    const save = between('save: () =>', 'offerSaveForLater');
    const built = save.indexOf('queuedSighting({');
    const builtEnd = save.indexOf('}),', built);
    expect(built).toBeGreaterThan(-1);
    expect(save.slice(built, builtEnd)).not.toMatch(/hint/i);
    expect(save.slice(builtEnd)).toMatch(/\{ hintCatId: hint \},\s*\)\.then/);
  });

  it('an online send passes the hint to the review route', () => {
    const sent = between("case 'sent': {", "case 'saved':");
    expect(sent).toMatch(/buildReviewParams\(\{[\s\S]*hintCatId: hint,[\s\S]*\}\)/);
    expect(sent.indexOf("dispatchHint({ kind: 'sent' })")).toBeGreaterThan(-1);
  });

  it('a saved spot clears the hint from the Spot screen', () => {
    expect(between("case 'saved':", "case 'save-failed':")).toMatch(/dispatchHint\(\{ kind: 'sent' \}\)/);
  });

  it('a save that failed or a refused photo keeps the photo, so keeps the hint', () => {
    expect(between("case 'save-failed':", "case 'not-saved':")).not.toMatch(/dispatchHint|clearPhoto/);
  });

  it('the banner shows once the cat is known, and its ✕ stops the hint', () => {
    const banner = between('{hintCat ? (', ') : null}');
    expect(banner).toMatch(/<SpotHintBanner/);
    expect(banner).toMatch(/onStop=\{\(\) => dispatchHint\(\{ kind: 'stop' \}\)\}/);
    // Above the camera and the staged photo alike: first in the scroll view.
    expect(source.indexOf('<SpotHintBanner')).toBeLessThan(source.indexOf('<NewSpotIntro'));
    expect(source.indexOf('<SpotHintBanner')).toBeLessThan(source.indexOf('<CaptureControls'));
  });
});
