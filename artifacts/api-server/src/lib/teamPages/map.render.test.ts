import { describe, expect, it } from "vitest";
import { assetUrl } from "../teamAssets";
import { isOpaqueAddress } from "../../test/opaqueAddress";
import { en } from "./strings/en";
import { inMapBox, mapCredit, mapPageAssets, renderMap, type MapMarker } from "./map";

// SYC-705 Task 2b.5: renderMap writes the MapLibre box (data for
// assets/map-core.js and dashboard-pin.js) instead of picture maps.

const unescape = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const dataOf = (html: string, name: string) => {
  const m = new RegExp(` ${name}="([^"]*)"`).exec(html);
  expect(m, name).not.toBeNull();
  return JSON.parse(unescape(m![1]!));
};

const site: MapMarker = { lat: 37.44, lng: 24.94, label: "Harbour", href: "/api/team/sites/12", look: "public" };

describe("renderMap", () => {
  it("renders data-map JSON with lang el for a Greek viewer, en for fr", () => {
    const el = dataOf(renderMap({ mode: "view", lang: "el", centre: { lat: 37.44, lng: 24.94 }, zoom: 17, markers: [site] }), "data-map");
    expect(el).toEqual({
      mode: "view",
      lang: "el",
      centre: [37.44, 24.94],
      zoom: 17,
      fit: null,
      markers: [{ lat: 37.44, lng: 24.94, label: "Harbour", href: "/api/team/sites/12", look: "public" }],
    });
    expect(dataOf(renderMap({ mode: "view", lang: "fr" }), "data-map").lang).toBe("en");
    expect(dataOf(renderMap({ mode: "view", lang: "en" }), "data-map").lang).toBe("en");
    expect(dataOf(renderMap({ mode: "view" }), "data-map")).toMatchObject({ lang: "en", centre: [37.445, 24.93], zoom: 12 });
  });

  it("writes positions to 5 decimal places (no float noise)", () => {
    const d = dataOf(
      renderMap({ mode: "view", centre: { lat: 37.450100000000006, lng: 24.930000000000003 }, fit: [{ lat: 37.123456789, lng: 24.987654321 }], markers: [{ ...site, lat: 37.4444449, lng: 24.9 }] }),
      "data-map",
    );
    expect(d.centre).toEqual([37.4501, 24.93]);
    expect(d.fit).toEqual([[37.12346, 24.98765]]);
    expect([d.markers[0].lat, d.markers[0].lng]).toEqual([37.44444, 24.9]);
  });

  it("fits the given positions, and writes place mode's form", () => {
    const d = dataOf(renderMap({ mode: "view", fit: [{ lat: 37.4, lng: 24.9 }, { lat: 37.5, lng: 25 }] }), "data-map");
    expect(d.fit).toEqual([[37.4, 24.9], [37.5, 25]]);
    expect(dataOf(renderMap({ mode: "view", fit: [] }), "data-map").fit).toBeNull();
    expect(dataOf(renderMap({ mode: "place", formId: "pick" }), "data-map")).toMatchObject({ mode: "place", formId: "pick" });
  });

  it("holds the needs-JavaScript line, the buttons' words, and the library's and worker's own addresses", () => {
    const html = renderMap({ mode: "view" });
    expect(html).toContain('<p class="mapnojs">The map needs a newer browser with JavaScript on.</p>');
    expect(en["map.needsJs"]).toBe("The map needs a newer browser with JavaScript on.");
    expect(dataOf(html, "data-words")).toEqual({
      zoomIn: en["map.zoomIn"],
      zoomOut: en["map.zoomOut"],
      compass: en["map.compass"],
      needsJs: en["map.needsJs"],
      loading: "Loading the map…",
    });
    expect(html).toContain(` data-maplibre="${assetUrl("maplibre-gl.mjs")}"`);
    expect(html).toContain(` data-worker="${assetUrl("maplibre-gl-worker.mjs")}"`);
    expect(assetUrl("maplibre-gl.mjs")).toMatch(/^\/api\/team\/assets\/maplibre-gl\.[0-9a-f]{12}\.mjs$/);
    expect(html.startsWith('<div class="map" id="map" ')).toBe(true);
    expect(renderMap({ mode: "view", anchor: false })).not.toContain('id="map"');
  });

  it("keeps a label as text: quotes and markup are escaped in the attribute and come back as written", () => {
    const label = `"><script>alert(1)</script> O'Hara & co`;
    const html = renderMap({ mode: "view", markers: [{ ...site, label }] });
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/data-map="[^"]*"[^ >]/);
    expect(dataOf(html, "data-map").markers[0].label).toBe(label);
  });

  it("no position in any href/action/src", () => {
    const html =
      renderMap({
        mode: "view",
        lang: "el",
        fit: [{ lat: 37.4412, lng: 24.9421 }, { lat: 37.4512, lng: 24.9521 }],
        markers: [site, { lat: 37.4412, lng: 24.9421, label: "Sighting 1", href: "#sg-3", look: "seen", n: 1 }],
      }) + renderMap({ mode: "place", formId: "pick", centre: { lat: 37.4412, lng: 24.9421 }, zoom: 17 });
    const values = [...html.matchAll(/\s(href|action|src)="([^"]*)"/g)].map((m) => m[2]!);
    // The markers' links too: dashboard-pin.js makes them hrefs.
    const inData = [...html.matchAll(/ data-map="([^"]*)"/g)].flatMap((m) =>
      (JSON.parse(unescape(m[1]!)).markers as { href?: string }[]).flatMap((k) => (k.href === undefined ? [] : [k.href])),
    );
    expect(inData).toEqual(["/api/team/sites/12", "#sg-3"]);
    values.push(...inData);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      if (isOpaqueAddress(v)) continue;
      expect(v, v).not.toMatch(/\d+\.\d+/);
      expect(v, v).not.toMatch(/\d+[/-]\d+[/-]\d+/);
      expect(v, v).not.toMatch(/[?&](lat|lng|lon|z|x|y|vz|vx|vy)=/i);
    }
    // Nor in the scripts' addresses.
    for (const s of [...mapPageAssets().script, ...mapPageAssets().styles]) expect(s).toMatch(/^\/api\/team\/assets\/[\w.-]+$/);
  });

  it("credit line links to the OSM copyright page", () => {
    const credit = '<p class="attrib"><a href="https://www.openstreetmap.org/copyright" rel="noreferrer">© OpenStreetMap contributors</a></p>';
    expect(mapCredit()).toBe(credit);
    expect(renderMap({ mode: "view" }).endsWith(credit)).toBe(true);
  });

  it("the page's map files: MapLibre's stylesheet, then PMTiles, map-core.js and dashboard-pin.js in that order", () => {
    const a = mapPageAssets();
    expect(a.styles).toEqual([assetUrl("maplibre-gl.css")]);
    expect(a.script).toEqual([assetUrl("pmtiles.js"), assetUrl("map-core.js"), assetUrl("dashboard-pin.js")]);
    expect(a.script.every((s) => typeof s === "string")).toBe(true);
  });

  it("the map's box is Syros padded by 0.03°", () => {
    expect(inMapBox({ lat: 37.445, lng: 24.93 })).toBe(true);
    expect(inMapBox({ lat: 37.335, lng: 24.93 })).toBe(true);
    expect(inMapBox({ lat: 37.32, lng: 24.93 })).toBe(false);
    expect(inMapBox({ lat: 37.98, lng: 23.72 })).toBe(false); // Athens
  });
});
