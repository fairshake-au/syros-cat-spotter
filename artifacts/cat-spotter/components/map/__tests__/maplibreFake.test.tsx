// @vitest-environment jsdom
/**
 * SYC-705: the MapLibre test double does the same Mercator maths as the app,
 * so later overlay tests can trust its project/unproject.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fromMapLibreZoom, toWorld } from '@/lib/mercator';
import {
  FakeMap,
  lastMap,
  makeMapConstructorThrow,
  maplibreModule,
  resetMaplibreFake,
  setFakeContainerSize,
  setWebGLSupported,
} from '../__mocks__/maplibreFake';

const SYROS = { lng: 24.94, lat: 37.44 };

function newMap(extra: Record<string, unknown> = {}): FakeMap {
  return new maplibreModule.default.Map({
    container: document.createElement('div'),
    center: [SYROS.lng, SYROS.lat],
    zoom: 14,
    ...extra,
  });
}

beforeEach(resetMaplibreFake);

describe('maplibreFake', () => {
  it('projects the centre to the middle of a 390×600 container', () => {
    const map = newMap();
    expect(map.project(SYROS)).toEqual({ x: 195, y: 300 });
  });

  it('projects with app-scale Mercator at fromMapLibreZoom(zoom)', () => {
    const map = newMap();
    const east = { lng: SYROS.lng + 0.01, lat: SYROS.lat };
    const z = fromMapLibreZoom(14);
    const dx =
      toWorld({ latitude: east.lat, longitude: east.lng }, z).x -
      toWorld({ latitude: SYROS.lat, longitude: SYROS.lng }, z).x;
    expect(map.project([east.lng, east.lat]).x).toBeCloseTo(195 + dx, 6);
  });

  it('unproject inverts project', () => {
    setFakeContainerSize(800, 500);
    const map = newMap();
    const p = { lng: 24.95, lat: 37.43 };
    const back = map.unproject(map.project(p));
    expect(back.lng).toBeCloseTo(p.lng, 9);
    expect(back.lat).toBeCloseTo(p.lat, 9);
    expect(map.project(SYROS)).toEqual({ x: 400, y: 250 });
  });

  it('panBy moves the point at the offset to the centre and fires move events', () => {
    const map = newMap();
    const seen: string[] = [];
    for (const t of ['movestart', 'move', 'moveend', 'zoom']) map.on(t, () => seen.push(t));
    const target = map.unproject([195 + 40, 300 - 25]);
    map.panBy([40, -25]);
    expect(map.getCenter().lng).toBeCloseTo(target.lng, 9);
    expect(map.getCenter().lat).toBeCloseTo(target.lat, 9);
    expect(seen).toEqual(['movestart', 'move', 'moveend']);
    expect(map.callsTo('panBy')).toEqual([[[40, -25]]]);
  });

  it('easeTo and jumpTo land at once, clamp zoom and fire zoom events', () => {
    const map = newMap({ minZoom: 11, maxZoom: 18 });
    const seen: string[] = [];
    map.on('zoom', () => seen.push('zoom'));
    map.easeTo({ center: [24.9, 37.4], zoom: 25 });
    expect(map.getZoom()).toBe(18);
    expect(map.getCenter()).toEqual({ lng: 24.9, lat: 37.4 });
    map.jumpTo({ zoom: 3 });
    expect(map.getZoom()).toBe(11);
    expect(seen).toEqual(['zoom', 'zoom']);
  });

  it('on/off/once and fire, with click filling in lngLat from point', () => {
    const map = newMap();
    const clicks: unknown[] = [];
    const onClick = (e: Record<string, unknown>) => clicks.push(e.lngLat);
    map.on('click', onClick);
    let loads = 0;
    map.once('load', () => loads++);
    map.fire('load').fire('load');
    expect(loads).toBe(1);
    expect(map.isStyleLoaded()).toBe(true);
    map.fire('click', { point: { x: 195, y: 300 } });
    expect(clicks).toHaveLength(1);
    const ll = clicks[0] as { lng: number; lat: number };
    expect(ll.lng).toBeCloseTo(SYROS.lng, 9);
    map.off('click', onClick);
    map.fire('click', { point: { x: 0, y: 0 } });
    expect(clicks).toHaveLength(1);
  });

  it('fires camera events in real jumpTo order', () => {
    const map = newMap();
    const seen: string[] = [];
    for (const t of ['movestart', 'move', 'zoomstart', 'zoom', 'zoomend', 'moveend']) map.on(t, () => seen.push(t));
    map.jumpTo({ zoom: 15 });
    expect(seen).toEqual(['movestart', 'move', 'zoomstart', 'zoom', 'zoomend', 'moveend']);
  });

  it('refuses style edits until the style loads, and again after setStyle', () => {
    const map = newMap();
    expect(map.isStyleLoaded()).toBe(false);
    expect(() => map.setLayoutProperty('places', 'text-field', 'x')).toThrow('Style is not done loading.');
    expect(() => map.addSource('cats', { type: 'geojson' })).toThrow('Style is not done loading.');
    expect(() => map.addLayer({ id: 'cats' })).toThrow('Style is not done loading.');
    expect(map.rejected.map((c) => c.method)).toEqual(['setLayoutProperty', 'addSource', 'addLayer']);
    expect(map.callsTo('setLayoutProperty')).toEqual([]);
    map.fire('styledata');
    map.addSource('cats', { type: 'geojson' });
    map.addLayer({ id: 'cats' });
    expect(map.getSource('cats')).toEqual({ type: 'geojson' });
    expect(map.getLayer('cats')).toEqual({ id: 'cats' });
    map.setStyle({ version: 8 });
    expect(map.isStyleLoaded()).toBe(false);
    expect(() => map.setLayoutProperty('places', 'text-field', 'x')).toThrow();
    map.fire('load');
    expect(() => map.setLayoutProperty('places', 'text-field', 'x')).not.toThrow();
  });

  it('layer listeners run only for their layer', () => {
    const map = newMap();
    let hits = 0;
    map.on('click', 'cats', () => hits++);
    map.fire('click', { point: { x: 1, y: 1 } });
    map.fire('click', { point: { x: 1, y: 1 }, layerId: 'cats' });
    expect(hits).toBe(1);
  });

  it('records style, layout, handler and lifecycle calls', () => {
    const map = newMap();
    map.fire('load');
    map.setLayoutProperty('places', 'text-field', ['get', 'name']);
    map.setStyle({ version: 8 });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.keyboard.disable();
    map.resize();
    map.remove();
    expect(map.getLayoutProperty('places', 'text-field')).toEqual(['get', 'name']);
    expect(map.calls.map((c) => c.method)).toEqual([
      'setLayoutProperty',
      'setStyle',
      'dragRotate.disable',
      'touchZoomRotate.disableRotation',
      'keyboard.disable',
      'resize',
      'remove',
    ]);
    expect(map.dragRotate.isEnabled()).toBe(false);
    expect(map.touchZoomRotate.isEnabled()).toBe(true);
    expect(map.removed).toBe(true);
    expect(map.getContainer()).toBe(map.options.container);
  });

  it('test controls: supported() and a throwing constructor', () => {
    expect(maplibreModule.default.supported()).toBe(true);
    setWebGLSupported(false);
    expect(maplibreModule.supported()).toBe(false);
    makeMapConstructorThrow();
    expect(() => newMap()).toThrow(/WebGL/);
    resetMaplibreFake();
    expect(maplibreModule.supported()).toBe(true);
    newMap();
    expect(lastMap()).toBe(FakeMap.instances[0]);
  });
  it('honours bearing in project/unproject: at 90° east is up', () => {
    const map = newMap({ bearing: 90 });
    expect(map.getBearing()).toBe(90);
    const east = map.project([SYROS.lng + 0.01, SYROS.lat]);
    expect(east.x).toBeCloseTo(195, 6);
    expect(east.y).toBeLessThan(300);
    const north = map.project([SYROS.lng, SYROS.lat + 0.01]);
    expect(north.x).toBeLessThan(195);
    expect(north.y).toBeCloseTo(300, 6);
    const p = { lng: 24.95, lat: 37.43 };
    const back = map.unproject(map.project(p));
    expect(back.lng).toBeCloseTo(p.lng, 9);
    expect(back.lat).toBeCloseTo(p.lat, 9);
  });

  it('setBearing and easeTo({ bearing }) fire rotate events before moveend, normalised to (-180, 180]', () => {
    const map = newMap();
    const seen: string[] = [];
    for (const t of ['move', 'rotatestart', 'rotate', 'rotateend', 'moveend']) map.on(t, () => seen.push(t));
    map.setBearing(270);
    expect(map.getBearing()).toBe(-90);
    expect(seen).toEqual(['move', 'rotatestart', 'rotate', 'rotateend', 'moveend']);
    seen.length = 0;
    map.easeTo({ bearing: -180 });
    expect(map.getBearing()).toBe(180);
    map.easeTo({ zoom: 15 });
    expect(seen).toEqual(['move', 'rotatestart', 'rotate', 'rotateend', 'moveend', 'move', 'moveend']);
  });
});
