// @vitest-environment jsdom
/**
 * SYC-509: the web location picker has a non-drag way to place the pin.
 * The map surface takes keyboard focus, arrow keys move the map under the
 * fixed pin (reporting the new centre), and the zoom buttons are labelled
 * in the app's language and at least 44 px.
 *
 * SYC-705: the map is MapLibre now (the test double in components/map/__mocks__).
 * The keys are ours, not MapLibre's: arrows call map.panBy and the picker
 * reports the centre from the 'moveend' that follows.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMap, lastMap, resetMaplibreFake } from '../map/__mocks__/maplibreFake';

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
import { MAPLIBRE_STYLE_ID, _resetMapLibreLoaderForTests } from '../map/useMapLibre.web';
import { fromMapLibreZoom } from '@/lib/mercator';

beforeEach(() => {
  resetMaplibreFake();
  _resetMapLibreLoaderForTests();
  document.getElementById(MAPLIBRE_STYLE_ID)?.remove();
});
afterEach(cleanup);

const START = { latitude: 37.4448, longitude: 24.9425 };

/** The map, once the picker holds it (it listens for 'moveend'). */
async function theMap(): Promise<FakeMap> {
  await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
  const map = lastMap() as FakeMap;
  await waitFor(() => expect(map.listenerCount('moveend')).toBeGreaterThan(0));
  return map;
}

describe('SYC-509: keyboard alternative to dragging the web map', () => {
  it('is focusable and labelled with how to use it', () => {
    render(<LocationPicker {...START} onChange={() => {}} />);
    const surface = screen.getByLabelText('t:mapPickerLabel');
    expect(surface.getAttribute('tabindex')).toBe('0');
    // Without a role, many screen readers ignore the label on a plain div.
    expect(surface.getAttribute('role')).toBe('application');
  });

  it("turns MapLibre's own keys off and keeps one tab stop", async () => {
    render(<LocationPicker {...START} onChange={() => {}} />);
    const map = await theMap();
    expect(map.keyboard.isEnabled()).toBe(false);
    // MapLibre's canvas would be a second, unlabelled tab stop.
    expect(map.getCanvas().getAttribute('tabindex')).toBe('-1');
  });

  it('adds up quick repeated key presses before a re-render', async () => {
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    await theMap();
    const surface = screen.getByLabelText('t:mapPickerLabel');
    fireEvent.keyDown(surface, { key: 'ArrowUp' });
    fireEvent.keyDown(surface, { key: 'ArrowUp' });
    const [first, second] = onChange.mock.calls.map((c) => c[0].latitude);
    expect(second).toBeGreaterThan(first);
  });

  it('arrow keys move the pin the way a drag would, one report per press', async () => {
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    const map = await theMap();
    const surface = screen.getByLabelText('t:mapPickerLabel');

    fireEvent.keyDown(surface, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledTimes(1);
    const north = onChange.mock.calls[0][0];
    expect(north.latitude).toBeGreaterThan(START.latitude);
    expect(north.longitude).toBeCloseTo(START.longitude, 9);

    fireEvent.keyDown(surface, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledTimes(2);
    const east = onChange.mock.calls[1][0];
    expect(east.longitude).toBeGreaterThan(START.longitude);

    // KEY_STEP is 32 px; Shift moves four times as far.
    fireEvent.keyDown(surface, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(surface, { key: 'ArrowLeft' });
    const offsets = map.callsTo('panBy').map(([o]) => o);
    expect(offsets).toEqual([
      [0, -32],
      [32, 0],
      [0, 128],
      [-32, 0],
    ]);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('ignores other keys', async () => {
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    const map = await theMap();
    fireEvent.keyDown(screen.getByLabelText('t:mapPickerLabel'), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
    expect(map.callsTo('panBy')).toHaveLength(0);
  });

  it('+, = and - zoom without moving the pin', async () => {
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    const map = await theMap();
    const surface = screen.getByLabelText('t:mapPickerLabel');
    expect(fromMapLibreZoom(map.getZoom())).toBe(17);
    fireEvent.keyDown(surface, { key: '+' });
    expect(fromMapLibreZoom(map.getZoom())).toBe(18);
    fireEvent.keyDown(surface, { key: '=' });
    expect(fromMapLibreZoom(map.getZoom())).toBe(19);
    fireEvent.keyDown(surface, { key: '-' });
    expect(fromMapLibreZoom(map.getZoom())).toBe(18);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('labels the zoom buttons in the app language, at 44 px', async () => {
    render(<LocationPicker {...START} onChange={() => {}} />);
    await theMap();
    for (const label of ['t:mapZoomIn', 't:mapZoomOut']) {
      const btn = screen.getByRole('button', { name: label });
      const css = window.getComputedStyle(btn);
      expect(css.width).toBe('44px');
      expect(css.height).toBe('44px');
    }
  });
});
