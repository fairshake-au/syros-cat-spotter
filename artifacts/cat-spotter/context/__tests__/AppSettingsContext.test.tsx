// @vitest-environment jsdom
/**
 * SYC-36 / SYC-48 (match-wait plan PR 1): the switches and this phone's
 * resident signals. Asked again on foreground, on reconnect, after a claim
 * and on a device id change; a claim counts at once; a refusal means
 * "unknown"; no answer or a 5xx keeps the last answer; a new device id
 * forgets the old one's signals, in memory and on the phone.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  appStateListeners: [] as ((s: string) => void)[],
  netListeners: [] as ((s: { isConnected: boolean }) => void)[],
  device: { deviceId: 'dev-a' as string | null, ownedCatIds: [] as number[] },
  getAppSettings: vi.fn(),
  getSpotterSignals: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => void h.storage.set(k, v),
  },
}));
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_: string, cb: (s: string) => void) => {
      h.appStateListeners.push(cb);
      return { remove: () => undefined };
    },
  },
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: (cb: (s: { isConnected: boolean }) => void) => {
      h.netListeners.push(cb);
      return () => undefined;
    },
  },
}));
vi.mock('@workspace/api-client-react', () => {
  class ApiError extends Error {
    constructor(readonly status: number) {
      super(`HTTP ${status}`);
    }
  }
  return { ApiError, getAppSettings: h.getAppSettings, getSpotterSignals: h.getSpotterSignals };
});
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => h.device }));

import { ApiError } from '@workspace/api-client-react';
import { AppSettingsProvider, useAppSettings } from '../AppSettingsContext';
import { APP_SETTINGS_STORAGE_KEY } from '@/lib/appSettings';

const wrapper = ({ children }: { children: React.ReactNode }) => <AppSettingsProvider>{children}</AppSettingsProvider>;
const SETTINGS = { feedNudge: { donateHost: 'syroscats.com' }, hiddenFacts: ['fact.cost'] };
const KNOWN = { hasClaimedCat: false, firstSpotDate: '2026-07-01' };
const saved = () => JSON.parse(h.storage.get(APP_SETTINGS_STORAGE_KEY) ?? 'null');
const apiError = (status: number) => new (ApiError as unknown as new (s: number) => Error)(status);

beforeEach(() => {
  h.storage.clear();
  h.appStateListeners.length = 0;
  h.netListeners.length = 0;
  h.device = { deviceId: 'dev-a', ownedCatIds: [] };
  h.getAppSettings.mockReset().mockResolvedValue(SETTINGS);
  h.getSpotterSignals.mockReset().mockResolvedValue(KNOWN);
});

describe('AppSettingsProvider', () => {
  it('loads the switches and this phone\'s signals at start, and keeps them on the phone', async () => {
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.signals.status).toBe('known'));
    expect(result.current.settings).toEqual({ loaded: true, linkOn: true, hiddenFacts: ['fact.cost'] });
    expect(result.current.donateHost).toBe('syroscats.com');
    expect(saved().signalsFor).toBe('dev-a');
  });

  it('before anything loads: link off, nothing hidden (Decision 4), signals unknown', () => {
    h.getAppSettings.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    expect(result.current.settings).toEqual({ loaded: false, linkOn: false, hiddenFacts: [] });
    expect(result.current.signals).toEqual({ status: 'unknown' });
  });

  it.each([401, 403, 410, 429])('a %i for the signals means unknown', async (status) => {
    h.getSpotterSignals.mockRejectedValue(apiError(status));
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(saved()?.signalsFor).toBe('dev-a'));
    expect(result.current.signals).toEqual({ status: 'unknown' });
  });

  it('no answer, or a 5xx, keeps the last known answer', async () => {
    h.storage.set(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ settings: { loaded: true, linkOn: true, hiddenFacts: [] }, donateHost: 'syroscats.com', signalsFor: 'dev-a', signals: { status: 'known', ...KNOWN } }),
    );
    h.getAppSettings.mockRejectedValue(new TypeError('Failed to fetch'));
    h.getSpotterSignals.mockRejectedValueOnce(apiError(503)).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.signals.status).toBe('known'));
    await act(async () => h.appStateListeners.forEach((l) => l('active')));
    await waitFor(() => expect(h.getSpotterSignals).toHaveBeenCalledTimes(2));
    expect(result.current.signals.status).toBe('known');
    expect(saved().signals.status).toBe('known');
  });

  it('asks again on foreground and when the connection comes back, not on every network change', async () => {
    renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(h.getSpotterSignals).toHaveBeenCalledTimes(1));
    await act(async () => h.appStateListeners.forEach((l) => l('active')));
    await waitFor(() => expect(h.getSpotterSignals).toHaveBeenCalledTimes(2));
    // Connected → connected (a signal-strength change): nothing.
    await act(async () => h.netListeners.forEach((l) => l({ isConnected: true })));
    await act(async () => h.netListeners.forEach((l) => l({ isConnected: true })));
    expect(h.getSpotterSignals).toHaveBeenCalledTimes(2);
    // Offline, then back: once.
    await act(async () => h.netListeners.forEach((l) => l({ isConnected: false })));
    await act(async () => h.netListeners.forEach((l) => l({ isConnected: true })));
    await waitFor(() => expect(h.getSpotterSignals).toHaveBeenCalledTimes(3));
  });

  it('a claim counts at once, and the server is asked again', async () => {
    const { result, rerender } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.signals.status).toBe('known'));
    h.device = { deviceId: 'dev-a', ownedCatIds: [7] };
    rerender();
    expect(result.current.signals).toMatchObject({ status: 'known', hasClaimedCat: true });
    await waitFor(() => expect(h.getSpotterSignals).toHaveBeenCalledTimes(2));
  });

  it('a new device id forgets the old signals at once, in memory and on the phone', async () => {
    const { result, rerender } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(saved()?.signalsFor).toBe('dev-a'));
    h.getSpotterSignals.mockRejectedValue(new TypeError('Failed to fetch'));
    h.device = { deviceId: 'dev-b', ownedCatIds: [] };
    rerender();
    expect(result.current.signals).toEqual({ status: 'unknown' });
    await waitFor(() => expect(saved().signalsFor).toBeNull());
    expect(JSON.stringify(saved())).not.toContain('dev-a');
  });

  it('a first send gives a known phone today\'s date; an unknown one asks the server', async () => {
    h.getSpotterSignals.mockResolvedValue({ hasClaimedCat: false, firstSpotDate: null });
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.signals.status).toBe('known'));
    act(() => result.current.noteSent());
    expect(result.current.signals).toMatchObject({ firstSpotDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });

    h.getSpotterSignals.mockReset().mockRejectedValueOnce(apiError(403)).mockResolvedValue(KNOWN);
    h.device = { deviceId: 'dev-new', ownedCatIds: [] };
    const second = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(h.getSpotterSignals).toHaveBeenCalledTimes(1));
    await act(async () => second.result.current.noteSent());
    await waitFor(() => expect(second.result.current.signals.status).toBe('known'));
  });

  it('one fetch at a time', async () => {
    let release!: () => void;
    h.getAppSettings.mockReturnValue(new Promise((r) => (release = () => r(SETTINGS))));
    renderHook(() => useAppSettings(), { wrapper });
    await act(async () => h.appStateListeners.forEach((l) => l('active')));
    await act(async () => h.appStateListeners.forEach((l) => l('active')));
    expect(h.getAppSettings).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it('a device id that changes during a fetch still gets its own answer (asked again when the fetch ends)', async () => {
    let releaseA!: (v: unknown) => void;
    h.getSpotterSignals.mockImplementation((id: string) =>
      id === 'dev-a' ? new Promise((r) => (releaseA = r)) : Promise.resolve(KNOWN),
    );
    const { result, rerender } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(h.getSpotterSignals).toHaveBeenCalledWith('dev-a'));
    h.device = { deviceId: 'dev-b', ownedCatIds: [] };
    rerender();
    await act(async () => releaseA(KNOWN));
    await waitFor(() => expect(h.getSpotterSignals).toHaveBeenCalledWith('dev-b'));
    await waitFor(() => expect(result.current.signals.status).toBe('known'));
    expect(saved().signalsFor).toBe('dev-b');
  });

  it('a first send while a refusal is in flight asks once more, and the bound phone gets known signals', async () => {
    let releaseFirst!: (e: unknown) => void;
    h.getSpotterSignals
      .mockImplementationOnce(() => new Promise((_, rej) => (releaseFirst = rej)))
      .mockResolvedValue(KNOWN);
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(h.getSpotterSignals).toHaveBeenCalledTimes(1));
    act(() => result.current.noteSent());
    await act(async () => releaseFirst(apiError(403)));
    await waitFor(() => expect(h.getSpotterSignals).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.signals.status).toBe('known'));
  });

  it('a slow settings answer never saves over signals that arrived meanwhile', async () => {
    let releaseSettings!: (v: unknown) => void;
    h.getAppSettings.mockReturnValueOnce(new Promise((r) => (releaseSettings = r)));
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    // The claim lands while the settings are still on their way.
    await act(async () => releaseSettings(SETTINGS));
    await waitFor(() => expect(result.current.signals.status).toBe('known'));
    await waitFor(() => expect(saved().settings.loaded).toBe(true));
    expect(saved().signals.status).toBe('known');
    expect(saved().signalsFor).toBe('dev-a');
  });

  it('a saved copy read late never replaces what was fetched, and another id\'s saved signals are dropped', async () => {
    h.storage.set(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ settings: { loaded: true, linkOn: false, hiddenFacts: [] }, donateHost: null, signalsFor: 'dev-old', signals: { status: 'known', hasClaimedCat: true, firstSpotDate: '2026-01-01' } }),
    );
    h.getSpotterSignals.mockRejectedValue(new TypeError('Failed to fetch'));
    h.getAppSettings.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    // The saved switches are used (offline), but dev-old's signals are not dev-a's.
    await waitFor(() => expect(result.current.settings.loaded).toBe(true));
    expect(result.current.signals).toEqual({ status: 'unknown' });
    await waitFor(() => expect(JSON.stringify(saved())).not.toContain('dev-old'));
  });
});
