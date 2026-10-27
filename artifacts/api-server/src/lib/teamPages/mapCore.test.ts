import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ISLAND_BOX } from "../island";
import { mapDataRoutes, mapScriptRig, makeMaplibreFake, type MapScriptRig } from "./__fixtures__/maplibreFake";
import { renderMap } from "./map";

// SYC-705 Task 2b.5: the dashboard's map scripts, run in jsdom with a fake
// MapLibre and PMTiles (__fixtures__/maplibreFake.ts). map-core.js starts a
// map on our own Syros map file; dashboard-pin.js draws a view map's markers.

const ASSETS = join(__dirname, "..", "..", "..", "assets");
const CORE = readFileSync(join(ASSETS, "map-core.js"), "utf8");
const PIN = readFileSync(join(ASSETS, "dashboard-pin.js"), "utf8");

const WORDS = {
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  compass: "Turn north up",
  needsJs: "The map needs a newer browser with JavaScript on.",
  loading: "Loading the map…",
};

const attr = (v: unknown) => JSON.stringify(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A view map's HTML, as renderMap writes it. */
function mapHtml(data: Record<string, unknown>, extra = ""): string {
  return (
    `<div class="map" id="map" data-map="${attr({ mode: "view", lang: "en", centre: null, zoom: 12, fit: null, markers: [], ...data })}" ` +
    `data-words="${attr(WORDS)}" data-maplibre="/api/team/assets/maplibre-gl.0123456789ab.mjs" ` +
    `data-worker="/api/team/assets/maplibre-gl-worker.0123456789ab.mjs"><p class="mapnojs">${WORDS.needsJs}</p></div>` +
    extra
  );
}

const FALLBACK = '<div class="mapfallback">The sites are listed below.</div>';

async function viewMap(data: Record<string, unknown> = {}, opts: Parameters<typeof mapScriptRig>[1] = {}): Promise<MapScriptRig> {
  const rig = mapScriptRig(mapHtml(data, FALLBACK), opts);
  rig.run("map-core.js", "dashboard-pin.js");
  await rig.settle();
  return rig;
}

const ALLOWED = new Set([
  "https://team.example/api/team/map-data/current",
  "https://team.example/api/team/map-data/v7/syros.pmtiles",
  "https://team.example/api/team/map-data/v7/style-en.json",
  "https://team.example/api/team/map-data/v7/style-el.json",
]);

function rangeHeaders(init: any): string[] {
  const h = init?.headers;
  if (!h) return [];
  const names = typeof h.keys === "function" ? [...h.keys()] : Object.keys(h);
  return names.filter((n: string) => n.toLowerCase() === "range");
}

describe("map-core.js: where it fetches from", () => {
  it("fetches only fixed map-data addresses with the version, never a Range header", async () => {
    const rig = await viewMap({ lang: "el" });
    expect(rig.fetches.length).toBeGreaterThanOrEqual(3);
    for (const f of rig.fetches) {
      expect(ALLOWED.has(f.url), f.url).toBe(true);
      expect(rangeHeaders(f.init), f.url).toEqual([]);
    }
    // The version first; then the file and the style (asked for together).
    expect(rig.fetches[0]!.url).toBe("https://team.example/api/team/map-data/current");
    expect(rig.fetches.map((f) => f.url).sort()).toEqual([
      "https://team.example/api/team/map-data/current",
      "https://team.example/api/team/map-data/v7/style-el.json",
      "https://team.example/api/team/map-data/v7/syros.pmtiles",
    ]);
    // The library and worker come from the map box's own attributes; the worker is set before the first map.
    expect(rig.imports).toEqual(["/api/team/assets/maplibre-gl.0123456789ab.mjs"]);
    const order = rig.lib.calls.map((c) => c[0]);
    expect(order.indexOf("setWorkerUrl")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("setWorkerUrl")).toBeLessThan(order.indexOf("Map"));
    expect(rig.lib.workerUrl).toBe("/api/team/assets/maplibre-gl-worker.0123456789ab.mjs");
    // The whole file, as one File named as the style's pmtiles:// source expects.
    expect(rig.lib.protocols["pmtiles"]).toBeTypeOf("function");
    expect(rig.pm.added).toEqual(["syros-v7.pmtiles"]);
    expect(rig.pm.files[0].name).toBe("syros-v7.pmtiles");
    // The style's relative glyphs and sprite are made absolute with this page's origin.
    const style = rig.lib.maps[0]!.options.style;
    expect(style.glyphs).toBe("https://team.example/api/team/map-data/v7/fonts/{fontstack}/{range}.pbf");
    expect(style.sprite).toBe("https://team.example/api/team/map-data/v7/sprites/light");
    expect(style.sources.protomaps.url).toBe("pmtiles://syros-v7.pmtiles");
  });

  it("builds no address from a position, and never asks for part of the file", () => {
    for (const src of [CORE, PIN]) {
      expect(src).not.toMatch(/[Rr]ange["']?\s*:/);
      expect(src).not.toMatch(/\bbytes=/);
      expect(src).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
      expect(src).not.toMatch(/[?&](?:lat|lng|z|x|y)=/);
    }
    // dashboard-pin.js fetches nothing itself.
    expect(PIN).not.toMatch(/\bfetch\(/);
  });

  it("uses the Cache API copy on a second start, no second file fetch", async () => {
    const first = await viewMap();
    const file = "https://team.example/api/team/map-data/v7/syros.pmtiles";
    expect(first.fetches.filter((f) => f.url === file)).toHaveLength(1);
    expect(first.caches!.stores["syros-map"]!.has(file)).toBe(true);
    // The next page load on the same browser.
    const second = await viewMap({}, { cachesFake: first.caches! });
    expect(second.fetches.filter((f) => f.url === file)).toHaveLength(0);
    expect(second.pm.added).toEqual(["syros-v7.pmtiles"]);
    expect(second.lib.maps).toHaveLength(1);
  });

  it("drops other versions' copies from the cache when the map has moved on", async () => {
    const first = await viewMap();
    const second = await viewMap({}, { cachesFake: first.caches!, routes: mapDataRoutes(8) });
    const store = second.caches!.stores["syros-map"]!;
    expect([...store.keys()]).toEqual(["https://team.example/api/team/map-data/v8/syros.pmtiles"]);
    expect(second.pm.added).toEqual(["syros-v8.pmtiles"]);
  });

  it("works with a plain fetch where there is no Cache API", async () => {
    const rig = await viewMap({}, { caches: false });
    expect(rig.fetches.map((f) => f.url)).toContain("https://team.example/api/team/map-data/v7/syros.pmtiles");
    expect(rig.lib.maps).toHaveLength(1);
    expect(rig.document.querySelector(".mapnojs")).toBeNull();
  });
});

describe("map-core.js: zoom", () => {
  it("app zoom 17 becomes MapLibre 16", async () => {
    const rig = await viewMap({ centre: [37.44, 24.94], zoom: 17 });
    expect(rig.window.CatMap.toMapLibreZoom(17)).toBe(16);
    expect(rig.window.CatMap.fromMapLibreZoom(16)).toBe(17);
    expect(rig.lib.maps[0]!.getZoom()).toBe(16);
    expect(rig.lib.maps[0]!.getCenter()).toEqual({ lng: 24.94, lat: 37.44 });
  });

  it("holds the map to Syros: island box padded by 0.03°, MapLibre zoom 11 to 18, no tilt, no attribution box", async () => {
    const rig = await viewMap();
    const o = rig.lib.maps[0]!.options;
    expect(o.maxBounds[0][0]).toBeCloseTo(ISLAND_BOX.minLng - 0.03, 10);
    expect(o.maxBounds[0][1]).toBeCloseTo(ISLAND_BOX.minLat - 0.03, 10);
    expect(o.maxBounds[1][0]).toBeCloseTo(ISLAND_BOX.maxLng + 0.03, 10);
    expect(o.maxBounds[1][1]).toBeCloseTo(ISLAND_BOX.maxLat + 0.03, 10);
    expect(o).toMatchObject({ minZoom: 11, maxZoom: 18, maxPitch: 0, pitchWithRotate: false, attributionControl: false });
  });

  it("fits the given positions (padding 24, never closer than app zoom 17), or opens on the centre", async () => {
    const rig = await viewMap({ fit: [[37.44, 24.94], [37.45, 24.95]] });
    const fit = rig.lib.maps[0]!.calls.find((c) => c[0] === "fitBounds")!;
    expect(fit[1]).toEqual([[24.94, 37.44], [24.95, 37.45]]);
    expect(fit[2]).toMatchObject({ padding: 24, maxZoom: 16 });
    // One position: no box to fit, so it opens there at app zoom 17.
    const one = await viewMap({ fit: [[37.44, 24.94]] });
    expect(one.lib.maps[0]!.calls.some((c) => c[0] === "fitBounds")).toBe(false);
    expect(one.lib.maps[0]!.getCenter()).toEqual({ lng: 24.94, lat: 37.44 });
    expect(one.lib.maps[0]!.getZoom()).toBe(16);
  });
});

describe("map-core.js: when the map starts", () => {
  it("removes the no-map line, marks the fallbacks live, and adds its own +, − and compass buttons", async () => {
    const rig = await viewMap();
    const d = rig.document;
    expect(d.querySelector(".mapnojs")).toBeNull();
    expect(d.querySelector(".mapfallback")!.classList.contains("maplive")).toBe(true);
    // A live map keeps its height: never marked as holding no map.
    expect(d.querySelector(".map")!.classList.contains("nomap")).toBe(false);
    const buttons = [...d.querySelectorAll(".map button")] as any[];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Zoom in", "Zoom out", "Turn north up"]);
    expect(buttons.every((b) => b.getAttribute("type") === "button")).toBe(true);
    const map = rig.lib.maps[0]!;
    const z = map.getZoom();
    buttons[0].click();
    expect(map.getZoom()).toBe(z + 1);
    buttons[1].click();
    expect(map.getZoom()).toBe(z);
    map.bearing = 40;
    buttons[2].click();
    expect(map.getBearing()).toBe(0);
  });

  it("rotation off when asked: no drag, touch or keyboard rotation and no compass", async () => {
    const rig = mapScriptRig(mapHtml({}));
    rig.run("map-core.js");
    const el = rig.document.querySelector(".map");
    const map = await rig.window.CatMap.start(el, { rotate: false, centre: [37.44, 24.94], zoom: 15 });
    expect(map.dragRotate.isEnabled()).toBe(false);
    expect(map.touchZoomRotate.rotation).toBe(false);
    expect(map.keyboard.rotation).toBe(false);
    expect([...rig.document.querySelectorAll(".map button")].map((b: any) => b.getAttribute("aria-label"))).toEqual([
      "Zoom in",
      "Zoom out",
    ]);
    // Rotation stays on by default.
    const other = mapScriptRig(mapHtml({}));
    other.run("map-core.js");
    const m2 = await other.window.CatMap.start(other.document.querySelector(".map"), {});
    expect(m2.dragRotate.isEnabled()).toBe(true);
  });
});

describe("map-core.js: while the map loads", () => {
  it("shows Loading the map… while the file downloads", async () => {
    let arrive!: (a: { status: number; body: string }) => void;
    const routes = {
      ...mapDataRoutes(),
      "/api/team/map-data/v7/syros.pmtiles": () => new Promise<{ status: number; body: string }>((r) => (arrive = r)),
    };
    const rig = mapScriptRig(mapHtml({}, FALLBACK), { routes });
    rig.run("map-core.js", "dashboard-pin.js");
    await rig.settle();
    const box = rig.document.querySelector(".map");
    expect(box.querySelector(".mapnojs").textContent).toBe("Loading the map…");
    expect(box.getAttribute("aria-busy")).toBe("true");
    expect(rig.document.querySelector(".mapfallback").classList.contains("maplive")).toBe(false);
    expect(rig.lib.maps).toHaveLength(0);
    arrive({ status: 200, body: "PMTILES-BYTES" });
    await rig.settle();
    expect(box.querySelector(".mapnojs")).toBeNull();
    expect(box.hasAttribute("aria-busy")).toBe(false);
    expect(rig.document.querySelector(".mapfallback").classList.contains("maplive")).toBe(true);
  });

  it("stalled download falls back to needsJs after the timeout", async () => {
    const routes = { ...mapDataRoutes(), "/api/team/map-data/v7/syros.pmtiles": () => new Promise<never>(() => {}) };
    const rig = mapScriptRig(mapHtml({}, FALLBACK), { routes, fakeTimers: true });
    rig.run("map-core.js", "dashboard-pin.js");
    await rig.settle();
    expect(rig.document.querySelector(".mapnojs").textContent).toBe("Loading the map…");
    expect(rig.timers.map((t) => t.ms)).toContain(45000);
    rig.runTimers(45000);
    await rig.settle();
    const box = rig.document.querySelector(".map");
    expect(box.querySelector(".mapnojs").textContent).toBe(WORDS.needsJs);
    expect(box.hasAttribute("aria-busy")).toBe(false);
    expect(box.children).toHaveLength(1);
    expect(rig.document.querySelector(".mapfallback").classList.contains("maplive")).toBe(false);
    expect(rig.lib.maps).toHaveLength(0);
  });

  it("keeps the loading line until the map's first load, and only then marks the page live", async () => {
    const rig = await viewMap({}, { lib: makeMaplibreFake({ autoLoad: false }) });
    const map = rig.lib.maps[0]!;
    expect(rig.document.querySelector(".mapnojs").textContent).toBe("Loading the map…");
    expect(rig.document.querySelector(".mapfallback").classList.contains("maplive")).toBe(false);
    map.fire("load");
    await rig.settle();
    expect(rig.document.querySelector(".mapnojs")).toBeNull();
    expect(rig.document.querySelector(".mapfallback").classList.contains("maplive")).toBe(true);
    // A tile error after load is not the page's business: the map stays.
    map.fire("error", { error: new Error("one tile") });
    await rig.settle();
    expect(map.removed).toBe(false);
  });

  it("an error before the first load is no map: needsJs, the fallbacks still visible, the map removed", async () => {
    const rig = await viewMap({}, { lib: makeMaplibreFake({ autoLoad: false }) });
    const map = rig.lib.maps[0]!;
    map.fire("error", { error: new Error("glyphs 404") });
    await rig.settle();
    const box = rig.document.querySelector(".map");
    expect(box.querySelector(".mapnojs").textContent).toBe(WORDS.needsJs);
    expect(box.children).toHaveLength(1);
    expect(box.hasAttribute("aria-busy")).toBe(false);
    expect(rig.document.querySelector(".mapfallback").classList.contains("maplive")).toBe(false);
    expect(map.removed).toBe(true);
    expect(rig.lib.markers).toHaveLength(0);
  });

  it("a map that never draws falls back to needsJs after its own timeout", async () => {
    const rig = mapScriptRig(mapHtml({}, FALLBACK), { lib: makeMaplibreFake({ autoLoad: false }), fakeTimers: true });
    rig.run("map-core.js", "dashboard-pin.js");
    await rig.settle();
    expect(rig.lib.maps).toHaveLength(1);
    rig.runTimers(30000);
    await rig.settle();
    expect(rig.document.querySelector(".mapnojs").textContent).toBe(WORDS.needsJs);
    expect(rig.lib.maps[0]!.removed).toBe(true);
  });
});

describe("map-core.js: map failure shows needsJs and keeps the fallback", () => {
  const cases: [string, Parameters<typeof mapScriptRig>[1]][] = [
    ["the Map constructor throws (no WebGL2)", { lib: makeMaplibreFake({ throwOnMap: true }) }],
    ["the library's import rejects", { importFails: true }],
    ["the map file answers 503", { routes: { ...mapDataRoutes(), "/api/team/map-data/v7/syros.pmtiles": () => ({ status: 503 }) } }],
    ["the style answers 503", { routes: { ...mapDataRoutes(), "/api/team/map-data/v7/style-en.json": () => ({ status: 503 }) } }],
    ["the version answers 503", { routes: { ...mapDataRoutes(), "/api/team/map-data/current": () => ({ status: 503 }) } }],
    ["the version is not a number", { routes: { ...mapDataRoutes(), "/api/team/map-data/current": () => ({ status: 200, body: { version: "../x" } }) } }],
    ["there is no pmtiles", { pmtiles: false }],
    ["there is no fetch", { fetch: false }],
  ];
  it.each(cases)("%s", async (_name, opts) => {
    const rig = await viewMap({ markers: [{ lat: 37.44, lng: 24.94, label: "Lighthouse", href: "/api/team/sites/4", look: "public" }] }, opts);
    const d = rig.document;
    expect(d.querySelector(".mapnojs")!.textContent).toBe(WORDS.needsJs);
    expect(d.querySelector(".mapfallback")!.classList.contains("maplive")).toBe(false);
    // Marked as holding no map, so the page's CSS collapses the box round its line.
    expect(d.querySelector(".map")!.classList.contains("nomap")).toBe(true);
    // Nothing of a half-made map is left in the box.
    expect(d.querySelector(".map")!.children).toHaveLength(1);
    expect(d.querySelectorAll(".map button")).toHaveLength(0);
    expect(rig.lib.markers).toHaveLength(0);
  });

  it("start() rejects, so a page script knows", async () => {
    const rig = mapScriptRig(mapHtml({}), { importFails: true });
    rig.run("map-core.js");
    await expect(rig.window.CatMap.start(rig.document.querySelector(".map"), {})).rejects.toBeTruthy();
    expect(rig.document.querySelector(".mapnojs")!.textContent).toBe(WORDS.needsJs);
  });
});

describe("dashboard-pin.js: the view map's markers", () => {
  it("markers are links with text labels, no innerHTML", async () => {
    const rig = await viewMap({
      markers: [
        { lat: 37.44, lng: 24.94, label: "<b>Lighthouse</b>", href: "/api/team/sites/4", look: "public" },
        { lat: 37.45, lng: 24.95, label: "Where the cat was seen", look: "sighting" },
        { lat: 37.46, lng: 24.93, label: "Sighting 1; Sighting 2", href: "#sg-12", look: "seen", n: 2, text: "1–2" },
        { lat: 37.47, lng: 24.92, label: "Odd", href: "javascript:alert(1)", look: "private" },
        { lat: 37.47, lng: 24.92, label: "Away", href: "https://evil.example/", look: "nonsense" },
      ],
    });
    const els = rig.lib.markers.map((m) => m.getElement());
    expect(rig.lib.markers.map((m) => m.getLngLat())).toEqual([
      { lng: 24.94, lat: 37.44 },
      { lng: 24.95, lat: 37.45 },
      { lng: 24.93, lat: 37.46 },
      { lng: 24.92, lat: 37.47 },
      { lng: 24.92, lat: 37.47 },
    ]);
    expect(rig.lib.markers.every((m) => m.map === rig.lib.maps[0])).toBe(true);
    expect(els.map((e) => e.tagName)).toEqual(["A", "SPAN", "A", "SPAN", "SPAN"]);
    expect(els.map((e) => e.className)).toEqual(["pin site-public", "pin sighting", "pin seen multi", "pin site-private", "pin"]);
    expect(els[0].getAttribute("href")).toBe("/api/team/sites/4");
    expect(els[2].getAttribute("href")).toBe("#sg-12");
    // The label is text, in a .sr span and the title; markup in it stays text.
    expect(els[0].querySelector(".sr").textContent).toBe("<b>Lighthouse</b>");
    expect(els[0].querySelector("b")).toBeNull();
    expect(els[0].getAttribute("title")).toBe("<b>Lighthouse</b>");
    expect(els[2].querySelector(".pinnum").textContent).toBe("1–2");
    for (const src of [CORE, PIN]) expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  });

  it("fits again once a map hidden at start (the cat page's Map tab) gets its size", async () => {
    const rig = await viewMap({ fit: [[37.44, 24.94], [37.45, 24.95]] });
    const map = rig.lib.maps[0]!;
    const fits = () => map.calls.filter((c) => c[0] === "fitBounds").length;
    expect(fits()).toBe(1);
    // jsdom has no layout, so the box measures 0 × 0, as a hidden panel does.
    map.fire("resize");
    expect(fits()).toBe(2);
    map.fire("resize");
    expect(fits()).toBe(2);
  });

  it("draws a sterilisation mark's dot and a numbered sighting", async () => {
    const rig = await viewMap({
      markers: [
        { lat: 37.44, lng: 24.94, label: "Cat", look: "not_known" },
        { lat: 37.45, lng: 24.95, label: "Sighting 3", look: "seen", n: 3 },
      ],
    });
    const els = rig.lib.markers.map((m) => m.getElement());
    expect(els[0].className).toBe("pin catpin");
    expect(els[0].querySelector(".catdot").className).toBe("catdot mark-not_known");
    expect(els[1].querySelector(".pinnum").textContent).toBe("3");
  });

  it("starts every view map on the page; a place map with no form of its own is left alone", async () => {
    const rig = mapScriptRig(mapHtml({}) + mapHtml({ mode: "place" }).replace('id="map"', 'id="other"'));
    rig.run("map-core.js", "dashboard-pin.js");
    await rig.settle();
    expect(rig.lib.maps).toHaveLength(1);
  });

  it("starts on renderMap's own output: the server's data and words reach the map", async () => {
    const html = renderMap({
      mode: "view",
      lang: "el",
      fit: [{ lat: 37.44, lng: 24.94 }, { lat: 37.45, lng: 24.95 }],
      markers: [{ lat: 37.44, lng: 24.94, label: "Harbour", href: "/api/team/sites/12", look: "private" }],
    });
    const rig = mapScriptRig(html);
    rig.run("map-core.js", "dashboard-pin.js");
    await rig.settle();
    expect(rig.lib.maps).toHaveLength(1);
    expect(rig.fetches.map((f) => f.url)).toContain("https://team.example/api/team/map-data/v7/style-el.json");
    expect(rig.lib.markers.map((m) => m.getElement().className)).toEqual(["pin site-private"]);
    expect(rig.lib.maps[0]!.calls.some((c) => c[0] === "fitBounds")).toBe(true);
    expect(rig.imports[0]).toMatch(/^\/api\/team\/assets\/maplibre-gl\.[0-9a-f]{12}\.mjs$/);
    expect(rig.lib.workerUrl).toMatch(/^\/api\/team\/assets\/maplibre-gl-worker\.[0-9a-f]{12}\.mjs$/);
  });
});

// SYC-705 Task 2b.7: place mode. A fixed pin in the middle; the person drags
// the MAP under it. The pin's spot goes into the page's form, never an address.
describe("dashboard-pin.js: placing a spot (drag the map under the pin)", () => {
  const PLACE_WORDS = {
    ...WORDS,
    place: "Map: drag it until the pin is on the spot. The arrow keys move it too.",
    moved: "The pin shows the spot you'll save.",
    offIsland: "Move the pin onto Syros.",
  };
  const BOX = { minLat: ISLAND_BOX.minLat, maxLat: ISLAND_BOX.maxLat, minLng: ISLAND_BOX.minLng, maxLng: ISLAND_BOX.maxLng };

  function placePage(o: { centre?: [number, number]; lat?: string; lng?: string; approximate?: boolean } = {}): string {
    const data = { mode: "place", lang: "en", centre: o.centre ?? [37.4447, 24.9417], zoom: 16, fit: null, markers: [], formId: "pickform", island: BOX };
    return (
      // As a confirm page: the spot in words with its Open map link, and the two lines the script reveals.
      `<p class="tapped" data-spotwords="pickform">The spot: <strong>Kini &middot; <a href="https://maps.example/?q=1">Open map</a></strong></p>` +
      `<p class="hint" data-spotmoved="pickform" hidden>${PLACE_WORDS.moved}</p>` +
      `<form id="pickform" method="post" action="/api/team/sites/pick">` +
      `<p class="warn" data-offisland="pickform" hidden>${PLACE_WORDS.offIsland}</p>` +
      `<div class="map" id="map" data-map="${attr(data)}" data-words="${attr(PLACE_WORDS)}" ` +
      `data-maplibre="/api/team/assets/maplibre-gl.0123456789ab.mjs" data-worker="/api/team/assets/maplibre-gl-worker.0123456789ab.mjs">` +
      `<p class="mapnojs">${WORDS.needsJs}</p></div>` +
      `<input type="hidden" name="lat" value="${o.lat ?? ""}"><input type="hidden" name="lng" value="${o.lng ?? ""}">` +
      (o.approximate ? `<input type="hidden" name="approximate" value="1">` : "") +
      `<button type="submit" class="usespot" data-mapon hidden>Use this spot</button>` +
      `<button type="submit" class="save">Save the site</button></form>` +
      FALLBACK
    );
  }

  async function placeRig(html: string, opts: Parameters<typeof mapScriptRig>[1] = {}) {
    const rig = mapScriptRig(html, opts);
    rig.run("map-core.js", "dashboard-pin.js");
    await rig.settle();
    const d = rig.document;
    const val = (n: string) => (d.querySelector(`input[name="${n}"]`) as any)?.value as string | undefined;
    return { rig, d, val, map: rig.lib.maps[0]! };
  }

  it("pin writes lat/lng to the form on moveend, rounded to 6 decimals; Use this spot revealed only after start", async () => {
    // Before the scripts run, the button is hidden: no map, no pin to use.
    const before = mapScriptRig(placePage());
    expect((before.document.querySelector(".usespot") as any).hidden).toBe(true);

    const { d, val, map } = await placeRig(placePage());
    expect((d.querySelector(".usespot") as any).hidden).toBe(false);
    // Opens where the page says, with the pin's spot already in the form.
    expect(map.getCenter()).toEqual({ lng: 24.9417, lat: 37.4447 });
    expect([val("lat"), val("lng")]).toEqual(["37.4447", "24.9417"]);
    // The person drags the map: on moveend the new middle is written, to 6 places.
    map.jumpTo({ center: [24.93123456789, 37.45198765432] });
    map.fire("moveend");
    expect([val("lat"), val("lng")]).toEqual(["37.451988", "24.931235"]);
    // A fixed pin sits in the middle of the box, hidden from screen readers.
    const pin = d.querySelector(".map .placepin")!;
    expect(pin.getAttribute("aria-hidden")).toBe("true");
    // Nothing went into the page's address.
    expect(rigUrl(d)).toBe("https://team.example/api/team/sites");
  });

  it("rotation is off, and the map can be reached and named from the keyboard", async () => {
    const { map } = await placeRig(placePage());
    expect(map.dragRotate.isEnabled()).toBe(false);
    expect(map.touchZoomRotate.rotation).toBe(false);
    expect(map.keyboard.rotation).toBe(false);
    // MapLibre's keyboard handler pans with the arrows; it must stay on.
    expect(map.keyboard.isEnabled()).toBe(true);
    const canvas = map.getCanvas();
    expect(canvas.getAttribute("tabindex")).toBe("0");
    expect(canvas.getAttribute("aria-label")).toBe(PLACE_WORDS.place);
  });

  it("a confirm page's exact spot is kept until the person moves the map", async () => {
    const { val, map } = await placeRig(placePage({ centre: [37.44471, 24.94172], lat: "37.444712345", lng: "24.941723456" }));
    expect([val("lat"), val("lng")]).toEqual(["37.444712345", "24.941723456"]);
    // A moveend with no move (a resize) changes nothing.
    map.fire("moveend");
    expect([val("lat"), val("lng")]).toEqual(["37.444712345", "24.941723456"]);
    map.jumpTo({ center: [24.9420, 37.4450] });
    map.fire("moveend");
    expect([val("lat"), val("lng")]).toEqual(["37.445", "24.942"]);
    // Back to the start: still written (the last spot never sticks).
    map.jumpTo({ center: [24.94172, 37.44471] });
    map.fire("moveend");
    expect([val("lat"), val("lng")]).toEqual(["37.44471", "24.94172"]);
  });

  it("moving the map after an area pick drops approximate: the spot is the pin's now", async () => {
    const { d, map } = await placeRig(placePage({ centre: [37.4436, 24.8889], lat: "37.4436", lng: "24.8889", approximate: true }));
    map.fire("moveend");
    expect(d.querySelector('input[name="approximate"]')).not.toBeNull();
    map.jumpTo({ center: [24.8895, 37.4440] });
    map.fire("moveend");
    expect(d.querySelector('input[name="approximate"]')).toBeNull();
  });

  it("after a real move the spot in words (and its Open map) is hidden and 'The pin shows the spot you'll save.' shown; no move changes nothing", async () => {
    const { d, map } = await placeRig(placePage({ centre: [37.4436, 24.8889], lat: "37.4436", lng: "24.8889" }));
    const words = d.querySelector("[data-spotwords]") as any;
    const moved = d.querySelector("[data-spotmoved]") as any;
    expect([words.hidden, moved.hidden]).toEqual([false, true]);
    // A moveend with no move (a resize), and our own jump back to the start: nothing changes.
    map.fire("moveend");
    map.jumpTo({ center: [24.8889, 37.4436] });
    map.fire("moveend");
    expect([words.hidden, moved.hidden]).toEqual([false, true]);
    // The person drags it 300 m: the words (and the link in them) go, the line comes.
    map.jumpTo({ center: [24.8889, 37.4463] });
    map.fire("moveend");
    expect([words.hidden, moved.hidden]).toEqual([true, false]);
    expect(moved.textContent).toBe(PLACE_WORDS.moved);
  });

  it("off the island box Save is turned off with 'Move the pin onto Syros.', and back on when the pin is back", async () => {
    const { d, map } = await placeRig(placePage({ centre: [37.4436, 24.8889], lat: "37.4436", lng: "24.8889" }));
    const off = d.querySelector("[data-offisland]") as any;
    const buttons = [...d.querySelectorAll('#pickform button[type="submit"]')] as any[];
    expect(off.hidden).toBe(true);
    expect(buttons.map((b) => b.disabled)).toEqual([false, false]);
    // Into the sea west of Syros (inside the map's margin, outside the island box).
    map.jumpTo({ center: [ISLAND_BOX.minLng - 0.01, 37.4436] });
    map.fire("moveend");
    expect(off.hidden).toBe(false);
    expect(off.textContent).toBe(PLACE_WORDS.offIsland);
    expect(buttons.map((b) => b.disabled)).toEqual([true, true]);
    map.jumpTo({ center: [24.8895, 37.444] });
    map.fire("moveend");
    expect(off.hidden).toBe(true);
    expect(buttons.map((b) => b.disabled)).toEqual([false, false]);
  });

  it("no map (WebGL refused): the button stays hidden, the fallback stays, the form is untouched", async () => {
    const { d, val } = await placeRig(placePage(), { lib: makeMaplibreFake({ throwOnMap: true }) });
    expect((d.querySelector(".usespot") as any).hidden).toBe(true);
    expect(d.querySelector(".mapfallback")!.classList.contains("maplive")).toBe(false);
    expect([val("lat"), val("lng")]).toEqual(["", ""]);
    expect(d.querySelector(".placepin")).toBeNull();
  });

  it("a place map with the page's own markers (the colony centre now, a site's spot now) starts: markers drawn, pin, button, form filled", async () => {
    const html =
      `<form id="f2">` +
      renderMap({
        mode: "place",
        lang: "en",
        formId: "f2",
        centre: { lat: 37.4447, lng: 24.9417 },
        zoom: 16,
        markers: [{ lat: 37.4436, lng: 24.8889, label: "The centre now", look: "retired", href: "/api/team/colonies/4" }],
      }) +
      `<input type="hidden" name="lat" value=""><input type="hidden" name="lng" value=""><button type="submit" data-mapon hidden>Use</button></form>`;
    const { d, val, map, rig } = await placeRig(html);
    expect(rig.lib.markers).toHaveLength(1);
    expect(rig.lib.markers[0]!.map).toBe(map);
    // Drawn as on the server's old pins, never a link on a place map.
    expect(rig.lib.markers[0]!.getElement().tagName).toBe("SPAN");
    expect(rig.lib.markers[0]!.getElement().className).toBe("pin site-retired");
    expect(d.querySelector(".placepin")).not.toBeNull();
    expect((d.querySelector("button[data-mapon]") as any).hidden).toBe(false);
    expect([val("lat"), val("lng")]).toEqual(["37.4447", "24.9417"]);
  });

  it("the fake is as strict as MapLibre: its classes can't be called without new", () => {
    const lib = makeMaplibreFake();
    expect(() => (lib.Marker as any)({})).toThrow(/without 'new'/);
    expect(() => (lib.Map as any)({})).toThrow(/without 'new'/);
  });

  it("starts on renderMap's own place output", async () => {
    const html =
      `<form id="f1">` +
      renderMap({ mode: "place", lang: "en", formId: "f1", centre: { lat: 37.4447, lng: 24.9417 }, zoom: 17 }) +
      `<input type="hidden" name="lat" value=""><input type="hidden" name="lng" value=""><button data-mapon hidden>Use</button></form>`;
    const { d, val, map } = await placeRig(html);
    expect(map.getZoom()).toBe(16);
    expect([val("lat"), val("lng")]).toEqual(["37.4447", "24.9417"]);
    expect((d.querySelector("button[data-mapon]") as any).hidden).toBe(false);
    expect(map.getCanvas().getAttribute("aria-label")).toMatch(/drag/i);
  });
});

function rigUrl(d: any): string {
  return d.defaultView.location.href;
}
