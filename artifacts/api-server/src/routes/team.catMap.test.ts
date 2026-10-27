import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { like } from "drizzle-orm";
import { db, feedingSitesTable, pool, sightingsTable } from "@workspace/db";
import app from "../app";
import { assetUrl } from "../lib/teamAssets";
import { isOpaqueAddress } from "../test/opaqueAddress";
import { expectMapNote } from "../test/mapNote";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { currentAreas } from "../lib/areas/namedAreas";
import { removeTestPerson } from "../test/removeTestPerson";
import { deleteTestSightings } from "../test/sightings";
import { guardianOn, newColony, RUN, seedCat, signedPerson, type SeededCat, type Signed } from "../test/roleKit";

// SYC-396 PR 1.5 (spec §6, §10.4, §12.2, §12.4, §13; plan Task 1.5.3); SYC-705
// Task 2b.6: the island Map, GET /api/team/cats?view=map. The MapLibre map's
// box for the scripts, and for no script (or no map) the "needs JavaScript"
// line and a link to the same cats as the grid; the legend, the layers, the
// Go to areas, the Grid/Map switch, and a cat's trail with ?focus=. No
// position in any address; team-only.

const KEY = "vitest-catmap-key-0123456789abcdef-0123456789ab";
const DEVICE = `vt-catmap-${RUN}`;
let staff: Signed;
let guardian: Signed;
let colony: number;
let cat: SeededCat;
let siteId: number;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("catmap");
  cat = await seedCat(colony);
  // Two sightings, so the trail has three points: found, then seen twice.
  for (const [lat, lng, daysAgo] of [
    [37.4436, 24.8889, 20],
    [37.4447, 24.9417, 2],
  ] as const) {
    await db.insert(sightingsTable).values({
      catId: cat.id,
      deviceId: DEVICE,
      photoId: cat.photoId,
      lat,
      lng,
      status: "resolved",
      createdAt: new Date(Date.now() - daysAgo * 86_400_000),
    });
  }
  const [site] = await db
    .insert(feedingSitesTable)
    .values({ name: `vt-catmap site ${RUN}`, lat: 37.4401, lng: 24.9402, colonyId: colony, isPublic: false })
    .returning({ id: feedingSitesTable.id });
  siteId = site!.id;
  staff = await signedPerson("catmap-staff", ["staff"]);
  guardian = await guardianOn("catmap-guardian", [colony]);
});

afterAll(async () => {
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
  // Feeding sites are never deleted (a database rule); the throwaway database goes.
  await removeTestPerson(staff.email);
  await removeTestPerson(guardian.email);
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const page = (path: string, who: Signed | null = staff) => {
  const t = request(app).get(path).set("Accept", "text/html").set("Sec-Fetch-Mode", "navigate");
  return who ? t.set("Cookie", who.cookie) : t;
};

/** Every href, src and action on a page. */
const addresses = (html: string) => [...html.matchAll(/\b(?:href|src|action)="([^"]*)"/g)].map((m) => m[1]!);

/** The JSON in one data- attribute of #island-map. */
function data(html: string, name: string): unknown {
  const m = new RegExp(`<div class="map" id="island-map"[^>]*\\sdata-${name}="([^"]*)"`).exec(html);
  if (!m) return undefined;
  const raw = m[1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return JSON.parse(raw);
}

describe("the island Map page", () => {
  it("holds the map's box for the scripts, saying the map needs JavaScript until it starts", async () => {
    const res = await page(`/api/team/cats?view=map&colony=${colony}`);
    expect(res.status).toBe(200);
    const box = /<div class="map" id="island-map"[^>]*>([\s\S]*?)<\/div>/.exec(res.text);
    expect(box).not.toBeNull();
    expect(box![0]).toContain('role="region" aria-label="Map of Syros with the cats on it"');
    expect(box![0]).toMatch(/ data-maplibre="\/api\/team\/assets\/maplibre-gl\.[0-9a-f]{12}\.mjs"/);
    expect(box![0]).toMatch(/ data-worker="\/api\/team\/assets\/maplibre-gl-worker\.[0-9a-f]{12}\.mjs"/);
    expect(box![1]).toBe('<p class="mapnojs">The map needs a newer browser with JavaScript on.</p>');
    const words = data(res.text, "words") as Record<string, string>;
    expect(words).toMatchObject({ loading: "Loading the map…", needsJs: "The map needs a newer browser with JavaScript on." });
    expect(data(res.text, "map")).toMatchObject({ mode: "view", lang: "en", zoom: 12, markers: [] });
    // No button map any more, in <noscript> or anywhere.
    expect(res.text).not.toContain("<noscript");
    expect(res.text).not.toContain("/api/team/cats/map");
    // The layers and Go to stay hidden until the script shows them.
    expect(res.text).toContain('<fieldset class="maplayers" id="maplayers" hidden>');
    expect(res.text).toContain('<details class="mapmove" id="mapmove" hidden><summary>Go to an area</summary>');
  });

  it("no script or no map: links to the same cats as the grid, with the filters and never a position", async () => {
    const q = `colours=ginger&sterilised=not_known&colony=${colony}`;
    const res = await page(`/api/team/cats?${q}&view=map&focus=${cat.id}`);
    const link = /<p class="mapfallback" id="mapgrid"><a class="tap" id="map-gridlink" href="([^"]+)">Show these cats as a grid<\/a><\/p>/.exec(res.text);
    expect(link).not.toBeNull();
    const href = link![1]!.replace(/&amp;/g, "&");
    // The same address as the Grid switch.
    const grid = /<a id="view-grid" href="([^"]+)"/.exec(res.text)![1]!.replace(/&amp;/g, "&");
    expect(href).toBe(grid);
    expect(href).toBe(`/api/team/cats?colours=ginger&colony=${colony}&sterilised=not_known`);
  });

  it("has a Go to button per named area, by key, with its position only in the page data", async () => {
    const res = await page("/api/team/cats?view=map");
    const keys = [...res.text.matchAll(/<button type="button" data-area="([^"]+)">([^<]+)<\/button>/g)].map((m) => [m[1], m[2]]);
    expect(keys).toEqual(currentAreas().map((a) => [a.key, a.name]));
    expect(data(res.text, "areas")).toEqual(currentAreas().map((a) => ({ key: a.key, name: a.name, lat: a.lat, lng: a.lng })));
  });

  it("says the map is only for the team where it can be seen, and keeps the reason behind a link (22 Oct 2026)", async () => {
    expectMapNote((await page(`/api/team/cats?view=map&colony=${colony}`)).text);
  });

  it("the note sits outside the map's box, so it shows with no script or no map too", async () => {
    const html = (await page(`/api/team/cats?view=map&colony=${colony}`)).text;
    expect(html.indexOf("This map is only for the team.")).toBeGreaterThan(html.indexOf('id="map-gridlink"'));
  });

  it("is titled Map and keeps Grid/Map after the search and Filters, as the grid does (SYC-522)", async () => {
    const map = (await page("/api/team/cats?view=map")).text;
    expect(map).toContain("<title>Map</title>");
    expect(map).toContain("<h1>Map</h1>");
    const grid = (await page("/api/team/cats")).text;
    for (const html of [map, grid]) {
      expect(html.indexOf('role="search"')).toBeLessThan(html.indexOf('class="viewswitch"'));
      expect(html.indexOf("<summary>Filters")).toBeLessThan(html.indexOf('class="viewswitch"'));
    }
  });

  it("is the menu's Map: Map is underlined, not Cats (SYC-396 PR 1.6)", async () => {
    const res = await page("/api/team/cats?view=map");
    const nav = /<nav class="bar[^"]*"[^>]*>([\s\S]*?)<\/nav>/.exec(res.text)![1]!;
    expect(nav).toContain('<a class="here" href="/api/team/cats?view=map" aria-current="page">Map</a>');
    expect(nav.match(/aria-current/g)).toHaveLength(1);
    // And the grid is still the menu's Cats.
    const grid = (await page("/api/team/cats")).text;
    expect(grid).toContain('<a class="here" href="/api/team/cats" aria-current="page">Cats</a>');
  });

  it("loads only our own files, by assetUrl()", async () => {
    const res = await page("/api/team/cats?view=map");
    const srcs = [...res.text.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toEqual([assetUrl("pmtiles.js"), assetUrl("map-core.js"), assetUrl("dashboard-map.js")]);
    const css = [...res.text.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    expect(css).toEqual([assetUrl("maplibre-gl.css")]);
  });

  it("has the legend: the four marks with their words, and the square feeding-site key", async () => {
    const res = await page("/api/team/cats?view=map");
    const legend = /<details class="maplegend"[\s\S]*?<\/details>/.exec(res.text)![0];
    for (const [mark, word] of [
      ["sterilised", "Sterilised"],
      ["probably", "Probably"],
      ["not_known", "Sterilised: not known yet"],
      ["not_sterilised", "Not sterilised"],
    ])
      expect(legend).toContain(`<span class="catdot mark-${mark}" aria-hidden="true"></span>${word}</li>`);
    for (const look of ["site-public", "site-private", "site-retired"]) expect(legend).toContain(`<span class="sitesq ${look}"`);
    expect(legend).toContain("Public feeding site");
    expect(legend).toContain("Private feeding site");
  });

  it("has the layer checkboxes: cats on, feeding sites off", async () => {
    const res = await page("/api/team/cats?view=map");
    expect(res.text).toContain('<input type="checkbox" id="layer-cats" checked> Cats');
    expect(res.text).toContain('<input type="checkbox" id="layer-sites"> Feeding sites');
  });

  it("has the Grid/Map switch, keeping the filters: the Grid link's query is the grid's own", async () => {
    const q = "colours=ginger&sterilised=not_known&lastSeen=month";
    const res = await page(`/api/team/cats?${q}&view=map`);
    const grid = /<a id="view-grid" href="([^"]+)"/.exec(res.text)![1]!.replace(/&amp;/g, "&");
    expect(grid).toBe(`/api/team/cats?${q}`);
    expect(res.text).toMatch(/<a id="view-map" href="[^"]*view=map" aria-current="page">Map<\/a>/);
    // And the grid's own switch links to the map with the same filters.
    const gridPage = await page(`/api/team/cats?${q}`);
    const map = /<a id="view-map" href="([^"]+)"/.exec(gridPage.text)![1]!.replace(/&amp;/g, "&");
    expect(map).toBe(`/api/team/cats?${q}&view=map`);
    // The form stays on the map when sent with no script.
    expect(res.text).toContain('<input type="hidden" name="view" value="map">');
  });

  it("has the photo link beside the switch, in one .viewrow, carrying only area, colony and colours (§5.3)", async () => {
    const res = await page(`/api/team/cats?view=map&colours=ginger&colony=${colony}&sterilised=not_known&q=Mimi`);
    const row = /<div class="viewrow">([\s\S]*?)<\/div>/.exec(res.text)![1]!;
    expect(row.indexOf('class="viewswitch"')).toBeGreaterThanOrEqual(0);
    const href = /<a class="findentrylink" href="([^"]+)">Find from a photo<\/a>/.exec(row)![1]!.replace(/&amp;/g, "&");
    expect(href).toBe(`/api/team/cats/find?colours=ginger&colony=${colony}`);
    expect(row.indexOf("viewswitch")).toBeLessThan(row.indexOf("findentrylink"));
  });

  it("a focus=<id> brings that cat's trail into the page data, oldest first", async () => {
    const res = await page(`/api/team/cats?view=map&focus=${cat.id}`);
    const focus = data(res.text, "focus") as { id: number; points: { lat: number; lng: number; at: string; first: boolean }[] };
    expect(focus.id).toBe(cat.id);
    expect(focus.points.map((p) => [p.lat, p.lng, p.first])).toEqual([
      [37.445, 24.942, true],
      [37.4436, 24.8889, false],
      [37.4447, 24.9417, false],
    ]);
    // No focus: no trail.
    expect(data((await page("/api/team/cats?view=map")).text, "focus")).toBeUndefined();
    // A focus that isn't a number is no focus.
    expect(data((await page("/api/team/cats?view=map&focus=1;drop")).text, "focus")).toBeUndefined();
  });

  it("carries the team's feeding sites as data for the Feeding sites layer", async () => {
    const res = await page("/api/team/cats?view=map");
    const sites = data(res.text, "sites") as { id: number; look: string }[];
    expect(sites.find((s) => s.id === siteId)).toMatchObject({ look: "private" });
  });

  it("puts no position in any address", async () => {
    const res = await page(`/api/team/cats?view=map&focus=${cat.id}`);
    const all = addresses(res.text);
    expect(all.length).toBeGreaterThan(10);
    for (const a of all) {
      // A photo uuid or a picture token this server signed is opaque by
      // design, and may hold a digit run by chance (SYC-425).
      if (isOpaqueAddress(a)) continue;
      expect(a, a).not.toMatch(/37\.\d|24\.\d|\d+[/-]\d+[/-]\d+/);
      expect(a, a).not.toMatch(/\blat\b|\blng\b|map-tiles\/|map-square\//i);
    }
  });

  it("no cats match: the map still shows, with the words and Clear filters (spec §13)", async () => {
    const res = await page("/api/team/cats?view=map&q=vt-no-such-cat-at-all-zz");
    expect(res.status).toBe(200);
    expect(res.text).toContain("No cats match these filters");
    expect(res.text).toMatch(/<a class="tap" id="mapclear" href="\/api\/team\/cats\?view=map">Clear filters<\/a>/);
    expect(res.text).toContain('<div class="map" id="island-map"');
  });

  it("is the team's only: a cat guardian gets the 403, nobody signed in the 401", async () => {
    const g = await page("/api/team/cats?view=map", guardian);
    expect(g.status).toBe(403);
    expect(g.text).not.toContain('id="island-map"');
    expect((await page("/api/team/cats?view=map", null)).status).toBe(401);
  });
});

describe("the button map's moves are gone (SYC-705 Task 2b.6)", () => {
  it("POST /api/team/cats/map is no route", async () => {
    const res = await request(app)
      .post("/api/team/cats/map")
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", staff.cookie)
      .type("form")
      .send({ vz: "12", vx: "0", vy: "0", go: "in" });
    expect(res.status).toBe(404);
  });
});
