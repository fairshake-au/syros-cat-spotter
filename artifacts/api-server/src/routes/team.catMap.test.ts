import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { like } from "drizzle-orm";
import { db, feedingSitesTable, pool, sightingsTable } from "@workspace/db";
import app from "../app";
import { assetUrl } from "../lib/teamAssets";
import { isOpaqueAddress } from "../test/opaqueAddress";
import { expectMapNote } from "../test/mapNote";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";
import { deleteTestSightings } from "../test/sightings";
import { guardianOn, newColony, RUN, seedCat, signedPerson, type SeededCat, type Signed } from "../test/roleKit";

// SYC-396 PR 1.5 (spec §6, §10.4, §12.2, §12.4, §13; plan Task 1.5.3): the
// island Map, GET /api/team/cats?view=map. A draggable map for the script,
// the button map with the cats on it for no script, the legend, the layers,
// the Grid/Map switch, and a cat's trail with ?focus=. No position in any
// address; team-only.

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
  const m = new RegExp(`<div id="island-map"[^>]*\\sdata-${name}="([^"]*)"`).exec(html);
  if (!m) return undefined;
  const raw = m[1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return JSON.parse(raw);
}

describe("the island Map page", () => {
  it("holds the draggable map's box, and the button map with the cats on it inside <noscript>", async () => {
    const res = await page(`/api/team/cats?view=map&colony=${colony}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="island-map"');
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(res.text);
    expect(noscript).not.toBeNull();
    const fallback = noscript![1]!;
    expect(fallback).toContain('class="mapfallback"');
    expect(fallback).toContain('<div class="map" id="map"');
    // The cat as a marker, with its mark's dot, linking to its page.
    expect(fallback).toContain(`href="/api/team/cats/${cat.id}"`);
    expect(fallback).toMatch(/class="pin catpin"[^>]*>.*?<span class="catdot mark-not_known"/);
    // Its zoom, pan and Go to buttons post back to the Cats map, not the tap-check page.
    expect(fallback).toContain('action="/api/team/cats/map"');
    expect(fallback).not.toContain('action="/api/team/map"');
    // The scripted part stays hidden until the script shows it.
    expect(res.text).toContain('<div id="mapscripted" hidden>');
  });

  it("says the map is only for the team where it can be seen, and keeps the reason behind a link (22 Oct 2026)", async () => {
    expectMapNote((await page(`/api/team/cats?view=map&colony=${colony}`)).text);
  });

  it("the no-script cats map carries the same note", async () => {
    // Without a script the page is the same HTML; the note sits outside <noscript> and the script's box.
    const html = (await page(`/api/team/cats?view=map&colony=${colony}`)).text;
    expect(html.indexOf("This map is only for the team.")).toBeGreaterThan(html.indexOf("</noscript>"));
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
    expect(srcs).toEqual([assetUrl("leaflet.js"), assetUrl("dashboard-map.js")]);
    const css = [...res.text.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    expect(css).toEqual([assetUrl("leaflet.css")]);
  });

  it("has the legend: the four marks with their words, and the square feeding-site key", async () => {
    const res = await page("/api/team/cats?view=map");
    const legend = /<details class="maplegend"[\s\S]*?<\/details>/.exec(res.text)![0];
    for (const [mark, word] of [
      ["sterilised", "Sterilised"],
      ["probably", "Probably"],
      ["not_known", "Not known"],
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

  it("a focus=<id> brings that cat's trail into the page data, oldest first", async () => {
    const res = await page(`/api/team/cats?view=map&focus=${cat.id}`);
    const focus = data(res.text, "focus") as { id: number; points: { lat: number; lng: number; at: string; first: boolean }[] };
    expect(focus.id).toBe(cat.id);
    expect(focus.points.map((p) => [p.lat, p.lng, p.first])).toEqual([
      [37.445, 24.942, true],
      [37.4436, 24.8889, false],
      [37.4447, 24.9417, false],
    ]);
    // On the button map too, as numbered markers with their dates.
    expect(res.text).toMatch(/title="1\. First recorded /);
    expect(res.text).toMatch(/title="3\. Seen /);
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
    expect(res.text).toContain('<div id="island-map"');
  });

  it("is the team's only: a cat guardian gets the 403, nobody signed in the 401", async () => {
    const g = await page("/api/team/cats?view=map", guardian);
    expect(g.status).toBe(403);
    expect(g.text).not.toContain('<div id="island-map"');
    expect((await page("/api/team/cats?view=map", null)).status).toBe(401);
  });
});

describe("the button map's moves, with no script (POST /api/team/cats/map)", () => {
  const move = (body: Record<string, string>, who: Signed | null = staff) => {
    const t = request(app).post("/api/team/cats/map").set("Origin", TEAM_ORIGIN).type("form");
    return (who ? t.set("Cookie", who.cookie) : t).send(body);
  };

  it("zooms in and keeps the filters, with the button map in the open and no script", async () => {
    const res = await move({ vz: "12", vx: "0", vy: "0", go: "in", filters: `colony=${colony}` });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<noscript>");
    expect(res.text).toContain('class="mapfallback"');
    expect(res.text).toMatch(/name="vz" value="13"/);
    // The filters ride along, in a hidden field, not the address.
    expect(res.text).toContain(`name="filters" value="colony=${colony}"`);
    expect(res.text).toMatch(/<option value="\d+" selected>/);
  });

  it("Go to an area works", async () => {
    const res = await move({ vz: "12", vx: "0", vy: "0", area: "kini" });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/name="vz" value="15"/);
  });

  it("an unreadable move is a 400 back at the whole island, saying so", async () => {
    const res = await move({ vz: "x" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("That didn&#39;t work, so the map is back at the whole island.");
  });

  it("is the team's only", async () => {
    expect((await move({ vz: "12", vx: "0", vy: "0" }, guardian)).status).toBe(403);
    expect((await move({ vz: "12", vx: "0", vy: "0" }, null)).status).toBe(401);
  });
});
