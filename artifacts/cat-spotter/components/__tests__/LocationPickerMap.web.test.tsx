// @vitest-environment jsdom
/**
 * SYC-705: the web "where was the cat?" picker on MapLibre. The pin stays in
 * the middle; the parent hears the new centre once per user move (a drag's
 * 'moveend', a tap's recentre), never for the picker's own moves when the
 * parent changes `latitude`/`longitude`. Without WebGL the page stays usable
 * through "Use where I am now".
 *
 * A user move is faked the way MapLibre reports one: camera events that
 * carry `originalEvent`.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeMap,
  lastMap,
  makeMapConstructorThrow,
  resetMaplibreFake,
  setWebGLSupported,
} from '../map/__mocks__/maplibreFake';

vi.mock('maplibre-gl', async () => (await import('../map/__mocks__/maplibreFake')).maplibreModule);
vi.mock('pmtiles', async () => (await import('../map/__mocks__/maplibreFake')).pmtilesModule);
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => `t:${key}`, language: 'en' }),
}));
vi.mock('@/lib/mapSource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mapSource')>()),
  useMapVersion: () => 1,
}));

import { LocationPicker } from '../LocationPicker.web';
import {
  MAPLIBRE_STYLE_ID,
  _resetMapLibreLoaderForTests,
  _setMapLibreImporterForTests,
} from '../map/useMapLibre.web';
import { fromMapLibreZoom } from '@/lib/mercator';

const realGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

beforeEach(() => {
  resetMaplibreFake();
  _resetMapLibreLoaderForTests();
  document.getElementById(MAPLIBRE_STYLE_ID)?.remove();
});
afterEach(() => {
  cleanup();
  if (realGeolocation) Object.defineProperty(navigator, 'geolocation', realGeolocation);
  else delete (navigator as { geolocation?: unknown }).geolocation;
});

const START = { latitude: 37.4448, longitude: 24.9425 };
const ELSEWHERE = { lng: 24.95, lat: 37.45 };
/** What MapLibre puts on events a person caused. */
const userEvent = () => ({ originalEvent: new MouseEvent('mouseup') });

async function theMap(): Promise<FakeMap> {
  await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
  const map = lastMap() as FakeMap;
  await waitFor(() => expect(map.listenerCount('moveend')).toBeGreaterThan(0));
  return map;
}

function stubGeolocation(
  impl: (ok: PositionCallback, fail: PositionErrorCallback) => void,
): ReturnType<typeof vi.fn> {
  const getCurrentPosition = vi.fn(impl);
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

describe('SYC-705: the web picker on MapLibre', () => {
  it('starts on the given spot at app zoom 17 (MapLibre 16), with rotation and MapLibre keys off', async () => {
    render(<LocationPicker {...START} onChange={() => {}} />);
    const map = await theMap();
    expect(map.options.center).toEqual([START.longitude, START.latitude]);
    expect(map.options.zoom).toBe(16);
    expect(fromMapLibreZoom(map.getZoom())).toBe(17);
    expect(map.options.interactive).toBe(true);
    expect(map.dragRotate.isEnabled()).toBe(false);
    expect(map.touchZoomRotate.rotationEnabled).toBe(false);
    expect(map.keyboard.isEnabled()).toBe(false);
  });

  it('a drag reports the new centre once, on release', async () => {
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    const map = await theMap();
    act(() => {
      // movestart, move and moveend all carry the drag's originalEvent.
      map.jumpTo({ center: ELSEWHERE }, userEvent());
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ latitude: ELSEWHERE.lat, longitude: ELSEWHERE.lng });
    // The readout follows.
    expect(screen.getByText('37.45000, 24.95000')).toBeTruthy();
  });

  it('a zoom without a move (pinch at the centre, the zoom buttons) reports nothing', async () => {
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    const map = await theMap();
    act(() => {
      map.jumpTo({ zoom: 17 }, userEvent());
    });
    fireEvent.click(screen.getByRole('button', { name: 't:mapZoomIn' }));
    expect(fromMapLibreZoom(map.getZoom())).toBe(19);
    fireEvent.click(screen.getByRole('button', { name: 't:mapZoomOut' }));
    expect(fromMapLibreZoom(map.getZoom())).toBe(18);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a tap brings the tapped spot to the pin, then reports it once', async () => {
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    const map = await theMap();
    act(() => {
      map.fire('click', { lngLat: ELSEWHERE, ...userEvent() });
    });
    const eases = map.callsTo('easeTo');
    expect(eases).toHaveLength(1);
    expect((eases[0]![0] as { center: unknown }).center).toEqual(ELSEWHERE);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ latitude: ELSEWHERE.lat, longitude: ELSEWHERE.lng });
  });

  it('props recentre does not call onChange', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<LocationPicker {...START} onChange={onChange} />);
    const map = await theMap();
    const zoomBefore = map.getZoom();
    // A fresh GPS fix from the parent.
    rerender(<LocationPicker latitude={ELSEWHERE.lat} longitude={ELSEWHERE.lng} onChange={onChange} />);
    expect(map.getCenter()).toEqual(ELSEWHERE);
    expect(map.getZoom()).toBe(zoomBefore);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('37.45000, 24.95000')).toBeTruthy();
  });

  it('a camera move nobody made reports nothing', async () => {
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    const map = await theMap();
    act(() => {
      // No originalEvent and not the picker's own key or tap move.
      map.setCenter(ELSEWHERE);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores the echo of its own onChange', async () => {
    let parent = { ...START };
    const onChange = vi.fn((next: typeof START) => {
      parent = next;
    });
    const { rerender } = render(<LocationPicker {...parent} onChange={onChange} />);
    const map = await theMap();
    act(() => {
      map.jumpTo({ center: ELSEWHERE }, userEvent());
    });
    const movesBefore = map.calls.length;
    rerender(<LocationPicker {...parent} onChange={onChange} />);
    expect(map.calls.slice(movesBefore).map((c) => c.method)).not.toContain('jumpTo');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('the pin, the readout and the credit let drags through to the map', async () => {
    render(<LocationPicker {...START} onChange={() => {}} />);
    await theMap();
    const readout = screen.getByText('37.44480, 24.94250');
    expect(getComputedStyle(readout).pointerEvents).toBe('none');
    const credit = screen.getByText('© OpenStreetMap contributors');
    expect(getComputedStyle(credit).pointerEvents).toBe('none');
    const pin = screen.getByTestId('location-picker-pin');
    expect(getComputedStyle(pin).pointerEvents).toBe('none');
    for (const child of Array.from(pin.children)) {
      expect(getComputedStyle(child).pointerEvents).toBe('none');
    }
  });
});

describe('SYC-705: no WebGL keeps the picker usable', () => {
  it('no WebGL shows Use where I am now', async () => {
    setWebGLSupported(false);
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 37.441, longitude: 24.946 } } as GeolocationPosition),
    );
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    expect(await screen.findByText('t:mapNoWebgl')).toBeTruthy();
    expect(FakeMap.instances).toHaveLength(0);
    // No map to zoom.
    expect(screen.queryByRole('button', { name: 't:mapZoomIn' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 't:claimUseHere' }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ latitude: 37.441, longitude: 24.946 }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText('37.44100, 24.94600')).toBeTruthy();
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
  });

  it('a map that fails to start also offers Use where I am now', async () => {
    makeMapConstructorThrow();
    render(<LocationPicker {...START} onChange={() => {}} />);
    expect(await screen.findByText('t:mapNoWebgl')).toBeTruthy();
    expect(screen.getByRole('button', { name: 't:claimUseHere' })).toBeTruthy();
  });

  it('a failed download says so and offers Use where I am now', async () => {
    _setMapLibreImporterForTests(() => Promise.reject(new Error('chunk failed')));
    render(<LocationPicker {...START} onChange={() => {}} />);
    expect(await screen.findByText('t:mapLoadFailed')).toBeTruthy();
    expect(screen.queryByText('t:mapNoWebgl')).toBeNull();
    expect(screen.getByRole('button', { name: 't:claimUseHere' })).toBeTruthy();
  });

  it('location refused: says so, reports nothing', async () => {
    setWebGLSupported(false);
    stubGeolocation((_ok, fail) => fail({ code: 1, message: 'denied' } as GeolocationPositionError));
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 't:claimUseHere' }));
    expect(await screen.findByText('t:mapLocOffWeb')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('no geolocation in the browser: says so, reports nothing', async () => {
    setWebGLSupported(false);
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 't:claimUseHere' }));
    expect(await screen.findByText('t:mapLocOffWeb')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
