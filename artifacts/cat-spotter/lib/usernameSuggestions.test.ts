import { describe, expect, it } from 'vitest';
import {
  normalizeUsernameLocally,
  numberedUsername,
  suggestLocalUsernames,
  USERNAME_MAX,
} from './usernameSuggestions';

function sequence(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('normalizeUsernameLocally (mirrors the server)', () => {
  it.each([
    ['SunnyTabby', 'SunnyTabby'],
    ['  Γάτα  της   Σύρου ', 'Γάτα της Σύρου'],
    ["Jo O'Neil-Smith_2.0", "Jo O'Neil-Smith_2.0"],
    ['ab', null],
    ['a'.repeat(25), null],
    ['a'.repeat(24), 'a'.repeat(24)],
    ['cat@home', null],
    ['emoji🐈', null],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeUsernameLocally(raw)).toBe(expected);
  });
});

describe('suggestLocalUsernames', () => {
  it('makes distinct names that the server would accept', () => {
    const names = suggestLocalUsernames(6);
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
    for (const name of names) expect(normalizeUsernameLocally(name)).toBe(name);
  });

  it('stops trying when the random source keeps repeating', () => {
    expect(suggestLocalUsernames(4, () => 0.5)).toHaveLength(1);
  });
});

describe('numberedUsername', () => {
  it('adds two digits', () => {
    expect(numberedUsername('SunnyTabby', () => 0.41)).toBe('SunnyTabby46');
  });

  it('shortens a long name so the result still fits', () => {
    const name = 'a'.repeat(23);
    const result = numberedUsername(name, sequence(0));
    expect(result).toBe('a'.repeat(22) + '10');
    expect(result.length).toBe(USERNAME_MAX);
    expect(normalizeUsernameLocally(result)).toBe(result);
  });

  it('does not leave a trailing space before the number', () => {
    expect(numberedUsername('a'.repeat(21) + ' bc', () => 0)).toBe('a'.repeat(21) + '10');
  });
});
