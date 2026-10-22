import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// SYC-573 (spec §3.2): the island map opens fitted to the cats, ONCE, on the
// first positions answer, and only if there is no focused cat and the person
// hasn't moved the map. Never again (filters, typing). This runs the real
// script in a stand-in page with a recording Leaflet stub whose moves fire
// `movestart` the way Leaflet does, so the "was that move ours?" logic is
// what is tested.

const SRC = readFileSync(join(__dirname, "../../../assets/dashboard-map.js"), "utf8");

/** Anything: callable, constructible, every property another such thing. */
function chain(): any {
  return new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? undefined : p === Symbol.toPrimitive ? () => 0 : chain()),
    apply: () => chain(),
    construct: () => chain(),
  });
}

interface Bounds {
  pts: unknown[];
  padBy?: number;
  pad(n: number): Bounds;
}
const bounds = (pts: unknown[], padBy?: number): Bounds => ({
  pts,
  padBy,
  pad: (n: number) => bounds(pts, n),
});

function setUp(opts: { focus?: unknown } = {}) {
  const dom = new JSDOM(
    "<!doctype html><html><body>" +
      '<form id="catfilters" action="/api/team/cats"><input type="checkbox" name="colours" value="ginger"></form>' +
      '<div id="mapcount"></div>' +
      '<div id="mapscripted"><div id="island-map" ' +
      (opts.focus ? `data-focus='${JSON.stringify(opts.focus)}' ` : "") +
      `data-areas='${JSON.stringify([{ key: "ermoupoli", lat: 37.44, lng: 24.94, zoom: 15 }])}'></div>` +
      '<div id="mapgoto"><button data-area="ermoupoli">Ermoupoli</button></div></div>' +
      "</body></html>",
    { url: "https://team.example/api/team/cats?view=map", runScripts: "outside-only" },
  );
  const w = dom.window as any;

  const handlers: Record<string, Array<() => void>> = {};
  const fits: Array<{ pts: unknown[]; padBy?: number; opts: any }> = [];
  const views: unknown[][] = [];
  const fire = (evt: string) => (handlers[evt] ?? []).forEach((f) => f());

  const map = new Proxy(
    {
      on: (evt: string, fn: () => void) => {
        (handlers[evt] ??= []).push(fn);
        return map;
      },
      fitBounds: (b: Bounds, o: unknown) => {
        fits.push({ pts: b.pts, padBy: b.padBy, opts: o });
        fire("movestart"); // Leaflet fires this synchronously for any move
      },
      setView: (...a: unknown[]) => {
        views.push(a);
        fire("movestart");
      },
      getZoom: () => 13,
      getMinZoom: () => 12,
      getMaxZoom: () => 19,
      project: () => ({ x: 0, y: 0 }),
    } as Record<string, unknown>,
    { get: (t, p: string) => (p in t ? t[p] : chain()) },
  );

  w.L = new Proxy(
    {
      latLngBounds: (pts: unknown[]) => bounds(pts),
      map: () => map,
    } as Record<string, unknown>,
    { get: (t, p: string) => (p in t ? t[p] : chain()) },
  );

  const asks: Array<{ url: string; answer: (cats: unknown[]) => void }> = [];
  w.fetch = (url: string, init: { signal: AbortSignal }) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      if (!url.includes("/cats/positions")) return; // map pictures: never answer
      asks.push({
        url,
        answer: (cats) =>
          resolve({
            ok: true,
            redirected: false,
            headers: { get: () => "application/json" },
            json: async () => ({ cats }),
          }),
      });
    });

  w.eval(SRC);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { w, fits, views, asks, fire, flush };
}

const cat = (id: number, lat: number, lng: number) => ({
  id,
  name: `Cat${id}`,
  mark: "sterilised",
  lat,
  lng,
});

describe("the island map fits to the cats once (SYC-573)", () => {
  it("starts on the island, then fits the first answer with 15% padding and a zoom cap of 16", async () => {
    const t = setUp();
    expect(t.fits).toHaveLength(1); // the island, as before
    t.asks[0]!.answer([cat(1, 37.44, 24.94), cat(2, 37.46, 24.97)]);
    await t.flush();
    expect(t.fits).toHaveLength(2);
    expect(t.fits[1]!.padBy).toBe(0.15);
    expect(t.fits[1]!.opts).toEqual({ maxZoom: 16 });
    expect(t.fits[1]!.pts).toEqual([
      [37.44, 24.94],
      [37.46, 24.97],
    ]);
  });

  it("never refits on a later answer (a filter change or typing)", async () => {
    const t = setUp();
    t.asks[0]!.answer([cat(1, 37.44, 24.94)]);
    await t.flush();
    expect(t.fits).toHaveLength(2);
    t.w.document.getElementById("catfilters").dispatchEvent(new t.w.Event("change", { bubbles: true }));
    await t.flush();
    expect(t.asks).toHaveLength(2);
    t.asks[1]!.answer([cat(3, 37.5, 25.0)]);
    await t.flush();
    expect(t.fits).toHaveLength(2);
  });

  it("does not fit when a cat is in focus", async () => {
    const t = setUp({ focus: { id: 99, points: [] } });
    t.asks[0]!.answer([cat(1, 37.44, 24.94)]);
    await t.flush();
    expect(t.fits).toHaveLength(1);
  });

  it("does not fit after the person has moved the map", async () => {
    const t = setUp();
    t.fire("movestart"); // a drag or zoom: not one of the script's own moves
    t.asks[0]!.answer([cat(1, 37.44, 24.94)]);
    await t.flush();
    expect(t.fits).toHaveLength(1);
  });

  it("does not fit after a Go to press", async () => {
    const t = setUp();
    t.w.document.querySelector("#mapgoto button").click();
    expect(t.views).toHaveLength(1);
    t.asks[0]!.answer([cat(1, 37.44, 24.94)]);
    await t.flush();
    expect(t.fits).toHaveLength(1);
  });

  it("stays on the island when there are no cats, and does not fit later either", async () => {
    const t = setUp();
    t.asks[0]!.answer([]);
    await t.flush();
    expect(t.fits).toHaveLength(1);
    t.w.document.getElementById("catfilters").dispatchEvent(new t.w.Event("change", { bubbles: true }));
    await t.flush();
    t.asks[1]!.answer([cat(1, 37.44, 24.94)]);
    await t.flush();
    expect(t.fits).toHaveLength(1);
  });
});
