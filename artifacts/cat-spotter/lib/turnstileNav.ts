/**
 * SYC-170 spike: which addresses the Turnstile WebView may load.
 * Cloudflare's guidance: the app's own host, challenges.cloudflare.com,
 * about:blank and about:srcdoc. Everything else is refused.
 */
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

export type ChallengeAction = 'welfare_report' | 'welfare_draft' | 'report_issue';

export function challengeUrl(appOrigin: string, action: ChallengeAction, cdata: string): string {
  const q = new URLSearchParams({ action, cdata });
  return `${appOrigin.replace(/\/+$/, '')}/_challenge?${q.toString()}`;
}

export type ChallengeMessage =
  | { type: 'token'; token: string }
  | { type: 'interactive' }
  | { type: 'error'; code: string }
  | { type: 'ua'; ua: string };

export function parseChallengeMessage(raw: string): ChallengeMessage | null {
  try {
    const m = JSON.parse(raw);
    if (m && m.type === 'token' && typeof m.token === 'string' && m.token.length > 0 && m.token.length <= 2048) {
      return { type: 'token', token: m.token };
    }
    if (m && m.type === 'interactive') return { type: 'interactive' };
    if (m && m.type === 'error') return { type: 'error', code: String(m.code ?? 'error').slice(0, 40) };
    if (m && m.type === 'ua' && typeof m.ua === 'string') return { type: 'ua', ua: m.ua.slice(0, 300) };
  } catch {
    // not ours
  }
  return null;
}
