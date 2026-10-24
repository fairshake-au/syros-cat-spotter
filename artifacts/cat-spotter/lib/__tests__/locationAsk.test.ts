/**
 * SYC-524: what the Spot screen shows about location after a photo.
 */
import { describe, expect, it } from 'vitest';
import { locationAskView, type LocationAskView } from '../locationAsk';
import type { LocationChoice } from '../locationChoice';
import type { LocationPermission } from '../locationPermission';
import type { PickSource } from '../mapStart';

type Row = [
  PickSource | null,
  boolean,
  LocationPermission,
  LocationChoice,
  'web' | 'native',
  boolean,
  LocationAskView,
];

const rows: Row[] = [
  [null, false, 'not-asked', null, 'native', false, 'none'],
  ['library', true, 'not-asked', null, 'native', false, 'none'],
  ['camera', true, 'granted', null, 'native', false, 'none'],
  ['camera', true, 'granted', 'map', 'native', false, 'none'],
  ['camera', true, 'granted', 'shared', 'native', false, 'none'],
  ['camera', true, 'not-asked', null, 'native', false, 'card'],
  ['live', true, 'not-asked', null, 'web', false, 'card'],
  ['camera', true, 'not-asked', 'shared', 'native', false, 'auto-ask'],
  ['camera', true, 'not-asked', 'map', 'native', false, 'link'],
  ['camera', true, 'denied-can-ask', 'map', 'native', false, 'link'],
  ['camera', true, 'denied-can-ask', null, 'native', false, 'link'],
  ['camera', true, 'denied-can-ask', 'shared', 'native', false, 'link'],
  ['camera', true, 'denied-final', null, 'native', false, 'off-native'],
  ['camera', true, 'denied-final', 'map', 'native', false, 'off-native'],
  ['camera', true, 'denied-final', 'shared', 'native', false, 'off-native'],
  ['camera', true, 'denied-final', null, 'web', false, 'off-web'],
  ['camera', true, 'denied-final', 'map', 'web', false, 'off-web'],
  ['camera', true, 'denied-final', 'shared', 'web', false, 'off-web'],
  ['camera', true, 'not-asked', null, 'native', true, 'link'],
  ['camera', true, 'denied-final', null, 'native', true, 'off-native'],
  ['camera', true, 'granted', null, 'native', true, 'none'],
];

describe('locationAskView', () => {
  it.each(rows)('%s hasPhoto=%s %s choice=%s %s answered=%s -> %s', (source, hasPhoto, permission, choice, platform, answeredThisPhoto, expected) => {
    expect(
      locationAskView({ source, hasPhoto, permission, choice, platform, answeredThisPhoto, checked: true }),
    ).toBe(expected);
  });

  it('shows nothing until the first permission read has finished', () => {
    const input = {
      source: 'camera' as const,
      hasPhoto: true,
      permission: 'not-asked' as const,
      choice: null,
      platform: 'native' as const,
      answeredThisPhoto: false,
    };
    expect(locationAskView({ ...input, checked: false })).toBe('none');
    expect(locationAskView({ ...input, checked: true })).toBe('card');
  });
});
