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

export type HomeScreenPlatform = 'ios-safari' | 'ios-unsupported' | 'other';

/**
 * Best-effort platform classification from the user-agent string (plus
 * maxTouchPoints, needed because iPadOS Safari's default UA claims to be a
 * Mac). The banner only ever shows for `'ios-safari'` — see the scoping
 * note below — everything else, including Android and desktop, is
 * `'other'`.
 *
 * `ios-unsupported` (SYC-134 review, 30 Sep 2026): Samuel's on-device check
 * for SYC-134 confirmed a Home Screen icon added from iOS **Safari** opens
 * straight into the signed-in app. It did not check any other iOS browser.
 * On iOS, third-party browsers (Chrome, Firefox, Edge, Opera — all
 * WebKit-based wrappers) keep their own storage, separate from Safari's, so
 * a Home Screen icon added from one of them may open with Safari's *empty*
 * storage instead — sending the tester straight back to onboarding, the
 * exact harm this banner exists to prevent. Until that's checked on a real
 * device (follow-up ticket filed, SYC-139), this stays hidden for every iOS
 * browser except Safari.
 *
 * In-app browsers (SYC-134 review round 2, 30 Sep 2026): a spotter can
 * reach the site from inside Facebook, Instagram, Messenger, LINE, Snapchat
 * and similar apps' built-in webview on iOS, not just a real browser.
 * Folded into the same `ios-unsupported` bucket (detected by UA tokens —
 * `FBAN`/`FBAV` for Facebook and Messenger, `Instagram`, `Line/`,
 * `Snapchat`).
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
 *
 * **Scoped to iPhone/iPad Safari only (Samuel, 30 Sep 2026, PR #36 review
 * round 3).** Safari's 7-day storage-clearing rule is what this banner
 * protects against, and that rule is Safari's, not the platform's — so the
 * card no longer shows on Android or desktop at all, regardless of
 * browser. (It was previously also shown on Android Chrome, with its own
 * `beforeinstallprompt` install flow; that path was removed entirely, not
 * just hidden, since it no longer has anywhere to run.) Android's in-app
 * webview detection (the generic `"; wv)"` marker) was removed for the same
 * reason: Android is `'other'` unconditionally now, so there's nothing left
 * to distinguish an Android in-app browser from any other Android browser.
 */
const IOS_UNSUPPORTED_BROWSER_RE =
  /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line\/|Snapchat/i;

// The `Version/X.Y` token is Safari's own version marker, present in both
// iPhone Safari's UA and iPadOS Safari's desktop-mode UA (the one that
// otherwise claims to be a Mac). `OS X_Y`-style is the underlying iOS
// version token, carried only on iPhone/iPad UAs (never in iPadOS desktop
// mode) — used as a secondary cross-check when the `Version/` token is
// missing.
const SAFARI_VERSION_RE = /Version\/(\d+)\.(\d+)/;
const IOS_OS_VERSION_RE = /OS (\d+)_(\d+)/;

const MIN_SAFARI_MAJOR = 16;
const MIN_SAFARI_MINOR = 4;

function meetsMinimumVersion(major: number, minor: number): boolean {
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major !== MIN_SAFARI_MAJOR) return major > MIN_SAFARI_MAJOR;
  return minor >= MIN_SAFARI_MINOR;
}

/**
 * SYC-134 (Samuel, 30 Sep 2026): whether to hide the card on older
 * iPhones/iPads until a tester on one of them confirms a Home Screen icon
 * keeps their identity — documented Safari behaviour, but only actually
 * checked on a device running iOS 16.4+. SYC-146 is the follow-up to get
 * that older-device check done and lift this once it's confirmed. Reads
 * the Safari version from the `Version/X.Y` token, which is present for
 * both iPhone Safari and iPadOS Safari in desktop mode; on iPhone, an
 * `OS 16_4`-style token is also accepted as a cross-check if `Version/` is
 * missing. If no version can be read at all, this fails safe and hides the
 * card — an unverified device is treated the same as a known-old one, not
 * the same as a known-new one.
 */
function isRecentEnoughSafari(ua: string, isIPhone: boolean): boolean {
  const versionMatch = ua.match(SAFARI_VERSION_RE);
  if (versionMatch) {
    return meetsMinimumVersion(Number(versionMatch[1]), Number(versionMatch[2]));
  }
  if (isIPhone) {
    const osMatch = ua.match(IOS_OS_VERSION_RE);
    if (osMatch) {
      return meetsMinimumVersion(Number(osMatch[1]), Number(osMatch[2]));
    }
  }
  // Fail safe: can't tell the version, so don't claim iOS 16.4+ behaviour.
  return false;
}

export function detectHomeScreenPlatform(
  userAgent: string,
  maxTouchPoints = 0,
): HomeScreenPlatform {
  const ua = userAgent || '';
  const isIPhone = /iPhone|iPod/.test(ua);
  // iPadOS Safari's default UA claims to be a Mac ("Macintosh"), so a touch
  // point count above 1 is what tells a real iPad apart from a real desktop
  // Mac (which reports 0). iPhone/iPod always carry their own UA token.
  const isIOSDevice =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

  if (isIOSDevice) {
    // Third-party iOS browsers (Chrome, Firefox, Edge, Opera) and in-app
    // webviews (Facebook, Messenger, Instagram, LINE, Snapchat). All of
    // them are WebKit wrappers whose Home Screen storage behaviour
    // relative to Safari's is unverified — see the doc comment above. Real
    // Safari's UA carries none of these tokens.
    if (IOS_UNSUPPORTED_BROWSER_RE.test(ua)) return 'ios-unsupported';
    // SYC-134, 30 Sep 2026: below iOS/iPadOS 16.4, or unreadable, this is
    // unverified — see `isRecentEnoughSafari` above and SYC-146 (follow-up:
    // ask a tester on an older device to confirm, then lift this).
    if (!isRecentEnoughSafari(ua, isIPhone)) return 'ios-unsupported';
    return 'ios-safari';
  }

  // Android (any browser) and desktop (any browser, including Mac Safari):
  // out of scope entirely — see the doc comment above.
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
 *
 * SYC-134 review round 2, 30 Sep 2026: a device clock can be wrong — set
 * back, or a dismissal timestamp written just before the clock jumped
 * forward and was then corrected. If `dismissedAt` is in the future
 * relative to `now`, `now - dismissedAt` is negative, which is always
 * `< HOME_SCREEN_SNOOZE_MS` — so a bad clock could make the snooze look
 * "not yet expired" indefinitely. Treat a future `dismissedAt` as not
 * snoozed at all, so a clock-skewed dismissal can't hide the nudge forever.
 */
export function isWithinDismissalSnooze(
  storedValue: string | null,
  now: number,
): boolean {
  if (!storedValue) return false;
  const dismissedAt = Number(storedValue);
  if (!Number.isFinite(dismissedAt)) return false;
  if (dismissedAt > now) return false;
  return now - dismissedAt < HOME_SCREEN_SNOOZE_MS;
}
