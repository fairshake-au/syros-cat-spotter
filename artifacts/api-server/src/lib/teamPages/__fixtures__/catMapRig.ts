import { renderCatMapPage, type CatMapOptions } from "../catMapPage";
import { makeMaplibreFake, mapScriptRig, type FakeAnswer, type FakeLib, type FakeMap, type FetchCall, type MapScriptRig } from "./maplibreFake";

// The island cats map (GET /api/team/cats?view=map) in jsdom, for the
// dashboard-map.js tests (SYC-705 Task 2b.6): the real page from
// renderCatMapPage, its script tags left out, then map-core.js and
// dashboard-map.js run on the fake MapLibre (maplibreFake.ts), as the
// page's deferred scripts would. The cats' positions route answers when the
// test says so.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PositionCat {
  id: number;
  name: string;
  mark: string;
  lat: number;
  lng: number;
  place?: string;
  seen?: string;
  colony?: number | null;
  photo?: string | null;
}

export interface CatMapRig extends MapScriptRig {
  /** Every POST to /api/team/cats/positions, in order. */
  asks: FetchCall[];
  /** Answer the i-th positions request with these cats. */
  answer(i: number, cats: PositionCat[]): Promise<void>;
  /** The one map the page made (throws if none). */
  map(): FakeMap;
  /** The page's filter form. */
  form(): any;
  /** Change the filter form as a person would (runs fn, then a bubbling change event). */
  change(fn?: () => void): void;
  /** Every marker element now on the map with this class. */
  markers(cls: string): any[];
}

export const POSITIONS = "/api/team/cats/positions";

/** The page's HTML body, as the server writes it for these options, without its script tags. */
export function catMapBody(o: Partial<CatMapOptions> = {}): string {
  process.env["TEAM_SESSION_KEYS"] ??= "vitest-catmaprig-key-0123456789abcdef-01234567";
  const html = renderCatMapPage({
    personName: "T",
    filters: {},
    colonies: [],
    cats: [],
    catCount: 0,
    sites: [],
    focus: null,
    now: new Date("2026-10-26T10:00:00Z"),
    ...o,
  });
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1]!;
  return body.replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

export async function catMapRig(
  opts: {
    page?: Partial<CatMapOptions>;
    /** Answer every positions request at once with these cats (default: the test answers). */
    cats?: PositionCat[];
    url?: string;
    lib?: FakeLib;
    /** Before the scripts run (stub something on the window). */
    before?: (rig: MapScriptRig) => void;
    /** Don't wait for the map to start. */
    noSettle?: boolean;
    rig?: Parameters<typeof mapScriptRig>[1];
  } = {},
): Promise<CatMapRig> {
  const pending: ((a: FakeAnswer) => void)[] = [];
  const base = mapScriptRig(catMapBody(opts.page), {
    url: opts.url ?? "https://team.example/api/team/cats?view=map",
    lib: opts.lib ?? makeMaplibreFake({ moveEvents: true }),
    ...opts.rig,
  });
  base.routes[POSITIONS] = () =>
    opts.cats ? { status: 200, body: { cats: opts.cats } } : new Promise<FakeAnswer>((resolve) => pending.push(resolve));
  const rig = base as CatMapRig;
  Object.defineProperty(rig, "asks", {
    get: () => base.fetches.filter((f) => new URL(f.url).pathname === POSITIONS),
  });
  rig.answer = async (i, cats) => {
    await rig.settle();
    const resolve = pending[i];
    if (!resolve) throw new Error(`no positions request ${i} (have ${pending.length})`);
    resolve({ status: 200, body: { cats } });
    await rig.settle();
  };
  rig.map = () => {
    const m = base.lib.maps[0];
    if (!m) throw new Error("no map was made");
    return m;
  };
  rig.form = () => base.document.getElementById("catfilters");
  rig.change = (fn) => {
    fn?.();
    rig.form().dispatchEvent(new base.window.Event("change", { bubbles: true }));
  };
  rig.markers = (cls) =>
    base.lib.markers.filter((k) => !k.removed && k.map && (k.element?.matches?.(`.${cls}`) || k.element?.querySelector?.(`.${cls}`))).map((k) => k.element);
  opts.before?.(base);
  base.run("map-core.js", "dashboard-map.js");
  if (!opts.noSettle) await base.settle();
  return rig;
}

/** A cat for the positions answer, at a position. */
export const posCat = (id: number, lat: number, lng: number, mark = "sterilised"): PositionCat => ({
  id,
  name: `Cat ${"abcdefghijklmnopqrstuvwxyz"[id % 26]}${"abcdefghijklmnopqrstuvwxyz"[Math.floor(id / 26) % 26]}`,
  mark,
  lat,
  lng,
  place: "Ermoupoli",
  seen: "Last seen today",
  colony: null,
  photo: null,
});
