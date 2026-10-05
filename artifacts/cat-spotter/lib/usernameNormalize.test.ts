import { describe, expect, it } from 'vitest';
import { sameUsername, usernameKey } from './usernameNormalize';

describe('usernameKey / sameUsername (server-equivalent comparison, SYC-211)', () => {
  it('collapses internal whitespace, trims and ignores case', () => {
    expect(usernameKey('  Cat  Lover ')).toBe('cat lover');
    expect(sameUsername('Cat  Lover', 'Cat Lover')).toBe(true);
    expect(sameUsername('SEACAT', 'seacat')).toBe(true);
    expect(sameUsername('Cat \u00a0 Lover', 'cat lover')).toBe(true);
    // A tab is a control character: the server strips it before collapsing.
    expect(sameUsername('Cat\tLover', 'catlover')).toBe(true);
  });

  it('strips control characters like the server does', () => {
    expect(sameUsername('Sea\u0007Cat', 'SeaCat')).toBe(true);
  });

  it('keeps genuinely different names apart', () => {
    expect(sameUsername('NameA', 'NameB')).toBe(false);
    expect(sameUsername('Cat Lover', 'CatLover')).toBe(false);
    expect(sameUsername('Γάτα', 'γάτα')).toBe(true);
    expect(sameUsername(null, 'x')).toBe(false);
  });
});
