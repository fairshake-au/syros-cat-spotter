// @vitest-environment jsdom
/**
 * SYC-705 (final review I3): once the map version has been read from
 * current.json, maps opened afterwards start on it. They must not be built on
 * the fallback version and then swapped (two sets of tiles, glyphs, sprites).
 * Uses the real useMapVersion, unlike useMapLibre.web.test.tsx.
 */
import React from 'react';
import { View } from 'react-native';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStyle } from '@workspace/map-style';
import { _resetMapVersionForTests, mapUrls } from '@/lib/mapSource';
import { FakeMap, lastMap, resetMaplibreFake } from '../__mocks__/maplibreFake';

vi.mock('maplibre-gl', async () => (await import('../__mocks__/maplibreFake')).maplibreModule);
vi.mock('pmtiles', async () => (await import('../__mocks__/maplibreFake')).pmtilesModule);
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'en' }),
}));

import { MAPLIBRE_STYLE_ID, _resetMapLibreLoaderForTests, useMapLibre } from '../useMapLibre.web';

const OPTS = { center: { latitude: 37.44, longitude: 24.94 }, zoom: 15, interactive: true, rotate: false, keyboard: false };

function Harness({ onResult }: { onResult: (r: ReturnType<typeof useMapLibre>) => void }) {
  const result = useMapLibre(OPTS);
  onResult(result);
  return <View ref={result.containerRef} style={{ width: 390, height: 600 }} />;
}

beforeEach(() => {
  resetMaplibreFake();
  _resetMapLibreLoaderForTests();
  _resetMapVersionForTests();
  document.getElementById(MAPLIBRE_STYLE_ID)?.remove();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: 2 }) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useMapLibre with the real map version', () => {
  it('a map opened after current.json has answered is built on that version, with no style swap', async () => {
    const first = { current: null as ReturnType<typeof useMapLibre> | null };
    const a = render(<Harness onResult={(r) => (first.current = r)} />);
    await waitFor(() => expect(first.current?.version).toBe(2));
    a.unmount();

    const second = { current: null as ReturnType<typeof useMapLibre> | null };
    render(<Harness onResult={(r) => (second.current = r)} />);
    await waitFor(() => expect(second.current?.map).not.toBeNull());
    const map = lastMap() as FakeMap;
    expect(FakeMap.instances).toHaveLength(2);
    expect(map.options.style).toEqual(buildStyle({ lang: 'en', ...mapUrls(2) }));
    expect(second.current?.version).toBe(2);
    expect(map.callsTo('setStyle')).toHaveLength(0);
  });
});
