/** SYC-508 §3.3 and §4.1 (from SYC-578): the Notifications screen's states. */
import { describe, expect, it } from 'vitest';
import { notificationsEmptyKey, notificationsLoadFailed } from '../notificationsEmpty';

describe('notificationsEmptyKey', () => {
  it('no spots yet: the "Spot a cat to follow its updates!" line', () => {
    expect(notificationsEmptyKey({ catsSpotted: 0 })).toBe('noNotifications');
  });
  it('has spotted cats: never tells them to spot a cat to follow updates', () => {
    expect(notificationsEmptyKey({ catsSpotted: 3 })).toBe('noNotificationsHasSpots');
  });
  it('unknown: the plain line', () => {
    expect(notificationsEmptyKey(undefined)).toBe('noNotificationsYet');
    expect(notificationsEmptyKey({})).toBe('noNotificationsYet');
  });
});

describe('notificationsLoadFailed', () => {
  it('still loading or never tried: not failed', () => {
    expect(notificationsLoadFailed({ data: undefined, isError: false })).toBe(false);
  });
  it('failed with nothing loaded: failed', () => {
    expect(notificationsLoadFailed({ data: undefined, isError: true })).toBe(true);
  });
  it('a failed poll after a good load (even an empty inbox): not failed', () => {
    expect(notificationsLoadFailed({ data: [], isError: true })).toBe(false);
    expect(notificationsLoadFailed({ data: [{ id: 1 }], isError: true })).toBe(false);
  });
  it('a reply that is not a list: failed', () => {
    expect(notificationsLoadFailed({ data: '<html>Sign in to Wi-Fi</html>', isError: false })).toBe(true);
  });
  it('loaded and empty: not failed', () => {
    expect(notificationsLoadFailed({ data: [], isError: false })).toBe(false);
  });
});
