import { beforeAll, describe, expect, it } from "vitest";
import { catMapRig, posCat, type CatMapRig } from "./__fixtures__/catMapRig";
import { renderCatMapPage } from "./catMapPage";

// SYC-619 Task 14 (spec §5.5): the map's own grid puts cats either side of a
// grid line into two bubbles that nearly touch. After bucketing, any bubbles
// closer than one cell (44px) are merged, repeatedly, into one at the cats'
// average point. SYC-705: on MapLibre, positions become screen pixels with
// map.project, measured from a fixed point (gridOrigin) so a pan never
// regroups; the tests place cats at chosen pixels through the fake's own
// projection.

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

const cat = (id: number, x: number, y: number): Cat => ({ id, name: "Cat " + id, mark: "sterilised", lat: y, lng: x });

/** The page at app zoom `appZoom`, the person having moved it (so no fit), with these cats placed at grid pixels (x, y). */
async function drawnAt(px: [number, number][], appZoom: number): Promise<{ t: CatMapRig; drawn: any[] }> {
  const t = await catMapRig({ page: {}, before: (r) => ((r.window as any).__dashboardMapTest = true) });
  const m = t.map();
  m.jumpTo({ zoom: appZoom - 1 }); // the person zooms (a move of theirs, so no fit)
  // Pixels measured from the script's own grid origin, as drawCats does.
  const origin = (t.window as any).__dashboardMapInternals.gridOrigin as [number, number];
  const o = m.project(origin);
  const cats = px.map(([x, y], i) => {
    const ll = m.unproject([o.x + x, o.y + y]);
    return posCat(i + 1, ll.lat, ll.lng);
  });
  await t.answer(0, cats);
  return { t, drawn: t.markers("catdot").concat(t.markers("catcluster")) };
}

/** The script's mergeClose, from a page run with the test flag. */
async function internals(): Promise<{ mergeClose: (m: Mk[], px: number) => Mk[] }> {
  const t = await catMapRig({ before: (r) => ((r.window as any).__dashboardMapTest = true) });
  return (t.window as any).__dashboardMapInternals;
}

const mk = (x: number, y: number, n = 1): Mk => ({
  x,
  y,
  cats: Array.from({ length: n }, (_, i) => cat(Math.round(x * 1000 + y + i), x, y)),
});

describe("mergeClose", () => {
  let mergeClose: (m: Mk[], px: number) => Mk[];
  beforeAll(async () => {
    mergeClose = (await internals()).mergeClose;
  });

  it("is reachable only when the test flag is set", async () => {
    const t = await catMapRig();
    expect((t.window as any).__dashboardMapInternals).toBeUndefined();
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
    const { drawn } = await drawnAt([[40, 10], [70, 10]], 15);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.getAttribute("aria-label")).toContain("2 cats here");
  });

  it("keeps cats 50px apart as two markers", async () => {
    const { drawn } = await drawnAt([[10, 10], [60, 10]], 15);
    expect(drawn).toHaveLength(2);
  });

  it("SYC-342: cats a few hundred metres apart are one group at the island view, and split when zoomed in", async () => {
    const t = await catMapRig();
    await t.answer(0, [posCat(1, 37.4447, 24.9417), posCat(2, 37.4460, 24.9440), posCat(3, 37.4430, 24.9400)]);
    // The person zooms out to the island, then back in close.
    t.map().jumpTo({ zoom: 11 });
    t.map().fire("zoomend");
    expect(t.markers("catcluster")).toHaveLength(1);
    expect(t.markers("catdot")).toHaveLength(0);
    t.map().jumpTo({ zoom: 17 });
    t.map().fire("zoomend");
    expect(t.markers("catdot")).toHaveLength(3);
    expect(t.markers("catcluster")).toHaveLength(0);
  });

  it("each marker is a 44px tap target (a button the page's CSS sizes) named by its cat, not a position", async () => {
    const { drawn } = await drawnAt([[10, 10]], 15);
    expect(drawn[0]!.tagName).toBe("BUTTON");
    expect(drawn[0]!.className).toBe("catpinicon");
    // jsdom has no layout, so the size is read from the page's own stylesheet.
    const css = renderCatMapPage({ personName: "T", filters: {}, colonies: [], cats: [], catCount: 0, sites: [], focus: null, now: new Date() });
    expect(css).toContain("button.catpinicon{width:44px;height:44px;padding:0;margin:0;box-sizing:border-box;cursor:pointer}");
    // Its dot or ring is centred inside.
    expect(css).toContain(".catpinicon{display:flex;align-items:center;justify-content:center;");
    expect(drawn[0]!.getAttribute("aria-label")).toBe("Cat ba: Sterilised");
  });

  it("tapping a group zooms in on it, and doesn't count as an opened card", async () => {
    const { t, drawn } = await drawnAt([[40, 10], [70, 10]], 15);
    drawn[0]!.click();
    const eases = t.map().calls.filter((c) => c[0] === "easeTo");
    expect(eases).toHaveLength(1);
    expect(eases[0]![1].zoom).toBe(16); // MapLibre 14 + 2
    expect(t.document.getElementById("catsheet").hidden).toBe(true);
  });

  it("review focus 5: 30 cats at one point at the closest zoom are one group whose tap lists all 30", async () => {
    const { t, drawn } = await drawnAt(Array.from({ length: 30 }, () => [500, 500] as [number, number]), 19);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.getAttribute("aria-label")).toContain("30 cats here");
    drawn[0]!.click();
    const sheet = t.document.getElementById("catsheet");
    expect(sheet.hidden).toBe(false);
    expect(sheet.querySelector(".sheetname").textContent).toBe("30 cats here");
    expect(sheet.querySelectorAll("ul.cats li")).toHaveLength(30);
  });
});
