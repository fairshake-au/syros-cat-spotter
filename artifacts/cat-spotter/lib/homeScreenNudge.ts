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
  | 'ios-unsupported'
  | 'android-chrome'
  | 'other';

/**
 * Best-effort platform classification from the user-agent string (plus
 * maxTouchPoints, needed because iPadOS Safari's default UA claims to be a
 * Mac). Only distinguishes the platforms the banner has different copy for;
 * everything else — desktop browsers, Android Firefox/Samsung Internet,
 * etc. — falls back to 'other'.
 *
 * `ios-unsupported` (SYC-134 review, 30 Sep 2026): Samuel's on-device check
 * for SYC-134 confirmed a Home Screen icon added from iOS **Safari** opens
 * straight into the signed-in app. It did not check any other iOS browser.
 * On iOS, third-party browsers (Chrome, Firefox, Edge, Opera — all
 * WebKit-based wrappers) keep their own storage, separate from Safari's, so
 * a Home Screen icon added from one of them may open with Safari's *empty*
 * storage instead — sending the tester straight back to onboarding, the
 * exact harm this banner exists to prevent. Until that's checked on a real
 * device (follow-up ticket filed), the banner stays hidden for every iOS
 * browser except Safari, rather than risk causing the very loss it's meant
 * to guard against.
 */
export function detectHomeScreenPlatform(
  userAgent: string,
  maxTouchPoints = 0,
): HomeScreenPlatform {
  const ua = userAgent || '';
  const isIOSDevice =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

  if (isIOSDevice) {
    // Known third-party iOS browser UA tokens (Chrome, Firefox, Edge,
    // Opera). All of them are WebKit wrappers whose Home Screen storage
    // behaviour relative to Safari's is unverified — see the doc comment
    // above. Real Safari's UA carries none of these tokens.
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 'ios-unsupported';
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
