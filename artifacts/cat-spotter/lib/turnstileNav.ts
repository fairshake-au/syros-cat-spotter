/**
 * SYC-170 PR 1.3: which addresses the Turnstile WebView may load.
 * Cloudflare's guidance: the app's own host, challenges.cloudflare.com,
 * about:blank and about:srcdoc. Everything else is refused.
 */
import type { ChallengeAction } from './challengeUnavailable';

export function isNavigationAllowed(url: string, appOrigin: string): boolean {
  if (url === 'about:blank' || url === 'about:srcdoc') return true;
  let target: URL;
  let app: URL;
  try {
    target = new URL(url);
    app = new URL(appOrigin);
  } catch {
    return false;
  }
  if (target.protocol === 'https:' && target.hostname === 'challenges.cloudflare.com') return true;
  // The app host: same protocol, host and port. (A local dev server is plain http.)
  return target.protocol === app.protocol && target.host === app.host;
}

export function challengeUrl(appOrigin: string, action: ChallengeAction, cdata: string): string {
  const q = new URLSearchParams({ action, cdata });
  return `${appOrigin.replace(/\/+$/, '')}/_challenge?${q.toString()}`;
}

export type ChallengeMessage =
  | { type: 'token'; token: string }
  | { type: 'interactive' }
  | { type: 'error'; code: string };

export function parseChallengeMessage(raw: string): ChallengeMessage | null {
  try {
    const m = JSON.parse(raw);
    if (m && m.type === 'token' && typeof m.token === 'string' && m.token.length > 0 && m.token.length <= 2048) {
      return { type: 'token', token: m.token };
    }
    if (m && m.type === 'interactive') return { type: 'interactive' };
    if (m && m.type === 'error') return { type: 'error', code: String(m.code ?? 'error').slice(0, 40) };
  } catch {
    // not ours
  }
  return null;
}

/** True when `url` is a page on the app's own origin (the only page that posts our messages). */
export function isAppPage(url: string, appOrigin: string): boolean {
  try {
    return new URL(url).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

/**
 * The WebView's user agent, fixed so it is the same on every check in a
 * session (Cloudflare looks at it, and a changing one reads as a bot). These
 * are ordinary mobile Safari / Chrome strings. Whether they suit the real
 * WebViews is part of the real-phone test: if the production log shows
 * checks failing on one platform, this is the first thing to look at.
 */
export const TURNSTILE_USER_AGENT = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
} as const;
