/**
 * SYC-705: a stand-in for maplibre-gl (and pmtiles) in jsdom tests. jsdom has
 * no WebGL, so the real library can't run there; this fake keeps the parts of
 * the Map API the website uses, records every call in `calls`, and does real
 * Web Mercator maths for project/unproject so overlay positions can be tested.
 *
 * Wire it in with:
 *   vi.mock('maplibre-gl', async () => (await import('<path>/__mocks__/maplibreFake')).maplibreModule);
 *   vi.mock('pmtiles', async () => (await import('<path>/__mocks__/maplibreFake')).pmtilesModule);
 * and call resetMaplibreFake() in beforeEach.
 *
 * Camera moves (jumpTo, easeTo, panBy, setZoom, setCenter) land at once and
 * fire their events synchronously in real jumpTo order: movestart, move,
 * [zoomstart, zoom, zoomend], moveend (zoom ones only when the zoom changed).
 * Nothing animates. Real easeTo/flyTo/panBy DO animate (panBy defaults to
 * 500 ms): don't write tests that rely on the camera having moved at once
 * after those; only jumpTo/setCenter/setZoom are synchronous for real.
 *
 * Style loading is modelled like real MapLibre: setLayoutProperty, addSource
 * and addLayer throw "Style is not done loading." until the style has loaded
 * (fire('styledata') or fire('load')), and setStyle unloads it again. A
 * rejected call lands in `rejected`, not `calls`.
 *
 * Module shape follows maplibre-gl 6: named exports only (no default), no
 * `supported()`; without WebGL2 the Map constructor throws
 * GPUInitializationError. setWorkerUrl/getVersion are recorded in
 * `workerUrlCalls` so tests can check the worker is pointed at before the
 * first map is made.
 *
 * Bearing (added for SYC-705 Task 3.4, the rotating cats map): `bearing` is
 * degrees clockwise from north of the screen's "up", as in MapLibre, kept in
 * (-180, 180]. project/unproject honour it (a positive bearing turns the map
 * content anticlockwise on screen), and jumpTo/easeTo/flyTo accept `bearing`.
 * A bearing change fires rotatestart, rotate, rotateend after any zoom
 * events and before moveend. The constructor reads `options.bearing`.
 */
import { fromMapLibreZoom, fromWorld, toWorld, type LatLng } from '@/lib/mercator';

export interface FakeCall {
  method: string;
  args: unknown[];
}

export interface FakeLngLat {
  lng: number;
  lat: number;
}

export interface FakePoint {
  x: number;
  y: number;
}

type LngLatInput = [number, number] | { lng: number; lat: number } | { lon: number; lat: number };
type PointInput = [number, number] | FakePoint;
type CameraOptions = { center?: LngLatInput; zoom?: number; bearing?: number };
type Listener = (event: Record<string, unknown>) => void;

interface Registration {
  type: string;
  layerId: string | null;
  listener: Listener;
  once: boolean;
}

/** Container size every new map takes, until setFakeContainerSize changes it. */
export const DEFAULT_CONTAINER_SIZE = { width: 390, height: 600 };

/** The version getVersion() reports. */
export const FAKE_MAPLIBRE_VERSION = '6.0.0-fake';

const state = {
  webgl2: true,
  constructorError: null as Error | null,
  protocolError: null as Error | null,
  containerSize: { ...DEFAULT_CONTAINER_SIZE },
};

/** Every setWorkerUrl call, in order, with how many maps existed at the time. */
export const workerUrlCalls: Array<{ url: string; mapsBefore: number }> = [];

/** Every addProtocol call, in order. */
export const protocolCalls: Array<{ protocol: string; loadFn: unknown }> = [];

function toLngLat(input: LngLatInput): FakeLngLat {
  if (Array.isArray(input)) return { lng: input[0], lat: input[1] };
  if ('lng' in input) return { lng: input.lng, lat: input.lat };
  return { lng: input.lon, lat: input.lat };
}

function toPoint(input: PointInput): FakePoint {
  return Array.isArray(input) ? { x: input[0], y: input[1] } : { x: input.x, y: input.y };
}

function normaliseBearing(b: number): number {
  const r = ((((b + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

function asLatLng({ lng, lat }: FakeLngLat): LatLng {
  return { latitude: lat, longitude: lng };
}

/** A handler such as dragRotate: enable/disable plus the rotation switches. */
export class FakeHandler {
  enabled = true;
  rotationEnabled = true;
  constructor(
    private readonly map: FakeMap,
    private readonly label: string,
  ) {}
  /** The options of the latest enable(options) call (MapLibre's scroll/touch zoom take `{ around: 'center' }`). */
  enableOptions: unknown = undefined;
  enable(options?: unknown): void {
    this.map.calls.push({ method: `${this.label}.enable`, args: options === undefined ? [] : [options] });
    this.enableOptions = options;
    this.enabled = true;
  }
  disable(): void {
    this.map.calls.push({ method: `${this.label}.disable`, args: [] });
    this.enabled = false;
  }
  isEnabled(): boolean {
    return this.enabled;
  }
  enableRotation(): void {
    this.map.calls.push({ method: `${this.label}.enableRotation`, args: [] });
    this.rotationEnabled = true;
  }
  disableRotation(): void {
    this.map.calls.push({ method: `${this.label}.disableRotation`, args: [] });
    this.rotationEnabled = false;
  }
}

export class FakeMap {
  /** Every map constructed since the last reset, oldest first. */
  static instances: FakeMap[] = [];

  readonly options: Record<string, unknown>;
  readonly calls: FakeCall[] = [];
  /** Calls refused because the style wasn't loaded yet. */
  readonly rejected: FakeCall[] = [];
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  width: number;
  height: number;
  center: FakeLngLat;
  /** MapLibre's own zoom (512-px world). */
  zoom: number;
  /** Degrees clockwise from north of the screen's up, in (-180, 180]. */
  bearing: number;
  minZoom: number;
  maxZoom: number;
  style: unknown;
  /** Layout properties set so far, by layer id then property name. */
  readonly layout: Record<string, Record<string, unknown>> = {};
  /** Sources and layers added so far, by id. */
  readonly sources: Record<string, unknown> = {};
  readonly layers: Record<string, unknown> = {};
  removed = false;
  styleLoaded = false;

  readonly dragRotate: FakeHandler;
  readonly touchZoomRotate: FakeHandler;
  readonly keyboard: FakeHandler;
  readonly dragPan: FakeHandler;
  readonly scrollZoom: FakeHandler;
  readonly doubleClickZoom: FakeHandler;
  readonly touchPitch: FakeHandler;

  private registrations: Registration[] = [];

  constructor(options: Record<string, unknown>) {
    if (!state.webgl2) throw new GPUInitializationError('WebGL2 is not supported');
    if (state.constructorError) throw state.constructorError;
    this.options = options;
    this.container = options.container as HTMLElement;
    this.canvas = document.createElement('canvas');
    this.width = state.containerSize.width;
    this.height = state.containerSize.height;
    this.center = options.center ? toLngLat(options.center as LngLatInput) : { lng: 0, lat: 0 };
    this.minZoom = typeof options.minZoom === 'number' ? options.minZoom : 0;
    this.maxZoom = typeof options.maxZoom === 'number' ? options.maxZoom : 22;
    this.zoom = this.clamp(typeof options.zoom === 'number' ? options.zoom : 0);
    this.bearing = normaliseBearing(typeof options.bearing === 'number' ? options.bearing : 0);
    this.style = options.style;
    this.dragRotate = new FakeHandler(this, 'dragRotate');
    this.touchZoomRotate = new FakeHandler(this, 'touchZoomRotate');
    this.keyboard = new FakeHandler(this, 'keyboard');
    this.dragPan = new FakeHandler(this, 'dragPan');
    this.scrollZoom = new FakeHandler(this, 'scrollZoom');
    this.doubleClickZoom = new FakeHandler(this, 'doubleClickZoom');
    this.touchPitch = new FakeHandler(this, 'touchPitch');
    FakeMap.instances.push(this);
  }

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  private clamp(z: number): number {
    return Math.min(this.maxZoom, Math.max(this.minZoom, z));
  }

  /** Calls made to one method, e.g. callsTo('setLayoutProperty'). */
  callsTo(method: string): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  // --- events ---------------------------------------------------------------

  on(type: string, layerOrListener: string | Listener, maybeListener?: Listener): this {
    this.record('on', [type, layerOrListener, maybeListener].filter((a) => a !== undefined));
    this.register(type, layerOrListener, maybeListener, false);
    return this;
  }

  once(type: string, layerOrListener?: string | Listener, maybeListener?: Listener): this | Promise<unknown> {
    this.record('once', [type, layerOrListener, maybeListener].filter((a) => a !== undefined));
    if (layerOrListener === undefined) {
      return new Promise((resolve) => this.register(type, resolve as Listener, undefined, true));
    }
    this.register(type, layerOrListener, maybeListener, true);
    return this;
  }

  off(type: string, layerOrListener: string | Listener, maybeListener?: Listener): this {
    this.record('off', [type, layerOrListener, maybeListener].filter((a) => a !== undefined));
    const layerId = typeof layerOrListener === 'string' ? layerOrListener : null;
    const listener = typeof layerOrListener === 'string' ? maybeListener : layerOrListener;
    this.registrations = this.registrations.filter(
      (r) => !(r.type === type && r.layerId === layerId && r.listener === listener),
    );
    return this;
  }

  private register(
    type: string,
    layerOrListener: string | Listener,
    maybeListener: Listener | undefined,
    once: boolean,
  ): void {
    const layerId = typeof layerOrListener === 'string' ? layerOrListener : null;
    const listener = typeof layerOrListener === 'string' ? maybeListener : layerOrListener;
    if (!listener) return;
    this.registrations.push({ type, layerId, listener, once });
  }

  /** How many listeners are registered for an event (all layers). */
  listenerCount(type: string): number {
    return this.registrations.filter((r) => r.type === type).length;
  }

  /**
   * Test helper: emit an event as MapLibre would. The event object gets
   * `type` and `target`. For mouse-style events, pass `point` or `lngLat`
   * and the other is filled in. Listeners added with a layer id run only when
   * `data.layerId` names that layer. 'load' also marks the style loaded.
   */
  fire(type: string, data: Record<string, unknown> = {}): this {
    if (type === 'load' || type === 'style.load' || type === 'styledata') this.styleLoaded = true;
    const event: Record<string, unknown> = { type, target: this, ...data };
    if (event.point && !event.lngLat) event.lngLat = this.unproject(event.point as PointInput);
    if (event.lngLat && !event.point) event.point = this.project(event.lngLat as LngLatInput);
    const layerId = typeof data.layerId === 'string' ? data.layerId : null;
    for (const r of [...this.registrations]) {
      if (r.type !== type) continue;
      if (r.layerId !== null && r.layerId !== layerId) continue;
      if (r.once) this.registrations = this.registrations.filter((x) => x !== r);
      r.listener(event);
    }
    return this;
  }

  // --- camera ---------------------------------------------------------------

  getZoom(): number {
    return this.zoom;
  }

  getCenter(): FakeLngLat {
    return { ...this.center };
  }

  getBearing(): number {
    return this.bearing;
  }

  getMinZoom(): number {
    return this.minZoom;
  }

  getMaxZoom(): number {
    return this.maxZoom;
  }

  /** Pixel position relative to the container (0,0 is its top-left). */
  project(lngLat: LngLatInput): FakePoint {
    const z = fromMapLibreZoom(this.zoom);
    const p = toWorld(asLatLng(toLngLat(lngLat)), z);
    const c = toWorld(asLatLng(this.center), z);
    // Turn the offset from the centre by -bearing (anticlockwise on screen, y down).
    const b = (this.bearing * Math.PI) / 180;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return {
      x: dx * Math.cos(b) + dy * Math.sin(b) + this.width / 2,
      y: -dx * Math.sin(b) + dy * Math.cos(b) + this.height / 2,
    };
  }

  unproject(point: PointInput): FakeLngLat {
    const { x, y } = toPoint(point);
    const z = fromMapLibreZoom(this.zoom);
    const c = toWorld(asLatLng(this.center), z);
    const b = (this.bearing * Math.PI) / 180;
    const sx = x - this.width / 2;
    const sy = y - this.height / 2;
    const dx = sx * Math.cos(b) - sy * Math.sin(b);
    const dy = sx * Math.sin(b) + sy * Math.cos(b);
    const ll = fromWorld({ x: c.x + dx, y: c.y + dy }, z);
    return { lng: ll.longitude, lat: ll.latitude };
  }

  private moveCamera(next: CameraOptions, source: Record<string, unknown> = {}): void {
    const prevZoom = this.zoom;
    const prevBearing = this.bearing;
    if (next.center) this.center = toLngLat(next.center);
    if (typeof next.zoom === 'number') this.zoom = this.clamp(next.zoom);
    if (typeof next.bearing === 'number') this.bearing = normaliseBearing(next.bearing);
    const zoomed = this.zoom !== prevZoom;
    const rotated = this.bearing !== prevBearing;
    this.fire('movestart', source);
    this.fire('move', source);
    if (zoomed) {
      this.fire('zoomstart', source);
      this.fire('zoom', source);
      this.fire('zoomend', source);
    }
    if (rotated) {
      this.fire('rotatestart', source);
      this.fire('rotate', source);
      this.fire('rotateend', source);
    }
    this.fire('moveend', source);
  }

  jumpTo(opts: CameraOptions, eventData?: Record<string, unknown>): this {
    this.record('jumpTo', eventData === undefined ? [opts] : [opts, eventData]);
    this.moveCamera(opts, eventData);
    return this;
  }

  easeTo(opts: CameraOptions & { duration?: number }, eventData?: Record<string, unknown>): this {
    this.record('easeTo', eventData === undefined ? [opts] : [opts, eventData]);
    this.moveCamera(opts, eventData);
    return this;
  }

  flyTo(opts: CameraOptions, eventData?: Record<string, unknown>): this {
    this.record('flyTo', eventData === undefined ? [opts] : [opts, eventData]);
    this.moveCamera(opts, eventData);
    return this;
  }

  /** Moves the view by a pixel offset: the point at `offset` from the centre becomes the centre. */
  panBy(offset: PointInput, opts?: Record<string, unknown>, eventData?: Record<string, unknown>): this {
    this.record('panBy', [offset, opts, eventData].filter((a) => a !== undefined));
    const { x, y } = toPoint(offset);
    const center = this.unproject([this.width / 2 + x, this.height / 2 + y]);
    this.moveCamera({ center }, eventData);
    return this;
  }

  setZoom(zoom: number): this {
    this.record('setZoom', [zoom]);
    this.moveCamera({ zoom });
    return this;
  }

  setBearing(bearing: number): this {
    this.record('setBearing', [bearing]);
    this.moveCamera({ bearing });
    return this;
  }

  setCenter(center: LngLatInput): this {
    this.record('setCenter', [center]);
    this.moveCamera({ center });
    return this;
  }

  // --- style ----------------------------------------------------------------

  /** The new style counts as loading until a 'styledata' or 'load' is fired. */
  setStyle(style: unknown, options?: unknown): this {
    this.record('setStyle', options === undefined ? [style] : [style, options]);
    this.style = style;
    this.styleLoaded = false;
    return this;
  }

  /** Throws like real MapLibre while the style is loading. */
  private requireStyle(method: string, args: unknown[]): void {
    if (this.styleLoaded) return;
    this.rejected.push({ method, args });
    throw new Error('Style is not done loading.');
  }

  getStyle(): unknown {
    return this.style;
  }

  isStyleLoaded(): boolean {
    return this.styleLoaded;
  }

  setLayoutProperty(layerId: string, name: string, value: unknown): this {
    this.requireStyle('setLayoutProperty', [layerId, name, value]);
    this.record('setLayoutProperty', [layerId, name, value]);
    (this.layout[layerId] ??= {})[name] = value;
    return this;
  }

  getLayoutProperty(layerId: string, name: string): unknown {
    return this.layout[layerId]?.[name];
  }

  addSource(id: string, source: unknown): this {
    this.requireStyle('addSource', [id, source]);
    this.record('addSource', [id, source]);
    this.sources[id] = source;
    return this;
  }

  getSource(id: string): unknown {
    return this.sources[id];
  }

  addLayer(layer: { id: string }, beforeId?: string): this {
    const args = beforeId === undefined ? [layer] : [layer, beforeId];
    this.requireStyle('addLayer', args);
    this.record('addLayer', args);
    this.layers[layer.id] = layer;
    return this;
  }

  getLayer(id: string): unknown {
    return this.layers[id];
  }

  // --- DOM and lifecycle ----------------------------------------------------

  getContainer(): HTMLElement {
    return this.container;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getCanvasContainer(): HTMLElement {
    return this.container;
  }

  /** Real MapLibre re-reads the container size here; the fake keeps width/height. */
  resize(): this {
    this.record('resize', []);
    this.fire('resize');
    return this;
  }

  remove(): void {
    this.record('remove', []);
    this.removed = true;
    this.registrations = [];
  }
}

export class FakeProtocol {
  static instances: FakeProtocol[] = [];
  readonly tileCalls: unknown[][] = [];
  constructor() {
    if (state.protocolError) throw state.protocolError;
    FakeProtocol.instances.push(this);
  }
  tile = (...args: unknown[]): Promise<{ data: null }> => {
    this.tileCalls.push(args);
    return Promise.resolve({ data: null });
  };
}

/** As maplibre-gl 6 exports it: what `new Map()` throws without WebGL2. */
export class GPUInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GPUInitializationError';
  }
}

function setWorkerUrl(url: string): void {
  workerUrlCalls.push({ url, mapsBefore: FakeMap.instances.length });
}

function getVersion(): string {
  return FAKE_MAPLIBRE_VERSION;
}

function addProtocol(name: string, loadFn: unknown): void {
  protocolCalls.push({ protocol: name, loadFn });
}

function removeProtocol(name: string): void {
  const i = protocolCalls.findIndex((c) => c.protocol === name);
  if (i >= 0) protocolCalls.splice(i, 1);
}

/** What `import('maplibre-gl')` resolves to: named exports only, as in maplibre-gl 6. */
export const maplibreModule = {
  Map: FakeMap,
  GPUInitializationError,
  addProtocol,
  removeProtocol,
  setWorkerUrl,
  getVersion,
};

/** What `import('pmtiles')` resolves to. */
export const pmtilesModule = { Protocol: FakeProtocol, default: { Protocol: FakeProtocol } };

// --- test controls -----------------------------------------------------------

/** Without WebGL2 (false), `new Map()` throws GPUInitializationError, as maplibre-gl 6 does. */
export function setWebGLSupported(value: boolean): void {
  state.webgl2 = value;
}

/** Make `new Map()` throw, as real MapLibre does without WebGL. null stops it. */
export function makeMapConstructorThrow(error: Error | null = new Error('Failed to initialize WebGL')): void {
  state.constructorError = error;
}

/** Make `new pmtiles.Protocol()` throw (protocol setup failing). null stops it. */
export function makeProtocolSetupThrow(error: Error | null = new Error('pmtiles setup failed')): void {
  state.protocolError = error;
}

/** Container size for maps created from now on. */
export function setFakeContainerSize(width: number, height: number): void {
  state.containerSize = { width, height };
}

/** The most recently constructed map, or null. */
export function lastMap(): FakeMap | null {
  return FakeMap.instances[FakeMap.instances.length - 1] ?? null;
}

/** Back to defaults: WebGL2 supported, no throwing, 390×600, no instances, protocol or worker calls. */
export function resetMaplibreFake(): void {
  state.webgl2 = true;
  state.constructorError = null;
  state.protocolError = null;
  state.containerSize = { ...DEFAULT_CONTAINER_SIZE };
  FakeMap.instances = [];
  FakeProtocol.instances = [];
  protocolCalls.length = 0;
  workerUrlCalls.length = 0;
}
