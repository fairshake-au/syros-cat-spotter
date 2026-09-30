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

// In-app browsers (SYC-134 review round 2): a spotter can reach the site
// from inside another app's webview, not just a real browser.
const IOS_FACEBOOK =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.0;FBBV/123456789;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US]';
const IOS_MESSENGER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0.0.0;FBBV/123456789;FBDV/iPhone14,2;FBSV/17.5]';
const IOS_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.114 (iPhone14,2; iOS 17_5; en_US; en-US; scale=3.00; 1170x2532; 498423722)';
const IOS_LINE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.15.0';
const IOS_SNAPCHAT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.79.0.34';
const ANDROID_IN_APP_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP31.240517.022; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.54 Mobile Safari/537.36';

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

  // SYC-134 review, 30 Sep 2026: Samuel's on-device check only covered iOS
  // Safari — a third-party iOS browser may keep its own storage, separate
  // from Safari's, so a Home Screen icon added from one of them could open
  // with Safari's *empty* storage. Until that's checked for real,
  // third-party iOS browsers are 'ios-unsupported', not given instructions.
  it('treats Chrome on iOS as unsupported (unverified Home Screen storage sharing)', () => {
    expect(detectHomeScreenPlatform(IPHONE_CHROME)).toBe('ios-unsupported');
  });

  it('treats other third-party iOS browsers as unsupported too', () => {
    expect(detectHomeScreenPlatform(IPHONE_FIREFOX)).toBe('ios-unsupported');
  });

  // SYC-134 review round 3, 30 Sep 2026: scoped to iPhone/iPad Safari only
  // — Safari's 7-day storage rule is what this banner protects against,
  // and that's Safari's rule, not the platform's. Android is 'other'
  // unconditionally now, Chrome included.
  it('treats every Android browser as out of scope, Chrome included', () => {
    expect(detectHomeScreenPlatform(ANDROID_CHROME)).toBe('other');
    expect(detectHomeScreenPlatform(ANDROID_FIREFOX)).toBe('other');
    expect(detectHomeScreenPlatform(ANDROID_SAMSUNG)).toBe('other');
  });

  it('falls back to generic for desktop, Mac Safari included', () => {
    expect(detectHomeScreenPlatform(DESKTOP_CHROME)).toBe('other');
    // A real desktop Mac reports 0 touch points, unlike an iPad (see the
    // "detects iPad Safari" test above) — so Mac Safari's own UA (which is
    // textually identical to iPad Safari's) must NOT be treated as an iPad.
    expect(detectHomeScreenPlatform(IPAD_SAFARI, 0)).toBe('other');
  });

  it('handles an empty user agent without throwing', () => {
    expect(detectHomeScreenPlatform('')).toBe('other');
  });

  // SYC-134 review round 2, 30 Sep 2026: in-app browsers (Facebook,
  // Messenger, Instagram, LINE, Snapchat on iOS; any app's embedded
  // WebView on Android) get the same treatment as third-party iOS
  // browsers — unverified Home Screen storage behaviour, so hidden.
  describe('in-app browsers', () => {
    it('treats Facebook\'s iOS in-app browser as unsupported', () => {
      expect(detectHomeScreenPlatform(IOS_FACEBOOK)).toBe('ios-unsupported');
    });

    it('treats Messenger\'s iOS in-app browser as unsupported', () => {
      expect(detectHomeScreenPlatform(IOS_MESSENGER)).toBe('ios-unsupported');
    });

    it('treats Instagram\'s iOS in-app browser as unsupported', () => {
      expect(detectHomeScreenPlatform(IOS_INSTAGRAM)).toBe('ios-unsupported');
    });

    it('treats LINE\'s iOS in-app browser as unsupported', () => {
      expect(detectHomeScreenPlatform(IOS_LINE)).toBe('ios-unsupported');
    });

    it('treats Snapchat\'s iOS in-app browser as unsupported', () => {
      expect(detectHomeScreenPlatform(IOS_SNAPCHAT)).toBe('ios-unsupported');
    });

    // SYC-134 review round 3: Android is out of scope entirely now (see
    // the "treats every Android browser as out of scope" test above), so
    // an Android in-app WebView has nothing special left to detect — it's
    // just Android, i.e. 'other', same as any other Android browser.
    it('treats an Android in-app WebView ("; wv)") as out of scope, same as any other Android browser', () => {
      expect(detectHomeScreenPlatform(ANDROID_IN_APP_WEBVIEW)).toBe('other');
    });

    // WhatsApp's iOS in-app browser carries no distinguishing UA token, so
    // it can't be — and deliberately isn't — special-cased: it's
    // indistinguishable from real Safari here, which is fine, because an
    // in-app webview has no Add to Home Screen option regardless (see the
    // doc comment in homeScreenNudge.ts).
    it('cannot distinguish WhatsApp\'s iOS in-app browser from Safari (documented, not a bug)', () => {
      const whatsappLikeSafariUA = IPHONE_SAFARI; // no WhatsApp-specific token exists
      expect(detectHomeScreenPlatform(whatsappLikeSafariUA)).toBe('ios-safari');
    });
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

  // SYC-134 review round 2, 30 Sep 2026: a device clock can be wrong. A
  // `dismissedAt` in the future would otherwise make `now - dismissedAt`
  // negative — always less than the snooze window — hiding the nudge
  // forever rather than for 7 days.
  it('is false when dismissedAt is in the future (clock skew), not snoozed forever', () => {
    const future = now + 1000;
    expect(isWithinDismissalSnooze(String(future), now)).toBe(false);

    const farFuture = now + HOME_SCREEN_SNOOZE_MS * 10;
    expect(isWithinDismissalSnooze(String(farFuture), now)).toBe(false);
  });
});
