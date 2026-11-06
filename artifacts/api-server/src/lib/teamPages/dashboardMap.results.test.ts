import { describe, expect, it } from "vitest";
import { makeMaplibreFake } from "./__fixtures__/maplibreFake";
import { catMapAnswer, catMapRig, posCat, type CatMapRig, type PositionCat } from "./__fixtures__/catMapRig";

// SYC-812 (spec §3.2): the Filters fold can be shut, so what is outside it has
// to say what's on. After any filter change the chips, the count, "Filters (n)"
// and the cats drawn all describe the same filters, whatever order the answers
// land in. A change asks two things at once: the cats' positions, and the page
// itself for #mapresults and the label. Both answers go on the page together,
// or neither does. The real page and scripts, on the fake MapLibre, with every
// answer held by the test. Neither fake honours an abort, so a stale answer
// really lands, as one that has already arrived does in a browser.

const AT = new URL("https://team.example/api/team/cats?view=map");

async function setUp(page: Parameters<typeof catMapRig>[0] = {}) {
  const t = await catMapRig({ heldPages: true, ...page });
  await t.answer(0, [posCat(1, 37.44, 24.94), posCat(2, 37.45, 24.91)]);
  return t;
}

const box = (t: CatMapRig, name: string, value: string) => t.document.querySelector(`#catfilters input[name="${name}"][value="${value}"]`);
const tick = (t: CatMapRig, name: string, value: string) => t.change(() => (box(t, name, value).checked = !box(t, name, value).checked));
const chips = (t: CatMapRig): string[] =>
  [...t.document.querySelectorAll("#mapresults .fchip")].map((c: any) => c.textContent.replace(/×.*$/, "").trim());
const label = (t: CatMapRig): string => t.document.querySelector("#catfilters summary").textContent;
const count = (t: CatMapRig): string => t.document.getElementById("mapcount").textContent;
const dots = (t: CatMapRig): number => t.markers("catdot").length;
const results = (t: CatMapRig): string => t.document.getElementById("mapresults").outerHTML;

const someCats = (n: number): PositionCat[] => Array.from({ length: n }, (_v, i) => posCat(i + 1, 37.3 + i * 0.05, 24.85 + i * 0.05));

describe("the Map's results follow the filters", () => {
  it("chips are redrawn after a filter change, not deleted", async () => {
    const t = await setUp({ page: { filters: { colours: ["ginger"] } } });
    expect(chips(t)).toEqual(["Ginger"]);
    tick(t, "colours", "black");
    // Still there while the answer is on its way.
    expect(chips(t)).toEqual(["Ginger"]);
    await t.answer(1, someCats(3));
    await t.answerPage(0, { count: 3 });
    expect(chips(t)).toEqual(["Black", "Ginger"]);
    // Each chip is the server's own link back to this Map without that filter.
    const href = t.document.querySelector("#mapresults .fchip").getAttribute("href");
    expect(href).toContain("view=map");
    expect(href).toContain("colours=ginger");
    expect(href).not.toContain("colours=black");
  });

  it("the Filters label follows the answer", async () => {
    const t = await setUp();
    expect(label(t)).toBe("Filters (0)");
    tick(t, "colours", "black");
    tick(t, "sterilised", "not_known");
    await t.answer(2, someCats(1));
    await t.answerPage(1, { count: 1 });
    expect(label(t)).toBe("Filters (2)");
    tick(t, "sterilised", "not_known");
    await t.answer(3, someCats(1));
    await t.answerPage(2, { count: 1 });
    expect(label(t)).toBe("Filters (1)");
  });

  it("the count comes from the answer, with its Clear filters link", async () => {
    const t = await setUp();
    tick(t, "colours", "black");
    await t.answer(1, someCats(1));
    await t.answerPage(0, { count: 1 });
    expect(count(t)).toBe("1 cat on the map Clear filters");
    expect(t.document.getElementById("mapclear").getAttribute("href")).toBe("/api/team/cats?view=map");
    tick(t, "colours", "black");
    await t.answer(2, someCats(2));
    await t.answerPage(1, { count: 2 });
    expect(chips(t)).toEqual([]);
    expect(count(t)).toContain("2 cats on the map");
  });

  it("asks for this page with view=map and the form's fields, as a signed-in GET", async () => {
    const t = await setUp();
    tick(t, "colours", "black");
    expect(t.pages).toHaveLength(1);
    const u = new URL(t.pages[0]!.url);
    expect(u.pathname).toBe("/api/team/cats");
    expect(u.searchParams.get("view")).toBe("map");
    expect(u.searchParams.get("colours")).toBe("black");
    expect(u.search).toBe(t.window.location.search);
    expect(u.search).not.toMatch(/lat|lng/);
    expect(t.pages[0]!.init.method).toBe("GET");
    expect(t.pages[0]!.init.credentials).toBe("same-origin");
    expect(t.pages[0]!.init.cache).toBe("no-store");
    expect(t.pages[0]!.init.headers.Accept).toBe("text/html");
  });

  it("nothing is asked of the page until a filter changes", async () => {
    const t = await setUp();
    expect(t.pages).toHaveLength(0);
  });

  it("leaves the map alone", async () => {
    const t = await setUp();
    const box0 = t.document.getElementById("island-map");
    const fits = () => t.map().calls.filter((c) => c[0] === "fitBounds").length;
    const before = fits();
    tick(t, "colours", "black");
    await t.answer(1, someCats(2));
    await t.answerPage(0, { count: 2 });
    expect(t.document.getElementById("island-map")).toBe(box0);
    expect(t.lib.maps).toHaveLength(1);
    expect(fits()).toBe(before);
  });

  it("the map's own links stay outside the swap, keep their ids, and follow the filters", async () => {
    const t = await setUp();
    tick(t, "colours", "black");
    tick(t, "colours", "ginger");
    await t.answer(2, someCats(1));
    await t.answerPage(1, { count: 1 });
    const href = (id: string) => t.document.getElementById(id).getAttribute("href");
    expect(t.document.querySelector("#mapresults #view-grid, #mapresults #view-map, #mapresults .findentrylink")).toBeNull();
    expect(href("view-map")).toMatch(/^\/api\/team\/cats\?colours=black&colours=ginger&.*view=map/);
    expect(href("view-grid")).toMatch(/^\/api\/team\/cats\?colours=black&colours=ginger&/);
    expect(href("view-grid")).not.toContain("view=");
    expect(href("map-gridlink")).toBe(href("view-grid"));
    expect(t.document.querySelector(".viewrow .findentrylink").getAttribute("href")).toBe("/api/team/cats/find?colours=black&colours=ginger");
  });

  it("the results say they're busy while a change is on its way, and not after", async () => {
    const t = await setUp();
    const busy = () => t.document.getElementById("mapresults").hasAttribute("aria-busy");
    expect(busy()).toBe(false);
    tick(t, "colours", "black");
    expect(busy()).toBe(true);
    await t.answer(1, someCats(1));
    expect(busy()).toBe(true);
    await t.answerPage(0, { count: 1 });
    expect(busy()).toBe(false);
    expect(t.document.getElementById("island-map").hasAttribute("aria-busy")).toBe(false);
  });
});

describe("the two answers to a change go on the page together", () => {
  it.each([
    ["the cats land first", async (t: CatMapRig) => t.answer(1, someCats(3)), async (t: CatMapRig) => t.answerPage(0, { count: 3 })],
    ["the results land first", async (t: CatMapRig) => t.answerPage(0, { count: 3 }), async (t: CatMapRig) => t.answer(1, someCats(3))],
  ])("%s: nothing moves until both are here", async (_what, first, second) => {
    const t = await setUp();
    const shown = results(t);
    tick(t, "colours", "black");
    await first(t);
    expect(results(t).replace(' aria-busy="true"', "")).toBe(shown);
    expect(label(t)).toBe("Filters (0)");
    expect(dots(t)).toBe(2);
    await second(t);
    expect(chips(t)).toEqual(["Black"]);
    expect(label(t)).toBe("Filters (1)");
    expect(count(t)).toContain("3 cats on the map");
    expect(dots(t)).toBe(3);
  });
});

describe("several quick changes", () => {
  // Three changes: colours=black, then +ginger, then +white. Requests 1-3 are
  // the cats (0 was the page load), 0-2 the page. Any order must end the same.
  type Step = (t: CatMapRig) => Promise<void>;
  const cats = (i: number): Step => (t) => t.answer(i + 1, someCats(i + 1));
  const page = (i: number): Step => (t) => t.answerPage(i, { count: i + 1 });

  it("an older answer is ignored", async () => {
    const t = await setUp();
    tick(t, "colours", "black");
    tick(t, "colours", "ginger");
    // The newer change lands whole, then the older one turns up late.
    await t.answer(2, someCats(2));
    await t.answerPage(1, { count: 2 });
    expect(chips(t)).toEqual(["Black", "Ginger"]);
    await t.answerPage(0, { count: 1 });
    await t.answer(1, someCats(1));
    expect(chips(t)).toEqual(["Black", "Ginger"]);
    expect(label(t)).toBe("Filters (1)");
    expect(count(t)).toContain("2 cats on the map");
    expect(dots(t)).toBe(2);
  });

  it("an older answer that lands first is ignored too", async () => {
    const t = await setUp();
    tick(t, "colours", "black");
    tick(t, "colours", "ginger");
    await t.answer(1, someCats(1));
    await t.answerPage(0, { count: 1 });
    expect(chips(t)).toEqual([]);
    expect(dots(t)).toBe(2);
    await t.answerPage(1, { count: 3 });
    await t.answer(2, someCats(3));
    expect(chips(t)).toEqual(["Black", "Ginger"]);
    expect(dots(t)).toBe(3);
  });

  it.each<[string, Step[]]>([
    ["in order", [cats(0), page(0), cats(1), page(1), cats(2), page(2)]],
    ["newest first", [page(2), cats(2), page(1), cats(1), page(0), cats(0)]],
    ["the cats all first", [cats(2), cats(1), cats(0), page(0), page(1), page(2)]],
    ["the results all first", [page(0), page(1), page(2), cats(0), cats(1), cats(2)]],
    ["crossed: older cats with newer results", [page(2), cats(0), cats(1), page(0), cats(2), page(1)]],
    ["crossed: newer cats with older results", [cats(2), page(0), page(1), cats(1), cats(0), page(2)]],
  ])("the chips, count, label and cats agree whatever the order: %s", async (_what, order) => {
    const t = await setUp();
    tick(t, "colours", "black");
    tick(t, "colours", "ginger");
    tick(t, "colours", "white");
    for (const step of order) await step(t);
    expect(chips(t)).toEqual(["Black", "Ginger", "White"]);
    expect(label(t)).toBe("Filters (1)");
    expect(count(t)).toContain("3 cats on the map");
    expect(dots(t)).toBe(3);
    expect(t.document.getElementById("mapresults").hasAttribute("aria-busy")).toBe(false);
  });

  it("a change before the page's first cats arrive overtakes them", async () => {
    const t = await catMapRig({ heldPages: true });
    tick(t, "colours", "black");
    await t.answer(0, someCats(4));
    expect(dots(t)).toBe(0);
    await t.answer(1, someCats(1));
    await t.answerPage(0, { count: 1 });
    expect(dots(t)).toBe(1);
    expect(chips(t)).toEqual(["Black"]);
  });
});

describe("when an answer doesn't come", () => {
  // Results in it on purpose: only the redirect says this isn't our answer.
  const signedOut = { ...catMapAnswer(AT, 9), redirected: true };

  it.each<[string, (t: CatMapRig) => Promise<void>]>([
    ["the page can't be reached", async (t) => (await t.answer(1, someCats(3)), t.failPage(0))],
    ["the server says no", async (t) => (await t.answer(1, someCats(3)), t.answerPage(0, { raw: { status: 500, type: "text/html", body: "<p>no</p>" } }))],
    ["the answer isn't a page", async (t) => (await t.answer(1, someCats(3)), t.answerPage(0, { raw: { status: 200, body: { cats: [] } } }))],
    ["the page has no results in it", async (t) => (await t.answer(1, someCats(3)), t.answerPage(0, { raw: { status: 200, type: "text/html", body: "<p>Sign in</p>" } }))],
    ["the cats are refused", async (t) => (await t.answerPage(0, { count: 3 }), t.refuse(1))],
  ])("a failed fetch leaves the page as it was: %s", async (_what, fail) => {
    const t = await setUp({ page: { filters: { colours: ["ginger"] } } });
    const shown = results(t);
    tick(t, "colours", "black");
    await fail(t);
    expect(results(t)).toBe(shown);
    expect(label(t)).toBe("Filters (1)");
    expect(dots(t)).toBe(2);
    expect(t.document.getElementById("island-map").hasAttribute("aria-busy")).toBe(false);
  });

  it("a redirected answer is not swapped in, even a whole page with results in it", async () => {
    const t = await setUp();
    const shown = results(t);
    tick(t, "colours", "black");
    await t.answer(1, someCats(3));
    await t.answerPage(0, { raw: signedOut });
    expect(results(t)).toBe(shown);
    expect(label(t)).toBe("Filters (0)");
    expect(dots(t)).toBe(2);
  });

  const submit = (t: CatMapRig) => {
    const ev = new t.window.Event("submit", { cancelable: true });
    t.form().dispatchEvent(ev);
    return ev;
  };

  it("while all is well, Show cats stays on the page", async () => {
    const t = await setUp();
    tick(t, "colours", "black");
    await t.answer(1, someCats(1));
    await t.answerPage(0, { count: 1 });
    expect(submit(t).defaultPrevented).toBe(true);
  });

  it("after a failed fetch, Show cats sends the form for real", async () => {
    const t = await setUp();
    tick(t, "colours", "black");
    await t.answer(1, someCats(1));
    await t.failPage(0);
    expect(submit(t).defaultPrevented).toBe(false);
  });

  it("the next change that works puts it right", async () => {
    const t = await setUp();
    tick(t, "colours", "black");
    await t.answer(1, someCats(1));
    await t.failPage(0);
    tick(t, "colours", "ginger");
    await t.answer(2, someCats(2));
    await t.answerPage(1, { count: 2 });
    expect(chips(t)).toEqual(["Black", "Ginger"]);
    expect(dots(t)).toBe(2);
    expect(submit(t).defaultPrevented).toBe(true);
  });

  it("a dropped answer overtaken by a newer change is not a failure", async () => {
    const t = await setUp();
    tick(t, "colours", "black");
    tick(t, "colours", "ginger");
    await t.failPage(0);
    expect(t.document.getElementById("mapresults").hasAttribute("aria-busy")).toBe(true);
    await t.answer(2, someCats(2));
    await t.answerPage(1, { count: 2 });
    expect(chips(t)).toEqual(["Black", "Ginger"]);
    expect(submit(t).defaultPrevented).toBe(true);
  });

  it("with no map, the results still follow the filters and no cats are asked for", async () => {
    const t = await catMapRig({ heldPages: true, lib: makeMaplibreFake({ throwOnMap: true }) });
    await t.settle();
    const asked = t.asks.length;
    tick(t, "colours", "black");
    await t.answerPage(0, { count: 4 });
    expect(t.asks).toHaveLength(asked);
    expect(chips(t)).toEqual(["Black"]);
    expect(label(t)).toBe("Filters (1)");
    expect(count(t)).toContain("4 cats on the map");
  });
});
