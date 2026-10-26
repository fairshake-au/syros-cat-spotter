/**
 * SYC-705: one MapLibre map inside a react-native-web View, drawn from our
 * own Syros map file (tiles.catspotters.com).
 *
 * MapLibre and pmtiles are loaded with `await import()` inside the effect,
 * never at module top level, so a static render (or jsdom) never touches
 * WebGL and the library stays out of the first page load. MapLibre's own
 * stylesheet is not imported (Expo would hoist it into every page's
 * index.html); the few rules the map needs are injected when the first map
 * is created. MapLibre's attribution control is off: the screens show
 * "© OpenStreetMap contributors" themselves.
 *
 * The options are a snapshot taken when the map is created: later changes to
 * center, zoom, interactive, rotate or keyboard are not applied. Callers move
 * the map through `map`.
 *
 * `map` arrives before its style has loaded. MapLibre throws "Style is not
 * done loading" from addSource/addLayer/setLayoutProperty until it has, so
 * callers wait for `styleReady` before adding sources or layers, and add
 * them again when it turns true after a map-version style swap.
 *
 * easeTo, panBy and flyTo animate in real MapLibre (panBy defaults to
 * 500 ms): callers and tests must not assume the camera has moved
 * synchronously after them. Only jumpTo/setCenter/setZoom land at once.
 *
 * Pitch is always off (maxPitch 0, touchPitch off): overlays use flat
 * Mercator maths.
 *
 * Zoom crosses the app/MapLibre boundary only through toMapLibreZoom and
 * fromMapLibreZoom: callers pass the app's zoom, and convert what they read
 * from `map.getZoom()`. The hook keeps no zoom state of its own (it would
 * re-render the whole map on every zoom frame); callers that need the live
 * zoom listen to the map's own events.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { View } from 'react-native';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { MAP_LANG, buildStyle, labelFieldsFor, type MapLang } from '@workspace/map-style';
import { useLanguage } from '@/context/LanguageContext';
import { mapUrls, useMapVersion } from '@/lib/mapSource';
import { MAX_ZOOM, MIN_ZOOM, toMapLibreZoom, type LatLng } from '@/lib/mercator';

export type { MaplibreMap };

export interface UseMapLibreOptions {
  center: LatLng;
  /** App zoom (256-px world). */
  zoom: number;
  interactive: boolean;
  rotate: boolean;
  keyboard: boolean;
}

export interface UseMapLibreResult {
  /** Attach to the View the map should fill. */
  containerRef: RefObject<View | null>;
  map: MaplibreMap | null;
  /**
   * 'no-webgl': MapLibre loaded but can't draw here (no WebGL; the map failed to start).
   * 'load-failed': MapLibre or pmtiles couldn't be downloaded or set up.
   */
  failed: MapFailure | null;
  /**
   * True once the style has loaded; false again while a new map version's
   * style loads. Wait for it before addSource/addLayer/setLayoutProperty.
   */
  styleReady: boolean;
  version: number;
}

export type MapFailure = 'no-webgl' | 'load-failed';

type MaplibreModule = typeof import('maplibre-gl');

export const MAPLIBRE_STYLE_ID = 'maplibre-min';

/**
 * The parts of maplibre-gl.css a bare map needs: canvas placement, clipping,
 * drag cursors and touch-action (so the map, not the page, gets the gesture).
 * No controls, markers or popups: we draw our own. `.maplibregl-map` gets no
 * `position`, so a caller's absolute-fill style is never overridden;
 * react-native-web Views are already position: relative.
 */
export const MAPLIBRE_MIN_CSS = [
  '.maplibregl-map{overflow:hidden;-webkit-tap-highlight-color:rgba(0,0,0,0)}',
  '.maplibregl-canvas{position:absolute;left:0;top:0}',
  '.maplibregl-canvas-container.maplibregl-interactive{cursor:grab;-webkit-user-select:none;user-select:none}',
  '.maplibregl-canvas-container.maplibregl-interactive:active{cursor:grabbing}',
  '.maplibregl-canvas-container.maplibregl-touch-zoom-rotate,.maplibregl-canvas-container.maplibregl-touch-zoom-rotate .maplibregl-canvas{touch-action:pan-x pan-y}',
  '.maplibregl-canvas-container.maplibregl-touch-drag-pan,.maplibregl-canvas-container.maplibregl-touch-drag-pan .maplibregl-canvas{touch-action:pinch-zoom}',
  '.maplibregl-canvas-container.maplibregl-touch-zoom-rotate.maplibregl-touch-drag-pan,.maplibregl-canvas-container.maplibregl-touch-zoom-rotate.maplibregl-touch-drag-pan .maplibregl-canvas{touch-action:none}',
  '.maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-top-left,.maplibregl-ctrl-top-right{pointer-events:none;position:absolute;z-index:2}',
  '.maplibregl-boxzoom{position:absolute;left:0;top:0;width:0;height:0;background:#fff;border:2px dotted #202020;opacity:.5}',
].join('');

/** Adds MAPLIBRE_MIN_CSS to the page once. */
function injectMapLibreCss(): void {
  if (typeof document === 'undefined' || document.getElementById(MAPLIBRE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MAPLIBRE_STYLE_ID;
  style.textContent = MAPLIBRE_MIN_CSS;
  document.head.appendChild(style);
}

let libraryPromise: Promise<MaplibreModule> | null = null;

const importLibrariesDefault = () => Promise.all([import('maplibre-gl'), import('pmtiles')]);
let importLibraries: () => Promise<[unknown, unknown]> = importLibrariesDefault;

/** Loads MapLibre and pmtiles once per page, registering the pmtiles protocol once. */
function loadMapLibre(): Promise<MaplibreModule> {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      const [maplibreImport, pmtilesImport] = await importLibraries();
      // Bundlers disagree on whether a CommonJS/UMD module arrives as the
      // namespace itself or under `default`.
      const maplibregl = ((maplibreImport as { default?: MaplibreModule }).default ??
        maplibreImport) as MaplibreModule;
      const pm = pmtilesImport as typeof import('pmtiles') & { default?: typeof import('pmtiles') };
      const Protocol = pm.Protocol ?? pm.default?.Protocol;
      const protocol = new Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);
      return maplibregl;
    })();
    // A failed load (e.g. a dropped connection) may succeed on the next mount.
    libraryPromise.catch(() => {
      libraryPromise = null;
    });
  }
  return libraryPromise;
}

/** Test-only: forget the loaded library so each test registers afresh. */
export function _resetMapLibreLoaderForTests(): void {
  libraryPromise = null;
  importLibraries = importLibrariesDefault;
}

/** Test-only: replace the dynamic imports, e.g. with a rejection to fake a failed download. */
export function _setMapLibreImporterForTests(fn: () => Promise<[unknown, unknown]>): void {
  importLibraries = fn;
}

/** Swap every label layer's text to `lang`. False if MapLibre refused (style not loaded). */
function applyLabelLanguage(map: MaplibreMap, lang: MapLang): boolean {
  try {
    for (const { layerId, textField } of labelFieldsFor(lang)) {
      map.setLayoutProperty(layerId, 'text-field', textField as never);
    }
    return true;
  } catch {
    return false;
  }
}

export function useMapLibre(opts: UseMapLibreOptions): UseMapLibreResult {
  const { language } = useLanguage();
  const version = useMapVersion();
  const mapLang = MAP_LANG(language);

  const containerRef = useRef<View>(null);
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [failed, setFailed] = useState<MapFailure | null>(null);
  const [styleReady, setStyleReady] = useState(false);

  // The map is created once, asynchronously; it reads the newest values then.
  const latest = useRef({ opts, mapLang, version });
  latest.current = { opts, mapLang, version };
  // What the live style was built with, so later changes apply only the difference.
  const styleLang = useRef<MapLang>(mapLang);
  const styleVersion = useRef(version);

  useEffect(() => {
    let cancelled = false;
    let created: MaplibreMap | null = null;

    void (async () => {
      let maplibregl: MaplibreModule;
      try {
        maplibregl = await loadMapLibre();
      } catch {
        if (!cancelled) setFailed('load-failed');
        return;
      }
      if (cancelled) return;
      const supported = (maplibregl as { supported?: () => boolean }).supported;
      if (supported && !supported()) {
        setFailed('no-webgl');
        return;
      }
      // react-native-web hands back the DOM element as the View's ref.
      const container = containerRef.current as unknown as HTMLElement | null;
      if (!container) return;

      const { opts: o, mapLang: lang, version: v } = latest.current;
      injectMapLibreCss();
      let instance: MaplibreMap;
      try {
        instance = new maplibregl.Map({
          container,
          style: buildStyle({ lang, ...mapUrls(v) }) as never,
          center: [o.center.longitude, o.center.latitude],
          zoom: toMapLibreZoom(o.zoom),
          minZoom: toMapLibreZoom(MIN_ZOOM),
          maxZoom: toMapLibreZoom(MAX_ZOOM),
          pitchWithRotate: false,
          maxPitch: 0,
          touchPitch: false,
          interactive: o.interactive,
          attributionControl: false,
        });
      } catch {
        setFailed('no-webgl');
        return;
      }
      created = instance;
      styleLang.current = lang;
      styleVersion.current = v;

      if (!o.rotate) {
        instance.dragRotate.disable();
        // Keeps pinch zoom; only the twist goes.
        instance.touchZoomRotate.disableRotation();
      }
      if (!o.keyboard) {
        instance.keyboard.disable();
      } else if (!o.rotate) {
        instance.keyboard.disableRotation();
      }

      // 'styledata' arrives once a style's JSON is in; 'load' after the first render.
      const markReady = () => setStyleReady(true);
      instance.on('styledata', markReady);
      instance.on('load', markReady);
      setMap(instance);
    })();

    return () => {
      cancelled = true;
      created?.remove();
      created = null;
    };
  }, []);

  // A new map file: the one place the whole style is replaced. Declared before
  // the language effect so a simultaneous language change rides along here.
  useEffect(() => {
    if (!map || styleVersion.current === version) return;
    styleVersion.current = version;
    styleLang.current = mapLang;
    setStyleReady(false);
    // Diffing against a style that hasn't loaded only warns and rebuilds.
    map.setStyle(buildStyle({ lang: mapLang, ...mapUrls(version) }) as never, { diff: map.isStyleLoaded() === true });
  }, [map, version, mapLang]);

  // A new language: relabel in place, never reload the style. Waits for the
  // style, since MapLibre refuses layout changes before it has loaded.
  useEffect(() => {
    if (!map || !styleReady || styleLang.current === mapLang) return;
    if (applyLabelLanguage(map, mapLang)) styleLang.current = mapLang;
  }, [map, mapLang, styleReady]);

  return { containerRef, map, failed, styleReady, version };
}
