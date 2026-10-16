import { describe, expect, it } from 'vitest';
import { SAME_VISIT_MS, checkExtraCandidate, coverRole, fitsRequestBudget, recheckAfterRetake, withinSameVisit } from '../extraPhotos';

const p = (fingerprint: string, takenAtMs: number | null, base64 = 'x') => ({ uri: `u-${fingerprint}`, base64, fingerprint, takenAtMs });
const T = Date.UTC(2026, 9, 15, 10, 0);

describe('coverRole', () => {
  it('is face when a face photo is added, else first', () => {
    expect(coverRole({ face: p('f', T) })).toBe('face');
    expect(coverRole({ body: p('b', T) })).toBe('first');
    expect(coverRole({})).toBe('first');
  });
});

describe('withinSameVisit', () => {
  it('accepts within two hours either way, and when either time is unknown', () => {
    expect(withinSameVisit(T, T + SAME_VISIT_MS)).toBe(true);
    expect(withinSameVisit(T, T - SAME_VISIT_MS)).toBe(true);
    expect(withinSameVisit(T, T + SAME_VISIT_MS + 1)).toBe(false);
    expect(withinSameVisit(T, null)).toBe(true);
    expect(withinSameVisit(null, T)).toBe(true);
  });
});

describe('checkExtraCandidate', () => {
  const first = p('first', T);
  it("refuses the first photo again, or the other box's photo", () => {
    expect(checkExtraCandidate({ candidate: p('first', T), first, otherExtra: undefined, alreadyLogged: false, tooOld: null })).toEqual({ kind: 'duplicate' });
    expect(checkExtraCandidate({ candidate: p('b', T), first, otherExtra: p('b', T), alreadyLogged: false, tooOld: null })).toEqual({ kind: 'duplicate' });
  });
  it('refuses an already-logged, too-old, or different-visit photo, in that order', () => {
    expect(checkExtraCandidate({ candidate: p('c', T), first, otherExtra: undefined, alreadyLogged: true, tooOld: null })).toEqual({ kind: 'alreadyLogged' });
    expect(checkExtraCandidate({ candidate: p('c', T), first, otherExtra: undefined, alreadyLogged: false, tooOld: { instantMs: 1 } })).toEqual({ kind: 'tooOld', instantMs: 1 });
    const later = T + SAME_VISIT_MS + 60_000;
    expect(checkExtraCandidate({ candidate: p('c', later), first, otherExtra: undefined, alreadyLogged: false, tooOld: null })).toEqual({ kind: 'differentVisit', takenAtMs: later });
  });
  it('catches a library first photo from days ago with a camera extra taken now (spec review F9)', () => {
    const libraryFirst = p('first', T - 3 * 86_400_000);
    expect(checkExtraCandidate({ candidate: p('cam', T), first: libraryFirst, otherExtra: undefined, alreadyLogged: false, tooOld: null })?.kind).toBe('differentVisit');
  });
  it('accepts a good photo', () => {
    expect(checkExtraCandidate({ candidate: p('c', T + 60_000), first, otherExtra: undefined, alreadyLogged: false, tooOld: null })).toBeNull();
  });
});

describe('recheckAfterRetake', () => {
  it('keeps extras that still fit and removes ones that no longer do, or that repeat the new first photo', () => {
    const newFirst = p('n', T + 5 * 3_600_000);
    const r = recheckAfterRetake(newFirst, { face: p('f', T), body: p('b', T + 4.5 * 3_600_000) });
    expect(Object.keys(r.kept)).toEqual(['body']);
    expect(r.removed).toEqual([{ role: 'face', takenAtMs: T }]);
    expect(recheckAfterRetake(p('b', T), { body: p('b', T) }).removed).toEqual([{ role: 'body', takenAtMs: T }]);
  });
});

describe('fitsRequestBudget', () => {
  it('is false once the total passes 18 MB of base64', () => {
    const mb = (n: number) => 'a'.repeat(n * 1024 * 1024);
    expect(fitsRequestBudget(mb(15), [mb(1), mb(1)])).toBe(true);
    expect(fitsRequestBudget(mb(15), [mb(2), mb(2)])).toBe(false);
  });
});
