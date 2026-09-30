/**
 * SYC-134: pure helpers behind the "Add to Home Screen" nudge banner.
 */
import { describe, expect, it } from 'vitest';
import {
  HOME_SCREEN_SNOOZE_MS,
  detectHomeScreenPlatform,
  isHomeScreenStandalone,
  isWithinDismissalSnooze,
} from '../homeScreenNudge';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_FIREFOX =
  'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0';
const ANDROID_SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

describe('detectHomeScreenPlatform', () => {
  it('detects iPhone Safari', () => {
    expect(detectHomeScreenPlatform(IPHONE_SAFARI)).toBe('ios-safari');
  });

  it('detects iPad Safari, whose UA claims to be a Mac, via maxTouchPoints', () => {
    expect(detectHomeScreenPlatform(IPAD_SAFARI, 5)).toBe('ios-safari');
    // Without a touch-capable Mac signal, it's indistinguishable from a
    // real desktop Mac, so it falls back to the generic instructions.
    expect(detectHomeScreenPlatform(IPAD_SAFARI, 0)).toBe('other');
  });

  it('detects Chrome on iOS', () => {
    expect(detectHomeScreenPlatform(IPHONE_CHROME)).toBe('ios-chrome');
  });

  it('falls back to generic for other iOS browsers', () => {
    expect(detectHomeScreenPlatform(IPHONE_FIREFOX)).toBe('other');
  });

  it('detects Chrome on Android', () => {
    expect(detectHomeScreenPlatform(ANDROID_CHROME)).toBe('android-chrome');
  });

  it('falls back to generic for other Android browsers', () => {
    expect(detectHomeScreenPlatform(ANDROID_FIREFOX)).toBe('other');
    expect(detectHomeScreenPlatform(ANDROID_SAMSUNG)).toBe('other');
  });

  it('falls back to generic for desktop', () => {
    expect(detectHomeScreenPlatform(DESKTOP_CHROME)).toBe('other');
  });

  it('handles an empty user agent without throwing', () => {
    expect(detectHomeScreenPlatform('')).toBe('other');
  });
});

describe('isHomeScreenStandalone', () => {
  it('is true when navigator.standalone is true (iOS)', () => {
    expect(isHomeScreenStandalone({ standalone: true }, undefined)).toBe(
      true,
    );
  });

  it('is false when navigator.standalone is false or missing', () => {
    expect(isHomeScreenStandalone({ standalone: false }, undefined)).toBe(
      false,
    );
    expect(isHomeScreenStandalone({}, undefined)).toBe(false);
  });

  it('is true when display-mode: standalone matches (cross-browser)', () => {
    const win = { matchMedia: () => ({ matches: true }) };
    expect(isHomeScreenStandalone({}, win)).toBe(true);
  });

  it('is false when neither signal is set', () => {
    const win = { matchMedia: () => ({ matches: false }) };
    expect(isHomeScreenStandalone({}, win)).toBe(false);
  });

  it('does not throw if matchMedia throws (e.g. an odd test environment)', () => {
    const win = {
      matchMedia: () => {
        throw new Error('no matchMedia here');
      },
    };
    expect(() => isHomeScreenStandalone({}, win)).not.toThrow();
    expect(isHomeScreenStandalone({}, win)).toBe(false);
  });
});

describe('isWithinDismissalSnooze', () => {
  const now = 1_700_000_000_000;

  it('is false when never dismissed', () => {
    expect(isWithinDismissalSnooze(null, now)).toBe(false);
  });

  it('is false when the stored value is unparsable', () => {
    expect(isWithinDismissalSnooze('not-a-number', now)).toBe(false);
  });

  it('is true when dismissed within the last 7 days', () => {
    const dismissedAt = now - 1000;
    expect(isWithinDismissalSnooze(String(dismissedAt), now)).toBe(true);
  });

  it('is true right up to (but not including) the 7-day boundary', () => {
    const dismissedAt = now - (HOME_SCREEN_SNOOZE_MS - 1);
    expect(isWithinDismissalSnooze(String(dismissedAt), now)).toBe(true);
  });

  it('is false once 7 days have passed, so the nudge shows again once', () => {
    const dismissedAt = now - HOME_SCREEN_SNOOZE_MS;
    expect(isWithinDismissalSnooze(String(dismissedAt), now)).toBe(false);

    const wellPast = now - (HOME_SCREEN_SNOOZE_MS + 1);
    expect(isWithinDismissalSnooze(String(wellPast), now)).toBe(false);
  });
});
