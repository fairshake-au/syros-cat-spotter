/**
 * SYC-170 PR 1.3: the brain of the phone apps' safety check. Framework-free,
 * so the rules are unit-testable; components/TurnstileHost.tsx only draws what
 * this says and feeds it what the WebView reports.
 *
 * One check at a time, each in a fresh WebView on /_challenge. The rule from
 * PR 1.2 holds: the client is never what stops a report. Whenever no tap was
 * asked for (no host mounted, no sitekey for this host, the page failed to
 * load, Cloudflare reported an error, nothing finished in time) the check
 * resolves `null` and the report is sent with no token, so the server decides.
 * ChallengeUnavailable is thrown only when Cloudflare asked for a tap and
 * nobody made it in time.
 */
import { CHALLENGE_TIMEOUT_MS, ChallengeUnavailable, type ChallengeAction } from './challengeUnavailable';
import { challengeUrl, isAppPage, isNavigationAllowed, parseChallengeMessage } from './turnstileNav';
import { sitekeyForHost } from './turnstileConfig';

export interface ChallengeView {
  /** The page to load, or null when no check is running (nothing is mounted). */
  url: string | null;
  /** Whether Cloudflare asked for a tap, so the WebView is shown as a small sheet. */
  sheet: boolean;
}

export interface ChallengeControllerDeps {
  /** The app host, the one the build already uses for /api. */
  origin(): string;
  /** Resolves once the app is in the foreground (immediately if it already is). */
  waitForActive?(): Promise<void>;
  timeoutMs?: number;
}

interface Running {
  action: ChallengeAction;
  tapAsked: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  arm(): void;
  finish(token: string | null, error?: ChallengeUnavailable): void;
}

export function createChallengeController(deps: ChallengeControllerDeps) {
  const timeoutMs = deps.timeoutMs ?? CHALLENGE_TIMEOUT_MS;
  let view: ChallengeView = { url: null, sheet: false };
  const listeners = new Set<() => void>();
  let running: Running | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  function setView(next: ChallengeView) {
    view = next;
    for (const l of [...listeners]) l();
  }

  function runOne(action: ChallengeAction, cdata: string): Promise<string | null> {
    // No host mounted (a test, a screen before the layout): send tokenless.
    if (listeners.size === 0) return Promise.resolve(null);
    let url: string;
    try {
      const origin = deps.origin();
      // A host with no sitekey (the EU project's own address, a future launch
      // domain): the page could only show an error there. Tokenless.
      if (sitekeyForHost(new URL(origin).host) === null) return Promise.resolve(null);
      url = challengeUrl(origin, action, cdata);
    } catch {
      return Promise.resolve(null);
    }

    const start = () =>
      new Promise<string | null>((resolve, reject) => {
        const r: Running = {
          action,
          tapAsked: false,
          timer: undefined,
          arm() {
            if (r.timer) clearTimeout(r.timer);
            r.timer = setTimeout(() => {
              // Only "asked for a tap and nobody made it" is an unanswered check.
              if (r.tapAsked) r.finish(null, new ChallengeUnavailable('timeout'));
              else r.finish(null);
            }, timeoutMs);
          },
          finish(token, error) {
            if (running !== r) return;
            if (r.timer) clearTimeout(r.timer);
            running = null;
            setView({ url: null, sheet: false });
            if (error) reject(error);
            else resolve(token);
          },
        };
        running = r;
        r.arm();
        setView({ url, sheet: false });
      });

    // The wait for the foreground is not part of the 20 seconds.
    return (deps.waitForActive ? deps.waitForActive() : Promise.resolve()).then(start);
  }

  return {
    getView: () => view,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        // The host went away mid-check: nothing can finish it, so go tokenless.
        if (listeners.size === 0) running?.finish(null);
      };
    },

    /** A token, or null (send without one), or ChallengeUnavailable (a tap went unanswered). */
    run(action: ChallengeAction, cdata: string): Promise<string | null> {
      const job = chain.then(() => runOne(action, cdata));
      chain = job.catch(() => undefined);
      return job;
    },

    /** The WebView's `onMessage`. `sourceUrl` is the page that posted it. */
    handleMessage(raw: string, sourceUrl?: string): void {
      const r = running;
      if (!r) return;
      if (sourceUrl !== undefined) {
        try {
          if (!isAppPage(sourceUrl, deps.origin())) return;
        } catch {
          return;
        }
      }
      const msg = parseChallengeMessage(raw);
      if (!msg) return;
      if (msg.type === 'token') r.finish(msg.token);
      else if (msg.type === 'error') r.finish(null);
      else if (msg.type === 'interactive') {
        // A draft never interrupts anyone: it goes tokenless, like the web.
        if (r.action === 'welfare_draft') return r.finish(null);
        r.tapAsked = true;
        setView({ url: view.url, sheet: true });
        // A person needs time to tap: the clock restarts once the sheet is up.
        r.arm();
      }
    },

    /** The WebView's `onError` / `onHttpError`: no tap was asked for, so tokenless. */
    handleLoadError(): void {
      running?.finish(null);
    },

    /** The WebView's `onShouldStartLoadWithRequest`. */
    shouldLoad(url: string): boolean {
      try {
        return isNavigationAllowed(url, deps.origin());
      } catch {
        return false;
      }
    },
  };
}

export type ChallengeController = ReturnType<typeof createChallengeController>;
