import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import request from "supertest";
import { and, asc, eq, like } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  coloniesTable,
  db,
  feedingSitesTable,
  mappingEventsTable,
  pool,
  sightingsTable,
} from "@workspace/db";
import app from "../app";
import { sessionCookieFor, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { BANDS } from "../lib/mapTiles/geometry";
import { guardianOn, newColony, putInColony, seedCat } from "../test/roleKit";
import { deleteTestSightings } from "../test/sightings";
import { isOpaqueAddress } from "../test/opaqueAddress";

// SYC-209 PR 3.4: the entry points. "Make a feeding site here" and "Show on
// our map" on each sighting of the team's cat page, and "Add a feeding site
// to this colony" on a colony page. Plan K13 (no position in any address),
// roles PR 0.5 (a 403 for a signed-in person without the capability, no
// target until PR 4.1), spec test 16 (escaping).
//
// mapping_events refuses delete and a site with history can't be removed, so
// nothing is cleaned up but the sightings: every name is unique to this run,
// and the throwaway database is dropped at the end of the run.

// A staff member who lacks exactly one capability (the site writes tests' way).
const denied = vi.hoisted(() => ({ cap: null as string | null }));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) =>
      args[1] === denied.cap ? false : real.can(...args),
  };
});

const RUN = randomBytes(3).toString("hex");
const DEVICE = `vt-ep-${RUN}-device`;
const SUSAN = `vitest-ep-susan-${RUN}@example.com`;
const VERA = `vitest-ep-vera-${RUN}@example.com`;
const KEY = "vitest-ep-key-0123456789abcdef-0123456789abcdef";
const MARKUP = `<img src=x onerror="alert(1)"> "q" 'x'`;
const NUL = String.fromCharCode(0);
const NO_SUCH = "999999999";

// Positions that would be easy to spot if they leaked into an address or an error.
const SPOT_A = { lat: 37.4447123, lng: 24.9417456 };
const SPOT_B = { lat: 37.4461987, lng: 24.9433654 };

let cookie: string;
let vetCookie: string;
let guardianCookie: string;
let n = 0;
let fetchSpy: MockInstance<typeof fetch>;

// The fixtures.
let colonyId: number;
let colonyName: string;
let catId: number;
let sightingA: number;
let sightingB: number;
let bareCatId: number; // a cat in no colony
let bareSighting: number;
let outsideSighting: number;
let awaitingSighting: number;
let pendingSighting: number;

const unique = (label: string) => `vt-ep-${RUN}-${label}-${++n}`;

/** The text a browser would show: entities decoded. */
const decoded = (html: string) =>
  html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const get = (path: string, c: string | null = cookie) => {
  const t = request(app).get(path);
  if (c) t.set("Cookie", c);
  return t;
};

function post(
  path: string,
  body: Record<string, string>,
  opts: { cookie?: string | null; origin?: string | null } = {},
) {
  const t = request(app).post(path).type("form");
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) t.set("Cookie", c);
  const o = opts.origin === undefined ? TEAM_ORIGIN : opts.origin;
  if (o) t.set("Origin", o);
  return t.send(body);
}

const postJson = (path: string, body: Record<string, unknown>) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).set("Accept", "application/json").send(body);

const hiddenIn = (html: string, name: string) => decoded(new RegExp(`name="${name}" value="([^"]*)"`).exec(html)![1]!);

const ATTR = /\s(href|action|src)="([^"]*)"/g;

/** K13: no href, action or src holds a coordinate or a z/x/y. */
function expectNoPositionInAddresses(html: string) {
  // A photo's address ends in a random id (a UUID), whose digit runs can look
  // like z-x-y by chance; it holds no position, so it is set aside first.
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const values = [...html.matchAll(ATTR)].map((m) => m[2]!.replace(UUID, "photo"));
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) {
    if (isOpaqueAddress(v)) continue; // a photo uuid or a signed tile token (SYC-425)
    expect(v, v).not.toMatch(/\d+\.\d+/);
    expect(v, v).not.toMatch(/\d+[/-]\d+[/-]\d+/);
    expect(v, v).not.toMatch(/[?&](lat|lng|lon|z|x|y|vz|vx|vy)=/i);
  }
}

/** A band's tap form: where it posts and every hidden field it carries. */
function bandForm(html: string, size: number) {
  const band = new RegExp(`<div class="mapband b${size}"[^>]*>(.*?)</div>`).exec(html)![0];
  const action = decoded(/<form method="post" action="([^"]*)"/.exec(band)![1]!);
  const fields: Record<string, string> = {};
  for (const m of band.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) fields[m[1]!] = decoded(m[2]!);
  return { action, fields, band };
}

/** The zoom, pan and area form under the map. */
function moveForm(html: string) {
  const m = /<form method="post" action="([^"]*)" class="mapmove">(.*?)<\/form>/.exec(html)!;
  const fields: Record<string, string> = {};
  for (const h of m[2]!.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) fields[h[1]!] = decoded(h[2]!);
  return { action: decoded(m[1]!), fields };
}

const siteRows = (name: string) => db.select().from(feedingSitesTable).where(eq(feedingSitesTable.name, name));
const totalSites = async () => Number((await pool.query("select count(*)::int as n from feeding_sites")).rows[0].n);
const totalSiteEvents = async () =>
  Number((await pool.query("select count(*)::int as n from mapping_events where subject_kind = 'site'")).rows[0].n);

async function sighting(
  forCat: number,
  photoId: number,
  at: { lat: number; lng: number },
  extra: Partial<typeof sightingsTable.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(sightingsTable)
    .values({
      catId: forCat,
      deviceId: DEVICE,
      photoId,
      lat: at.lat,
      lng: at.lng,
      status: "resolved",
      createdAt: new Date("2026-09-12T07:15:00Z"),
      ...extra,
    })
    .returning({ id: sightingsTable.id });
  return row!.id;
}

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  const susan = await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest" });
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["vet"] });
  cookie = sessionCookieFor(susan.id);
  vetCookie = sessionCookieFor(vera.id);
  const own = await newColony("ep-guardian");
  guardianCookie = (await guardianOn("ep-guardian", [own])).cookie;

  // A colony and a cat in it, both with markup in their names (spec test 16).
  colonyName = `${MARKUP} ${unique("colony")}`;
  const [c] = await db
    .insert(coloniesTable)
    .values({ name: colonyName, normalisedName: colonyName.toLowerCase() })
    .returning({ id: coloniesTable.id });
  colonyId = c!.id;

  const cat = await seedCat(colonyId);
  catId = cat.id;
  await db.update(catsTable).set({ name: `${MARKUP} ${unique("cat")}` }).where(eq(catsTable.id, catId));
  sightingA = await sighting(catId, cat.photoId, SPOT_A);
  sightingB = await sighting(catId, cat.photoId, SPOT_B, { createdAt: new Date("2026-09-28T16:40:00Z") });
  outsideSighting = await sighting(catId, cat.photoId, { lat: 38.5123456, lng: 25.5123456 });
  pendingSighting = await sighting(catId, cat.photoId, SPOT_A, { status: "pending", catId: null });
  // Not yet checked by the team, though it already names a cat.
  awaitingSighting = await sighting(catId, cat.photoId, SPOT_A, { status: "awaiting_team" });

  const bare = await seedCat(null);
  bareCatId = bare.id;
  bareSighting = await sighting(bareCatId, bare.photoId, SPOT_B);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
  // The map's pictures are fetched by our server; no test reaches the internet.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 503 }));
});

afterAll(async () => {
  fetchSpy?.mockRestore();
  await deleteTestSightings(like(sightingsTable.deviceId, `vt-ep-${RUN}-%`));
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

// ── The cat page ───────────────────────────────────────────────────────────

describe("the cat page: two buttons on each sighting", () => {
  it("each sighting has 'Make a feeding site here' and 'Show on our map', as POST forms carrying only its number", async () => {
    const res = await get(`/api/team/cats/${catId}`);
    expect(res.status).toBe(200);
    for (const id of [sightingA, sightingB]) {
      expect(res.text).toContain(
        `<form method="post" action="/api/team/sites/from-sighting" class="sightact"><input type="hidden" name="sightingId" value="${id}"><button type="submit">Make a feeding site here</button></form>`,
      );
      expect(res.text).toContain(
        `<form method="post" action="/api/team/sites/map-at-sighting#map" class="sightact"><input type="hidden" name="sightingId" value="${id}"><button type="submit">Show on our map</button></form>`,
      );
    }
    // The positions still show as plain text for the team, and nowhere else.
    expect(res.text).toContain(`${SPOT_A.lat}, ${SPOT_A.lng}`);
    expectNoPositionInAddresses(res.text);
  });

  it("the page has no link to a map company", async () => {
    const res = await get(`/api/team/cats/${catId}`);
    for (const company of ["google.com/maps", "maps.apple.com", "maps.google.", "goo.gl/maps", "geo:", "waze.com", "openstreetmap.org/?mlat"]) {
      expect(res.text).not.toContain(company);
    }
  });

  it("a cat's name and a colony's name with markup are escaped on the page", async () => {
    const res = await get(`/api/team/cats/${catId}`);
    expect(res.text).not.toContain("<img src=x");
    expect(decoded(res.text)).toContain(MARKUP);
  });

  it("someone who may not add sites sees 'Show on our map' but not 'Make a feeding site here'", async () => {
    denied.cap = "add_feeding_site";
    const res = await get(`/api/team/cats/${catId}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("from-sighting");
    expect(res.text).not.toContain("Make a feeding site here");
    expect(res.text).toContain("map-at-sighting");
  });

  it("someone who may add sites but not see exact positions gets no cat page, so neither button", async () => {
    denied.cap = "view_exact_location";
    const res = await get(`/api/team/cats/${catId}`);
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("from-sighting");
  });
});

// ── Make a feeding site here ───────────────────────────────────────────────

describe("'Make a feeding site here'", () => {
  it("opens the confirmation page at exactly the sighting's position, in hidden fields only, with the cat's colony chosen", async () => {
    const res = await post("/api/team/sites/from-sighting", { sightingId: String(sightingA) });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Check the spot");
    expect(hiddenIn(res.text, "lat")).toBe(String(SPOT_A.lat));
    expect(hiddenIn(res.text, "lng")).toBe(String(SPOT_A.lng));
    expect(res.text).toContain(`<option value="${colonyId}" selected>`);
    // The name, how to find it and the notes start empty.
    expect(res.text).toContain('id="new-name" name="name" type="text" required maxlength="');
    expect(res.text).toMatch(/id="new-name"[^>]*value=""/);
    // The colony's name is escaped in the choice list.
    expect(res.text).not.toContain("<img src=x");
    expect(decoded(res.text)).toContain(MARKUP);
    // The small map is centred on the spot and can be nudged.
    expect(res.text).toContain("Not quite right? Tap the small map to move the pin.");
    expect(bandForm(res.text, 179).action).toBe("/api/team/sites/pick");
    expect(bandForm(res.text, 179).fields["colonyId"]).toBe(String(colonyId));
    // It saves nothing, and the sighting's number does not come back.
    expect(res.text).not.toContain("sightingId");
    expectNoPositionInAddresses(res.text);
  });

  it("the pin is within the central half of the small map at every width band", async () => {
    const res = await post("/api/team/sites/from-sighting", { sightingId: String(sightingB) });
    for (const b of BANDS) {
      const { band } = bandForm(res.text, b.size);
      const m = /class="pin site-private" style="left:(\d+)px;top:(\d+)px"/.exec(band);
      expect(m, `at ${b.size}`).not.toBeNull();
      const span = 2 * b.size;
      for (const off of [Number(m![1]), Number(m![2])]) {
        expect(Math.abs(off - span / 2), `at ${b.size}`).toBeLessThanOrEqual(span / 4 + 1);
      }
    }
  });

  it("a cat in no colony gets no colony chosen", async () => {
    const res = await post("/api/team/sites/from-sighting", { sightingId: String(bareSighting) });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(" selected>");
    expect(hiddenIn(res.text, "lat")).toBe(String(SPOT_B.lat));
  });

  it("a cat whose colony was changed is placed in the colony that stands now", async () => {
    const other = await newColony("ep-other");
    const cat = await seedCat(colonyId);
    const s = await sighting(cat.id, cat.photoId, SPOT_A);
    await putInColony(cat.id, other);
    const res = await post("/api/team/sites/from-sighting", { sightingId: String(s) });
    expect(res.text).toContain(`<option value="${other}" selected>`);
    expect(res.text).not.toContain(`<option value="${colonyId}" selected>`);
  });

  it("saving it makes a private site at that spot and writes one 'created' event", async () => {
    const page = (await post("/api/team/sites/from-sighting", { sightingId: String(sightingA) })).text;
    const name = unique("from-sighting");
    const before = await totalSiteEvents();
    const saved = await post("/api/team/sites", {
      lat: hiddenIn(page, "lat"),
      lng: hiddenIn(page, "lng"),
      name,
      colonyId: String(colonyId),
      directions: "",
      notes: "",
    });
    expect(saved.status).toBe(303);
    const [site] = await siteRows(name);
    expect(site).toBeDefined();
    expect(site!.lat).toBeCloseTo(SPOT_A.lat, 9);
    expect(site!.lng).toBeCloseTo(SPOT_A.lng, 9);
    expect(site!.isPublic).toBe(false);
    expect(site!.colonyId).toBe(colonyId);
    const events = await db
      .select()
      .from(mappingEventsTable)
      .where(and(eq(mappingEventsTable.subjectKind, "site"), eq(mappingEventsTable.subjectId, site!.id)))
      .orderBy(asc(mappingEventsTable.id));
    expect(events.map((e) => e.kind)).toEqual(["created"]);
    expect(await totalSiteEvents()).toBe(before + 1);
  });

  it("opening the page writes nothing", async () => {
    const before = { sites: await totalSites(), events: await totalSiteEvents() };
    await post("/api/team/sites/from-sighting", { sightingId: String(sightingA) });
    await post("/api/team/sites/from-sighting", { sightingId: String(bareSighting) });
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual(before);
  });

  it("an unknown sighting, a sighting that isn't a cat's, or one outside the island is a 400 that names no position", async () => {
    const bad: Array<[string, Record<string, string>]> = [
      ["no such sighting", { sightingId: NO_SUCH }],
      ["a pending sighting (no cat yet)", { sightingId: String(pendingSighting) }],
      ["a sighting the team hasn't checked yet", { sightingId: String(awaitingSighting) }],
      ["outside the island box", { sightingId: String(outsideSighting) }],
      ["not a number", { sightingId: "abc" }],
      ["empty", { sightingId: "" }],
      ["missing", {}],
      ["a decimal", { sightingId: "1.5" }],
      ["an exponent", { sightingId: "1e3" }],
      ["a NUL", { sightingId: `${sightingA}${NUL}` }],
      ["too long", { sightingId: "1234567890123" }],
    ];
    for (const [label, body] of bad) {
      const res = await post("/api/team/sites/from-sighting", body);
      expect(res.status, label).toBe(400);
      expect(res.text, label).toContain("That sighting can&#39;t be found, or it isn&#39;t somewhere on Syros.");
      expect(res.text, label).not.toContain("Check the spot");
      // Not the stored position, and not the outside one either.
      expect(res.text, label).not.toMatch(/38\.5|25\.5|37\.44|24\.94/);
      expectNoPositionInAddresses(res.text);
    }
    const json = await postJson("/api/team/sites/from-sighting", { sightingId: Number(NO_SUCH) });
    expect(json.status).toBe(400);
    expect(json.body).toEqual({ error: "Invalid request", fields: ["sightingId"] });
    const outside = await postJson("/api/team/sites/from-sighting", { sightingId: outsideSighting });
    expect(outside.status).toBe(400);
    expect(JSON.stringify(outside.body)).not.toMatch(/38\.5|25\.5/);
  });

  it("ignores everything but the sighting's number: a position in the form is not used", async () => {
    const res = await post("/api/team/sites/from-sighting", { sightingId: String(sightingA), lat: "37.5", lng: "25.0" });
    expect(hiddenIn(res.text, "lat")).toBe(String(SPOT_A.lat));
    expect(hiddenIn(res.text, "lng")).toBe(String(SPOT_A.lng));
  });

  it("an Object.prototype key is not a field", async () => {
    const res = await post("/api/team/sites/from-sighting", { constructor: "1", __proto__: "1" } as Record<string, string>);
    expect(res.status).toBe(400);
  });
});

// ── Show on our map ────────────────────────────────────────────────────────

describe("'Show on our map'", () => {
  it("is the Feeding sites map centred on the sighting, with an outlined marker no site marker looks like, and the site markers as usual", async () => {
    const siteName = unique("nearby");
    const [site] = await db
      .insert(feedingSitesTable)
      .values({ name: siteName, lat: SPOT_A.lat + 0.0003, lng: SPOT_A.lng + 0.0002 })
      .returning({ id: feedingSitesTable.id });
    const before = { sites: await totalSites(), events: await totalSiteEvents() };
    const res = await post("/api/team/sites/map-at-sighting", { sightingId: String(sightingA) });
    expect(res.status).toBe(200);
    expect(res.text).toContain("<h1>Feeding sites</h1>");
    for (const b of BANDS) {
      const { band } = (() => {
        const band = new RegExp(`<div class="mapband b${b.size}"[^>]*>(.*?)</div>`).exec(res.text)![0];
        return { band };
      })();
      const m = /<span class="pin sighting" style="left:(\d+)px;top:(\d+)px"/.exec(band);
      expect(m, `at ${b.size}`).not.toBeNull();
      const span = 2 * b.size;
      for (const off of [Number(m![1]), Number(m![2])]) {
        expect(Math.abs(off - span / 2), `at ${b.size}`).toBeLessThanOrEqual(span / 4 + 1);
      }
      // The site is a link marker of its own kind.
      expect(band).toContain(`<a class="pin site-private"`);
      expect(band).toContain(`href="/api/team/sites/${site!.id}"`);
    }
    expect(res.text).toContain("Where the cat was seen");
    expect(res.text).toContain("Dashed blue square: where the cat was seen.");
    expectNoPositionInAddresses(res.text);
    // It writes nothing at all.
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual(before);
  });

  it("zoom, pan and the area buttons keep working from this page", async () => {
    const res = await post("/api/team/sites/map-at-sighting", { sightingId: String(sightingA) });
    const form = moveForm(res.text);
    expect(form.action).toBe("/api/team/sites/map");
    const moved = await post(form.action, { ...form.fields, go: "in" });
    expect(moved.status).toBe(200);
    expect(Number(hiddenIn(moved.text, "vz"))).toBe(Number(form.fields["vz"]) + 1);
    expectNoPositionInAddresses(moved.text);
  });

  it("an unknown sighting, or one outside the island, is a 400 that names no position", async () => {
    for (const id of [NO_SUCH, String(outsideSighting), String(pendingSighting), "abc", ""]) {
      const res = await post("/api/team/sites/map-at-sighting", { sightingId: id });
      expect(res.status, id).toBe(400);
      expect(res.text, id).toContain("That sighting can&#39;t be found");
      expect(res.text, id).not.toMatch(/38\.5|25\.5|37\.44|24\.94/);
      expectNoPositionInAddresses(res.text);
    }
    const json = await postJson("/api/team/sites/map-at-sighting", { sightingId: Number(NO_SUCH) });
    expect(json.status).toBe(400);
    expect(json.body).toEqual({ error: "Invalid request", fields: ["sightingId"] });
  });
});

// ── Add a feeding site to this colony ──────────────────────────────────────

describe("'Add a feeding site to this colony'", () => {
  it("the colony page has the link, with only the colony's number in the address", async () => {
    const res = await get(`/api/team/colonies/${colonyId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`<a class="tap" href="/api/team/sites/new?colony=${colonyId}">Add a feeding site to this colony</a>`);
    expect(res.text).not.toContain("<img src=x");
    expectNoPositionInAddresses(res.text);
  });

  it("someone who may not add sites doesn't see it", async () => {
    denied.cap = "add_feeding_site";
    const res = await get(`/api/team/colonies/${colonyId}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Add a feeding site to this colony");
  });

  it("opens the add page with the colony named and carried by every form on the page", async () => {
    const res = await get(`/api/team/sites/new?colony=${colonyId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<h1>Add a feeding site</h1>");
    expect(res.text).toContain("This site will be put in the colony");
    // Escaped: the colony's name has markup in it.
    expect(res.text).not.toContain("<img src=x");
    expect(decoded(res.text)).toContain(MARKUP);
    for (const b of BANDS) expect(bandForm(res.text, b.size).fields["colonyId"]).toBe(String(colonyId));
    expect(moveForm(res.text).fields["colonyId"]).toBe(String(colonyId));
    expect(res.text).toMatch(/class="typedpos">\s*<input type="hidden" name="colonyId"/);
    expectNoPositionInAddresses(res.text);
  });

  it("a colony that doesn't exist is ignored: the add page opens as usual, with no colony chosen", async () => {
    for (const q of [`colony=${NO_SUCH}`, "colony=abc", "colony=", "colony=1e3", "colony=-1", "colony=1&colony=2", "colony[x]=1"]) {
      const res = await get(`/api/team/sites/new?${q}`);
      expect(res.status, q).toBe(200);
      expect(res.text, q).not.toContain('name="colonyId"');
      expect(res.text, q).not.toContain("This site will be put in the colony");
    }
  });

  it("the colony stays chosen through a move, a tap and the nudge", async () => {
    const page = (await get(`/api/team/sites/new?colony=${colonyId}`)).text;

    // A move (zoom in).
    const mv = moveForm(page);
    expect(mv.action).toBe("/api/team/sites/new/map");
    const moved = await post(mv.action, { ...mv.fields, go: "in" });
    expect(moved.status).toBe(200);
    expect(moved.text).toContain("This site will be put in the colony");
    expect(moveForm(moved.text).fields["colonyId"]).toBe(String(colonyId));
    expect(Number(moveForm(moved.text).fields["vz"])).toBe(Number(mv.fields["vz"]) + 1);

    // A tap on the moved map.
    const tap = bandForm(moved.text, 179);
    expect(tap.action).toBe("/api/team/sites/pick");
    const tapped = await post(tap.action, { ...tap.fields, x: "190", y: "190" });
    expect(tapped.status).toBe(200);
    expect(tapped.text).toContain("Check the spot");
    expect(tapped.text).toContain(`<option value="${colonyId}" selected>`);

    // The nudge: a re-tap on the confirmation's small map.
    const nudge = bandForm(tapped.text, 179);
    expect(nudge.fields["colonyId"]).toBe(String(colonyId));
    const nudged = await post(nudge.action, { ...nudge.fields, x: "120", y: "100" });
    expect(nudged.status).toBe(200);
    expect(nudged.text).toContain(`<option value="${colonyId}" selected>`);
    expectNoPositionInAddresses(tapped.text);
    expectNoPositionInAddresses(nudged.text);
  });

  it("the colony stays chosen through typed coordinates, and when a tap is refused", async () => {
    const page = (await get(`/api/team/sites/new?colony=${colonyId}`)).text;
    const typed = await post("/api/team/sites/pick", { lat: "37.4447", lng: "24.9417", colonyId: String(colonyId) });
    expect(typed.text).toContain(`<option value="${colonyId}" selected>`);

    // (0, 0) is refused, and the picker it comes back to still has the colony.
    const tap = bandForm(page, 179);
    const refused = await post(tap.action, { ...tap.fields, x: "0", y: "0" });
    expect(refused.status).toBe(400);
    expect(refused.text).toContain("This site will be put in the colony");
    expect(bandForm(refused.text, 179).fields["colonyId"]).toBe(String(colonyId));
  });

  it("a colony number that was altered on the way is ignored, never trusted", async () => {
    const res = await post("/api/team/sites/pick", { lat: "37.4447", lng: "24.9417", colonyId: NO_SUCH });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(" selected>");
    const move = await post("/api/team/sites/new/map", { vz: "12", vx: "1", vy: "1", colonyId: "<script>" });
    expect(move.status).toBe(200);
    expect(move.text).not.toContain('name="colonyId"');
  });

  it("saving from there puts the new site in the colony, private, with a 'created' event", async () => {
    const tap = bandForm((await get(`/api/team/sites/new?colony=${colonyId}`)).text, 179);
    const confirm = (await post(tap.action, { ...tap.fields, x: "190", y: "190" })).text;
    const name = unique("in-colony");
    const saved = await post("/api/team/sites", {
      lat: hiddenIn(confirm, "lat"),
      lng: hiddenIn(confirm, "lng"),
      name,
      colonyId: String(colonyId),
    });
    expect(saved.status).toBe(303);
    const [site] = await siteRows(name);
    expect(site!.colonyId).toBe(colonyId);
    expect(site!.isPublic).toBe(false);
  });
});

// ── Who may use them ───────────────────────────────────────────────────────

describe("access (roles PR 0.5: no target until PR 4.1)", () => {
  const ROUTES = [
    "/api/team/sites/from-sighting",
    "/api/team/sites/map-at-sighting",
  ];

  it("without a session: 401, and nothing is shown", async () => {
    for (const path of ROUTES) {
      const res = await post(path, { sightingId: String(sightingA) }, { cookie: null });
      expect([res.status, res.text], path).toEqual([401, '{"error":"not_signed_in"}']);
    }
  });

  it("signed in without the role (a vet) or as a cat guardian: 403, nothing shown or written", async () => {
    const before = { sites: await totalSites(), events: await totalSiteEvents() };
    for (const c of [vetCookie, guardianCookie]) {
      for (const path of ROUTES) {
        const res = await post(path, { sightingId: String(sightingA) }, { cookie: c });
        expect([res.status, res.text], path).toEqual([403, '{"error":"forbidden"}']);
      }
      const colonyLink = await get(`/api/team/sites/new?colony=${colonyId}`, c);
      expect(colonyLink.status).toBe(403);
    }
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual(before);
  });

  it("a foreign or missing Origin is refused before anything is read", async () => {
    for (const origin of [null, "https://evil.example.com", `${TEAM_ORIGIN}.evil.com`]) {
      for (const path of ROUTES) {
        const res = await post(path, { sightingId: String(sightingA) }, { origin });
        expect([res.status, res.text], `${origin} ${path}`).toEqual([401, '{"error":"not_signed_in"}']);
      }
    }
  });

  it("each button asks for its own capability, before the body is read", async () => {
    const wants: Array<[string, string]> = [
      ["add_feeding_site", "/api/team/sites/from-sighting"],
      ["view_exact_location", "/api/team/sites/from-sighting"],
      ["view_exact_location", "/api/team/sites/map-at-sighting"],
    ];
    for (const [cap, path] of wants) {
      denied.cap = cap;
      // A body that would be a 400 gets the 403 first.
      for (const body of [{ sightingId: String(sightingA) }, {} as Record<string, string>]) {
        const res = await post(path, body);
        expect([res.status, res.text], `${cap} ${path}`).toEqual([403, '{"error":"forbidden"}']);
      }
    }
  });
});
