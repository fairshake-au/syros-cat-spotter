/**
 * SYC-705: one MapLibre map inside a react-native-web View, drawn from our
 * own Syros map file (tiles.catspotters.com).
 *
 * MapLibre and pmtiles are loaded with `await import()` inside the effect,
 * never at module top level, so a static render (or jsdom) never touches
 * WebGL and the library stays out of the first page load.
 *
 * Zoom crosses the app/MapLibre boundary only through toMapLibreZoom and
 * fromMapLibreZoom: callers pass and receive the app's zoom.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { View } from 'react-native';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { MAP_LANG, buildStyle, labelFieldsFor, type MapLang } from '@workspace/map-style';
import { useLanguage } from '@/context/LanguageContext';
import { mapUrls, useMapVersion } from '@/lib/mapSource';
import { MAX_ZOOM, MIN_ZOOM, fromMapLibreZoom, toMapLibreZoom, type LatLng } from '@/lib/mercator';

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
  /** 'no-webgl': MapLibre can't draw here (no WebGL, or it failed to load or start). */
  failed: 'no-webgl' | null;
  /** App zoom, following the map as it zooms. */
  zoom: number;
  version: number;
}

type MaplibreModule = typeof import('maplibre-gl');

let libraryPromise: Promise<MaplibreModule> | null = null;

/** Loads MapLibre and pmtiles once per page, registering the pmtiles protocol once. */
function loadMapLibre(): Promise<MaplibreModule> {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      const [maplibreImport, pmtilesImport] = await Promise.all([
        import('maplibre-gl'),
        import('pmtiles'),
        // @ts-expect-error -- a CSS file has no types; Metro and vitest both load it.
        import('maplibre-gl/dist/maplibre-gl.css'),
      ]);
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
}

/** Swap every label layer's text to `lang`; retries once the style has loaded if it hadn't. */
function applyLabelLanguage(map: MaplibreMap, lang: MapLang): void {
  const apply = () => {
    for (const { layerId, textField } of labelFieldsFor(lang)) {
      map.setLayoutProperty(layerId, 'text-field', textField as never);
    }
  };
  try {
    apply();
  } catch {
    // MapLibre throws "Style is not done loading" until the style arrives.
    map.once('styledata', () => {
      try {
        apply();
      } catch {
        // The style was replaced again; the next style is built in the right language.
      }
    });
  }
}

export function useMapLibre(opts: UseMapLibreOptions): UseMapLibreResult {
  const { language } = useLanguage();
  const version = useMapVersion();
  const mapLang = MAP_LANG(language);

  const containerRef = useRef<View>(null);
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [failed, setFailed] = useState<'no-webgl' | null>(null);
  const [zoom, setZoom] = useState(opts.zoom);

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
        if (!cancelled) setFailed('no-webgl');
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
          interactive: o.interactive,
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

      instance.on('zoom', () => setZoom(fromMapLibreZoom(instance.getZoom())));
      setZoom(fromMapLibreZoom(instance.getZoom()));
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
    map.setStyle(buildStyle({ lang: mapLang, ...mapUrls(version) }) as never);
  }, [map, version, mapLang]);

  // A new language: relabel in place, never reload the style.
  useEffect(() => {
    if (!map || styleLang.current === mapLang) return;
    styleLang.current = mapLang;
    applyLabelLanguage(map, mapLang);
  }, [map, mapLang]);

  return { containerRef, map, failed, zoom, version };
}
