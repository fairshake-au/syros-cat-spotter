import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

// A recording stand-in for MapLibre GL JS 6 and PMTiles 4 (SYC-705 Task
// 2b.5), for tests that run the dashboard's map scripts (assets/map-core.js
// and the page scripts on top of it) inside jsdom. jsdom has no WebGL and
// can't import an ES module from a URL, so nothing real is loaded:
//
// - map-core.js imports the library through `window.__catMapImport` when a
//   test sets it (test-only; browsers use `import()`), and gets `lib` here.
// - `window.pmtiles` is `pm` here; `window.fetch` and `window.caches` are
//   recording fakes that answer the map-data routes.
//
// Reused by the cats map script (2b.6) and place mode (2b.7) tests, so it
// covers more of MapLibre than the view maps need. Every call to a map is
// recorded in `map.calls` as [method, ...args].

/* eslint-disable @typescript-eslint/no-explicit-any */

export type LngLatLike = [number, number] | { lng: number; lat: number } | { lon: number; lat: number };

export interface LngLat {
  lng: number;
  lat: number;
}

export const toLngLat = (v: LngLatLike): LngLat =>
  Array.isArray(v) ? { lng: v[0], lat: v[1] } : { lng: "lng" in v ? v.lng : v.lon, lat: v.lat };

/** MapLibre's world: 512 px across at zoom 0. */
const TILE = 512;
const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};
const lngOf = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180;
const latOf = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

type Handler = (ev: any) => void;

export interface FakeHandler {
  enabled: boolean;
  rotation: boolean;
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  disableRotation(): void;
  enableRotation(): void;
}

function handler(): FakeHandler {
  return {
    enabled: true,
    rotation: true,
    enable() {
      this.enabled = true;
    },
    disable() {
      this.enabled = false;
    },
    isEnabled() {
      return this.enabled;
    },
    disableRotation() {
      this.rotation = false;
    },
    enableRotation() {
      this.rotation = true;
    },
  };
}

export interface FakeMarker {
  options: any;
  element: any;
  lngLat: LngLat | null;
  map: FakeMap | null;
  removed: boolean;
  setLngLat(v: LngLatLike): FakeMarker;
  getLngLat(): LngLat | null;
  addTo(map: FakeMap): FakeMarker;
  remove(): FakeMarker;
  getElement(): any;
}

export interface FakeMap {
  options: any;
  calls: any[][];
  markers: FakeMarker[];
  removed: boolean;
  /** The container's size the fake projects with (jsdom has no layout). */
  size: { width: number; height: number };
  centre: LngLat;
  zoom: number;
  bearing: number;
  dragRotate: FakeHandler;
  touchZoomRotate: FakeHandler;
  keyboard: FakeHandler;
  dragPan: FakeHandler;
  scrollZoom: FakeHandler;
  doubleClickZoom: FakeHandler;
  boxZoom: FakeHandler;
  touchPitch: FakeHandler;
  on(name: string, fn: Handler): FakeMap;
  off(name: string, fn: Handler): FakeMap;
  once(name: string, fn?: Handler): FakeMap | Promise<any>;
  /** Test helper: run the handlers for `name`. */
  fire(name: string, ev?: any): void;
  getContainer(): any;
  getZoom(): number;
  getCenter(): LngLat;
  getBearing(): number;
  getMinZoom(): number;
  getMaxZoom(): number;
  project(v: LngLatLike): { x: number; y: number };
  unproject(p: { x: number; y: number } | [number, number]): LngLat;
  jumpTo(o: any): FakeMap;
  easeTo(o: any): FakeMap;
  flyTo(o: any): FakeMap;
  zoomIn(): FakeMap;
  zoomOut(): FakeMap;
  fitBounds(b: [LngLatLike, LngLatLike], o?: any): FakeMap;
  resetNorth(): FakeMap;
  resize(): FakeMap;
  remove(): void;
  setLayoutProperty(layer: string, name: string, value: unknown): FakeMap;
  addSource(id: string, s: unknown): FakeMap;
  addLayer(l: unknown): FakeMap;
  getSource(id: string): unknown;
  getLayer(id: string): unknown;
  loaded(): boolean;
}

export interface FakeLib {
  /** Every map made, in order. */
  maps: FakeMap[];
  markers: FakeMarker[];
  protocols: Record<string, unknown>;
  workerUrl: string | null;
  /** Calls to the library itself (addProtocol, setWorkerUrl, new Map), in order. */
  calls: any[][];
  /** Make `new Map` throw, as MapLibre 6 does without WebGL2. */
  throwOnMap: boolean;
  Map: new (options: any) => FakeMap;
  Marker: new (options?: any) => FakeMarker;
  addProtocol(name: string, fn: unknown): void;
  removeProtocol(name: string): void;
  setWorkerUrl(url: string): void;
  getWorkerUrl(): string | null;
}

export function makeMaplibreFake(
  opts: {
    throwOnMap?: boolean;
    size?: { width: number; height: number };
    /** Fire "load" on each new map once the code that made it has run (default true); false: the test fires it. */
    autoLoad?: boolean;
    /**
     * Fire MapLibre's camera events from jumpTo/easeTo/flyTo/zoomIn/zoomOut/
     * fitBounds, as the real one does: movestart (and zoomstart) at once, in
     * the call, then move/zoom and moveend/zoomend. Default false.
     */
    moveEvents?: boolean;
  } = {},
): FakeLib {
  const lib = {
    maps: [] as FakeMap[],
    markers: [] as FakeMarker[],
    protocols: {} as Record<string, unknown>,
    workerUrl: null as string | null,
    calls: [] as any[][],
    throwOnMap: opts.throwOnMap ?? false,
  } as FakeLib;

  function FakeMapCtor(this: FakeMap, options: any) {
    lib.calls.push(["Map", options]);
    if (lib.throwOnMap) {
      const e = new Error("Failed to initialize WebGL");
      e.name = "GPUInitializationError";
      throw e;
    }
    const m = this;
    const handlers: Record<string, Handler[]> = {};
    m.options = options;
    m.calls = [];
    m.markers = [];
    m.removed = false;
    m.size = opts.size ?? { width: 400, height: 300 };
    m.centre = options.center ? toLngLat(options.center) : { lng: 0, lat: 0 };
    m.zoom = typeof options.zoom === "number" ? options.zoom : 0;
    m.bearing = typeof options.bearing === "number" ? options.bearing : 0;
    for (const h of ["dragRotate", "touchZoomRotate", "keyboard", "dragPan", "scrollZoom", "doubleClickZoom", "boxZoom", "touchPitch"] as const)
      (m as any)[h] = handler();
    const rec = (name: string, args: any[]) => m.calls.push([name, ...args]);
    const setCamera = (o: any) => {
      if (o.center) m.centre = toLngLat(o.center);
      if (typeof o.zoom === "number") m.zoom = Math.min(options.maxZoom ?? 22, Math.max(options.minZoom ?? 0, o.zoom));
      if (typeof o.bearing === "number") m.bearing = o.bearing;
    };
    const camera = (o: any) => {
      if (!opts.moveEvents) return setCamera(o);
      const zoomed = typeof o.zoom === "number";
      m.fire("movestart");
      if (zoomed) m.fire("zoomstart");
      setCamera(o);
      m.fire("move");
      if (zoomed) m.fire("zoom");
      m.fire("moveend");
      if (zoomed) m.fire("zoomend");
    };
    Object.assign(m, {
      on(name: string, fn: Handler) {
        rec("on", [name]);
        (handlers[name] ??= []).push(fn);
        return m;
      },
      off(name: string, fn: Handler) {
        rec("off", [name]);
        handlers[name] = (handlers[name] ?? []).filter((h) => h !== fn && (h as any).inner !== fn);
        return m;
      },
      once(name: string, fn?: Handler) {
        rec("once", [name]);
        if (!fn) return new Promise((resolve) => m.once(name, resolve));
        const wrap: Handler = (ev) => {
          m.off(name, wrap);
          fn(ev);
        };
        (wrap as any).inner = fn;
        (handlers[name] ??= []).push(wrap);
        return m;
      },
      fire(name: string, ev: any = {}) {
        for (const h of [...(handlers[name] ?? [])]) h({ type: name, target: m, ...ev });
      },
      getContainer: () => options.container,
      getZoom: () => m.zoom,
      getCenter: () => ({ ...m.centre }),
      getBearing: () => m.bearing,
      getMinZoom: () => options.minZoom ?? 0,
      getMaxZoom: () => options.maxZoom ?? 22,
      project(v: LngLatLike) {
        const p = toLngLat(v);
        return {
          x: worldX(p.lng, m.zoom) - worldX(m.centre.lng, m.zoom) + m.size.width / 2,
          y: worldY(p.lat, m.zoom) - worldY(m.centre.lat, m.zoom) + m.size.height / 2,
        };
      },
      unproject(pt: { x: number; y: number } | [number, number]) {
        const [x, y] = Array.isArray(pt) ? pt : [pt.x, pt.y];
        return {
          lng: lngOf(worldX(m.centre.lng, m.zoom) + x - m.size.width / 2, m.zoom),
          lat: latOf(worldY(m.centre.lat, m.zoom) + y - m.size.height / 2, m.zoom),
        };
      },
      jumpTo(o: any) {
        rec("jumpTo", [o]);
        camera(o);
        return m;
      },
      easeTo(o: any) {
        rec("easeTo", [o]);
        camera(o);
        return m;
      },
      flyTo(o: any) {
        rec("flyTo", [o]);
        camera(o);
        return m;
      },
      zoomIn() {
        rec("zoomIn", []);
        camera({ zoom: m.zoom + 1 });
        return m;
      },
      zoomOut() {
        rec("zoomOut", []);
        camera({ zoom: m.zoom - 1 });
        return m;
      },
      fitBounds(b: [LngLatLike, LngLatLike], o: any = {}) {
        rec("fitBounds", [b, o]);
        const sw = toLngLat(b[0]);
        const ne = toLngLat(b[1]);
        const pad = typeof o.padding === "number" ? o.padding : 0;
        const w = Math.max(1, m.size.width - 2 * pad);
        const h = Math.max(1, m.size.height - 2 * pad);
        // The largest zoom at which the box fits inside the padded container.
        const dx = Math.max(1e-12, worldX(ne.lng, 0) - worldX(sw.lng, 0));
        const dy = Math.max(1e-12, worldY(sw.lat, 0) - worldY(ne.lat, 0));
        const z = Math.log2(Math.min(w / dx, h / dy));
        camera({
          center: {
            lng: lngOf((worldX(sw.lng, 0) + worldX(ne.lng, 0)) / 2, 0),
            lat: latOf((worldY(sw.lat, 0) + worldY(ne.lat, 0)) / 2, 0),
          },
          zoom: Math.min(z, typeof o.maxZoom === "number" ? o.maxZoom : Infinity),
        });
        return m;
      },
      resetNorth() {
        rec("resetNorth", []);
        m.bearing = 0;
        return m;
      },
      resize() {
        rec("resize", []);
        return m;
      },
      remove() {
        rec("remove", []);
        m.removed = true;
      },
      setLayoutProperty(layer: string, name: string, value: unknown) {
        rec("setLayoutProperty", [layer, name, value]);
        return m;
      },
      addSource(id: string, s: unknown) {
        rec("addSource", [id, s]);
        sources[id] = s;
        return m;
      },
      addLayer(l: any) {
        rec("addLayer", [l]);
        layers[l?.id] = l;
        return m;
      },
      getSource: (id: string) => sources[id],
      getLayer: (id: string) => layers[id],
      loaded: () => true,
    });
    const sources: Record<string, unknown> = {};
    const layers: Record<string, unknown> = {};
    lib.maps.push(m);
    // As MapLibre does once the style and first tiles are in: after the caller's own code has run.
    if (opts.autoLoad !== false) void Promise.resolve().then(() => !m.removed && m.fire("load"));
  }

  function FakeMarkerCtor(this: FakeMarker, options: any = {}) {
    const k = this;
    k.options = options;
    k.element = options.element ?? null;
    k.lngLat = null;
    k.map = null;
    k.removed = false;
    Object.assign(k, {
      setLngLat(v: LngLatLike) {
        k.lngLat = toLngLat(v);
        return k;
      },
      getLngLat: () => k.lngLat,
      addTo(map: FakeMap) {
        k.map = map;
        map.markers.push(k);
        // Into the map's container, as MapLibre does, so tests can query the DOM.
        const box = map.getContainer();
        if (k.element && box && typeof box.appendChild === "function") box.appendChild(k.element);
        return k;
      },
      remove() {
        k.removed = true;
        if (k.map) k.map.markers = k.map.markers.filter((x) => x !== k);
        if (k.element?.parentNode) k.element.parentNode.removeChild(k.element);
        return k;
      },
      getElement: () => k.element,
    });
    lib.markers.push(k);
  }

  lib.Map = FakeMapCtor as any;
  lib.Marker = FakeMarkerCtor as any;
  lib.addProtocol = (name, fn) => {
    lib.calls.push(["addProtocol", name]);
    lib.protocols[name] = fn;
  };
  lib.removeProtocol = (name) => {
    lib.calls.push(["removeProtocol", name]);
    delete lib.protocols[name];
  };
  lib.setWorkerUrl = (url) => {
    lib.calls.push(["setWorkerUrl", url]);
    lib.workerUrl = url;
  };
  lib.getWorkerUrl = () => lib.workerUrl;
  return lib;
}

export interface FakePmtiles {
  /** The keys of every archive handed to a protocol (`protocol.add`), in order. */
  added: string[];
  /** The File (or other source object) each FileSource was made from. */
  files: any[];
  Protocol: new () => { tile: unknown; add(p: any): void };
  PMTiles: new (source: any) => { source: any };
  FileSource: new (file: any) => { file: any; getKey(): string };
}

export function makePmtilesFake(): FakePmtiles {
  const pm = { added: [] as string[], files: [] as any[] } as FakePmtiles;
  pm.Protocol = function (this: any) {
    this.tile = function tile() {};
    this.add = (p: any) => pm.added.push(p.source.getKey());
  } as any;
  pm.PMTiles = function (this: any, source: any) {
    this.source = source;
  } as any;
  // The real FileSource's key is its File's name (pmtiles 4.3.2 dist/esm/index.js).
  pm.FileSource = function (this: any, file: any) {
    pm.files.push(file);
    this.file = file;
    this.getKey = () => file.name;
  } as any;
  return pm;
}

/** One answer of the fake fetch: a status and a body (JSON-able, or text/bytes). */
export interface FakeAnswer {
  status: number;
  body?: unknown;
}

export interface FetchCall {
  url: string;
  init: any;
}

/** The map-data routes, answered as the server does for `version`. */
export function mapDataRoutes(version = 7): Record<string, () => FakeAnswer | Promise<FakeAnswer>> {
  const style = (lang: string) => ({
    version: 8,
    glyphs: `/api/team/map-data/v${version}/fonts/{fontstack}/{range}.pbf`,
    sprite: `/api/team/map-data/v${version}/sprites/light`,
    sources: { protomaps: { type: "vector", url: `pmtiles://syros-v${version}.pmtiles` } },
    layers: [{ id: "background", type: "background", lang }],
  });
  return {
    "/api/team/map-data/current": () => ({ status: 200, body: { version } }),
    [`/api/team/map-data/v${version}/syros.pmtiles`]: () => ({ status: 200, body: "PMTILES-BYTES" }),
    [`/api/team/map-data/v${version}/style-en.json`]: () => ({ status: 200, body: style("en") }),
    [`/api/team/map-data/v${version}/style-el.json`]: () => ({ status: 200, body: style("el") }),
  };
}

function makeResponse(w: any, url: string, a: FakeAnswer): any {
  const text = typeof a.body === "string" ? a.body : JSON.stringify(a.body ?? null);
  const res: any = {
    ok: a.status >= 200 && a.status < 300,
    status: a.status,
    url,
    // A JSON body answers as application/json (the cats' positions route checks it).
    headers: { get: (name: string) => (/^content-type$/i.test(name) && typeof a.body !== "string" ? "application/json; charset=utf-8" : null) },
    json: async () => JSON.parse(text),
    text: async () => text,
    blob: async () => new w.Blob([text]),
    clone: () => makeResponse(w, url, a),
  };
  return res;
}

export interface FakeCaches {
  /** What each cache holds: name → url → body text. */
  stores: Record<string, Map<string, FakeAnswer>>;
  calls: any[][];
  open(name: string): Promise<any>;
}

export function makeCachesFake(w: any): FakeCaches {
  const c = { stores: {}, calls: [] } as unknown as FakeCaches;
  c.open = async (name: string) => {
    c.calls.push(["open", name]);
    const store = (c.stores[name] ??= new Map());
    const keyOf = (r: any) => (typeof r === "string" ? r : r.url);
    return {
      keys: async () => [...store.keys()].map((url) => ({ url })),
      match: async (r: any) => {
        c.calls.push(["match", keyOf(r)]);
        const a = store.get(keyOf(r));
        return a ? makeResponse(w, keyOf(r), a) : undefined;
      },
      put: async (r: any, res: any) => {
        c.calls.push(["put", keyOf(r)]);
        store.set(keyOf(r), { status: res.status, body: await res.text() });
      },
      delete: async (r: any) => {
        c.calls.push(["delete", keyOf(r)]);
        return store.delete(keyOf(r));
      },
    };
  };
  return c;
}

export interface FakeTimer {
  fn: () => void;
  ms: number;
  cleared: boolean;
  ran: boolean;
}

export interface MapScriptRig {
  window: any;
  document: any;
  lib: FakeLib;
  pm: FakePmtiles;
  caches: FakeCaches | null;
  /** Every fetch the scripts made, in order, with their absolute URL. */
  fetches: FetchCall[];
  /** The routes the fake fetch answers; tests may change them. Path → answer. */
  routes: Record<string, () => FakeAnswer | Promise<FakeAnswer>>;
  /** The URLs the test import hook was asked for. */
  imports: string[];
  /** With `fakeTimers`: every timer the page set, in order. */
  timers: FakeTimer[];
  /** With `fakeTimers`: run each pending timer of at least `atLeastMs`. */
  runTimers(atLeastMs: number): void;
  /** Run assets/<file> in the page, in order (as the page's deferred script tags would). */
  run(...files: string[]): void;
  /** Let every pending promise and timer settle. */
  settle(): Promise<void>;
}

const ASSETS = join(__dirname, "..", "..", "..", "..", "assets");

/**
 * A jsdom page holding `body`, with the fakes installed: `window.pmtiles`,
 * `window.fetch` (answering `routes`, 404 for anything else),
 * `window.caches` (unless `caches: false`) and the test-only import hook
 * (`window.__catMapImport`), which hands map-core `lib` (or rejects when
 * `importFails`).
 */
export function mapScriptRig(
  body: string,
  opts: {
    url?: string;
    lib?: FakeLib;
    caches?: boolean;
    /** Share another rig's Cache API (a second page load on the same browser). */
    cachesFake?: FakeCaches;
    pmtiles?: boolean;
    fetch?: boolean;
    importFails?: boolean;
    routes?: Record<string, () => FakeAnswer | Promise<FakeAnswer>>;
    /** Replace the page's setTimeout/clearTimeout with recorded ones the test runs (rig.timers). */
    fakeTimers?: boolean;
  } = {},
): MapScriptRig {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url: opts.url ?? "https://team.example/api/team/sites",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const lib = opts.lib ?? makeMaplibreFake();
  const pm = makePmtilesFake();
  const routes = opts.routes ?? mapDataRoutes();
  const fetches: FetchCall[] = [];
  const imports: string[] = [];
  if (opts.pmtiles !== false) w.pmtiles = pm;
  if (opts.fetch !== false) {
    w.fetch = async (input: any, init: any) => {
      const url = new w.URL(typeof input === "string" ? input : input.url, w.location.href).href;
      fetches.push({ url, init });
      const u = new w.URL(url);
      const route = u.origin === w.location.origin && u.search === "" ? routes[u.pathname] : undefined;
      return makeResponse(w, url, route ? await route() : { status: 404, body: "not found" });
    };
  } else {
    delete w.fetch;
  }
  const caches = opts.caches === false ? null : (opts.cachesFake ?? makeCachesFake(w));
  if (caches) w.caches = caches;
  else delete w.caches;
  const timers: FakeTimer[] = [];
  if (opts.fakeTimers) {
    w.setTimeout = (fn: () => void, ms: number) => timers.push({ fn, ms, cleared: false, ran: false });
    w.clearTimeout = (id: number) => {
      if (timers[id - 1]) timers[id - 1]!.cleared = true;
    };
  }
  w.__catMapImport = (url: string) => {
    imports.push(url);
    return opts.importFails ? Promise.reject(new TypeError("import failed")) : Promise.resolve(lib);
  };
  return {
    window: w,
    document: w.document,
    lib,
    pm,
    caches,
    fetches,
    routes,
    imports,
    timers,
    runTimers(atLeastMs: number) {
      for (const t of timers) {
        if (!t.cleared && !t.ran && t.ms >= atLeastMs) {
          t.ran = true;
          t.fn();
        }
      }
    },
    run(...files: string[]) {
      for (const f of files) w.eval(readFileSync(join(ASSETS, f), "utf8"));
    },
    async settle() {
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    },
  };
}
