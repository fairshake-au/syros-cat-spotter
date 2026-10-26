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

import { AppMap, cellBounds, cellBox } from '../AppMap.web';
import {
  MAPLIBRE_STYLE_ID,
  _resetMapLibreLoaderForTests,
  _setMapLibreImporterForTests,
} from '../map/useMapLibre.web';
import { fromMapLibreZoom, toWorld } from '@/lib/mercator';
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

describe('AppMap.web taps and drags reach the map', () => {
  const c = { latitude: 37.44, longitude: 24.94 };
  const dLat = 250 / 2 / METRES_PER_DEGREE_LAT;

  async function mountOne(onPress = vi.fn()) {
    // latitudeDelta 0.005 starts at app zoom 15, where the square is wide enough for its label.
    render(
      <AppMap
        {...base}
        latitudeDelta={0.005}
        areas={[area('a', c.latitude, c.longitude, { accessibilityLabel: 'A', label: '3 cats', onPress })]}
      />,
    );
    const map = await theMap();
    await screen.findByLabelText('A');
    return { map, onPress };
  }

  it('squares and their labels are pointer-transparent, so drags, pinches and wheel go to the map', async () => {
    await mountOne();
    const overlay = square('A').parentElement as HTMLElement;
    expect(getComputedStyle(overlay).pointerEvents).toBe('none');
    const label = screen.getByText('3 cats').parentElement as HTMLElement;
    expect(getComputedStyle(label).pointerEvents).toBe('none');
    // Still a focusable button for keyboards and screen readers.
    expect(square('A').getAttribute('role')).toBe('button');
    expect(square('A').tabIndex).toBe(0);
  });

  it('a label-only square (the cat page\'s "Somewhere in here") lets drags through its label too', async () => {
    // A disabled Pressable is box-none, which sets its children back to
    // pointer-events: auto unless they say otherwise.
    render(
      <AppMap
        {...base}
        latitudeDelta={0.005}
        areas={[area('a', c.latitude, c.longitude, { label: 'Somewhere in here' })]}
      />,
    );
    await theMap();
    const label = (await screen.findByText('Somewhere in here')).parentElement as HTMLElement;
    expect(getComputedStyle(label).pointerEvents).toBe('none');
    const fill = label.previousElementSibling as HTMLElement;
    expect(getComputedStyle(fill).pointerEvents).toBe('none');
  });

  it("a map click inside a square presses it; outside it doesn't", async () => {
    const { map, onPress } = await mountOne();
    act(() => {
      map.fire('click', { lngLat: { lng: c.longitude, lat: c.latitude + dLat * 0.9 } });
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    act(() => {
      map.fire('click', { lngLat: { lng: c.longitude, lat: c.latitude + dLat * 1.2 } });
      map.fire('click', { point: { x: 5, y: 5 } });
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('the topmost pressable square takes the click; a label-only square on top does not block it', async () => {
    const under = vi.fn();
    const over = vi.fn();
    render(
      <AppMap
        {...base}
        areas={[
          area('a', c.latitude, c.longitude, { accessibilityLabel: 'A', onPress: under }),
          area('b', c.latitude, c.longitude, { accessibilityLabel: 'B', onPress: over }),
          area('c', c.latitude, c.longitude, { accessibilityLabel: 'C' }),
        ]}
      />,
    );
    const map = await theMap();
    act(() => {
      map.fire('click', { lngLat: { lng: c.longitude, lat: c.latitude } });
    });
    expect(over).toHaveBeenCalledTimes(1);
    expect(under).not.toHaveBeenCalled();
  });

  it('a drag over a square never presses it', async () => {
    const { map, onPress } = await mountOne();
    const centre = map.project([c.longitude, c.latitude]);
    act(() => {
      map.fire('mousedown', { point: centre });
      map.fire('dragstart');
      map.panBy([40, 30]);
      map.fire('drag');
      map.fire('dragend');
      map.fire('mouseup', { point: centre });
      map.fire('touchstart', { point: centre });
      map.fire('touchend', { point: centre });
    });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows a pointer cursor over a pressable square', async () => {
    const { map } = await mountOne();
    act(() => {
      map.fire('mousemove', { lngLat: { lng: c.longitude, lat: c.latitude } });
    });
    expect(map.getCanvas().style.cursor).toBe('pointer');
    act(() => {
      map.fire('mousemove', { point: { x: 5, y: 5 } });
    });
    expect(map.getCanvas().style.cursor).toBe('');
  });

  it('keyboard: the square is still a native button, which the browser clicks on Enter/Space', async () => {
    // react-native-web renders role=button as <button> and leaves Enter/Space to
    // the browser's own click (jsdom doesn't synthesise it), so a click stands in.
    const { onPress } = await mountOne();
    expect(square('A').tagName).toBe('BUTTON');
    expect((square('A') as HTMLButtonElement).disabled).toBe(false);
    act(() => {
      square('A').focus();
      fireEvent.click(square('A'));
    });
    expect(document.activeElement).toBe(square('A'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('AppMap.web rotation', () => {
  it('a compass button appears once the map is turned, and turns it back to north', async () => {
    render(<AppMap {...base} areas={[]} />);
    const map = await theMap();
    expect(screen.queryByLabelText('mapResetNorth')).toBeNull();
    act(() => {
      map.setBearing(30);
    });
    const compass = await screen.findByLabelText('mapResetNorth');
    expect(getComputedStyle(compass).width).toBe('44px');
    expect(getComputedStyle(compass).height).toBe('44px');
    act(() => {
      fireEvent.click(compass);
    });
    expect(map.callsTo('easeTo')).toEqual([[{ bearing: 0 }]]);
    expect(map.getBearing()).toBe(0);
    await waitFor(() => expect(screen.queryByLabelText('mapResetNorth')).toBeNull());
  });

  it('the controls are drawn above the cat strip, so the compass stays tappable on a short map', async () => {
    render(
      <AppMap
        {...base}
        areas={[]}
        markers={[{ id: '1', latitude: 37.44, longitude: 24.94, title: 'Agatha' }]}
      />,
    );
    const map = await theMap();
    act(() => {
      map.setBearing(30);
    });
    const compass = await screen.findByLabelText('mapResetNorth');
    const controls = compass.parentElement as HTMLElement;
    const chip = screen.getByText('Agatha');
    // The strip's scroll area: the element holding the chip that is a sibling of the controls.
    let stripEl: HTMLElement = chip;
    while (stripEl.parentElement && stripEl.parentElement !== controls.parentElement) stripEl = stripEl.parentElement;
    expect(stripEl).not.toBe(controls);
    // Later in the page than the strip, and with an explicit stacking level.
    expect(stripEl.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(controls).zIndex).toBe('1');
  });

  it('no compass on a non-interactive map', async () => {
    render(<AppMap {...base} areas={[]} interactive={false} />);
    const map = await theMap();
    act(() => {
      map.setBearing(45);
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByLabelText('mapResetNorth')).toBeNull();
  });

  it('on a turned map the square turns with it and "3 cats" stays upright', async () => {
    const c = { latitude: 37.44, longitude: 24.94 };
    render(
      <AppMap
        {...base}
        latitudeDelta={0.005}
        areas={[area('a', c.latitude, c.longitude, { accessibilityLabel: 'A', label: '3 cats' })]}
      />,
    );
    const map = await theMap();
    act(() => {
      map.setBearing(180);
    });
    await waitFor(() => {
      const fill = square('A').firstElementChild as HTMLElement;
      expect(fill.style.transform).toMatch(/rotate\(/);
    });
    const label = screen.getByText('3 cats').parentElement as HTMLElement;
    expect(label.style.transform).toBe('');
    // The box is centred on the cell.
    const s = square('A').style;
    const centre = map.project([c.longitude, c.latitude]);
    expect(px(s.left) + px(s.width) / 2).toBeCloseTo(centre.x, 1);
    expect(px(s.top) + px(s.height) / 2).toBeCloseTo(centre.y, 1);
  });
});

describe('cellBox on a rotated map', () => {
  const centre = { latitude: 37.44, longitude: 24.94 };
  const Z = 17;
  /** A project() that turns the map by `deg` (MapLibre bearing) about (195, 300). */
  const rotatingProject = (deg: number) => {
    const b = (deg * Math.PI) / 180;
    const o = toWorld(centre, Z);
    return {
      project: ([lng, lat]: [number, number]) => {
        const p = toWorld({ latitude: lat, longitude: lng }, Z);
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        return { x: dx * Math.cos(b) + dy * Math.sin(b) + 195, y: -dx * Math.sin(b) + dy * Math.cos(b) + 300 };
      },
    };
  };
  /** The corners of a CSS box rotated clockwise by `angle` about its centre. */
  const boxCorners = (box: ReturnType<typeof cellBox>) => {
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const at = (x: number, y: number) => ({
      x: cx + x * Math.cos(box.angle) - y * Math.sin(box.angle),
      y: cy + x * Math.sin(box.angle) + y * Math.cos(box.angle),
    });
    const w = box.width / 2;
    const h = box.height / 2;
    return { nw: at(-w, -h), ne: at(w, -h), sw: at(-w, h), se: at(w, h) };
  };

  for (const deg of [30, 180]) {
    it(`puts the rotated box's corners on the projected corners at ${deg}°`, () => {
      const map = rotatingProject(deg);
      const b = cellBounds({ id: 'a', ...centre, sizeMetres: 250 });
      const box = cellBox(map as never, b);
      expect(box.angle).not.toBe(0);
      const got = boxCorners(box);
      const want = {
        nw: map.project([b.west, b.north]),
        ne: map.project([b.east, b.north]),
        sw: map.project([b.west, b.south]),
        se: map.project([b.east, b.south]),
      };
      for (const k of ['nw', 'ne', 'sw', 'se'] as const) {
        expect(got[k].x).toBeCloseTo(want[k].x, 6);
        expect(got[k].y).toBeCloseTo(want[k].y, 6);
      }
    });
  }
});

describe('AppMap.web squares stay in step with their areas', () => {
  it('new areas are placed in the same render, and inline areas never re-subscribe', async () => {
    const mk = (lat: number) => [area('x', lat, 24.94, { accessibilityLabel: 'X' })];
    const { rerender } = render(<AppMap {...base} areas={mk(37.44)} />);
    const map = await theMap();
    await screen.findByLabelText('X');
    const subscriptions = map.callsTo('on').length;
    rerender(<AppMap {...base} areas={mk(37.441)} />);
    // No waiting: the moved square is already where the map draws it.
    const dLat = 250 / 2 / METRES_PER_DEGREE_LAT;
    const dLng = dLat / Math.cos((37.441 * Math.PI) / 180);
    const nw = map.project([24.94 - dLng, 37.441 + dLat]);
    expect(px(square('X').style.top)).toBeCloseTo(nw.y, 1);
    expect(px(square('X').style.left)).toBeCloseTo(nw.x, 1);
    rerender(<AppMap {...base} areas={mk(37.441)} />);
    expect(map.callsTo('on').length).toBe(subscriptions);
    expect(map.callsTo('off')).toHaveLength(0);
  });
});
