import { describe, expect, it } from "vitest";
import { catMapRig, posCat } from "./__fixtures__/catMapRig";
import { makeMaplibreFake, mapDataRoutes } from "./__fixtures__/maplibreFake";

// The island map while it loads, and when it can't start (SYC-619 §5.4;
// SYC-705 Task 2b.6). map-core.js owns the map's own "Loading the map…" line
// and the no-map line (mapCore.test.ts tests them in detail); here they are
// checked on the cats page itself. The cats' positions keep the box busy
// (aria-busy) while they are asked for, once the map is up. With no script
// or no map, the page says so and links to the same cats as the grid, with
// the filters in its query (never a position).

const box = (t: { document: any }) => t.document.getElementById("island-map");
const gridLink = (t: { document: any }) => t.document.getElementById("map-gridlink");

describe("the island map while it loads", () => {
  it("shows map-core's loading line in the cats map's box, and the box is busy", async () => {
    const t = await catMapRig({ lib: makeMaplibreFake({ autoLoad: false, moveEvents: true }) });
    expect(box(t).querySelector(".mapnojs").textContent).toBe("Loading the map…");
    expect(box(t).getAttribute("aria-busy")).toBe("true");
    t.map().fire("load");
    await t.settle();
    expect(box(t).querySelector(".mapnojs")).toBeNull();
  });

  it("keeps the box busy while the cats are asked for, and not after", async () => {
    const t = await catMapRig();
    // The map is up; the first positions request is still out.
    expect(box(t).classList.contains("maplive")).toBe(true);
    expect(box(t).getAttribute("aria-busy")).toBe("true");
    await t.answer(0, [posCat(1, 37.44, 24.94)]);
    expect(box(t).hasAttribute("aria-busy")).toBe(false);
    t.change();
    expect(box(t).getAttribute("aria-busy")).toBe("true");
    await t.answer(1, []);
    expect(box(t).hasAttribute("aria-busy")).toBe(false);
  });

  it("is not busy once the map is up if the cats came first", async () => {
    const t = await catMapRig({ cats: [posCat(1, 37.44, 24.94)] });
    expect(box(t).classList.contains("maplive")).toBe(true);
    expect(box(t).hasAttribute("aria-busy")).toBe(false);
  });

  it("shows the layers and Go to only once the map is up; the grid link is hidden then", async () => {
    const t = await catMapRig({ lib: makeMaplibreFake({ autoLoad: false, moveEvents: true }) });
    expect(t.document.getElementById("maplayers").hidden).toBe(true);
    expect(t.document.getElementById("mapmove").hidden).toBe(true);
    t.map().fire("load");
    await t.settle();
    expect(t.document.getElementById("maplayers").hidden).toBe(false);
    expect(t.document.getElementById("mapmove").hidden).toBe(false);
    expect(t.document.getElementById("mapgrid").classList.contains("maplive")).toBe(true);
  });
});

describe("map can't start", () => {
  const filters = { colours: ["ginger" as const], sterilised: ["not_known" as const], lastSeen: "month" as const };

  it("grid link shown with the current filters", async () => {
    const t = await catMapRig({ page: { filters }, lib: makeMaplibreFake({ throwOnMap: true }) });
    expect(box(t).querySelector(".mapnojs").textContent).toBe("The map needs a newer browser with JavaScript on.");
    expect(box(t).hasAttribute("aria-busy")).toBe(false);
    const p = t.document.getElementById("mapgrid");
    expect(p.classList.contains("maplive")).toBe(false);
    expect(gridLink(t).textContent).toBe("Show these cats as a grid");
    expect(gridLink(t).getAttribute("href")).toBe("/api/team/cats?colours=ginger&sterilised=not_known&lastSeen=month");
    // The link follows a change of filters, as the Grid switch does; no cats are asked for again.
    const asked = t.asks.length;
    t.change(() => (t.document.querySelector('#catfilters input[name="colours"][value="black"]').checked = true));
    // The same address as the Grid switch, which the script also keeps up to date.
    expect(gridLink(t).getAttribute("href")).toBe(t.document.getElementById("view-grid").getAttribute("href"));
    expect(gridLink(t).getAttribute("href")).toMatch(/^\/api\/team\/cats\?colours=black&colours=ginger&sterilised=not_known&/);
    expect(gridLink(t).getAttribute("href")).not.toMatch(/view=|lat|lng/);
    expect(t.asks.length).toBe(asked);
    // Nothing went on the (absent) map, and the layers and Go to stay hidden.
    expect(t.lib.markers).toHaveLength(0);
    expect(t.document.getElementById("maplayers").hidden).toBe(true);
  });

  it("the form then sends itself as it would with no script", async () => {
    const t = await catMapRig({ lib: makeMaplibreFake({ throwOnMap: true }) });
    const ev = new t.window.Event("submit", { cancelable: true });
    t.form().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it.each([
    ["the map file can't be had", { routes: { ...mapDataRoutes(), "/api/team/map-data/current": () => ({ status: 503, body: "down" }) } }],
    ["the library won't load", { importFails: true }],
  ])("%s: the grid link shows", async (_what, rig) => {
    const t = await catMapRig({ page: { filters }, rig });
    expect(t.document.getElementById("mapgrid").classList.contains("maplive")).toBe(false);
    expect(gridLink(t).getAttribute("href")).toBe("/api/team/cats?colours=ginger&sterilised=not_known&lastSeen=month");
  });

  it("a box with no map collapses round its one line; loading and live keep the map's height", async () => {
    const { renderCatMapPage } = await import("./catMapPage");
    const css = renderCatMapPage({ personName: "T", filters: {}, colonies: [], cats: [], catCount: 0, sites: [], focus: null, now: new Date() });
    // map-core marks loading with aria-busy and a live map with .maplive; anything else holds no map.
    expect(css).toContain(".map[data-map]:not(.maplive):not([aria-busy]),#island-map:not(.maplive):not([aria-busy]){height:auto;min-height:0}");
    const t = await catMapRig({ lib: makeMaplibreFake({ throwOnMap: true }) });
    const el = box(t);
    expect(el.matches(".map[data-map]:not(.maplive):not([aria-busy])")).toBe(true);
    const live = await catMapRig();
    expect(box(live).matches("#island-map:not(.maplive):not([aria-busy])")).toBe(false);
  });

  it("with no script at all, the page already says the map needs JavaScript and links to the grid", async () => {
    const { catMapBody } = await import("./__fixtures__/catMapRig");
    const html = catMapBody({ filters });
    expect(html).toContain('<p class="mapnojs">The map needs a newer browser with JavaScript on.</p>');
    expect(html).toContain(
      '<p class="mapfallback" id="mapgrid"><a class="tap" id="map-gridlink" href="/api/team/cats?colours=ginger&amp;sterilised=not_known&amp;lastSeen=month">Show these cats as a grid</a></p>',
    );
    expect(html).not.toContain("<noscript");
  });
});
