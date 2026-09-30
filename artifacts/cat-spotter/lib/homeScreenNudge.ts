/**
 * SYC-134: pure helpers for the "Add to Home Screen" nudge, kept out of the
 * component so they can be unit-tested against arbitrary user-agent strings
 * without mounting anything.
 *
 * Why this nudge exists (SYC-3 plan, Decision 1(a)): on the website, a
 * spotter's identity (device id, secret, username) lives only in that
 * browser's storage for that one address. Safari deletes it after 7 days
 * without a visit — a Home Screen icon isn't subject to that rule (checked
 * on a real iPhone for SYC-134: it opens straight into the signed-in app).
 * This nudge only protects against that storage loss; it says nothing about
 * offline support, which is separate and partial.
 */

export type HomeScreenPlatform =
  | 'ios-safari'
  | 'ios-chrome'
  | 'android-chrome'
  | 'other';

/**
 * Best-effort platform classification from the user-agent string (plus
 * maxTouchPoints, needed because iPadOS Safari's default UA claims to be a
 * Mac). Only distinguishes the platforms the banner has different copy for;
 * everything else — desktop browsers, iOS Firefox/Edge, Android
 * Firefox/Samsung Internet, etc. — falls back to 'other'.
 */
export function detectHomeScreenPlatform(
  userAgent: string,
  maxTouchPoints = 0,
): HomeScreenPlatform {
  const ua = userAgent || '';
  const isIOSDevice =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

  if (isIOSDevice) {
    if (/CriOS/.test(ua)) return 'ios-chrome';
    // Other third-party iOS browsers (Firefox, Edge, Opera on iOS) don't
    // get bespoke copy — the generic line is accurate for all of them.
    if (/FxiOS|EdgiOS|OPiOS/.test(ua)) return 'other';
    return 'ios-safari';
  }

  const isAndroidChrome =
    /Android/.test(ua) &&
    /Chrome\//.test(ua) &&
    !/Edg\/|EdgA\/|OPR\/|SamsungBrowser|Firefox/.test(ua);
  if (isAndroidChrome) return 'android-chrome';

  return 'other';
}

/**
 * True once the site is already running as a Home Screen / installed app —
 * `navigator.standalone` is the iOS Safari signal, `display-mode: standalone`
 * is the cross-browser one (Android Chrome, desktop PWA installs). Either
 * one means there's nothing left for this banner to nudge toward.
 */
export function isHomeScreenStandalone(
  nav: { standalone?: boolean } | undefined,
  win: { matchMedia?: (query: string) => { matches: boolean } } | undefined,
): boolean {
  if (nav && nav.standalone === true) return true;
  if (win && typeof win.matchMedia === 'function') {
    try {
      if (win.matchMedia('(display-mode: standalone)').matches) return true;
    } catch {
      // matchMedia can throw in some non-browser test environments; treat
      // as "not standalone" rather than crashing the banner.
    }
  }
  return false;
}

export const HOME_SCREEN_DISMISSED_KEY = 'cat-spotter/home-screen-nudge-dismissed-at';
export const HOME_SCREEN_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether the banner should stay hidden because it was dismissed inside the
 * last 7 days. `null`/missing storage means "never dismissed" — show it.
 * An unparsable value is treated the same way, rather than hiding forever.
 */
export function isWithinDismissalSnooze(
  storedValue: string | null,
  now: number,
): boolean {
  if (!storedValue) return false;
  const dismissedAt = Number(storedValue);
  if (!Number.isFinite(dismissedAt)) return false;
  return now - dismissedAt < HOME_SCREEN_SNOOZE_MS;
}
