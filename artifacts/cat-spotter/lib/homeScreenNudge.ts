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
 *
 * In-app browsers (SYC-134 review round 2, 30 Sep 2026): a spotter can
 * reach the site from inside Facebook, Instagram, Messenger, LINE, Snapchat
 * and similar apps' built-in webview, not just a real browser. These are
 * folded into the same `ios-unsupported` bucket on iOS (detected by their
 * UA tokens — `FBAN`/`FBAV` for Facebook and Messenger, `Instagram`,
 * `Line/`, `Snapchat`), and on Android by the generic in-app-webview marker
 * `; wv)` that Android's WebKit adds to any app embedding a WebView,
 * regardless of which app it is.
 *
 * **Deliberately not attempted: telling someone in one of these to "open in
 * Safari".** A tester who onboarded and claimed a username *inside*, say,
 * WhatsApp's iOS in-app browser already has their identity in *that* view's
 * storage — sending them to Safari instead would hand them a stranger's
 * (empty) storage, which is worse than doing nothing. WhatsApp's iOS
 * in-app browser also can't be told apart from real Safari by user agent at
 * all (it carries no distinguishing token), so it isn't and can't be
 * special-cased here. That's fine: an in-app webview has no "Add to Home
 * Screen" option in the first place, so at worst this shows instructions
 * that quietly don't do anything — never a UA it can misclassify into
 * moving someone's identity.
 */
const IOS_UNSUPPORTED_BROWSER_RE =
  /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line\/|Snapchat/i;
const ANDROID_IN_APP_WEBVIEW_RE = /;\s*wv\)/i;

export function detectHomeScreenPlatform(
  userAgent: string,
  maxTouchPoints = 0,
): HomeScreenPlatform {
  const ua = userAgent || '';
  const isIOSDevice =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

  if (isIOSDevice) {
    // Third-party iOS browsers (Chrome, Firefox, Edge, Opera) and in-app
    // webviews (Facebook, Messenger, Instagram, LINE, Snapchat). All of
    // them are WebKit wrappers whose Home Screen storage behaviour
    // relative to Safari's is unverified — see the doc comment above. Real
    // Safari's UA carries none of these tokens.
    if (IOS_UNSUPPORTED_BROWSER_RE.test(ua)) return 'ios-unsupported';
    return 'ios-safari';
  }

  // Android in-app webviews (any app's embedded WebView, tagged "; wv)" —
  // see the doc comment above). Same reasoning as iOS: unverified storage
  // behaviour, so reuse the same hidden bucket rather than invent a second
  // one.
  if (/Android/.test(ua) && ANDROID_IN_APP_WEBVIEW_RE.test(ua)) {
    return 'ios-unsupported';
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
