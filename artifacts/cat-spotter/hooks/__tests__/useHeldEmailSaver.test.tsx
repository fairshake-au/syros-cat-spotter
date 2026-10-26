// @vitest-environment jsdom
/**
 * SYC-715: the background save of an email typed when the server gave no
 * answer. It reads first (so a first request that did land sends no second
 * confirmation email), backs off after no answer, drops a refused address,
 * and does nothing once the phone is another spotter.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  online: true,
  gen: 0,
  setKeepSafeOffer: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void h.store.set(k, v)),
    removeItem: vi.fn(async (k: string) => void h.store.delete(k)),
  },
}));
vi.mock('@workspace/api-client-react', () => ({
  // Just enough of the real class for lib/keepSafe's isInvalidEmail.
  ApiError: class ApiError extends Error {
    constructor(public status: number, public data: unknown) { super(`HTTP ${status}`); }
  },
  customFetch: vi.fn(),
}));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({
    deviceId: 'dev-1',
    setKeepSafeOffer: h.setKeepSafeOffer,
    identityGeneration: () => h.gen,
  }),
}));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ language: 'el' }) }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.online }) }));

import { ApiError } from '@workspace/api-client-react';
import { HELD_EMAIL_RETRY_MS, HELD_EMAIL_TIMEOUT_MS, useHeldEmailSaver, type HeldEmailDeps } from '@/hooks/useHeldEmailSaver';
import { HELD_EMAIL_KEY, heldEmailNow, holdEmail, resetHeldEmailForTests } from '@/lib/heldEmail';

function fakeServer(over: Partial<HeldEmailDeps> = {}): HeldEmailDeps {
  return {
    read: vi.fn(async () => ({ status: 'none' as const })),
    add: vi.fn(async () => ({ status: 'pending' as const, addressMask: 's***@example.com' })),
    ...over,
  };
}

async function start(deps: HeldEmailDeps, held: string | null = 'sea@example.com') {
  if (held) await holdEmail(held);
  return renderHook(() => useHeldEmailSaver(deps));
}

describe('useHeldEmailSaver (SYC-715)', () => {
  beforeEach(() => {
    h.store.clear();
    h.online = true;
    h.gen = 0;
    h.setKeepSafeOffer.mockReset();
    resetHeldEmailForTests();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('adds a held email once online, then forgets it and marks the offer done', async () => {
    const deps = fakeServer();
    await start(deps);
    await waitFor(() => expect(heldEmailNow()).toBeNull());
    expect(deps.read).toHaveBeenCalledWith('dev-1');
    expect(deps.add).toHaveBeenCalledWith(
      'dev-1',
      { email: 'sea@example.com', language: 'el', surface: 'onboarding' },
      { timeoutMs: HELD_EMAIL_TIMEOUT_MS },
    );
    expect(h.setKeepSafeOffer).toHaveBeenCalledWith('done');
    expect(h.store.has(HELD_EMAIL_KEY)).toBe(false);
  });

  it('reads first: an address the server already has is adopted and nothing is sent', async () => {
    const deps = fakeServer({ read: vi.fn(async () => ({ status: 'pending' as const, addressMask: 's***@example.com' })) });
    await start(deps);
    await waitFor(() => expect(heldEmailNow()).toBeNull());
    expect(deps.add).not.toHaveBeenCalled();
    expect(h.setKeepSafeOffer).toHaveBeenCalledWith('done');
  });

  it('does nothing while offline', async () => {
    h.online = false;
    const deps = fakeServer();
    await start(deps);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(deps.read).not.toHaveBeenCalled();
    expect(heldEmailNow()).toBe('sea@example.com');
  });

  it('does nothing when no email is held', async () => {
    const idle = fakeServer();
    await start(idle, null);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(idle.read).not.toHaveBeenCalled();
  });

  it('no answer: keeps the email and tries again after the backoff, then saves', async () => {
    vi.useFakeTimers();
    const add = vi.fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue({ status: 'pending', addressMask: 's***@example.com' });
    const deps = fakeServer({ add });
    await start(deps);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(add).toHaveBeenCalledTimes(1);
    expect(heldEmailNow()).toBe('sea@example.com');
    expect(h.setKeepSafeOffer).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(HELD_EMAIL_RETRY_MS[0] + 10); });
    expect(add).toHaveBeenCalledTimes(2);
    expect(heldEmailNow()).toBeNull();
    expect(h.setKeepSafeOffer).toHaveBeenCalledWith('done');
  });

  it('a refused address is dropped and not retried', async () => {
    vi.useFakeTimers();
    const add = vi.fn().mockRejectedValue(new (ApiError as any)(400, { error: 'invalid_email' }));
    await start(fakeServer({ add }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(heldEmailNow()).toBeNull();
    expect(h.setKeepSafeOffer).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(HELD_EMAIL_RETRY_MS[0] * 3); });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('a server error (503) keeps the email and retries later', async () => {
    vi.useFakeTimers();
    const add = vi.fn().mockRejectedValue(new (ApiError as any)(503, { error: 'not_configured' }));
    await start(fakeServer({ add }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(heldEmailNow()).toBe('sea@example.com');
    await act(async () => { await vi.advanceTimersByTimeAsync(HELD_EMAIL_RETRY_MS[0] + 10); });
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('if the phone becomes another spotter mid-run, nothing is applied', async () => {
    let release!: (v: { status: 'pending'; addressMask: string }) => void;
    const add = vi.fn(() => new Promise<{ status: 'pending'; addressMask: string }>((res) => { release = res; }));
    const deps = fakeServer({ add });
    await start(deps);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    h.gen += 1; // "Delete my data", "Start again" or a restore
    await act(async () => { release({ status: 'pending', addressMask: 's***@example.com' }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(h.setKeepSafeOffer).not.toHaveBeenCalled();
    expect(heldEmailNow()).toBe('sea@example.com');
  });
});
