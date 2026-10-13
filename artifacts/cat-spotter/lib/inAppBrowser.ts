/**
 * Is this page open inside another app's built-in browser (an email or social
 * app), rather than a browser the person uses on its own? (SYC-3 Decision 12.)
 *
 * Spots moved into one of these stay in that app's private storage: the
 * person won't find them in the browser they normally use. Detection is from
 * the browser's identifier only, so it can't be perfect (some mail apps open
 * links in a view that looks exactly like Safari); the restore page's
 * "is this the app or browser you use for Cat Spotters?" question is the real
 * safety net, and this warning is a bonus.
 *
 * The iOS in-app tokens are the same ones the Home Screen card treats as
 * "not Safari" (lib/homeScreenNudge.ts), plus a few more apps; `; wv)` is an
 * Android WebView.
 */
const IN_APP_BROWSER_RE =
  /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|LinkedInApp|musical_ly|BytedanceWebview|TikTok|GSA\/|Twitter|; wv\)/i;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER_RE.test(userAgent || '');
}
