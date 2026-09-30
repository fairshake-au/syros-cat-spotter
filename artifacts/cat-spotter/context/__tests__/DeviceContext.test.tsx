// @vitest-environment jsdom
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getItem, setItem } = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));

const { setDeviceSecretGetter, getProfile } = vi.hoisted(() => ({
  setDeviceSecretGetter: vi.fn(),
  getProfile: vi.fn(async () => ({ ownedCatIds: [] })),
}));

vi.mock('@workspace/api-client-react', () => ({
  setDeviceSecretGetter,
  getProfile,
}));

import { DeviceProvider, useDevice } from '@/context/DeviceContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DeviceProvider>{children}</DeviceProvider>
);

function lastRegisteredGetter(): () => string | null {
  expect(setDeviceSecretGetter).toHaveBeenCalled();
  const calls = setDeviceSecretGetter.mock.calls;
  return calls[calls.length - 1][0];
}

// SYC-92: POST /api/sightings now requires the device secret. The offline
// queue's syncNow (OfflineContext.tsx) is gated on `deviceId` being set
// before it will fire a request at all. That guard only protects a queued
// upload if the secret getter registered by DeviceContext is *already
// live* by the time a consumer can observe a non-null deviceId — otherwise
// a request could go out with no X-Device-Secret header, get a 401, and
// classifySyncFailure (offlineQueue.ts) marks any 4xx a *permanent* error:
// a sighting that silently stops retrying. These tests lock in that
// ordering so a future refactor of DeviceContext can't quietly break it.
describe('DeviceProvider — secret-before-deviceId ordering (SYC-92)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getItem.mockResolvedValue(null);
  });

  it('registers a live secret getter before a fresh device id becomes visible', async () => {
    const { result } = renderHook(() => useDevice(), { wrapper });

    await waitFor(() => expect(result.current.deviceId).not.toBeNull());

    // The getter registered by the time deviceId is visible must already
    // return a real, non-empty secret — not undefined/null, which is what
    // it would return if registration happened after (or raced with)
    // deviceId becoming available.
    const getter = lastRegisteredGetter();
    const secret = getter();
    expect(typeof secret).toBe('string');
    expect(secret).not.toBe('');
  });

  it('restores an existing device id and its previously-stored secret together, not id-then-secret', async () => {
    getItem.mockImplementation(async (key: string) => {
      if (key === 'cat-spotter/device-id') return 'dev-existing';
      if (key === 'cat-spotter/device-secret') return 'sec-existing-stored';
      return null;
    });

    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.deviceId).toBe('dev-existing'));

    const getter = lastRegisteredGetter();
    expect(getter()).toBe('sec-existing-stored');
  });

  it('mints and persists a new secret for a device with an id but no stored secret yet (pre-device-secret-era install)', async () => {
    getItem.mockImplementation(async (key: string) => {
      if (key === 'cat-spotter/device-id') return 'dev-preexisting-no-secret';
      return null; // no device-secret key at all
    });

    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() =>
      expect(result.current.deviceId).toBe('dev-preexisting-no-secret'),
    );

    const getter = lastRegisteredGetter();
    const secret = getter();
    expect(typeof secret).toBe('string');
    expect(secret).not.toBe('');
    // TOFU-bound on the server: a device from before this feature existed
    // is never locked out, it just binds a secret on its first request.
    expect(setItem).toHaveBeenCalledWith('cat-spotter/device-secret', secret);
  });
});

// SYC-136: makeDeviceSecret()/makeDeviceId() used to build randomness from
// Math.random(), which is not a secure source — an attacker who could
// predict or narrow it down could forge the X-Device-Secret header for a
// device they don't own. Both now derive from a cryptographically secure
// source (crypto.getRandomValues in these tests, since vitest resolves
// 'react-native' to 'react-native-web' — Platform.OS is 'web').
describe('DeviceProvider — cryptographically random secret and id (SYC-136)', () => {
  const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

  beforeEach(() => {
    vi.clearAllMocks();
    getItem.mockResolvedValue(null);
  });

  it('mints a new-install secret as 32 bytes of base64url, never touching Math.random', async () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');

    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.deviceId).not.toBeNull());

    const getter = lastRegisteredGetter();
    const secret = getter();

    expect(typeof secret).toBe('string');
    expect(secret).toMatch(BASE64URL_RE);
    // 32 random bytes as unpadded base64url is 43 characters
    // (ceil(32/3) * 4 groups, minus the final group's padding).
    expect(secret).toHaveLength(43);
    expect(mathRandomSpy).not.toHaveBeenCalled();

    mathRandomSpy.mockRestore();
  });

  it('mints a new-install device id in the existing dev-<random> shape, never touching Math.random', async () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');

    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.deviceId).not.toBeNull());

    expect(result.current.deviceId).toMatch(/^dev-[a-z0-9]+$/);
    expect(mathRandomSpy).not.toHaveBeenCalled();

    mathRandomSpy.mockRestore();
  });

  // Deliberate break, per SYC-136's test plan: if makeDeviceSecret ever
  // regresses to Math.random(), the spy assertion above must go red. This
  // test proves that by inverting the assertion against a Math.random-based
  // stand-in generator — it should fail (call count > 0) exactly the way
  // the real regression would.
  it('would fail the Math.random spy assertion if the generator regressed to Math.random (self-check)', async () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');

    function insecureDeviceSecret(): string {
      let secret = '';
      while (secret.length < 32) {
        secret += Math.random().toString(36).slice(2);
      }
      return secret.slice(0, 32);
    }
    insecureDeviceSecret();

    expect(mathRandomSpy).toHaveBeenCalled();
    expect(() => expect(mathRandomSpy).not.toHaveBeenCalled()).toThrow();

    mathRandomSpy.mockRestore();
  });
});
