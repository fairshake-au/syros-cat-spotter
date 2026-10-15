// @vitest-environment jsdom
/**
 * SYC-36 (match-wait plan PR 2): the hook that decides, once, what the first
 * result screen shows, counts it in the phone's record, and opens the
 * counting address on "Help feed a cat".
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  openURL: vi.fn(async (_url: string) => undefined),
  settings: { loaded: true, linkOn: true, hiddenFacts: [] as string[] },
  signals: { status: 'known', hasClaimedCat: false, firstSpotDate: null } as unknown,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => void h.storage.set(k, v),
  },
}));
vi.mock('react-native', () => ({ Linking: { openURL: h.openURL } }));
vi.mock('@/lib/urls', () => ({ apiOrigin: () => 'https://api.example' }));
vi.mock('@/context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: h.settings, signals: h.signals, donateHost: 'syroscats.com', noteSent: () => undefined }),
}));

import { useResultNudge } from '../useResultNudge';
import { emptyRecord, type WaitingRecord } from '@/lib/waitingCard';
import { waitingCardKey } from '@/lib/waitingCardStore';

const KEY = waitingCardKey('dev-a');
const record = (): WaitingRecord => JSON.parse(h.storage.get(KEY)!);
const put = (r: WaitingRecord) => h.storage.set(KEY, JSON.stringify(r));

beforeEach(() => {
  h.storage.clear();
  h.openURL.mockClear();
});

describe('useResultNudge', () => {
  it('shows the nudge carried from the wait, and counts it', async () => {
    put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
    const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
    await waitFor(() => expect(result.current.show).toEqual({ kind: 'nudge', form: 'link' }));
    expect(record().nudgeCounted).toBe(true);
    expect(record().pendingResult).toBeNull();
  });

  it('decides once: a re-render with other props changes nothing', async () => {
    put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
    const { result, rerender } = renderHook((p: { screen: 'matches' | 'naming' }) =>
      useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: p.screen }), { initialProps: { screen: 'matches' } });
    await waitFor(() => expect(result.current.show).not.toBeNull());
    rerender({ screen: 'naming' });
    expect(result.current.show).toEqual({ kind: 'nudge', form: 'link' });
  });

  it('a queued sighting (localId) shows nothing and leaves the record alone', async () => {
    const r = { ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link' as const, countable: true } };
    put(r);
    const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, localId: 'q1', screen: 'matches' }));
    await new Promise((res) => setTimeout(res, 20));
    expect(result.current.show).toBeNull();
    expect(record()).toEqual(r);
  });

  it('no stored record: nothing shows and nothing is written', async () => {
    const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
    await new Promise((res) => setTimeout(res, 20));
    expect(result.current.show).toBeNull();
    expect(h.storage.has(KEY)).toBe(false);
  });

  it('Help feed a cat hides it, opens the counting address and marks the tap', async () => {
    put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
    const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
    await waitFor(() => expect(result.current.show).not.toBeNull());
    act(() => result.current.help());
    expect(result.current.show).toBeNull();
    expect(h.openURL).toHaveBeenCalledWith('https://api.example/api/go/feed');
    await waitFor(() => expect(record().tapped).toBe(true));
  });

  it('Got it hides it and marks nothing', async () => {
    put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
    const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
    await waitFor(() => expect(result.current.show).not.toBeNull());
    act(() => result.current.dismiss());
    expect(result.current.show).toBeNull();
    expect(record().tapped).toBe(false);
    expect(h.openURL).not.toHaveBeenCalled();
  });
});
