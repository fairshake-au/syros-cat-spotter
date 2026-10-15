/**
 * SYC-170 PR 1.2: the client twin of the server's Turnstile check, phone-app
 * half. Metro picks lib/turnstile.web.ts on the website.
 *
 * Until PR 1.3 (the hidden WebView) the phone apps send no token: this
 * resolves `null`, and the report goes without one. Production runs
 * TURNSTILE_MODE=observe, which refuses nothing, so nothing is lost.
 * `TURNSTILE_MODE` moves to `enforce` only once PR 1.3's build is in testers'
 * hands (plan, "Small calls").
 */
import type { ChallengeAction } from './challengeUnavailable';

export { ChallengeUnavailable, CHALLENGE_TIMEOUT_MS, type ChallengeAction } from './challengeUnavailable';

export async function getTurnstileToken(_action: ChallengeAction, _cdata: string): Promise<string | null> {
  return null;
}
