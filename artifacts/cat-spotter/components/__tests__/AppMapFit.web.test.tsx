// @vitest-environment jsdom
/**
 * SYC-573: the web map fits to its areas once per `fitKey`, without
 * remounting; new data, rerenders and a moved `latitude`/`longitude` alone
 * never refit. Squares carry accessibility labels; "N cats" hides while the
 * square is under 40 px wide; the strip can start with a "Show all" chip.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));

import { AppMap } from '../AppMap.web';

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
afterEach(cleanup);

const area = (id: string, lat: number, lng: number, extra: object = {}) => ({
  id,
  latitude: lat,
  longitude: lng,
  sizeMetres: 250,
  ...extra,
});

const tileZoom = () => {
  const src = document.querySelector('img')?.getAttribute('src') ?? '';
  const m = src.match(/openstreetmap\.org\/(\d+)\//);
  return m ? Number(m[1]) : null;
};

const base = { latitude: 37.44, longitude: 24.94, markers: [] };

describe('AppMap.web fit', () => {
  it('fits to the areas on first measure, and not again on new data', async () => {
    const one = [area('a', 37.4448, 24.9425)];
    const { rerender } = render(<AppMap {...base} areas={one} fitKey="all|" />);
    await waitFor(() => expect(tileZoom()).toBe(16));
    rerender(
      <AppMap {...base} areas={[area('a', 37.42, 24.92), area('b', 37.47, 24.99)]} fitKey="all|" />,
    );
    expect(tileZoom()).toBe(16);
  });

  it('refits without remounting when fitKey changes', async () => {
    const { rerender } = render(<AppMap {...base} areas={[area('a', 37.44, 24.94)]} fitKey="all|" />);
    await waitFor(() => expect(tileZoom()).toBe(16));
    const surface = screen.getByLabelText('map');
    rerender(
      <AppMap
        {...base}
        areas={[area('a', 37.4, 24.9), area('b', 37.5, 25.0)]}
        fitKey="homed|"
      />,
    );
    expect(screen.getByLabelText('map')).toBe(surface);
    await waitFor(() => expect(tileZoom()).toBeLessThan(16));
  });

  it('does not move when only the parent centre (a location fix) changes', async () => {
    const areas = [area('a', 37.44, 24.94)];
    const { rerender } = render(<AppMap {...base} areas={areas} fitKey="all|" />);
    await waitFor(() => expect(tileZoom()).toBe(16));
    rerender(<AppMap {...base} latitude={37.9} longitude={25.5} areas={areas} fitKey="all|" />);
    expect(tileZoom()).toBe(16);
  });

  it('keeps the given view when there are no areas', async () => {
    render(<AppMap {...base} areas={[]} fitKey="all|" />);
    // Wait for the tiles themselves, not a fixed delay: under the full suite's
    // load a 50 ms sleep sometimes ran before the first tile rendered (null).
    await waitFor(() => expect(tileZoom()).not.toBeNull());
    expect(tileZoom()).toBe(12);
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
    await waitFor(() => expect(tileZoom()).toBe(12));
    expect(screen.queryByText('3 cats')).toBeNull();
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
});
