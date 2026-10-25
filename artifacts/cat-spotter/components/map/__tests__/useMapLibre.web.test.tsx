// @vitest-environment jsdom
/**
 * SYC-705: useMapLibre owns one MapLibre map inside a react-native-web View.
 * MapLibre and pmtiles are replaced by the test double in __mocks__.
 */
import React from 'react';
import { View } from 'react-native';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStyle, labelFieldsFor } from '@workspace/map-style';
import { mapUrls } from '@/lib/mapSource';
import {
  FakeMap,
  FakeProtocol,
  lastMap,
  makeMapConstructorThrow,
  makeProtocolSetupThrow,
  protocolCalls,
  resetMaplibreFake,
  setWebGLSupported,
} from '../__mocks__/maplibreFake';

const env = vi.hoisted(() => ({ language: 'en' as 'en' | 'el' | 'fr', version: 1 }));

vi.mock('maplibre-gl', async () => (await import('../__mocks__/maplibreFake')).maplibreModule);
vi.mock('pmtiles', async () => (await import('../__mocks__/maplibreFake')).pmtilesModule);
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: env.language }),
}));
vi.mock('@/lib/mapSource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mapSource')>()),
  useMapVersion: () => env.version,
}));

import {
  MAPLIBRE_STYLE_ID,
  _resetMapLibreLoaderForTests,
  _setMapLibreImporterForTests,
  useMapLibre,
  type UseMapLibreOptions,
} from '../useMapLibre.web';

type Result = ReturnType<typeof useMapLibre>;

const SYROS = { latitude: 37.44, longitude: 24.94 };
const BASE: UseMapLibreOptions = { center: SYROS, zoom: 15, interactive: true, rotate: false, keyboard: false };

function Harness({ opts, onResult }: { opts: UseMapLibreOptions; onResult: (r: Result) => void }) {
  const result = useMapLibre(opts);
  onResult(result);
  return <View ref={result.containerRef} testID="map-host" style={{ width: 390, height: 600 }} />;
}

function mount(opts: UseMapLibreOptions = BASE) {
  const latest: { current: Result | null } = { current: null };
  const onResult = (r: Result) => {
    latest.current = r;
  };
  const utils = render(<Harness opts={opts} onResult={onResult} />);
  return {
    latest,
    rerender: (next: UseMapLibreOptions = opts) => utils.rerender(<Harness opts={next} onResult={onResult} />),
    unmount: utils.unmount,
    host: () => utils.getByTestId('map-host'),
  };
}

async function mountReady(opts: UseMapLibreOptions = BASE) {
  const m = mount(opts);
  await waitFor(() => expect(m.latest.current?.map).not.toBeNull());
  return { ...m, map: lastMap() as FakeMap };
}

beforeEach(() => {
  env.language = 'en';
  env.version = 1;
  resetMaplibreFake();
  _resetMapLibreLoaderForTests();
  document.getElementById(MAPLIBRE_STYLE_ID)?.remove();
});
afterEach(cleanup);

describe('useMapLibre', () => {
  it('creates the map with app zoom converted', async () => {
    const { latest, map, host } = await mountReady();
    expect(FakeMap.instances).toHaveLength(1);
    expect(latest.current?.map).toBe(map);
    expect(map.options.container).toBe(host());
    expect(map.options.center).toEqual([SYROS.longitude, SYROS.latitude]);
    expect(map.options.zoom).toBe(14);
    expect(map.options.minZoom).toBe(11);
    expect(map.options.maxZoom).toBe(18);
    expect(map.options.pitchWithRotate).toBe(false);
    expect(map.options.interactive).toBe(true);
    expect(map.options.attributionControl).toBe(false);
    expect(map.options.style).toEqual(buildStyle({ lang: 'en', ...mapUrls(1) }));
    expect(latest.current?.zoom).toBe(15);
    expect(latest.current?.version).toBe(1);
    expect(latest.current?.failed).toBeNull();
  });

  it('builds the style in the map language for the current version', async () => {
    env.language = 'el';
    env.version = 3;
    const { map } = await mountReady();
    expect(map.options.style).toEqual(buildStyle({ lang: 'el', ...mapUrls(3) }));
  });

  it('registers the pmtiles protocol once, however many maps', async () => {
    const a = await mountReady();
    a.unmount();
    await mountReady();
    expect(FakeMap.instances).toHaveLength(2);
    expect(protocolCalls).toHaveLength(1);
    expect(protocolCalls[0].protocol).toBe('pmtiles');
    expect(protocolCalls[0].loadFn).toBe(FakeProtocol.instances[0].tile);
  });

  it('passes interactive through', async () => {
    const { map } = await mountReady({ ...BASE, interactive: false });
    expect(map.options.interactive).toBe(false);
  });

  it('language change calls setLayoutProperty for every labelFieldsFor layer, never setStyle', async () => {
    const { map, rerender } = await mountReady();
    map.fire('load');
    env.language = 'el';
    act(() => rerender());
    const expected = labelFieldsFor('el').map((f) => [f.layerId, 'text-field', f.textField]);
    expect(expected.length).toBeGreaterThan(0);
    expect(map.callsTo('setLayoutProperty')).toEqual(expected);
    expect(map.callsTo('setStyle')).toEqual([]);
  });

  it('French uses the English map labels, so en → fr changes nothing', async () => {
    const { map, rerender } = await mountReady();
    env.language = 'fr';
    act(() => rerender());
    expect(map.callsTo('setLayoutProperty')).toEqual([]);
    expect(map.callsTo('setStyle')).toEqual([]);
  });

  it('a language change the style was not ready for is applied once it loads', async () => {
    const { map, rerender } = await mountReady();
    const real = map.setLayoutProperty.bind(map);
    let ready = false;
    map.setLayoutProperty = (...args: Parameters<FakeMap['setLayoutProperty']>) => {
      if (!ready) throw new Error('Style is not done loading.');
      return real(...args);
    };
    env.language = 'el';
    act(() => rerender());
    expect(map.callsTo('setLayoutProperty')).toEqual([]);
    ready = true;
    act(() => {
      map.fire('styledata');
    });
    expect(map.callsTo('setLayoutProperty')).toHaveLength(labelFieldsFor('el').length);
  });

  it('version change swaps the style with setStyle', async () => {
    const { map, rerender, latest } = await mountReady();
    env.version = 2;
    act(() => rerender());
    expect(map.callsTo('setStyle')).toEqual([[buildStyle({ lang: 'en', ...mapUrls(2) })]]);
    expect(latest.current?.version).toBe(2);
    expect(FakeMap.instances).toHaveLength(1);
  });

  it('no WebGL reports failed', async () => {
    setWebGLSupported(false);
    const { latest } = mount();
    await waitFor(() => expect(latest.current?.failed).toBe('no-webgl'));
    expect(latest.current?.map).toBeNull();
    expect(FakeMap.instances).toHaveLength(0);
  });

  it('a map that throws on construction reports failed', async () => {
    makeMapConstructorThrow();
    const { latest } = mount();
    await waitFor(() => expect(latest.current?.failed).toBe('no-webgl'));
    expect(latest.current?.map).toBeNull();
  });

  it('a failed download of MapLibre reports load-failed, and a later mount retries', async () => {
    _setMapLibreImporterForTests(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    const first = mount();
    await waitFor(() => expect(first.latest.current?.failed).toBe('load-failed'));
    expect(first.latest.current?.map).toBeNull();
    first.unmount();
    _resetMapLibreLoaderForTests();
    await mountReady();
    expect(FakeMap.instances).toHaveLength(1);
  });

  it('pmtiles protocol setup failing reports load-failed', async () => {
    makeProtocolSetupThrow();
    const { latest } = mount();
    await waitFor(() => expect(latest.current?.failed).toBe('load-failed'));
    expect(latest.current?.map).toBeNull();
    expect(FakeMap.instances).toHaveLength(0);
  });

  it('injects the minimal MapLibre CSS once, when the first map is created', async () => {
    expect(document.getElementById(MAPLIBRE_STYLE_ID)).toBeNull();
    const a = await mountReady();
    const style = document.getElementById(MAPLIBRE_STYLE_ID);
    expect(style?.tagName).toBe('STYLE');
    expect(style?.parentNode).toBe(document.head);
    expect(style?.textContent).toContain('.maplibregl-canvas{position:absolute');
    a.unmount();
    await mountReady();
    expect(document.querySelectorAll(`#${MAPLIBRE_STYLE_ID}`)).toHaveLength(1);
  });

  it('injects no CSS when MapLibre cannot load', async () => {
    _setMapLibreImporterForTests(() => Promise.reject(new Error('offline')));
    const { latest } = mount();
    await waitFor(() => expect(latest.current?.failed).toBe('load-failed'));
    expect(document.getElementById(MAPLIBRE_STYLE_ID)).toBeNull();
  });

  it('removes the map on unmount', async () => {
    const { map, unmount } = await mountReady();
    expect(map.removed).toBe(false);
    unmount();
    expect(map.removed).toBe(true);
  });

  it('unmounting before MapLibre loads leaves no live map', async () => {
    const { unmount } = mount();
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(FakeMap.instances.every((m) => m.removed)).toBe(true);
  });

  it('rotation and keyboard disabled when asked', async () => {
    const { map } = await mountReady({ ...BASE, rotate: false, keyboard: false });
    expect(map.dragRotate.isEnabled()).toBe(false);
    expect(map.touchZoomRotate.rotationEnabled).toBe(false);
    // Pinch zoom stays: only the rotation half of touchZoomRotate goes.
    expect(map.touchZoomRotate.isEnabled()).toBe(true);
    expect(map.keyboard.isEnabled()).toBe(false);
  });

  it('rotation and keyboard left alone when allowed', async () => {
    const { map } = await mountReady({ ...BASE, rotate: true, keyboard: true });
    const methods = map.calls.map((c) => c.method);
    expect(methods).not.toContain('dragRotate.disable');
    expect(methods).not.toContain('touchZoomRotate.disableRotation');
    expect(methods).not.toContain('keyboard.disable');
  });

  it('keyboard on but rotation off keeps keyboard panning, drops keyboard rotation', async () => {
    const { map } = await mountReady({ ...BASE, rotate: false, keyboard: true });
    expect(map.keyboard.isEnabled()).toBe(true);
    expect(map.keyboard.rotationEnabled).toBe(false);
  });

  it('reports the app zoom as the map zooms', async () => {
    const { map, latest } = await mountReady();
    act(() => {
      map.jumpTo({ zoom: 16.5 });
    });
    expect(latest.current?.zoom).toBe(17.5);
  });
});
