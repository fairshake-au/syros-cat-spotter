import { afterEach, describe, expect, it, vi } from 'vitest';
// SYC-211 F1: on Android, React Native's OkHttp client has no connect/read
// timeout at all, and (before this fix) neither did our fetch wrapper. A
// claim whose connection never answers back then never settles, so the
// per-request `outstanding` counter in the onboarding and editor screens
// never returns to zero and the screen is locked for good. The fix belongs
// in the transport itself (`lib/api-client-react/src/custom-fetch.ts`), not
// only in the UI's own ~8s deadline, because that deadline only stops the
// screen from *waiting* on the request — it does not stop the request, or
// free up the slot once the request is abandoned.
//
// This drives `claimUsername` (a thin wrapper generated over `customFetch`)
// with `fetch` itself mocked to hang unless its abort signal fires, the way
// a real stalled connection behaves. No particular timeout mechanism is
// assumed beyond "the request's AbortSignal, if any, is what eventually
// frees it" — which is how both `fetch` and `AbortController` already work.
import { claimUsername } from '@workspace/api-client-react';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('claim transport timeout (SYC-211 F1)', () => {
  it('eventually settles a claim whose connection never answers, instead of hanging forever', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    let settled = false;
    claimUsername('device-1', { username: 'SeaCat' } as any).then(
      () => { settled = true; },
      () => { settled = true; },
    );

    // Give a request that never answers a wide margin over the UI's own 8s
    // claim deadline (CLAIM_WAIT_MS) — a transport timeout, separate from
    // that UI deadline, must be what eventually frees this request.
    await vi.advanceTimersByTimeAsync(35_000);

    expect(settled).toBe(true);
  });
});
