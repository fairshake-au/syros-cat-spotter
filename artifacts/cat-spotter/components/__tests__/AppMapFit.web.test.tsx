// @vitest-environment jsdom
/**
 * SYC-573: the web map fits to its areas once per `fitKey`, without
 * remounting; new data, rerenders and a moved `latitude`/`longitude` alone
 * never refit. Squares carry accessibility labels; "N cats" hides while the
 * square is under 40 px wide; the strip can start with a "Show all" chip.
 *
 * SYC-705: the map is MapLibre now (the test double in components/map/__mocks__).
 * Zoom is read from the fake's camera (MapLibre scale, converted back to the
 * app's with fromMapLibreZoom); cells are DOM overlays placed with map.project.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('@/lib/mapSource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mapSource')>()),
  useMapVersion: () => 1,
}));

import { AppMap } from '../AppMap.web';
import {
  MAPLIBRE_STYLE_ID,
  _resetMapLibreLoaderForTests,
  _setMapLibreImporterForTests,
} from '../map/useMapLibre.web';
import { fromMapLibreZoom } from '@/lib/mercator';
import { LABEL_MIN_PX } from '@/lib/cellShape';

beforeAll(() => {
  class RO {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb([{ target, contentRect: { width: 390, height: 600 } } as never], this as never);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', RO);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 390 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 390, height: 600, top: 0, left: 0, right: 390, bottom: 600, x: 0, y: 0 }) as DOMRect;
});
beforeEach(() => {
  resetMaplibreFake();
  _resetMapLibreLoaderForTests();
  document.getElementById(MAPLIBRE_STYLE_ID)?.remove();
});
afterEach(cleanup);

const area = (id: string, lat: number, lng: number, extra: object = {}) => ({
  id,
  latitude: lat,
  longitude: lng,
  sizeMetres: 250,
  ...extra,
});

const METRES_PER_DEGREE_LAT = 111_320;

/**
 * The map, once the component has it: created, and AppMap's own effects have
 * run with it (its squares listen for 'move').
 */
async function theMap(): Promise<FakeMap> {
  await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
  const map = lastMap() as FakeMap;
  await waitFor(() => expect(map.listenerCount('move')).toBeGreaterThan(0));
  return map;
}

/** The map's zoom on the app's scale (the old tile zoom). */
const appZoom = () => fromMapLibreZoom((lastMap() as FakeMap).getZoom());

/** Fits are the jumpTo calls that set a zoom. */
const fits = () =>
  (lastMap() as FakeMap)
    .callsTo('jumpTo')
    .filter(([o]) => (o as { zoom?: number }).zoom !== undefined);

/** The rendered square for an area, found by its accessibility label. */
const square = (label: string) => screen.getByLabelText(label) as HTMLElement;

const px = (v: string) => Number.parseFloat(v);

const base = { latitude: 37.44, longitude: 24.94, markers: [] };

describe('AppMap.web fit', () => {
  it('fits to the areas on first measure, and not again on new data', async () => {
    const one = [area('a', 37.4448, 24.9425)];
    const { rerender } = render(<AppMap {...base} areas={one} fitKey="all|" />);
    await theMap();
    await waitFor(() => expect(appZoom()).toBe(16));
    expect(fits()).toHaveLength(1);
    // The fit goes to MapLibre on its own scale, through toMapLibreZoom.
    expect((fits()[0]![0] as { zoom: number }).zoom).toBe(15);
    rerender(
      <AppMap {...base} areas={[area('a', 37.42, 24.92), area('b', 37.47, 24.99)]} fitKey="all|" />,
    );
    expect(appZoom()).toBe(16);
    expect(fits()).toHaveLength(1);
  });

  it('refits without remounting when fitKey changes', async () => {
    const { rerender } = render(<AppMap {...base} areas={[area('a', 37.44, 24.94)]} fitKey="all|" />);
    const map = await theMap();
    await waitFor(() => expect(appZoom()).toBe(16));
    const surface = screen.getByLabelText('map');
    rerender(
      <AppMap
        {...base}
        areas={[area('a', 37.4, 24.9), area('b', 37.5, 25.0)]}
        fitKey="homed|"
      />,
    );
    expect(screen.getByLabelText('map')).toBe(surface);
    await waitFor(() => expect(appZoom()).toBeLessThan(16));
    expect(lastMap()).toBe(map);
    expect(FakeMap.instances).toHaveLength(1);
  });

  it('recentres without changing zoom when only the parent centre (a location fix) changes', async () => {
    const areas = [area('a', 37.44, 24.94)];
    const { rerender } = render(<AppMap {...base} areas={areas} fitKey="all|" />);
    const map = await theMap();
    await waitFor(() => expect(appZoom()).toBe(16));
    rerender(<AppMap {...base} latitude={37.9} longitude={25.5} areas={areas} fitKey="all|" />);
    expect(appZoom()).toBe(16);
    expect(fits()).toHaveLength(1);
    expect(map.getCenter().lat).toBeCloseTo(37.9, 6);
    expect(map.getCenter().lng).toBeCloseTo(25.5, 6);
  });

  it('keeps the given view when there are no areas', async () => {
    render(<AppMap {...base} areas={[]} fitKey="all|" />);
    const map = await theMap();
    expect(appZoom()).toBe(12);
    expect(map.options.zoom).toBe(11);
    expect(map.options.center).toEqual([24.94, 37.44]);
    expect(fits()).toHaveLength(0);
  });
});

describe('AppMap.web map options', () => {
  it('rotates, takes the keyboard, and is interactive by default (the cat page map, SYC-707)', async () => {
    render(<AppMap {...base} areas={[]} />);
    const map = await theMap();
    expect(map.options.interactive).toBe(true);
    expect(map.callsTo('dragRotate.disable')).toHaveLength(0);
    expect(map.callsTo('touchZoomRotate.disableRotation')).toHaveLength(0);
    expect(map.callsTo('keyboard.disable')).toHaveLength(0);
    expect(screen.getByLabelText('mapZoomIn')).toBeTruthy();
  });

  it('interactive={false} turns off every map handler and hides the zoom buttons', async () => {
    render(<AppMap {...base} areas={[]} interactive={false} />);
    const map = await theMap();
    expect(map.options.interactive).toBe(false);
    expect(screen.queryByLabelText('mapZoomIn')).toBeNull();
    expect(screen.queryByLabelText('mapZoomOut')).toBeNull();
  });

  it('zoom buttons are 44 px, translated, and ease the map one step', async () => {
    render(<AppMap {...base} areas={[]} />);
    const map = await theMap();
    const zoomIn = screen.getByLabelText('mapZoomIn');
    const zoomOut = screen.getByLabelText('mapZoomOut');
    for (const b of [zoomIn, zoomOut]) {
      const s = getComputedStyle(b);
      expect(s.width).toBe('44px');
      expect(s.height).toBe('44px');
    }
    act(() => {
      fireEvent.click(zoomIn);
    });
    expect(map.callsTo('easeTo')).toEqual([[{ zoom: 12 }]]);
    act(() => {
      fireEvent.click(zoomOut);
    });
    expect(map.callsTo('easeTo')[1]).toEqual([{ zoom: 11 }]);
  });

  it('keeps the OpenStreetMap credit', () => {
    render(<AppMap {...base} areas={[]} />);
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
  });
});

describe('AppMap.web areas and strip', () => {
  it('gives every square an accessibility label', async () => {
    render(
      <AppMap
        {...base}
        fitKey="k"
        areas={[
          area('a', 37.44, 24.94, { accessibilityLabel: 'Agatha’s area' }),
          area('b', 37.45, 24.95, { accessibilityLabel: 'Area with 3 cats', label: '3 cats' }),
        ]}
      />,
    );
    expect(await screen.findByLabelText('Agatha’s area')).toBeTruthy();
    expect(screen.getByLabelText('Area with 3 cats')).toBeTruthy();
  });

  it('presses a square', async () => {
    const onPress = vi.fn();
    render(
      <AppMap {...base} fitKey="k" areas={[area('a', 37.44, 24.94, { accessibilityLabel: 'A', onPress })]} />,
    );
    const el = await screen.findByLabelText('A');
    act(() => {
      fireEvent.click(el);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows "3 cats" on a wide square and hides it on a narrow one', async () => {
    const shared = [area('b', 37.45, 24.95, { label: '3 cats', accessibilityLabel: 'x' })];
    const { unmount } = render(<AppMap {...base} areas={shared} fitKey="k" />);
    expect(await screen.findByText('3 cats')).toBeTruthy();
    unmount();
    // Two far-apart cells force a low zoom, so each square is narrow.
    render(
      <AppMap
        {...base}
        fitKey="k"
        areas={[shared[0]!, area('c', 37.3, 24.8), area('d', 37.6, 25.2)]}
      />,
    );
    await theMap();
    await waitFor(() => expect(appZoom()).toBe(12));
    await waitFor(() => expect(px(square('x').style.width)).toBeLessThan(LABEL_MIN_PX));
    expect(screen.queryByText('3 cats')).toBeNull();
  });

  it('cell box follows map.project after move and zoom', async () => {
    const c = { latitude: 37.44, longitude: 24.94 };
    render(<AppMap {...base} areas={[area('a', c.latitude, c.longitude, { accessibilityLabel: 'A' })]} />);
    const map = await theMap();
    const dLat = 250 / 2 / METRES_PER_DEGREE_LAT;
    const dLng = dLat / Math.cos((c.latitude * Math.PI) / 180);
    const expectBoxAtProjection = async () => {
      const nw = map.project([c.longitude - dLng, c.latitude + dLat]);
      const se = map.project([c.longitude + dLng, c.latitude - dLat]);
      await waitFor(() => {
        const s = square('A').style;
        expect(px(s.left)).toBeCloseTo(nw.x, 1);
        expect(px(s.top)).toBeCloseTo(nw.y, 1);
        expect(px(s.width)).toBeCloseTo(se.x - nw.x, 1);
        expect(px(s.height)).toBeCloseTo(se.y - nw.y, 1);
      });
      return { nw, se };
    };
    const first = await expectBoxAtProjection();

    // A drag: the map pans and fires 'move'.
    act(() => {
      map.panBy([120, -80]);
    });
    const moved = await expectBoxAtProjection();
    expect(moved.nw.x).toBeCloseTo(first.nw.x - 120, 1);
    expect(moved.nw.y).toBeCloseTo(first.nw.y + 80, 1);

    // A zoom: the square doubles in size.
    act(() => {
      map.setZoom(map.getZoom() + 1);
    });
    const zoomed = await expectBoxAtProjection();
    expect(zoomed.se.x - zoomed.nw.x).toBeCloseTo(2 * (moved.se.x - moved.nw.x), 1);
    expect(map.rejected).toEqual([]);
  });

  it('shows a Show all chip at the start of the strip and presses it', () => {
    const onPress = vi.fn();
    render(
      <AppMap
        {...base}
        areas={[area('a', 37.44, 24.94)]}
        markers={[{ id: '1', latitude: 37.44, longitude: 24.94, title: 'Agatha' }]}
        stripAction={{ label: 'Show all', onPress }}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByText('Show all'));
    });
    expect(onPress).toHaveBeenCalled();
  });

  it('shows the strip only when there are markers', () => {
    const { unmount } = render(
      <AppMap {...base} areas={[]} stripAction={{ label: 'Show all', onPress: () => {} }} />,
    );
    expect(screen.queryByText('Show all')).toBeNull();
    unmount();
    const onPress = vi.fn();
    render(
      <AppMap
        {...base}
        areas={[]}
        markers={[{ id: '1', latitude: 37.44, longitude: 24.94, title: 'Agatha', onPress }]}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByText('Agatha'));
    });
    expect(onPress).toHaveBeenCalled();
  });
});

describe('AppMap.web when the map cannot draw', () => {
  const strip = {
    markers: [{ id: '1', latitude: 37.44, longitude: 24.94, title: 'Agatha' }],
  };

  it('no WebGL shows message and keeps the strip', async () => {
    setWebGLSupported(false);
    const onPress = vi.fn();
    const onChip = vi.fn();
    render(
      <AppMap
        {...base}
        {...strip}
        markers={[{ ...strip.markers[0]!, onPress: onChip }]}
        areas={[area('a', 37.44, 24.94, { accessibilityLabel: 'A' })]}
        fitKey="k"
        stripAction={{ label: 'Show all', onPress }}
      />,
    );
    expect(await screen.findByText('mapNoWebgl')).toBeTruthy();
    expect(FakeMap.instances).toHaveLength(0);
    // No map, so no zoom buttons and no squares floating over nothing.
    expect(screen.queryByLabelText('mapZoomIn')).toBeNull();
    expect(screen.queryByLabelText('A')).toBeNull();
    act(() => {
      fireEvent.click(screen.getByText('Show all'));
      fireEvent.click(screen.getByText('Agatha'));
    });
    expect(onPress).toHaveBeenCalled();
    expect(onChip).toHaveBeenCalled();
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
  });

  it('a map that fails to start also shows the no-WebGL message', async () => {
    makeMapConstructorThrow();
    render(<AppMap {...base} {...strip} areas={[]} />);
    expect(await screen.findByText('mapNoWebgl')).toBeTruthy();
    expect(screen.getByText('Agatha')).toBeTruthy();
  });

  it('a failed download shows the load-failed message and keeps the strip', async () => {
    _setMapLibreImporterForTests(() => Promise.reject(new Error('chunk failed')));
    const onPress = vi.fn();
    render(<AppMap {...base} {...strip} areas={[]} stripAction={{ label: 'Show all', onPress }} />);
    expect(await screen.findByText('mapLoadFailed')).toBeTruthy();
    expect(screen.queryByText('mapNoWebgl')).toBeNull();
    act(() => {
      fireEvent.click(screen.getByText('Show all'));
    });
    expect(onPress).toHaveBeenCalled();
  });
});
