/**
 * SYC-574 (docs/specs/design-review-fixes-oct22.md §2.2): how long the Spot
 * screen's hint lasts, one test per row of the spec's table, and what the
 * `for` param may hold.
 */
import { describe, expect, it } from 'vitest';
import { canSpotFromPage, nextHint, readHintParam, spotRouteFor } from '../spotHint';

describe("the hint's lifetime (spec §2.2 table)", () => {
  it('arriving with a hint and no photo staged: the hint is set (the banner shows)', () => {
    expect(nextHint(null, { kind: 'arrive', catId: 7 })).toBe(7);
  });

  it('arriving with a hint when a photo is already staged: the hint applies to it', () => {
    // The staged photo is untouched (the reducer holds only the hint); a
    // newer arrival replaces an older hint.
    expect(nextHint(3, { kind: 'arrive', catId: 7 })).toBe(7);
  });

  it('leaving the tab with no photo staged drops the hint', () => {
    expect(nextHint(7, { kind: 'leaveTab', hasPhoto: false })).toBeNull();
  });

  it('leaving the tab with a photo staged keeps the hint with the photo', () => {
    expect(nextHint(7, { kind: 'leaveTab', hasPhoto: true })).toBe(7);
  });

  it.each(['stop', 'startAgain'] as const)('%s (✕, "Start again" / discard) drops the hint', (kind) => {
    expect(nextHint(7, { kind })).toBeNull();
  });

  it('a sent or saved spot clears it from the Spot screen', () => {
    expect(nextHint(7, { kind: 'sent' })).toBeNull();
  });

  it('a cat in care or that has died drops it', () => {
    expect(nextHint(7, { kind: 'notSpottable' })).toBeNull();
  });
});

describe('readHintParam', () => {
  it('reads a positive whole id', () => {
    expect(readHintParam('7')).toBe(7);
    expect(readHintParam(['12'])).toBe(12);
  });
  it.each(['', '0', '-1', '1.5', '07', '7abc', ' 7', '1e3', '99999999999', undefined, null, 7])(
    'ignores %j',
    (raw) => {
      expect(readHintParam(raw)).toBeNull();
    },
  );
});

describe('canSpotFromPage and spotRouteFor', () => {
  it('only street and homed cats can be spotted from their page', () => {
    expect(canSpotFromPage('street')).toBe(true);
    expect(canSpotFromPage('homed')).toBe(true);
    expect(canSpotFromPage('in_care')).toBe(false);
    expect(canSpotFromPage('deceased')).toBe(false);
    expect(canSpotFromPage(undefined)).toBe(false);
  });
  it('carries the id as `for` and nothing else', () => {
    expect(spotRouteFor(7)).toEqual({ pathname: '/spot', params: { for: '7' } });
  });
});
