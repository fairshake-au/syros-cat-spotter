import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { removeTestPerson } from "../test/removeTestPerson";
import { guardianOn, newColony, seedCat, signedPerson, type Signed } from "../test/roleKit";

// SYC-396 PR 1.3.4: the Cats grid is the one team page with a script, and
// it is exactly one tag: our own file, by its hashed name, from
// /api/team/assets/. Every other team page has no script at all (its
// security header would refuse one anyway; this catches it before a browser
// does).

const KEY = "vitest-scripttags-key-0123456789abcdef-012345";
let staff: Signed;
let guardian: Signed;
let catId: number;
let colonyId: number;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colonyId = await newColony("scripttags");
  catId = (await seedCat(colonyId)).id;
  staff = await signedPerson("scripttags-staff", ["staff"]);
  guardian = await guardianOn("scripttags-guardian", [colonyId]);
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  await removeTestPerson(staff.email);
  await removeTestPerson(guardian.email);
  await pool.end();
});

const page = (path: string, who?: Signed) => {
  const t = request(app).get(path).set("Accept", "text/html").set("Sec-Fetch-Mode", "navigate");
  return who ? t.set("Cookie", who.cookie) : t;
};

const OUR_SCRIPT = /^<script src="\/api\/team\/assets\/dashboard-grid\.[0-9a-f]{12}\.js" defer><\/script>$/;

describe("the Cats grid has exactly one script: ours", () => {
  it.each([
    ["the grid", "/api/team/cats"],
    ["the grid, filtered", "/api/team/cats?colours=ginger&sterilised=not_known"],
    ["the grid, nothing matches", "/api/team/cats?q=vt-no-such-cat-at-all"],
  ])("%s", async (_what, path) => {
    const res = await page(path, staff);
    expect(res.status).toBe(200);
    const tags = res.text.match(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi) ?? [];
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatch(OUR_SCRIPT);
    expect(res.text.match(/<script\b/gi)).toHaveLength(1);
    // It sits in the head, and the parts it swaps are there.
    expect(res.text.indexOf(tags[0]!)).toBeLessThan(res.text.indexOf("</head>"));
    expect(res.text).toContain('id="catfilters"');
    expect(res.text).toContain('<div id="catresults">');
    // The file it names is served.
    const src = /src="([^"]+)"/.exec(tags[0]!)![1]!;
    const file = await request(app).get(src);
    expect(file.status).toBe(200);
  });
});

describe("no other team page has any script", () => {
  const PAGES: [string, () => string, (() => Signed) | undefined][] = [
    ["the welfare queue", () => "/api/team", () => staff],
    ["a cat's page", () => `/api/team/cats/${catId}`, () => staff],
    ["a cat that doesn't exist", () => "/api/team/cats/999999999", () => staff],
    ["the colonies list", () => "/api/team/colonies", () => staff],
    ["a colony", () => `/api/team/colonies/${colonyId}`, () => staff],
    ["a colony's cats", () => `/api/team/colonies/${colonyId}/cats`, () => staff],
    ["the map", () => "/api/team/map", () => staff],
    ["Colour check", () => "/api/team/colour-check", () => staff],
    ["the likely-sterilised list", () => "/api/team/likely", () => staff],
    ["My page", () => "/api/team/my", () => staff],
    ["My colonies, for a guardian", () => "/api/team/my/colonies", () => guardian],
    ["the Cats grid, refused to a guardian", () => "/api/team/cats", () => guardian],
    ["the Cats grid, signed out", () => "/api/team/cats", undefined],
  ];
  it.each(PAGES)("%s", async (_what, path, who) => {
    const res = await page(path(), who?.());
    expect(res.status).toBeLessThan(500);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.text).not.toMatch(/<script/i);
  });
});

// SYC-705 Task 2b.5: a page with a MapLibre map loads exactly MapLibre's
// stylesheet, then PMTiles, map-core.js and dashboard-pin.js, all by hashed
// name from /api/team/assets/; the library and its worker are named on the map
// box (data-maplibre, data-worker), never as script tags. A cat's page and a
// colony's page load them only when they have a map (with no sightings or
// sites they are in the list above, with no script).
describe("a page with a MapLibre map loads its files, and nothing else", () => {
  const CSS = /^<link rel="stylesheet" href="\/api\/team\/assets\/maplibre-gl\.[0-9a-f]{12}\.css">$/;
  const TAGS = [
    /^<script src="\/api\/team\/assets\/pmtiles\.[0-9a-f]{12}\.js" defer><\/script>$/,
    /^<script src="\/api\/team\/assets\/map-core\.[0-9a-f]{12}\.js" defer><\/script>$/,
    /^<script src="\/api\/team\/assets\/dashboard-pin\.[0-9a-f]{12}\.js" defer><\/script>$/,
  ];
  it.each([
    ["the Feeding sites page", "/api/team/sites"],
    ["the Feeding sites page, with retired sites", "/api/team/sites?retired=1"],
    // SYC-705 Task 2b.7: the place pages (drag the map under the pin).
    ["the add-a-site page", "/api/team/sites/new"],
  ])("%s", async (_what, path) => {
    const res = await page(path, staff);
    expect(res.status).toBe(200);
    const tags = res.text.match(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi) ?? [];
    expect(tags).toHaveLength(3);
    tags.forEach((t, i) => expect(t).toMatch(TAGS[i]!));
    expect(res.text.match(/<script\b/gi)).toHaveLength(3);
    const links = res.text.match(/<link\b[^>]*>/gi) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toMatch(CSS);
    const head = res.text.slice(0, res.text.indexOf("</head>"));
    for (const t of [...tags, ...links]) expect(head).toContain(t);
    const lib = / data-maplibre="(\/api\/team\/assets\/maplibre-gl\.[0-9a-f]{12}\.mjs)"/.exec(res.text);
    const worker = / data-worker="(\/api\/team\/assets\/maplibre-gl-worker\.[0-9a-f]{12}\.mjs)"/.exec(res.text);
    expect(lib).not.toBeNull();
    expect(worker).not.toBeNull();
    // Every file it names is served.
    for (const src of [...[...tags, ...links].map((t) => /(?:src|href)="([^"]+)"/.exec(t)![1]!), lib![1]!, worker![1]!]) {
      expect((await request(app).get(src)).status, src).toBe(200);
    }
  });
});

// SYC-396 PR 1.5; SYC-705 Task 2b.6: the island Map (the Cats page as a map)
// loads MapLibre's stylesheet, then PMTiles, map-core.js and our cats map
// script, all by hashed name from /api/team/assets/; the library and its
// worker are named on the map box, never as script tags. No picture-map library.
describe("the island Map loads the MapLibre files and our map script, and nothing else", () => {
  const TAGS = [
    /^<script src="\/api\/team\/assets\/pmtiles\.[0-9a-f]{12}\.js" defer><\/script>$/,
    /^<script src="\/api\/team\/assets\/map-core\.[0-9a-f]{12}\.js" defer><\/script>$/,
    /^<script src="\/api\/team\/assets\/dashboard-map\.[0-9a-f]{12}\.js" defer><\/script>$/,
  ];
  const CSS = /^<link rel="stylesheet" href="\/api\/team\/assets\/maplibre-gl\.[0-9a-f]{12}\.css">$/;

  it.each([
    ["the map", "/api/team/cats?view=map"],
    ["the map, filtered", "/api/team/cats?view=map&colours=ginger&sterilised=not_known"],
    ["the map, with a cat in focus", () => `/api/team/cats?view=map&focus=${catId}`],
  ] as [string, string | (() => string)][])("%s", async (_what, p) => {
    const res = await page(typeof p === "string" ? p : p(), staff);
    expect(res.status).toBe(200);
    const tags = res.text.match(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi) ?? [];
    expect(tags).toHaveLength(3);
    tags.forEach((t, i) => expect(t).toMatch(TAGS[i]!));
    expect(res.text.match(/<script\b/gi)).toHaveLength(3);
    expect(res.text).not.toMatch(/leaflet/i);
    const links = res.text.match(/<link\b[^>]*>/gi) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toMatch(CSS);
    const head = res.text.slice(0, res.text.indexOf("</head>"));
    for (const t of [...tags, ...links]) expect(head).toContain(t);
    const lib = / data-maplibre="(\/api\/team\/assets\/maplibre-gl\.[0-9a-f]{12}\.mjs)"/.exec(res.text);
    const worker = / data-worker="(\/api\/team\/assets\/maplibre-gl-worker\.[0-9a-f]{12}\.mjs)"/.exec(res.text);
    expect(lib).not.toBeNull();
    expect(worker).not.toBeNull();
    // Every file it names is served.
    for (const src of [...[...tags, ...links].map((t) => /(?:src|href)="([^"]+)"/.exec(t)![1]!), lib![1]!, worker![1]!]) {
      expect((await request(app).get(src)).status, src).toBe(200);
    }
  });

  it("refused to a cat guardian: no script", async () => {
    const res = await page("/api/team/cats?view=map", guardian);
    expect(res.status).toBe(403);
    expect(res.text).not.toMatch(/<script|<link\b/i);
  });
});
