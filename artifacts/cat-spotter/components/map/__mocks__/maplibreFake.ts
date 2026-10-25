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
 * fire their events synchronously: movestart, move, moveend, plus zoomstart,
 * zoom, zoomend when the zoom changed. Nothing animates.
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
type Listener = (event: Record<string, unknown>) => void;

interface Registration {
  type: string;
  layerId: string | null;
  listener: Listener;
  once: boolean;
}

/** Container size every new map takes, until setFakeContainerSize changes it. */
export const DEFAULT_CONTAINER_SIZE = { width: 390, height: 600 };

const state = {
  supported: true,
  constructorError: null as Error | null,
  containerSize: { ...DEFAULT_CONTAINER_SIZE },
};

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
  enable(): void {
    this.map.calls.push({ method: `${this.label}.enable`, args: [] });
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
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  width: number;
  height: number;
  center: FakeLngLat;
  /** MapLibre's own zoom (512-px world). */
  zoom: number;
  minZoom: number;
  maxZoom: number;
  style: unknown;
  /** Layout properties set so far, by layer id then property name. */
  readonly layout: Record<string, Record<string, unknown>> = {};
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
    if (type === 'load' || type === 'style.load') this.styleLoaded = true;
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
    return { x: p.x - c.x + this.width / 2, y: p.y - c.y + this.height / 2 };
  }

  unproject(point: PointInput): FakeLngLat {
    const { x, y } = toPoint(point);
    const z = fromMapLibreZoom(this.zoom);
    const c = toWorld(asLatLng(this.center), z);
    const ll = fromWorld({ x: c.x + x - this.width / 2, y: c.y + y - this.height / 2 }, z);
    return { lng: ll.longitude, lat: ll.latitude };
  }

  private moveCamera(next: { center?: LngLatInput; zoom?: number }, source: Record<string, unknown> = {}): void {
    const prevZoom = this.zoom;
    if (next.center) this.center = toLngLat(next.center);
    if (typeof next.zoom === 'number') this.zoom = this.clamp(next.zoom);
    const zoomed = this.zoom !== prevZoom;
    this.fire('movestart', source);
    if (zoomed) this.fire('zoomstart', source);
    this.fire('move', source);
    if (zoomed) this.fire('zoom', source);
    this.fire('moveend', source);
    if (zoomed) this.fire('zoomend', source);
  }

  jumpTo(opts: { center?: LngLatInput; zoom?: number }, eventData?: Record<string, unknown>): this {
    this.record('jumpTo', eventData === undefined ? [opts] : [opts, eventData]);
    this.moveCamera(opts, eventData);
    return this;
  }

  easeTo(opts: { center?: LngLatInput; zoom?: number; duration?: number }, eventData?: Record<string, unknown>): this {
    this.record('easeTo', eventData === undefined ? [opts] : [opts, eventData]);
    this.moveCamera(opts, eventData);
    return this;
  }

  flyTo(opts: { center?: LngLatInput; zoom?: number }, eventData?: Record<string, unknown>): this {
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

  setCenter(center: LngLatInput): this {
    this.record('setCenter', [center]);
    this.moveCamera({ center });
    return this;
  }

  // --- style ----------------------------------------------------------------

  setStyle(style: unknown, options?: unknown): this {
    this.record('setStyle', options === undefined ? [style] : [style, options]);
    this.style = style;
    return this;
  }

  getStyle(): unknown {
    return this.style;
  }

  isStyleLoaded(): boolean {
    return this.styleLoaded;
  }

  setLayoutProperty(layerId: string, name: string, value: unknown): this {
    this.record('setLayoutProperty', [layerId, name, value]);
    (this.layout[layerId] ??= {})[name] = value;
    return this;
  }

  getLayoutProperty(layerId: string, name: string): unknown {
    return this.layout[layerId]?.[name];
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
    FakeProtocol.instances.push(this);
  }
  tile = (...args: unknown[]): Promise<{ data: null }> => {
    this.tileCalls.push(args);
    return Promise.resolve({ data: null });
  };
}

function supported(): boolean {
  return state.supported;
}

function addProtocol(name: string, loadFn: unknown): void {
  protocolCalls.push({ protocol: name, loadFn });
}

function removeProtocol(name: string): void {
  const i = protocolCalls.findIndex((c) => c.protocol === name);
  if (i >= 0) protocolCalls.splice(i, 1);
}

const maplibreApi = { Map: FakeMap, supported, addProtocol, removeProtocol };

/** What `import('maplibre-gl')` resolves to: named exports plus a default. */
export const maplibreModule = { ...maplibreApi, default: maplibreApi };

/** What `import('pmtiles')` resolves to. */
export const pmtilesModule = { Protocol: FakeProtocol, default: { Protocol: FakeProtocol } };

// --- test controls -----------------------------------------------------------

/** Make `supported()` answer false (or true again). */
export function setWebGLSupported(value: boolean): void {
  state.supported = value;
}

/** Make `new Map()` throw, as real MapLibre does without WebGL. null stops it. */
export function makeMapConstructorThrow(error: Error | null = new Error('Failed to initialize WebGL')): void {
  state.constructorError = error;
}

/** Container size for maps created from now on. */
export function setFakeContainerSize(width: number, height: number): void {
  state.containerSize = { width, height };
}

/** The most recently constructed map, or null. */
export function lastMap(): FakeMap | null {
  return FakeMap.instances[FakeMap.instances.length - 1] ?? null;
}

/** Back to defaults: WebGL supported, no throwing, 390×600, no instances or protocol calls. */
export function resetMaplibreFake(): void {
  state.supported = true;
  state.constructorError = null;
  state.containerSize = { ...DEFAULT_CONTAINER_SIZE };
  FakeMap.instances = [];
  FakeProtocol.instances = [];
  protocolCalls.length = 0;
}
