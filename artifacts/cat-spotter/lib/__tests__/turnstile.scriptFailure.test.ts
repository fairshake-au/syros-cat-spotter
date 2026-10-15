// @vitest-environment jsdom
/**
 * SYC-170 PR 1.2: the client never stops a report. A blocked or failed
 * Cloudflare script (an ad-blocker, say) resolves null, so the report is sent
 * with no token and the server decides. Only "asked for a tap and they didn't
 * in time" throws ChallengeUnavailable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCRIPT_LOAD_TIMEOUT_MS, getTurnstileToken } from '../turnstile.web';
import { CHALLENGE_TIMEOUT_MS, ChallengeUnavailable } from '../challengeUnavailable';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as { turnstile?: unknown }).turnstile;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('getTurnstileToken on a mapped host (localhost)', () => {
  it('script load failure: resolves null, never throws, and leaves nothing on the page', async () => {
    const real = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      const el = node as HTMLScriptElement;
      if (el.tagName === 'SCRIPT') queueMicrotask(() => el.dispatchEvent(new Event('error')));
      return real(node);
    }) as typeof document.head.appendChild);
    await expect(getTurnstileToken('welfare_report', 'r-abc')).resolves.toBeNull();
    // and a later send tries the script again
    await expect(getTurnstileToken('welfare_report', 'r-abc')).resolves.toBeNull();
    expect(document.querySelector('[data-turnstile-sheet]')).toBeNull();
  });

  it('review finding 5: a script that never arrives costs one send ~8 s, not 20 s, and the next send waits on it again', async () => {
    vi.useFakeTimers();
    let settled = false;
    const first = getTurnstileToken('welfare_report', 'r-abc').then((v) => {
      settled = true;
      return v;
    });
    await vi.advanceTimersByTimeAsync(SCRIPT_LOAD_TIMEOUT_MS - 100);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(true);
    await expect(first).resolves.toBeNull();
    // The tag is still there (not added twice); when it arrives later the next send uses it.
    expect(document.querySelectorAll('script[src*="challenges.cloudflare.com"]')).toHaveLength(1);
    (globalThis as { turnstile?: unknown }).turnstile = {
      render: (_c: unknown, p: { callback: (t: string) => void }) => {
        queueMicrotask(() => p.callback('tok-late'));
        return 'w1';
      },
      remove: () => undefined,
    };
    await expect(getTurnstileToken('welfare_report', 'r-abc')).resolves.toBe('tok-late');
    expect(document.querySelectorAll('script[src*="challenges.cloudflare.com"]')).toHaveLength(1);
  });

  it('a widget error with no tap asked also resolves null', async () => {
    (globalThis as { turnstile?: unknown }).turnstile = {
      render: (_c: unknown, p: { 'error-callback': () => void }) => {
        queueMicrotask(() => p['error-callback']());
        return 'w1';
      },
      remove: () => undefined,
    };
    await expect(getTurnstileToken('welfare_report', 'r-abc')).resolves.toBeNull();
  });

  it('asked for a tap and nobody tapped in time: ChallengeUnavailable', async () => {
    vi.useFakeTimers();
    (globalThis as { turnstile?: unknown }).turnstile = {
      render: (_c: unknown, p: { 'before-interactive-callback': () => void }) => {
        queueMicrotask(() => p['before-interactive-callback']());
        return 'w1';
      },
      remove: () => undefined,
    };
    const result = getTurnstileToken('welfare_report', 'r-abc');
    const assertion = expect(result).rejects.toBeInstanceOf(ChallengeUnavailable);
    await vi.advanceTimersByTimeAsync(CHALLENGE_TIMEOUT_MS + 1000);
    await assertion;
  });

  it.each(['error-callback', 'unsupported-callback'])(
    'review finding 7: %s after a tap was asked is tokenless, not an unanswered tap',
    async (event) => {
      (globalThis as { turnstile?: unknown }).turnstile = {
        render: (_c: unknown, p: Record<string, () => void>) => {
          queueMicrotask(() => {
            p['before-interactive-callback']!();
            p[event]!();
          });
          return 'w1';
        },
        remove: () => undefined,
      };
      await expect(getTurnstileToken('welfare_report', 'r-abc')).resolves.toBeNull();
    },
  );
});
