// @vitest-environment jsdom
/**
 * SYC-705: where the website learns the map host and the current map version.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAP_FALLBACK_VERSION,
  MAP_HOST,
  _resetMapVersionForTests,
  mapUrls,
  useMapVersion,
} from '../mapSource';

const fetchMock = vi.fn();

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  _resetMapVersionForTests();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('mapUrls', () => {
  it('builds the exact URLs for a version', () => {
    expect(MAP_HOST).toBe('https://tiles.catspotters.com');
    expect(mapUrls(3)).toEqual({
      pmtilesUrl: 'pmtiles://https://tiles.catspotters.com/v3/syros.pmtiles',
      glyphsUrl: 'https://tiles.catspotters.com/v3/fonts/{fontstack}/{range}.pbf',
      spriteUrl: 'https://tiles.catspotters.com/v3/sprites/light',
    });
  });
});

describe('useMapVersion', () => {
  it('returns the fallback at once, then the fetched version', async () => {
    fetchMock.mockResolvedValue(ok({ version: 4 }));
    const { result } = renderHook(() => useMapVersion());
    expect(result.current).toBe(MAP_FALLBACK_VERSION);
    await waitFor(() => expect(result.current).toBe(4));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://tiles.catspotters.com/current.json',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('once the version is known, a later mount starts on it at once', async () => {
    fetchMock.mockResolvedValue(ok({ version: 3 }));
    const a = renderHook(() => useMapVersion());
    await waitFor(() => expect(a.result.current).toBe(3));
    const b = renderHook(() => useMapVersion());
    expect(b.result.current).toBe(3);
  });

  it('reads current.json once per visit', async () => {
    fetchMock.mockResolvedValue(ok({ version: 2 }));
    const a = renderHook(() => useMapVersion());
    const b = renderHook(() => useMapVersion());
    await waitFor(() => expect(a.result.current).toBe(2));
    await waitFor(() => expect(b.result.current).toBe(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['network failure', () => fetchMock.mockRejectedValue(new Error('offline'))],
    ['404', () => fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })],
    ['string version', () => fetchMock.mockResolvedValue(ok({ version: 'x' }))],
    ['zero', () => fetchMock.mockResolvedValue(ok({ version: 0 }))],
    ['negative', () => fetchMock.mockResolvedValue(ok({ version: -2 }))],
    ['fraction', () => fetchMock.mockResolvedValue(ok({ version: 1.5 }))],
    ['bad JSON', () => fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad'); } })],
  ])('falls back on %s', async (_name, setup) => {
    setup();
    const { result } = renderHook(() => useMapVersion());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(MAP_FALLBACK_VERSION);
  });

  it('aborts after 5 seconds and keeps the fallback', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    );
    const { result } = renderHook(() => useMapVersion());
    await vi.advanceTimersByTimeAsync(5001);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(result.current).toBe(MAP_FALLBACK_VERSION);
  });
});
