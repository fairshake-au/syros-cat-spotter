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
  settings: { loaded: true, linkOn: true, hiddenFacts: [] as string[], extraPhotosOn: false },
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
import { FACT_IDS } from '@/lib/starterFacts';

const KEY = waitingCardKey('dev-a');
const record = (): WaitingRecord => JSON.parse(h.storage.get(KEY)!);
const put = (r: WaitingRecord) => h.storage.set(KEY, JSON.stringify(r));

beforeEach(() => {
  h.storage.clear();
  h.openURL.mockReset().mockResolvedValue(undefined);
  h.signals = { status: 'known', hasClaimedCat: false, firstSpotDate: null };
});

describe('useResultNudge', () => {
  it('shows the nudge carried from the wait, and counts it', async () => {
    put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
    const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
    await waitFor(() => expect(result.current.show).toEqual({ kind: 'nudge', form: 'link' }));
    expect(record().nudgeCounted).toBe(true);
    expect(record().pendingResult).toBeNull();
  });

  it('decides once, as soon as the phone\'s id is known (it may arrive after the screen opens)', async () => {
    put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
    const { result, rerender } = renderHook((p: { deviceId: string | null }) =>
      useResultNudge({ deviceId: p.deviceId, sightingId: 5, screen: 'matches' }), { initialProps: { deviceId: null as string | null } });
    await new Promise((res) => setTimeout(res, 20));
    expect(result.current.show).toBeNull();
    rerender({ deviceId: 'dev-a' });
    await waitFor(() => expect(result.current.show).toEqual({ kind: 'nudge', form: 'link' }));
    // A later change of id doesn't decide again, even with a pending result there.
    const KEY_B = waitingCardKey('dev-b');
    const pendingB = JSON.stringify({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
    h.storage.set(KEY_B, pendingB);
    rerender({ deviceId: 'dev-b' });
    await new Promise((res) => setTimeout(res, 20));
    expect(h.storage.get(KEY_B)).toBe(pendingB);
  });

  it('a change of sighting on the same screen doesn\'t decide again', async () => {
    put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: null, countable: false } });
    const { result, rerender } = renderHook((p: { sightingId: number }) =>
      useResultNudge({ deviceId: 'dev-a', sightingId: p.sightingId, screen: 'matches' }), { initialProps: { sightingId: 5 } });
    await waitFor(() => expect(record().pendingResult).toBeNull());
    put({ ...emptyRecord(), pendingResult: { sightingId: 6, nudge: 'link', countable: true } });
    const before = h.storage.get(KEY);
    rerender({ sightingId: 6 });
    await new Promise((res) => setTimeout(res, 20));
    expect(result.current.show).toBeNull();
    expect(h.storage.get(KEY)).toBe(before);
  });

  it('waits for the sighting id too, then decides', async () => {
    put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
    const { result, rerender } = renderHook((p: { sightingId: number | null }) =>
      useResultNudge({ deviceId: 'dev-a', sightingId: p.sightingId, screen: 'matches' }), { initialProps: { sightingId: null as number | null } });
    await new Promise((res) => setTimeout(res, 20));
    expect(result.current.show).toBeNull();
    expect(record().pendingResult).not.toBeNull();
    rerender({ sightingId: 5 });
    await waitFor(() => expect(result.current.show).toEqual({ kind: 'nudge', form: 'link' }));
  });

  it('a visitor on a later day gets the one-liner, and the day is used up', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    put({ ...emptyRecord(), nudgeCounted: true, nudgeCountedDay: '2026-01-01', lastLineDay: yesterday, pendingResult: { sightingId: 6, nudge: null, countable: false } });
    h.signals = { status: 'known', hasClaimedCat: false, firstSpotDate: null };
    const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 6, screen: 'naming' }));
    await waitFor(() => expect(result.current.show).toEqual({ kind: 'line' }));
    expect(record().lastLineDay).not.toBe(yesterday);
  });

  it('the no-cat screen shows nothing and uses up the pending result', async () => {
    put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
    const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'notCat' }));
    await waitFor(() => expect(record().pendingResult).toBeNull());
    expect(result.current.show).toBeNull();
    expect(record().nudgeCounted).toBe(false);
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

  it('a browser that fails to open doesn\'t count as a tap', async () => {
    put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
    h.openURL.mockRejectedValueOnce(new Error('no browser'));
    const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
    await waitFor(() => expect(result.current.show).not.toBeNull());
    act(() => result.current.help());
    await new Promise((res) => setTimeout(res, 20));
    expect(record().tapped).toBe(false);
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

  // SYC-772 spec §3.3 / §5.1: the thanks-screen line, from the same single read.
  describe('nextSpotBringsNewFact', () => {
    const counted = { nudgeCounted: true, nudgeCountedDay: '2026-01-01' };

    it('starts false', () => {
      const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: null, screen: 'matches' }));
      expect(result.current.nextSpotBringsNewFact).toBe(false);
    });

    it('is true when a fact is still unseen', async () => {
      put({ ...emptyRecord(), ...counted, everSeen: [FACT_IDS[0]!] });
      const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
      await waitFor(() => expect(result.current.nextSpotBringsNewFact).toBe(true));
    });

    it('reflects the record after the nudge is counted (was due, now is not)', async () => {
      put({ ...emptyRecord(), pendingResult: { sightingId: 5, nudge: 'link', countable: true } });
      const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
      await waitFor(() => expect(result.current.nextSpotBringsNewFact).toBe(true));
      expect(record().nudgeCounted).toBe(true);
    });

    it('is false when the next wait would be the nudge', async () => {
      // Nothing pending, nudge never counted: the nudge is still due.
      put({ ...emptyRecord() });
      const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
      await new Promise((res) => setTimeout(res, 20));
      expect(result.current.nextSpotBringsNewFact).toBe(false);
    });

    it('is false when everything has been seen', async () => {
      put({ ...emptyRecord(), ...counted, everSeen: [...FACT_IDS] });
      const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
      await new Promise((res) => setTimeout(res, 20));
      expect(result.current.show).toBeNull();
      expect(result.current.nextSpotBringsNewFact).toBe(false);
    });

    it('is false when the record can\'t be read', async () => {
      const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
      await new Promise((res) => setTimeout(res, 20));
      expect(result.current.nextSpotBringsNewFact).toBe(false);
    });

    it('gives the same answer for a spot kept at send and one saved for later as for a live send', async () => {
      put({ ...emptyRecord(), ...counted, everSeen: [FACT_IDS[0]!] });
      const live = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, screen: 'matches' }));
      const kept = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, localId: 'q1', keptAtSend: true, screen: 'matches' }));
      const later = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, localId: 'q2', screen: 'matches' }));
      await waitFor(() => expect(live.result.current.nextSpotBringsNewFact).toBe(true));
      await waitFor(() => expect(kept.result.current.nextSpotBringsNewFact).toBe(true));
      await waitFor(() => expect(later.result.current.nextSpotBringsNewFact).toBe(true));
    });

    it('reads the record once and saves nothing extra', async () => {
      const r = { ...emptyRecord(), ...counted, everSeen: [FACT_IDS[0]!] };
      put(r);
      const { result } = renderHook(() => useResultNudge({ deviceId: 'dev-a', sightingId: 5, localId: 'q2', screen: 'matches' }));
      await waitFor(() => expect(result.current.nextSpotBringsNewFact).toBe(true));
      expect(record()).toEqual(r);
    });
  });
});
