/**
 * data-spine.md PR 4, cat-record-data-spine.md §3.5/§4.2: the cat page's
 * life line and sterilised line. "An app test renders each line in each
 * language, with no 'presumed' and no 'No longer with us' for the presumed
 * case" (plan, PR 4's Tests bullet) -- covered here as pure-logic + i18n
 * coverage, since this repo tests screen content through its lib functions
 * rather than full screen renders (see CatPicker's component test for the
 * one place a full render is used).
 */
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../i18n';
import {
  lifeLine,
  parseDateOnly,
  sterilisedLineKey,
  textFor,
  STATUS_LINE_KEYS,
  type LifeLine,
} from '../catStatusLines';
import type { Cat } from '@workspace/api-client-react';

function cat(overrides: Partial<Pick<Cat, 'lifeStatus' | 'notSeenSince'>>): Pick<
  Cat,
  'lifeStatus' | 'notSeenSince'
> {
  return { lifeStatus: 'street', notSeenSince: null, ...overrides };
}

describe('lifeLine', () => {
  it('maps each lifeStatus to its own key when there is no notSeenSince', () => {
    expect(lifeLine(cat({ lifeStatus: 'street' }))).toEqual({ key: 'lifeStatusStreet' });
    expect(lifeLine(cat({ lifeStatus: 'homed' }))).toEqual({ key: 'lifeStatusHomed' });
    expect(lifeLine(cat({ lifeStatus: 'in_care' }))).toEqual({ key: 'lifeStatusInCare' });
    expect(lifeLine(cat({ lifeStatus: 'deceased' }))).toEqual({ key: 'lifeStatusDeceased' });
  });

  it('prefers notSeenSince over the ordinary lifeStatus line -- never both, never "presumed"', () => {
    // notSeenSince is a bare calendar date (catHelpers.ts's toPublicDate),
    // not a full timestamp -- see parseDateOnly's own tests below for why
    // that matters to rendering.
    const result = lifeLine(cat({ lifeStatus: 'street', notSeenSince: '2024-06-01' }));
    expect(result).toEqual({ key: 'notSeenSince', date: '2024-06-01' });
    // The resolver's own invariant is that notSeenSince and
    // lifeStatus: "deceased" never both apply to the same cat; this is
    // simply never reached in practice, but if it ever were, notSeenSince
    // still wins -- it is never shown as "deceased".
    const impossible = lifeLine(
      cat({ lifeStatus: 'deceased', notSeenSince: '2024-06-01' }),
    );
    expect((impossible as LifeLine).key).toBe('notSeenSince');
  });
});

describe('parseDateOnly', () => {
  it('reads a bare YYYY-MM-DD date into the matching calendar date, local midnight', () => {
    const d = parseDateOnly('2024-06-03');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(5); // 0-indexed: June
    expect(d.getDate()).toBe(3);
    expect(d.getHours()).toBe(0);
  });

  it('never rolls the date back a day for a viewer west of UTC -- the bug `new Date(dateOnly)` + toLocaleDateString has', () => {
    const dateOnly = '2024-06-03';

    // The bug this guards against: new Date('2024-06-03') is UTC midnight,
    // which a viewer west of UTC (anywhere from the UK back to the US)
    // renders as 2 June in their local timezone -- one day earlier than the
    // server meant. parseDateOnly must never do that: its result's
    // calendar date matches the input regardless of the runner's own
    // timezone (whatever CI happens to run in).
    const viaParseDateOnly = parseDateOnly(dateOnly);
    expect(
      `${viaParseDateOnly.getFullYear()}-${String(viaParseDateOnly.getMonth() + 1).padStart(2, '0')}-${String(viaParseDateOnly.getDate()).padStart(2, '0')}`,
    ).toBe(dateOnly);
  });

  it('rejects anything that is not a bare YYYY-MM-DD date', () => {
    expect(() => parseDateOnly('2024-06-03T00:00:00Z')).toThrow();
    expect(() => parseDateOnly('not-a-date')).toThrow();
  });
});

describe('sterilisedLineKey', () => {
  it('confirmed true/false, likely, and unknown each map to their own line', () => {
    expect(
      sterilisedLineKey({ value: true, confidence: 'confirmed', clippedTipSightings: 0 }),
    ).toBe('sterilisedConfirmedTrue');
    expect(
      sterilisedLineKey({ value: false, confidence: 'confirmed', clippedTipSightings: 0 }),
    ).toBe('sterilisedConfirmedFalse');
    expect(
      sterilisedLineKey({ value: true, confidence: 'likely', clippedTipSightings: 1 }),
    ).toBe('sterilisedLikely');
    expect(
      sterilisedLineKey({ value: null, confidence: 'unknown', clippedTipSightings: 0 }),
    ).toBe('sterilisedUnknown');
  });

  it('falls back to the unknown line for "reported" (not yet reachable)', () => {
    expect(
      sterilisedLineKey({ value: null, confidence: 'reported', clippedTipSightings: 0 }),
    ).toBe('sterilisedUnknown');
  });
});

describe('every status line, in every language', () => {
  for (const { code } of LANGUAGES) {
    it(`${code}: every key has a non-empty translation`, () => {
      for (const key of STATUS_LINE_KEYS) {
        expect(textFor(code, key)).toBeTruthy();
      }
    });

    it(`${code}: the presumed-deceased line never says "presumed" and never reuses the deceased line's text`, () => {
      const notSeenSince = textFor(code, 'notSeenSince');
      const deceased = textFor(code, 'lifeStatusDeceased');
      expect(notSeenSince.toLowerCase()).not.toContain('presum');
      expect(notSeenSince).not.toBe(deceased);
    });
  }
});
