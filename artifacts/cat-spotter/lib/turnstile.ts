/**
 * SYC-170 PR 1.3: the client twin of the server's Turnstile check, phone-app
 * half. Metro picks lib/turnstile.web.ts on the website.
 *
 * `getTurnstileToken(action, cdata)` asks the TurnstileHost (mounted once in
 * the root layout) to run Cloudflare's check in a hidden WebView on the app
 * host's /_challenge page. See lib/turnstileController.ts for the rules: it
 * resolves `null` whenever no tap was asked for (the report is then sent with
 * no token and the server decides), and throws `ChallengeUnavailable` only
 * when Cloudflare asked for a tap and nobody made it in about 20 seconds.
 * The check waits for the app to be in the foreground first.
 */
import { AppState } from 'react-native';
import type { ChallengeAction } from './challengeUnavailable';
import { waitForActive } from './foregroundGate';
import { createChallengeController } from './turnstileController';
import { apiOrigin } from './urls';

export { ChallengeUnavailable, CHALLENGE_TIMEOUT_MS, type ChallengeAction } from './challengeUnavailable';

export const turnstileController = createChallengeController({
  origin: apiOrigin,
  waitForActive: () =>
    waitForActive({
      current: () => AppState.currentState,
      onChange: (listener) => {
        const sub = AppState.addEventListener('change', listener);
        return () => sub.remove();
      },
    }),
});

export function getTurnstileToken(action: ChallengeAction, cdata: string): Promise<string | null> {
  return turnstileController.run(action, cdata);
}
