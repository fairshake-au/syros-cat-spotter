import { afterEach, describe, expect, it, vi } from 'vitest';
// SYC-211 F1: the transport timeout is scoped to the username claim, read
// and availability routes, so it can never cut off a slow photo upload.
import { RequestTimeoutError, USERNAME_REQUEST_TIMEOUT_MS, customFetch } from '@workspace/api-client-react';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function hangingFetch() {
  const fetchMock = vi.fn((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function settleState(promise: Promise<unknown>, ms: number) {
  let state: 'pending' | 'resolved' | unknown = 'pending';
  promise.then(() => { state = 'resolved'; }, (error) => { state = error; });
  await vi.advanceTimersByTimeAsync(ms);
  return state;
}

describe('customFetch transport timeout (SYC-211)', () => {
  it.each([
    '/api/profiles/dev-1/username',
    '/api/profiles/username-availability?name=SeaCat',
  ])('times out %s with a RequestTimeoutError (no HTTP status)', async (url) => {
    vi.useFakeTimers();
    hangingFetch();
    const state = await settleState(customFetch(url), USERNAME_REQUEST_TIMEOUT_MS + 1);
    expect(state).toBeInstanceOf(RequestTimeoutError);
    expect((state as { status?: number }).status).toBeUndefined();
  });

  it('leaves other routes (e.g. photo uploads) without a default timeout', async () => {
    vi.useFakeTimers();
    hangingFetch();
    expect(await settleState(customFetch('/api/sightings', { method: 'POST', body: 'x' }), 10 * 60_000)).toBe('pending');
    expect(await settleState(customFetch('/api/profiles/username-suggestions'), 10 * 60_000)).toBe('pending');
  });

  it('honours an explicit per-call timeoutMs and the caller’s own abort signal', async () => {
    vi.useFakeTimers();
    hangingFetch();
    expect(await settleState(customFetch('/api/anything', { timeoutMs: 1000 }), 1001)).toBeInstanceOf(RequestTimeoutError);

    const controller = new AbortController();
    const request = customFetch('/api/profiles/dev-1/username', { signal: controller.signal });
    controller.abort();
    const state = await settleState(request, 0);
    expect(state).not.toBe('pending');
    expect(state).not.toBeInstanceOf(RequestTimeoutError);
  });
});
