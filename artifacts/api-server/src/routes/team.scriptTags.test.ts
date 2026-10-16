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
    const tags = res.text.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [];
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
    ["the Feeding sites page", () => "/api/team/sites", () => staff],
    ["the add-a-site page", () => "/api/team/sites/new", () => staff],
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
