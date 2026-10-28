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
import { guardianOn, newColony, putInColony, seedCat } from "../test/roleKit";
import { deleteTestSightings } from "../test/sightings";
import { isOpaqueAddress } from "../test/opaqueAddress";
import { isOpenMapLink } from "../test/openMapLink";

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
  // SYC-705: a map's markers link from its data-map JSON; those are addresses too.
  for (const m of html.matchAll(/data-map="([^"]*)"/g)) {
    const data = JSON.parse(decoded(m[1]!)) as { markers?: Array<{ href?: string }> };
    for (const mk of data.markers ?? []) if (mk.href !== undefined) values.push(mk.href);
  }
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) {
    if (isOpaqueAddress(v)) continue; // a photo uuid or a signed tile token (SYC-425)
    if (isOpenMapLink(v)) continue; // D9's outbound Open map link, for the team only (SYC-395)
    expect(v, v).not.toMatch(/\d+\.\d+/);
    expect(v, v).not.toMatch(/\d+[/-]\d+[/-]\d+/);
    expect(v, v).not.toMatch(/[?&](lat|lng|lon|z|x|y|vz|vx|vy)=/i);
  }
}

/** The map's data on a page (renderMap's data-map), decoded. */
const mapDataIn = (html: string) => JSON.parse(decoded(/data-map="([^"]*)"/.exec(html)![1]!));

/** Every form on a page: where it posts, and its hidden fields. */
function formsIn(html: string) {
  return [...html.matchAll(/<form method="post" action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/g)].map((m) => {
    const fields: Record<string, string> = {};
    for (const h of m[2]!.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) fields[h[1]!] = decoded(h[2]!);
    return { action: decoded(m[1]!), fields };
  });
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
        `<form method="post" action="/api/team/sites/map-at-sighting#map" class="sightact"><input type="hidden" name="sightingId" value="${id}"><button type="submit">Show on the map</button></form>`,
      );
    }
    // The position is a link only (Open map, 5 places, by position.ts), never printed as numbers (SYC-517).
    expect(res.text).toContain(encodeURIComponent(`${SPOT_A.lat.toFixed(5)},${SPOT_A.lng.toFixed(5)}`));
    expect(res.text.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ")).not.toMatch(/\d{2}\.\d{5}/);
    expectNoPositionInAddresses(res.text);
  });

  // SYC-395 (D9): the team gets Open map links beside the buttons (built by
  // position.ts only); no other map company, and no other link shape.
  it("the page's only map-company links are position.ts's Open map links", async () => {
    const res = await get(`/api/team/cats/${catId}`);
    for (const company of ["maps.apple.com", "maps.google.", "goo.gl/maps", "geo:", "waze.com", "openstreetmap.org/?mlat"]) {
      expect(res.text).not.toContain(company);
    }
    const google = [...res.text.matchAll(/href="([^"]*google\.com\/maps[^"]*)"/g)].map((m) => m[1]!);
    expect(google.length).toBeGreaterThan(0);
    for (const href of google) expect(isOpenMapLink(href), href).toBe(true);
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
    // The small place map is centred on the spot, inside the save form: drag it to move the pin.
    expect(res.text).toContain("Not quite right? Drag the small map to move the pin.");
    // The map's data holds positions to 5 places (renderMap); the form keeps the exact one.
    expect(mapDataIn(res.text)).toMatchObject({ mode: "place", formId: "detailsform", centre: [37.44471, 24.94175], zoom: 17 });
    expect(res.text).toContain('<form method="post" action="/api/team/sites" id="detailsform">');
    expect(res.text).not.toContain('name="approximate"');
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    // It saves nothing, and the sighting's number does not come back.
    expect(res.text).not.toContain("sightingId");
    expectNoPositionInAddresses(res.text);
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
    // The MapLibre sites map, opened on the sighting, close up (Samuel, 26 Oct 2026).
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    const data = mapDataIn(res.text);
    expect(data).toMatchObject({ mode: "view", centre: [37.44471, 24.94175], zoom: 17, fit: null });
    expect(data.markers).toContainEqual({ lat: 37.44471, lng: 24.94175, label: "Where the cat was seen", look: "sighting" });
    // The site is a link marker of its own kind, to its number.
    expect(data.markers).toContainEqual(expect.objectContaining({ href: `/api/team/sites/${site!.id}`, look: "private" }));
    expect(res.text).not.toContain('class="mapband');
    expect(res.text).toContain("Where the cat was seen");
    expect(res.text).toContain("Dashed blue square: where the cat was seen.");
    expectNoPositionInAddresses(res.text);
    // It writes nothing at all.
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual(before);
  });

  it("is a POST with nothing in the address: no zoom, pan or area buttons (the map's own), and POST /api/team/sites/map is gone", async () => {
    const res = await post("/api/team/sites/map-at-sighting", { sightingId: String(sightingA) });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('class="mapmove"');
    expect(res.text).not.toContain('action="/api/team/sites/map"');
    expect((await post("/api/team/sites/map", { vz: "12", vx: "1", vy: "1" })).status).toBe(404);
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
    // The map's form, the area list and the typed numbers all carry it.
    const forms = formsIn(res.text).filter((f) => f.action === "/api/team/sites/pick");
    expect(forms).toHaveLength(3);
    for (const f of forms) expect(f.fields["colonyId"]).toBe(String(colonyId));
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

  it("the colony stays chosen through the map's pin, an area, and typed coordinates", async () => {
    const page = (await get(`/api/team/sites/new?colony=${colonyId}`)).text;
    for (const f of formsIn(page).filter((x) => x.action === "/api/team/sites/pick")) {
      // Each form as the browser sends it: the pin's spot, an area, or typed numbers.
      const body = { ...f.fields, ...(Object.hasOwn(f.fields, "lat") ? { lat: "37.4447", lng: "24.9417" } : {}) };
      const sent = Object.hasOwn(body, "lat") ? body : { ...body, area: "kini" };
      const res = await post(f.action, sent);
      expect(res.status).toBe(200);
      expect(res.text).toContain("Check the spot");
      expect(res.text).toContain(`<option value="${colonyId}" selected>`);
      expectNoPositionInAddresses(res.text);
    }
  });

  it("the colony stays chosen when a pick is refused", async () => {
    const refused = await post("/api/team/sites/pick", { lat: "37.30", lng: "24.70", colonyId: String(colonyId) });
    expect(refused.status).toBe(400);
    expect(refused.text).toContain("This site will be put in the colony");
    for (const f of formsIn(refused.text).filter((x) => x.action === "/api/team/sites/pick")) expect(f.fields["colonyId"]).toBe(String(colonyId));
  });

  it("a colony number that was altered on the way is ignored, never trusted", async () => {
    const res = await post("/api/team/sites/pick", { lat: "37.4447", lng: "24.9417", colonyId: NO_SUCH });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(" selected>");
    const refused = await post("/api/team/sites/pick", { lat: "0", lng: "0", colonyId: "<script>" });
    expect(refused.status).toBe(400);
    expect(refused.text).not.toContain('name="colonyId"');
  });

  it("saving from there puts the new site in the colony, private, with a 'created' event", async () => {
    const pin = formsIn((await get(`/api/team/sites/new?colony=${colonyId}`)).text).find((f) => f.action === "/api/team/sites/pick")!;
    expect(pin.fields).toEqual({ colonyId: String(colonyId), lat: "", lng: "" });
    const confirm = (await post(pin.action, { ...pin.fields, lat: "37.444712", lng: "24.941734" })).text;
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
      if (c === vetCookie) {
        expect(colonyLink.status).toBe(403);
      } else {
        // A cat guardian may add sites to HER colonies (SYC-209 PR 4.2), so the
        // add page opens; another colony in ?colony= is ignored like an unknown one.
        expect(colonyLink.status).toBe(200);
        expect(colonyLink.text).not.toContain(`name="colonyId" value="${colonyId}"`);
      }
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
