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

  it('(a) sends extras only while the switch is on: everything sent comes from photosInUse', () => {
    const submit = between(spot, 'const submit = () =>', 'const openAlreadyLogged = ');
    expect(submit).toMatch(/const inUse = photosInUse\(extras, matchWaitSettings\.extraPhotosOn\);/);
    // `extras` (everything held) is read once, by photosInUse; the payload, the
    // queue item, the cover and the fingerprints all come from `inUse`.
    expect(submit.match(/\bextras\b(?!\s*:)/g)).toHaveLength(1);
    expect(submit).toMatch(/const cover = coverExtra\(inUse\) \?\? photo;/);
  });

  it('(a) hidden extras are not kept at all while the switch is off', () => {
    expect(spot).toMatch(
      /React\.useEffect\(\(\) => \{\s*if \(!matchWaitSettings\.extraPhotosOn && Object\.keys\(extrasRef\.current\)\.length > 0\) \{\s*setExtras\(\{\}\);/,
    );
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

  it('(c) setting the first photo re-checks the extras against it, with the right reason', () => {
    const setter = between(spot, 'const setFirstPhoto = (', 'const retakeFirstPhoto = ');
    expect(setter).toMatch(/recheckAfterRetake\(/);
    expect(setter).toMatch(/r\.reason === 'duplicate' \? 'extraRemovedDuplicate' : 'extraRemovedAfterRetake'/);
  });

  it('(c) with the switch off there is no re-check and no notice: hidden extras are just dropped', () => {
    const setter = between(spot, 'const setFirstPhoto = (', 'const retakeFirstPhoto = ');
    const gate = setter.indexOf('if (!matchWaitSettings.extraPhotosOn)');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(setter.indexOf('recheckAfterRetake('));
    expect(setter.slice(gate, setter.indexOf('recheckAfterRetake('))).toMatch(/setExtras\(\{\}\);\s*\} else if/);
  });

  it('(h) a photo picked for a spot that was retaken, discarded or sent meanwhile is never attached', () => {
    expect(spot).toMatch(/const spotGenerationRef = React\.useRef\(0\);/);
    for (const [from, to] of [
      ['const setFirstPhoto = (', 'const retakeFirstPhoto = '],
      ['const retakeFirstPhoto = ', 'const clearPhoto = '],
      ['const submit = () =>', 'const sightingMs = '],
    ]) {
      expect(between(spot, from, to), from).toMatch(/spotGenerationRef\.current \+= 1;/);
    }
    const add = between(spot, 'const addExtra = async', 'const removeExtra = ');
    expect(add).toMatch(/const generation = spotGenerationRef\.current;/);
    expect(add).toMatch(/const stale = \(\) => spotGenerationRef\.current !== generation;/);
    // A check after every await, before the next step.
    const at = (m: string, from = 0) => add.indexOf(m, from);
    const pickedAt = at('await choosePhoto(');
    const stale1 = at('if (stale())', pickedAt);
    const preparedAt = at('await prepareExtraPhoto(', stale1);
    const stale2 = at('if (stale())', preparedAt);
    const loggedAt = at('await loadRecentPhotos(', stale2);
    const stale3 = at('if (stale())', loggedAt);
    const setAt = at('setExtras(', stale3);
    for (const i of [pickedAt, stale1, preparedAt, stale2, loggedAt, stale3, setAt]) expect(i).toBeGreaterThan(-1);
  });

  it('(h) the boxes are disabled while a photo is being prepared', () => {
    expect(spot).toMatch(/disabled=\{submitting \|\| preparingExtra\}/);
    const add = between(spot, 'const addExtra = async', 'const removeExtra = ');
    expect(add.indexOf('setPreparingExtra(true)')).toBeLessThan(add.indexOf('await prepareExtraPhoto('));
    expect(add).toMatch(/finally \{\s*setPreparingExtra\(false\);/);
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
    expect(submit).toMatch(/coverExtra\(inUse\)/);
    const kept = between(submit, 'const kept = await savePendingPhoto(', ');');
    expect(kept).toMatch(/cover\.uri/);
    expect(kept).toMatch(/cover\.base64/);
  });

  it('(f) every photo of the spot is remembered for "already logged"', () => {
    const remembered = between(spot, 'const remembered = entryForOutcome(', 'if (remembered)');
    expect(remembered).toMatch(/rememberedExtras/);
    // Only the extras actually kept with a spot saved for later (review item 9).
    const list = between(spot, 'const rememberedExtras = inUse', ';');
    expect(list).toMatch(/keptRoles\.includes\(role\)/);
    expect(list).toMatch(/fingerprint: extra\.fingerprint/);
  });

  it('(g) the queued rejected card lets the spotter replace or remove a refused extra', () => {
    const card = between(spot, "{item.status === 'rejected' &&", '{new Date(item.createdAt).toLocaleString()}');
    expect(card).toMatch(/item\.rejectedRole === 'face' \|\| item\.rejectedRole === 'body'/);
    expect(card).toMatch(/replaceRejectedExtra\(/);
    expect(card).toMatch(/removeRejectedExtra\(/);
    // Read as "Remove the face photo", never "Remove: Add the face" (review item 8).
    expect(card).not.toMatch(/t\('removePhoto'\)\}: /);
    expect(card).not.toMatch(/\$\{t\('removePhoto'\)\}: \$\{/);
    expect(card).toMatch(/'removeFaceA11y' : 'removeBodyA11y'/);
    // Fixing a refused extra updates "already logged" (review item 10).
    const remove = between(spot, 'const removeRejectedExtra = async', 'const replaceRejectedExtra = async');
    expect(remove.indexOf('removeExtraPhoto(')).toBeGreaterThan(-1);
    expect(remove.indexOf('removeExtraPhoto(')).toBeLessThan(remove.indexOf('replaceRecentExtraFingerprint('));
    expect(remove).toMatch(/replaceRecentExtraFingerprint\(AsyncStorage, localId, role, null,/);
    // A too-large spot can be fixed by removing a photo (spec §6.4).
    expect(card).toMatch(/item\.rejectionKey === 'spotTooLarge'/);
    const replace = between(spot, 'const replaceRejectedExtra = async', 'const changeQueue = ');
    expect(replace).toMatch(/replaceExtraPhoto\(/);
    expect(replace).toMatch(/prepareExtraPhoto\(/);
    expect(replace.indexOf('replaceExtraPhoto(')).toBeLessThan(replace.indexOf('replaceRecentExtraFingerprint('));
    expect(replace).toMatch(/replaceRecentExtraFingerprint\(AsyncStorage, localId, role, picked\.fingerprint,/);
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
    // SYC-503 added two: the "couldn't check" screen and the naming screen's photo.
    expect(review.match(/\bcover\.uri\b/g)?.length).toBe(5);
    expect(review.match(/\bcover\?\.base64\b/g)?.length).toBe(5);
    expect(review).toMatch(/const cover = queuedItem \? coverOf\(queuedItem\) : null;/);
  });

  it('says when an extra photo had gone missing and the others were sent', () => {
    expect(review).toMatch(/queuedItem\?\.extraNote === ["']extraMissing["']/);
    expect(review).toMatch(/t\("extraMissingNote"\)/);
  });
});
