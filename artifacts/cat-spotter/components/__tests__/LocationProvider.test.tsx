// @vitest-environment jsdom
/**
 * SYC-524: one shared LocationProvider. It never asks for location on mount,
 * reads the position only when permission is already granted, and
 * askAndLocate() is the single way the phone's/browser's location box comes
 * up. Every consumer sees the same permission and coordinates.
 */
import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  platform: 'ios' as string,
  storage: new Map<string, string>(),
  appStateListeners: [] as ((s: string) => void)[],
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => void h.storage.set(k, v),
    removeItem: async (k: string) => void h.storage.delete(k),
  },
}));
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return h.platform;
    },
  },
  AppState: {
    addEventListener: (_: string, cb: (s: string) => void) => {
      h.appStateListeners.push(cb);
      return { remove: () => undefined };
    },
  },
}));
vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: h.getForegroundPermissionsAsync,
  requestForegroundPermissionsAsync: h.requestForegroundPermissionsAsync,
  getLastKnownPositionAsync: h.getLastKnownPositionAsync,
  getCurrentPositionAsync: h.getCurrentPositionAsync,
}));

import { LocationProvider, useAppLocation } from '../../context/LocationContext';
import { LOCATION_CHOICE_KEY } from '@/lib/locationChoice';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocationProvider>{children}</LocationProvider>
);
const FIX = { coords: { latitude: 37.44, longitude: 24.94 } };
const UNDETERMINED = { status: 'undetermined', canAskAgain: true };
const GRANTED = { status: 'granted', canAskAgain: true };
const DENIED_FINAL = { status: 'denied', canAskAgain: false };

const settle = () => act(async () => {});

beforeEach(() => {
  h.platform = 'ios';
  h.storage.clear();
  h.appStateListeners.length = 0;
  h.getForegroundPermissionsAsync.mockReset().mockResolvedValue(UNDETERMINED);
  h.requestForegroundPermissionsAsync.mockReset().mockResolvedValue(GRANTED);
  h.getLastKnownPositionAsync.mockReset().mockResolvedValue(null);
  h.getCurrentPositionAsync.mockReset().mockResolvedValue(FIX);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LocationProvider (native)', () => {
  it('never asks on mount', async () => {
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    expect(h.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(h.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.coords).toBeNull();
    expect(result.current.permission).toBe('not-asked');
    expect(result.current.denied).toBe(false);
  });

  it('treats a permission read that throws as not-asked', async () => {
    h.getForegroundPermissionsAsync.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    expect(result.current.permission).toBe('not-asked');
    expect(result.current.loading).toBe(false);
  });

  it('reads the position on mount when already granted', async () => {
    h.getForegroundPermissionsAsync.mockResolvedValue(GRANTED);
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await waitFor(() => expect(result.current.coords).toEqual(FIX.coords));
    expect(result.current.permission).toBe('granted');
    expect(h.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('reads the remembered choice on mount', async () => {
    h.storage.set(LOCATION_CHOICE_KEY, 'map');
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await waitFor(() => expect(result.current.choice).toBe('map'));
  });

  it('askAndLocate grants and shares with every consumer', async () => {
    const seen: { a?: ReturnType<typeof useAppLocation>; b?: ReturnType<typeof useAppLocation> } = {};
    const A = () => {
      seen.a = useAppLocation();
      return null;
    };
    const B = () => {
      seen.b = useAppLocation();
      return null;
    };
    render(
      <LocationProvider>
        <A />
        <B />
      </LocationProvider>,
    );
    await settle();
    let returned: unknown;
    await act(async () => {
      returned = await seen.a!.askAndLocate();
    });
    expect(returned).toEqual(FIX.coords);
    for (const c of [seen.a!, seen.b!]) {
      expect(c.coords).toEqual(FIX.coords);
      expect(c.permission).toBe('granted');
      expect(c.choice).toBe('shared');
      expect(c.denied).toBe(false);
      expect(c.loading).toBe(false);
    }
    expect(h.storage.get(LOCATION_CHOICE_KEY)).toBe('shared');
    expect(h.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('askAndLocate refused', async () => {
    h.requestForegroundPermissionsAsync.mockResolvedValue(DENIED_FINAL);
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    let returned: unknown = 'unset';
    await act(async () => {
      returned = await result.current.askAndLocate();
    });
    expect(returned).toBeNull();
    expect(result.current.permission).toBe('denied-final');
    expect(result.current.denied).toBe(true);
    expect(result.current.coords).toBeNull();
    expect(h.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(h.storage.has(LOCATION_CHOICE_KEY)).toBe(false);
  });

  it('askAndLocate timeout', async () => {
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    h.getCurrentPositionAsync.mockReturnValue(new Promise(() => undefined));
    vi.useFakeTimers();
    let returned: unknown = 'unset';
    await act(async () => {
      const p = result.current.askAndLocate();
      await vi.advanceTimersByTimeAsync(15000);
      returned = await p;
    });
    expect(returned).toBeNull();
    expect(result.current.denied).toBe(true);
    expect(result.current.coords).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(h.storage.has(LOCATION_CHOICE_KEY)).toBe(false);
  });

  it('a cached fix within 5 minutes is shown while the fresh one is awaited', async () => {
    h.getLastKnownPositionAsync.mockResolvedValue({ coords: { latitude: 1, longitude: 2 } });
    h.getCurrentPositionAsync.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    vi.useFakeTimers();
    await act(async () => {
      const p = result.current.askAndLocate();
      await vi.advanceTimersByTimeAsync(15000);
      await p;
    });
    expect(h.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: 5 * 60 * 1000 });
    expect(result.current.coords).toEqual({ latitude: 1, longitude: 2 });
    expect(result.current.denied).toBe(false);
  });

  it('chooseMap remembers the map choice', async () => {
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    act(() => result.current.chooseMap());
    await waitFor(() => expect(h.storage.get(LOCATION_CHOICE_KEY)).toBe('map'));
    expect(result.current.choice).toBe('map');
  });

  it('re-reads permission on return to the app', async () => {
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    expect(result.current.coords).toBeNull();
    // The spotter turned location on in Settings and came back.
    h.getForegroundPermissionsAsync.mockResolvedValue(GRANTED);
    await act(async () => {
      h.appStateListeners.forEach((cb) => cb('active'));
    });
    await waitFor(() => expect(result.current.coords).toEqual(FIX.coords));
    expect(result.current.permission).toBe('granted');
    expect(h.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('ignores app state changes other than active', async () => {
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    h.getForegroundPermissionsAsync.mockClear();
    await act(async () => {
      h.appStateListeners.forEach((cb) => cb('background'));
    });
    expect(h.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(result.current.permission).toBe('not-asked');
  });
});

describe('LocationProvider (web)', () => {
  let getCurrentPosition: ReturnType<typeof vi.fn>;
  let permissionState: string;

  beforeEach(() => {
    h.platform = 'web';
    permissionState = 'prompt';
    getCurrentPosition = vi.fn((ok: (p: unknown) => void) => ok(FIX));
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
    Object.defineProperty(navigator, 'permissions', {
      value: { query: async () => ({ state: permissionState }) },
      configurable: true,
    });
  });

  it('never prompts on mount', async () => {
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(result.current.permission).toBe('not-asked');
    expect(result.current.loading).toBe(false);
  });

  it('reads the position on mount when the browser already allows it', async () => {
    permissionState = 'granted';
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await waitFor(() => expect(result.current.coords).toEqual(FIX.coords));
    expect(result.current.permission).toBe('granted');
  });

  it('askAndLocate prompts through getCurrentPosition, then re-reads permission', async () => {
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    permissionState = 'granted';
    await act(async () => {
      await result.current.askAndLocate();
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(result.current.coords).toEqual(FIX.coords);
    expect(result.current.permission).toBe('granted');
    expect(h.storage.get(LOCATION_CHOICE_KEY)).toBe('shared');
  });

  it('askAndLocate refused: permission becomes denied-final', async () => {
    getCurrentPosition.mockImplementation((_ok: unknown, fail: (e: unknown) => void) =>
      fail({ code: 1 }),
    );
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    permissionState = 'denied';
    let returned: unknown = 'unset';
    await act(async () => {
      returned = await result.current.askAndLocate();
    });
    expect(returned).toBeNull();
    expect(result.current.permission).toBe('denied-final');
    expect(result.current.denied).toBe(true);
    expect(result.current.coords).toBeNull();
  });

  it('askAndLocate timeout sets denied without changing the stored choice', async () => {
    getCurrentPosition.mockImplementation((_ok: unknown, fail: (e: unknown) => void) =>
      fail({ code: 3 }),
    );
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    await act(async () => {
      await result.current.askAndLocate();
    });
    expect(result.current.denied).toBe(true);
    expect(h.storage.has(LOCATION_CHOICE_KEY)).toBe(false);
  });

  it('re-reads permission when the page becomes visible again', async () => {
    const { result } = renderHook(() => useAppLocation(), { wrapper });
    await settle();
    expect(result.current.coords).toBeNull();
    permissionState = 'granted';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current.coords).toEqual(FIX.coords));
    expect(result.current.permission).toBe('granted');
  });
});
