import { describe, expect, it } from 'vitest';
import { formatRank } from '../formatRank';

describe('formatRank', () => {
  it('formats English ordinals', () => {
    const cases: Array<[number, string]> = [
      [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'],
      [13, '13th'], [21, '21st'], [22, '22nd'], [23, '23rd'], [101, '101st'], [111, '111th'],
    ];
    for (const [n, out] of cases) expect(formatRank('en', n)).toBe(out);
  });

  it('uses a plain number in Greek', () => {
    expect(formatRank('el', 1)).toBe('1');
    expect(formatRank('el', 4)).toBe('4');
  });

  it('formats French ranks', () => {
    expect(formatRank('fr', 1)).toBe('1er');
    expect(formatRank('fr', 2)).toBe('2e');
    expect(formatRank('fr', 11)).toBe('11e');
  });
});
