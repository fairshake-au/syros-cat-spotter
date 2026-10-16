/**
 * SYC-415 (plan Task 4.6): how the face and body boxes are wired into the
 * Spot screen and the review screen. `app/` is outside vitest's render paths,
 * so like spotRetake.test.ts this reads the screens' source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const spot = readFileSync(path.resolve(__dirname, '../../app/(tabs)/spot.tsx'), 'utf8');
const review = readFileSync(path.resolve(__dirname, '../../app/review.tsx'), 'utf8');

function between(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1);
  expect(end, `${endMarker} not found after ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the Spot screen (spot.tsx)', () => {
  it('(a) shows the boxes only when the extra-photos switch is on', () => {
    expect(spot).toMatch(/matchWaitSettings\.extraPhotosOn && \(\s*<ExtraPhotoBoxes/);
    expect(spot.match(/<ExtraPhotoBoxes/g)).toHaveLength(1);
  });

  it('(a) sends extras only while the switch is on, so a hidden box never sends a photo', () => {
    const submit = between(spot, 'const submit = () =>', 'const openAlreadyLogged = ');
    expect(submit).toMatch(/matchWaitSettings\.extraPhotosOn \? extras : \{\}/);
  });

  it('(b) one setFirstPhoto, used by both the picker and the live camera', () => {
    expect(spot).toMatch(/const setFirstPhoto = \(/);
    const pick = between(spot, 'const pickPhoto = async', 'const captureLivePhoto = async');
    const live = between(spot, 'const captureLivePhoto = async', 'const requestLiveCamera = async');
    expect(pick).toMatch(/setFirstPhoto\(/);
    expect(live).toMatch(/setFirstPhoto\(/);
    expect(pick).not.toMatch(/\bsetPhoto\(/);
    expect(live).not.toMatch(/\bsetPhoto\(/);
  });

  it('(b) camera photos now carry a fingerprint too (Task 4.5)', () => {
    const live = between(spot, 'const captureLivePhoto = async', 'const requestLiveCamera = async');
    expect(live).toMatch(/setFirstPhoto\(picked, \{ kind: 'unread' \}, photoFingerprint\(picked\.base64\), Date\.now\(\)\)/);
    const setter = between(spot, 'const setFirstPhoto = (', 'const retakeFirstPhoto = ');
    expect(setter).toMatch(/photoFingerprintRef\.current = fingerprint;/);
  });

  it('(c) setting the first photo re-checks the extras against it', () => {
    const setter = between(spot, 'const setFirstPhoto = (', 'const retakeFirstPhoto = ');
    expect(setter).toMatch(/recheckAfterRetake\(/);
    expect(setter).toMatch(/t\('extraRemovedAfterRetake'\)\.replace\(\s*'\{which\}'/);
  });

  it('(d) submit passes extraPhotos to sightingRequest and extras to queuedSighting', () => {
    const submit = between(spot, 'const submit = () =>', 'const openAlreadyLogged = ');
    const request = between(submit, 'sightingRequest({', '})');
    expect(request).toMatch(/\bextraPhotos\b/);
    const queued = between(submit, 'queuedSighting({', '})');
    expect(queued).toMatch(/\bextras\b/);
  });

  it('(e) the result screen photo is the cover photo: the face when there is one', () => {
    const submit = between(spot, 'const submit = () =>', 'const openAlreadyLogged = ');
    expect(submit).toMatch(/coverRole\(\w+\) === 'face'/);
    const kept = between(submit, 'const kept = await savePendingPhoto(', ');');
    expect(kept).toMatch(/cover\.uri/);
    expect(kept).toMatch(/cover\.base64/);
  });

  it('(f) every photo of the spot is remembered for "already logged"', () => {
    const remembered = between(spot, 'const remembered = entryForOutcome(', 'if (remembered)');
    expect(remembered).toMatch(/rememberedExtras/);
  });

  it('(g) the queued rejected card lets the spotter replace or remove a refused extra', () => {
    const card = between(spot, "{item.status === 'rejected' &&", '{new Date(item.createdAt).toLocaleString()}');
    expect(card).toMatch(/item\.rejectedRole === 'face' \|\| item\.rejectedRole === 'body'/);
    expect(card).toMatch(/replaceRejectedExtra\(/);
    expect(card).toMatch(/removeExtraPhoto\(/);
    // A too-large spot can be fixed by removing a photo (spec §6.4).
    expect(card).toMatch(/item\.rejectionKey === 'spotTooLarge'/);
    const replace = between(spot, 'const replaceRejectedExtra = async', 'const changeQueue = ');
    expect(replace).toMatch(/replaceExtraPhoto\(/);
    expect(replace).toMatch(/prepareExtraPhoto\(/);
  });

  it('an extra is refused at pick time, in order: cannot prepare, already logged, the rules, then the size budget', () => {
    // The messages live in extraProblemMessage, just above addExtra.
    const messages = between(spot, 'const extraProblemMessage = ', 'const addExtra = async');
    const add = between(spot, 'const addExtra = async', 'const removeExtra = ');
    const order = [
      'choosePhoto(',
      'prepareExtraPhoto(',
      "t('extraTooLarge')",
      'findAlreadyLogged(',
      'checkExtraCandidate(',
      'fitsRequestBudget(',
      'setExtras(',
    ].map((m) => add.indexOf(m));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The fingerprint is always of the photo as picked, never the prepared copy.
    expect(add).toMatch(/fingerprint: picked\.fingerprint/);
    expect(messages).toMatch(/t\('extraDifferentVisit'\)\.replace\(\s*'\{when\}'/);
    expect(messages).toMatch(/t\('extraDuplicate'\)/);
    expect(messages).toMatch(/t\('photoAlreadyLogged'\)/);
    expect(messages).toMatch(/t\('photoTooOld'\)/);
  });

  it('a rejected extra on sending names the photo and keeps everything on screen', () => {
    const rejected = between(spot, "case 'rejected':", 'break;');
    expect(rejected).toMatch(/t\('extraPhotoRejected'\)\.replace\(\s*'\{which\}'/);
    expect(rejected).not.toMatch(/clearPhoto\(/);
  });

  it('a spot saved without its extras says so', () => {
    const saved = between(spot, "case 'saved':", 'break;');
    expect(saved).toMatch(/t\('extraNotKeptNote'\)/);
  });
});

describe('the review screen (review.tsx)', () => {
  it('uses coverOf wherever a queued photo uri and base64 travel together', () => {
    expect(review).not.toMatch(/queuedItem\.photoUri/);
    expect(review).not.toMatch(/queuedItem\?\.photoBase64/);
    expect(review.match(/\bcover\.uri\b/g)?.length).toBe(3);
    expect(review.match(/\bcover\?\.base64\b/g)?.length).toBe(3);
    expect(review).toMatch(/const cover = queuedItem \? coverOf\(queuedItem\) : null;/);
  });

  it('says when an extra photo had gone missing and the others were sent', () => {
    expect(review).toMatch(/queuedItem\?\.extraNote === ["']extraMissing["']/);
    expect(review).toMatch(/t\("extraMissingNote"\)/);
  });
});
