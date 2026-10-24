import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// SYC-619 Task 14 (spec §5.5): the map's own grid puts cats either side of a
// grid line into two bubbles that nearly touch. After bucketing, any bubbles
// closer than one cell (44px) are merged, repeatedly, into one at the cats'
// average point.

const SRC = readFileSync(join(__dirname, "../../../assets/dashboard-map.js"), "utf8");

function chain(): any {
  return new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? undefined : p === Symbol.toPrimitive ? () => 0 : chain()),
    apply: () => chain(),
    construct: () => chain(),
  });
}

interface Cat {
  id: number;
  name: string;
  mark: string;
  lat: number;
  lng: number;
}
interface Mk {
  x: number;
  y: number;
  cats: Cat[];
}
interface StubMarker {
  at: any;
  opts: any;
  handlers: Record<string, (e: unknown) => void>;
}

const cat = (id: number, x: number, y: number): Cat => ({ id, name: "Cat " + id, mark: "sterilised", lat: y, lng: x });

/** The script in jsdom with a Leaflet stub where a cat's lng/lat ARE its screen x/y. */
function setUp(cats: Cat[] = [], zoom = 19) {
  const dom = new JSDOM(
    "<!doctype html><html><body>" +
      '<form id="catfilters" action="/api/team/cats"></form><div id="mapcount"></div>' +
      '<div id="mapscripted"><div id="island-map" data-areas="[]"></div></div>' +
      '<div id="catsheet" hidden></div></body></html>',
    { url: "https://team.example/api/team/cats?view=map", runScripts: "outside-only" },
  );
  const w = dom.window as any;
  w.__dashboardMapTest = true;

  const groups: Array<{ layers: StubMarker[] }> = [];
  const map = new Proxy(
    {
      getZoom: () => zoom,
      getMinZoom: () => 12,
      getMaxZoom: () => 19,
      project: (ll: number[]) => ({ x: ll[1], y: ll[0] }),
      setView: () => {},
    } as Record<string, unknown>,
    { get: (t, p: string) => (p in t ? t[p] : chain()) },
  );
  w.L = new Proxy(
    {
      map: () => map,
      layerGroup: () => {
        const g = { layers: [] as StubMarker[] };
        groups.push(g);
        const stub: any = {
          addTo: () => stub,
          addLayer: (m: StubMarker) => g.layers.push(m),
          clearLayers: () => {
            g.layers = [];
          },
        };
        return new Proxy(stub, { get: (t, p: string) => (p in t ? t[p] : chain()) });
      },
      latLng: (lat: number, lng: number) => ({ lat, lng }),
      divIcon: (o: unknown) => o,
      marker: (at: any, opts: any) => {
        const m: any = { at, opts, handlers: {} as Record<string, (e: unknown) => void> };
        m.on = (ev: string, fn: (e: unknown) => void) => {
          m.handlers[ev] = fn;
          return m;
        };
        return new Proxy(m, { get: (t, p: string) => (p in t ? t[p] : chain()) });
      },
    } as Record<string, unknown>,
    { get: (t, p: string) => (p in t ? t[p] : chain()) },
  );
  w.fetch = (url: string) => {
    if (!url.includes("/cats/positions")) return new Promise(() => {});
    return Promise.resolve({
      ok: true,
      redirected: false,
      headers: { get: () => "application/json" },
      json: async () => ({ cats }),
    });
  };
  w.eval(SRC);
  return {
    w,
    mergeClose: w.__dashboardMapInternals?.mergeClose as (m: Mk[], px: number) => Mk[],
    /** The markers the real drawCats put on the cats layer (the first layer group). */
    drawn: async () => {
      await new Promise((r) => setTimeout(r, 10));
      return groups[0]!.layers;
    },
  };
}

const mk = (x: number, y: number, n = 1): Mk => ({
  x,
  y,
  cats: Array.from({ length: n }, (_, i) => cat(Math.round(x * 1000 + y + i), x, y)),
});

describe("mergeClose", () => {
  const { mergeClose } = setUp();

  it("is reachable only when the test flag is set", () => {
    const dom = new JSDOM(
      '<form id="catfilters"></form><div id="mapscripted"><div id="island-map"></div></div>',
      { runScripts: "outside-only" },
    );
    (dom.window as any).L = chain();
    (dom.window as any).fetch = () => new Promise(() => {});
    dom.window.eval(SRC);
    expect((dom.window as any).__dashboardMapInternals).toBeUndefined();
    expect(typeof mergeClose).toBe("function");
  });

  it("turns two markers 30px apart into one holding both sets of cats", () => {
    const out = mergeClose([mk(100, 100, 2), mk(130, 100, 3)], 44);
    expect(out).toHaveLength(1);
    expect(out[0]!.cats).toHaveLength(5);
  });

  it("ends a chain of three markers 40px apart as one marker", () => {
    const out = mergeClose([mk(0, 0), mk(40, 0), mk(80, 0)], 44);
    expect(out).toHaveLength(1);
    expect(out[0]!.cats).toHaveLength(3);
  });

  it("repeats until stable: a merge that brings the result near a third marker folds that in too", () => {
    // (46,0) and (30,35) are 38.5px apart and merge first; the result sits
    // about 42px from (0,0), which only a second pass can see.
    const out = mergeClose([mk(0, 0), mk(46, 0), mk(30, 35)], 44);
    expect(out).toHaveLength(1);
    expect(out[0]!.cats).toHaveLength(3);
  });

  it("leaves markers 50px apart as they are", () => {
    const input = [mk(0, 0), mk(50, 0)];
    const out = mergeClose(input, 44);
    expect(out).toHaveLength(2);
    expect(out.map((m) => [m.x, m.y])).toEqual([[0, 0], [50, 0]]);
  });

  it("sits the merged marker at the cats' average, weighted by how many cats each held", () => {
    const out = mergeClose([mk(0, 0, 10), mk(33, 0, 1)], 44);
    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBeCloseTo(3, 6);
    expect(out[0]!.y).toBeCloseTo(0, 6);
  });

  it("leaves no pair under 44px for 2,000 random cats, in under 50ms (best of 3)", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const make = () => Array.from({ length: 2000 }, () => mk(rnd() * 1000, rnd() * 800));
    let best = Infinity;
    let out: Mk[] = [];
    for (let run = 0; run < 3; run++) {
      const input = make();
      const t0 = performance.now();
      out = mergeClose(input, 44);
      best = Math.min(best, performance.now() - t0);
    }
    expect(out.reduce((n, m) => n + m.cats.length, 0)).toBe(2000);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        expect(Math.hypot(out[i]!.x - out[j]!.x, out[i]!.y - out[j]!.y)).toBeGreaterThanOrEqual(44);
    // Guards against a quadratic blow-up, not frame timing.
    expect(best).toBeLessThan(50);
  });
});

describe("the real drawCats", () => {
  it("draws one bubble for two cats either side of a grid line (fails without the merge pass)", async () => {
    // x = 40 and x = 70 sit in cells 0 and 1 (CELL = 44) yet are 30px apart.
    const t = setUp([cat(1, 40, 10), cat(2, 70, 10)], 15);
    const drawn = await t.drawn();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.opts.title).toContain("2 cats here");
  });

  it("keeps cats 50px apart as two markers", async () => {
    const t = setUp([cat(1, 10, 10), cat(2, 60, 10)], 15);
    expect(await t.drawn()).toHaveLength(2);
  });

  it("review focus 5: 30 cats at one point at the closest zoom are one group whose tap lists all 30", async () => {
    const cats = Array.from({ length: 30 }, (_, i) => cat(i + 1, 500, 500));
    const t = setUp(cats, 19);
    const drawn = await t.drawn();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.opts.title).toContain("30 cats here");
    drawn[0]!.handlers.click!({});
    const sheet = t.w.document.getElementById("catsheet");
    expect(sheet.hidden).toBe(false);
    expect(sheet.querySelector(".sheetname").textContent).toBe("30 cats here");
    expect(sheet.querySelectorAll("ul.cats li")).toHaveLength(30);
  });
});
