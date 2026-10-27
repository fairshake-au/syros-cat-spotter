import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import request from "supertest";
import { and, asc, eq } from "drizzle-orm";
import {
  addPerson,
  coloniesTable,
  db,
  feedingSitesTable,
  mappingEventsTable,
  pool,
} from "@workspace/db";
import app from "../app";
import { sessionCookieFor, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { recordMappingEvent } from "../lib/mappingEvents";
import type { Position } from "../lib/mapTiles/geometry";
import { guardianOn, newColony } from "../test/roleKit";
import { makePrivateIfPublic } from "../lib/teamSiteWrites";
import { isOpaqueAddress } from "../test/opaqueAddress";
import { expectMapNote } from "../test/mapNote";
import { isOpenMapLink } from "../test/openMapLink";
import { placeLabel } from "../lib/areas/placeLabel";
import { currentAreas } from "../lib/areas/namedAreas";

// SYC-209 PR 3.3: adding, moving, retiring and bringing back feeding sites,
// and changing their colony. Spec tests 7 (never created public), 9 (early
// half: moving a public site makes it private), 10 (retired is never
// public), 11 (one history row per change, in the same transaction), 12
// (refusals), 13 (concurrent writes), 16 (escaping), the island-box and
// (0, 0) refusals, and K13 (no position in any address) on every page this
// PR adds.
//
// mapping_events refuses delete, and a site with history can't be removed,
// so nothing here is cleaned up: every name is unique to this run, and the
// throwaway database is dropped at the end of the run (src/test/globalSetup.ts).

// The history write is mocked through so a test can make it fail; every
// other call goes to the real writer.
vi.mock("../lib/mappingEvents", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/mappingEvents")>();
  return { ...real, recordMappingEvent: vi.fn(real.recordMappingEvent) };
});

// A staff member who lacks exactly one capability (the colonies tests' way).
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
const P = `vt-sw-${RUN}-`;
const SUSAN = `vitest-sw-susan-${RUN}@example.com`;
const VERA = `vitest-sw-vera-${RUN}@example.com`;
const KEY = "vitest-sw-key-0123456789abcdef-0123456789abcdef";
const MARKUP = `<img src=x onerror="alert(1)"> "q" 'x'`;
const NUL = String.fromCharCode(0);
const NO_SUCH = "999999999";

let susan: string;
let cookie: string;
let vetCookie: string;
let guardianCookie: string;
let n = 0;
let fetchSpy: MockInstance<typeof fetch>;

const unique = (label: string) => `${P}${label}-${++n}`;

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

/** Sites go near the middle of the island, away from other tests' sites. */
let slot = 0;
async function makeSite(
  opts: { name?: string; colonyId?: number | null; isPublic?: boolean; retired?: boolean; lat?: number; lng?: number } = {},
): Promise<{ id: number; name: string; lat: number; lng: number }> {
  const name = opts.name ?? unique("site");
  const lat = opts.lat ?? 37.46 + slot * 0.0007;
  const lng = opts.lng ?? 24.95;
  slot += 1;
  const [row] = await db
    .insert(feedingSitesTable)
    .values({
      name,
      lat,
      lng,
      colonyId: opts.colonyId ?? null,
      ...(opts.isPublic
        ? {
            isPublic: true,
            publicLabel: "A public place",
            publicId: randomBytes(16).toString("hex"),
            madePublicBy: susan,
            madePublicAt: new Date("2026-09-01T10:00:00Z"),
          }
        : {}),
      ...(opts.retired ? { retiredAt: new Date("2026-09-15T10:00:00Z") } : {}),
    })
    .returning({ id: feedingSitesTable.id });
  return { id: row!.id, name, lat, lng };
}

async function makeColony(name = unique("colony")): Promise<number> {
  const [c] = await db
    .insert(coloniesTable)
    .values({ name, normalisedName: name.toLowerCase() })
    .returning({ id: coloniesTable.id });
  return c!.id;
}

const siteRow = async (id: number) =>
  (await db.select().from(feedingSitesTable).where(eq(feedingSitesTable.id, id)))[0]!;

const eventsOf = (id: number) =>
  db
    .select()
    .from(mappingEventsTable)
    .where(and(eq(mappingEventsTable.subjectKind, "site"), eq(mappingEventsTable.subjectId, id)))
    .orderBy(asc(mappingEventsTable.id));

const kindsOf = async (id: number) => (await eventsOf(id)).map((e) => e.kind);

/** The exact `updated_at` text, as a page carries it. */
const stampOf = async (id: number) =>
  String((await pool.query("select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as s from feeding_sites where id = $1", [id])).rows[0].s);

const totalSites = async () => Number((await pool.query("select count(*)::int as n from feeding_sites")).rows[0].n);
const totalSiteEvents = async () =>
  Number((await pool.query("select count(*)::int as n from mapping_events where subject_kind = 'site'")).rows[0].n);

/** The stamp a page shows, as a browser would send it back. */
const stampIn = (html: string) => decoded(/name="updatedAt" value="([^"]*)"/.exec(html)![1]!);
const hiddenIn = (html: string, name: string) => decoded(new RegExp(`name="${name}" value="([^"]*)"`).exec(html)![1]!);

const ATTR = /\s(href|action|src)="([^"]*)"/g;

/** K13: no href, action or src holds a coordinate or a z/x/y. */
function expectNoPositionInAddresses(html: string) {
  const values = [...html.matchAll(ATTR)].map((m) => m[2]!);
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

const ERMOUPOLI: Position = { lat: 37.4447, lng: 24.9417 };

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  susan = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest" })).id;
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["vet"] });
  cookie = sessionCookieFor(susan);
  vetCookie = sessionCookieFor(vera.id);
  const colony = await newColony("sw-guardian");
  guardianCookie = (await guardianOn("sw-guardian", [colony])).cookie;
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
  // A reset (not a clear): a failure queued by one test must never reach the next.
  vi.mocked(recordMappingEvent).mockReset();
  // The map's pictures are fetched by our server; no test reaches the internet.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 503 }));
});

afterAll(async () => {
  fetchSpy?.mockRestore();
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

// ── Adding ─────────────────────────────────────────────────────────────────

/** The map's data on a page (renderMap's data-map), decoded. */
const mapDataIn = (html: string) => JSON.parse(decoded(/data-map="([^"]*)"/.exec(html)![1]!));
/** The form that holds the place map (by its id), whole. */
const formById = (html: string, id: string) => new RegExp(`<form [^>]*id="${id}"[\\s\\S]*?</form>`).exec(html)?.[0];
/** The no-map path: the .mapfallback block. */
const fallbackIn = (html: string) => /<div class="mapfallback">[\s\S]*?<\/details><\/div>/.exec(html)?.[0];

describe("adding a site: the map and the pick", () => {
  it("/sites/new is the place page, not a site called 'new': a map to drag under the pin, posting to /sites/pick", async () => {
    const res = await get("/api/team/sites/new");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<h1>Add a feeding site</h1>");
    const form = formById(res.text, "pickform")!;
    expect(form).toContain('action="/api/team/sites/pick"');
    expect(mapDataIn(res.text)).toMatchObject({ mode: "place", formId: "pickform" });
    // The pin writes these; "Use this spot" waits, hidden, for the map to start.
    expect(form).toContain('<input type="hidden" name="lat" value=""><input type="hidden" name="lng" value="">');
    expect(form).toMatch(/<button type="submit" class="save" data-mapon hidden>Use this spot<\/button>/);
    expect(res.text).toContain("Don&#39;t copy numbers from other map apps. Ask a colleague who has been there.");
    expect(res.text).not.toContain("No such feeding site");
    // Only our own map scripts, under the wider header.
    expect(res.text).toMatch(/<script src="\/api\/team\/assets\/map-core\.[0-9a-f]{12}\.js"/);
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expectNoPositionInAddresses(res.text);
  });

  it("the new-site map says it is only for the team where it can be seen, and keeps the reason behind a link (22 Oct 2026)", async () => {
    expectMapNote((await get("/api/team/sites/new")).text);
  });

  it("place page without script offers area list and typed coordinates (the no-map path)", async () => {
    const res = await get("/api/team/sites/new");
    const fallback = fallbackIn(res.text)!;
    expect(fallback).toBeDefined();
    // An area from the list: every current area, by key, posting to the same pick.
    expect(fallback).toContain('<form method="post" action="/api/team/sites/pick" class="areapick">');
    const keys = [...fallback.matchAll(/<option value="([^"]*)">/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(currentAreas().map((a) => a.key).sort());
    expect(fallback).toContain("Use this area’s centre");
    // Typed numbers, open here (there is no map to fold them under).
    expect(fallback).toMatch(/<details class="typedfold" open><summary>Type a position instead<\/summary><form method="post" action="\/api\/team\/sites\/pick" class="typedpos">/);
  });

  it("an area pick answers with Check the spot at that area's centre, marked approximate", async () => {
    const kini = currentAreas().find((a) => a.key === "kini")!;
    const res = await post("/api/team/sites/pick", { area: "kini" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Check the spot");
    const form = formById(res.text, "detailsform")!;
    expect(Number(hiddenIn(form, "lat"))).toBe(kini.lat);
    expect(Number(hiddenIn(form, "lng"))).toBe(kini.lng);
    expect(hiddenIn(form, "approximate")).toBe("1");
    expect(res.text).toContain("only roughly right");
    expectNoPositionInAddresses(res.text);
  });

  it("unknown area key is refused: 400, the no-map path, strict header, nothing saved", async () => {
    const before = { sites: await totalSites(), events: await totalSiteEvents() };
    const res = await post("/api/team/sites/pick", { area: "atlantis" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("That area isn&#39;t on our list");
    expect(res.text).not.toMatch(/<script/i);
    expect(res.headers["content-security-policy"]).not.toContain("script-src");
    expect(fallbackIn(res.text)).toBeDefined();
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual(before);
  });

  it("the map's pin answers with the confirmation page directly: the spot in hidden fields of the one form, and in words", async () => {
    const res = await post("/api/team/sites/pick", { lat: "37.444712", lng: "24.941734" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Check the spot");
    const form = formById(res.text, "detailsform")!;
    expect(form).toContain('<form method="post" action="/api/team/sites" id="detailsform">');
    expect(hiddenIn(form, "lat")).toBe("37.444712");
    expect(hiddenIn(form, "lng")).toBe("24.941734");
    expect(form).not.toContain('name="approximate"');
    // The small place map is inside that form; the spot in words for the team, with Open map.
    expect(mapDataIn(form)).toMatchObject({ mode: "place", formId: "detailsform" });
    expect(res.text).toContain(`The spot: <strong>${placeLabel({ lat: 37.444712, lng: 24.941734 })} &middot; <a `);
    expect(res.text).toContain("A new site is always private");
    // No tap any more: no nudge, no check details.
    expect(res.text).not.toContain('name="nudge"');
    expect(res.text).not.toContain("Details for checking the tap");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.text).not.toContain('name="is_public"');
    expectNoPositionInAddresses(res.text);
  });

  it("a pick does not save anything", async () => {
    const before = { sites: await totalSites(), events: await totalSiteEvents() };
    await post("/api/team/sites/pick", { area: "kini" });
    await post("/api/team/sites/pick", { lat: "37.44470", lng: "24.94170" });
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual(before);
  });

  it("pin outside Syros is refused (the map can be dragged a little out to sea)", async () => {
    const res = await post("/api/team/sites/pick", { lat: "37.30", lng: "24.70" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("outside Syros");
    expect(res.text).not.toContain("Check the spot");
    expect(res.text).not.toMatch(/<script/i);
    expectNoPositionInAddresses(res.text);
  });

  it("an old tap (view, x, y) is no position at all", async () => {
    const res = await post("/api/team/sites/pick", { view: "abc", size: "179", x: "190", y: "190" });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain("Check the spot");
    expect((await post("/api/team/sites/pick", {})).status).toBe(400);
  });

  it("typed coordinates are checked the way the colony centre is: plain decimals, inside the island box", async () => {
    const ok = await post("/api/team/sites/pick", { lat: "37.4447", lng: "24.9417" });
    expect(ok.status).toBe(200);
    expect(ok.text).toContain("Check the spot");
    expect(hiddenIn(ok.text, "lat")).toBe("37.4447");
    expectNoPositionInAddresses(ok.text);
    for (const [lat, lng] of [
      ["0", "0"],
      ["40.0", "25.0"],
      ["37.4447", "30.0"],
      ["37.4447e0", "24.9417"],
      ["0x25", "24.9417"],
      ["abc", "24.9417"],
      ["37.4447", ""],
      ["", ""],
      [`37.4${NUL}`, "24.9417"],
    ] as const) {
      const res = await post("/api/team/sites/pick", { lat, lng });
      expect(res.status, `${lat},${lng}`).toBe(400);
      expect(res.text).not.toContain("Check the spot");
    }
    const onlyOne = await post("/api/team/sites/pick", { lat: "37.4447" });
    expect(onlyOne.status).toBe(400);
    const json = await postJson("/api/team/sites/pick", { lat: 99, lng: 24.9 });
    expect(json.status).toBe(400);
    expect(json.body).toEqual({ error: "Invalid request", fields: expect.arrayContaining(["lat"]) });
  });

  it("zoom and pan are the map's own now: the old POST /sites/new/map is gone", async () => {
    expect((await post("/api/team/sites/new/map", { vz: "12", vx: "1", vy: "1", go: "in" })).status).toBe(404);
  });

  it("confirm page keeps typed details when the spot changes (one form): dragging rewrites its lat/lng, and the save reads them", async () => {
    const page = (await post("/api/team/sites/pick", { area: "kini" })).text;
    const form = formById(page, "detailsform")!;
    // Every field the person fills in and the map's lat/lng are in the same form.
    const names = [...form.matchAll(/name="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["approximate", "colonyId", "directions", "lat", "lng", "name", "notes"]);
    expect(form).not.toContain('type="image"');
    // "map pin clears it": the pin moved, so dashboard-pin.js dropped approximate and wrote its spot.
    const name = unique("pinned");
    const res = await post("/api/team/sites", { name, colonyId: "", directions: "by the gate", notes: "", lat: "37.443811", lng: "24.889402" });
    expect(res.status).toBe(303);
    const id = Number(/\/sites\/(\d+)\?done=created$/.exec(res.headers["location"] as string)![1]);
    expect(await siteRow(id)).toMatchObject({ name, directions: "by the gate", lat: 37.443811, lng: 24.889402, positionApproximate: false });
  });
});

describe("adding a site: saving", () => {
  const spot = { lat: "37.44470", lng: "24.94170" };

  it("saves a private site and one 'created' event with name, lat, lng and colonyId, then goes to its page", async () => {
    const colonyId = await makeColony();
    const name = unique("added");
    const res = await post("/api/team/sites", {
      ...spot,
      name,
      colonyId: String(colonyId),
      directions: "down the steps",
      notes: "the gate is round the back",
    });
    expect(res.status).toBe(303);
    const id = Number(/\/sites\/(\d+)\?done=created$/.exec(res.headers["location"] as string)![1]);
    expect(await siteRow(id)).toMatchObject({
      name,
      lat: 37.4447,
      lng: 24.9417,
      colonyId,
      directions: "down the steps",
      notes: "the gate is round the back",
      isPublic: false,
      publicLabel: null,
      publicId: null,
      madePublicBy: null,
      retiredAt: null,
    });
    const events = await eventsOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "created",
      personId: susan,
      before: null,
      after: { name, lat: 37.4447, lng: 24.9417, colonyId },
    });
    const page = await get(res.headers["location"] as string);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Site added. It is private");
    expect(page.text).toContain("Site created");
  });

  it("the colony, how to find it and notes are all optional", async () => {
    const res = await post("/api/team/sites", { ...spot, name: unique("bare") });
    expect(res.status).toBe(303);
    const id = Number(/\/sites\/(\d+)\?/.exec(res.headers["location"] as string)![1]);
    expect(await siteRow(id)).toMatchObject({ colonyId: null, directions: null, notes: null });
  });

  it("answers JSON with 201 and the new number", async () => {
    const res = await postJson("/api/team/sites", { lat: 37.4447, lng: 24.9417, name: unique("json") });
    expect(res.status).toBe(201);
    expect((await siteRow(res.body.id)).isPublic).toBe(false);
  });

  it("refuses a bad form with 400 naming the fields only, and writes nothing", async () => {
    const before = { sites: await totalSites(), events: await totalSiteEvents() };
    const secret = `SECRET-${RUN}`;
    const bad: Array<[Record<string, unknown>, string[]]> = [
      [{ ...spot, name: "   ", notes: secret }, ["name"]],
      [{ ...spot, name: "x".repeat(101) }, ["name"]],
      [{ ...spot, name: "ok", notes: "n".repeat(2001) }, ["notes"]],
      [{ ...spot, name: "ok", directions: "d".repeat(301) }, ["directions"]],
      [{ ...spot, name: "ok", colonyId: "abc" }, ["colonyId"]],
      [{ lat: "0", lng: "0", name: "ok" }, ["lat", "lng"]],
    ];
    for (const [body, fields] of bad) {
      const json = await postJson("/api/team/sites", body);
      expect(json.status, JSON.stringify(body)).toBe(400);
      expect(json.body.error).toBe("Invalid request");
      expect(json.body.fields).toEqual(expect.arrayContaining(fields.slice(0, 1)));
      expect(JSON.stringify(json.body)).not.toContain(secret);
    }
    // SYC-406: a NUL in a JSON body is refused app-wide, before this route.
    for (const body of [{ ...spot, name: `a${NUL}b` }, { ...spot, name: "ok", notes: `n${NUL}` }]) {
      const json = await postJson("/api/team/sites", body);
      expect(json.status).toBe(400);
      expect(json.body.error).toMatch(/character we can't accept/);
    }
    const form = await post("/api/team/sites", { ...spot, name: "   ", notes: secret });
    expect(form.status).toBe(400);
    expect(form.text).not.toContain(secret);
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual(before);
  });

  it("a colony that doesn't exist is refused, and nothing is written; a spot outside Syros is refused", async () => {
    const before = { sites: await totalSites(), events: await totalSiteEvents() };
    const noColony = await post("/api/team/sites", { ...spot, name: unique("ghost"), colonyId: NO_SUCH });
    expect(noColony.status).toBe(400);
    expect(noColony.text).toContain("That colony doesn&#39;t exist.");
    const outside = await post("/api/team/sites", { lat: "40.0", lng: "25.0", name: unique("far") });
    expect(outside.status).toBe(400);
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual(before);
  });
});

describe("test 7: a site is never created public", () => {
  const publicKeys = {
    is_public: "true",
    isPublic: "true",
    public_label: "Shiny label",
    publicLabel: "Shiny label",
    public_id: "abc123",
    publicId: "abc123",
    made_public_by: "someone",
    madePublicBy: "someone",
    made_public_at: "2026-01-01",
    madePublicAt: "2026-01-01",
    last_public_lat: "37.4",
  };

  it("the add form has no visibility field, and any is_public / public* key sent is ignored", async () => {
    const pick = await post("/api/team/sites/pick", { lat: "37.4447", lng: "24.9417" });
    const form = formById(pick.text, "detailsform")!;
    expect(form).not.toMatch(/public/i);
    expect([...form.matchAll(/name="([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(
      ["colonyId", "directions", "lat", "lng", "name", "notes"],
    );
    const res = await post("/api/team/sites", {
      lat: "37.4447",
      lng: "24.9417",
      name: unique("sneaky"),
      ...publicKeys,
    });
    expect(res.status).toBe(303);
    const id = Number(/\/sites\/(\d+)\?/.exec(res.headers["location"] as string)![1]);
    expect(await siteRow(id)).toMatchObject({
      isPublic: false,
      publicLabel: null,
      publicId: null,
      madePublicBy: null,
      madePublicAt: null,
    });
    const json = await postJson("/api/team/sites", {
      lat: 37.4447,
      lng: 24.9417,
      name: unique("sneaky-json"),
      is_public: true,
      publicLabel: "Shiny label",
    });
    expect(json.status).toBe(201);
    expect(await siteRow(json.body.id)).toMatchObject({ isPublic: false, publicLabel: null });
  });

  it("no other write route sets visibility either: edit, move, colony, retire and restore leave a private site private", async () => {
    const colonyId = await makeColony();
    const a = await makeSite();
    const send = async (path: string, body: Record<string, string>) =>
      post(`/api/team/sites/${a.id}${path}`, { updatedAt: await stampOf(a.id), ...publicKeys, ...body });
    expect((await send("", { name: unique("e") })).status).toBe(303);
    expect((await send("/move", { lat: "37.45", lng: "24.95", reason: "r" })).status).toBe(303);
    expect((await send("/colony", { colonyId: String(colonyId) })).status).toBe(303);
    expect((await send("/retire", { confirm: "1", reason: "r" })).status).toBe(303);
    expect((await send("/restore", { reason: "r" })).status).toBe(303);
    expect(await siteRow(a.id)).toMatchObject({ isPublic: false, publicLabel: null, publicId: null, madePublicBy: null });
  });
});

// ── Editing ────────────────────────────────────────────────────────────────

describe("edit details", () => {
  it("writes one event for each thing that changed, with before and after", async () => {
    const s = await makeSite();
    const next = { name: unique("renamed"), notes: "new notes", directions: "by the blue gate" };
    const res = await post(`/api/team/sites/${s.id}`, { updatedAt: await stampOf(s.id), ...next });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/sites/${s.id}?done=saved`);
    expect(await siteRow(s.id)).toMatchObject(next);
    const events = await eventsOf(s.id);
    expect(events.map((e) => e.kind)).toEqual(["renamed", "notes_edited", "directions_edited"]);
    expect(events[0]).toMatchObject({ before: { name: s.name }, after: { name: next.name }, personId: susan });
    expect(events[1]).toMatchObject({ before: { notes: null }, after: { notes: "new notes" } });
    expect(events[2]).toMatchObject({ before: { directions: null }, after: { directions: "by the blue gate" } });
  });

  it("a single change writes a single event, and clearing a box stores nothing", async () => {
    const s = await makeSite();
    await post(`/api/team/sites/${s.id}`, { updatedAt: await stampOf(s.id), name: s.name, notes: "hello", directions: "" });
    expect(await kindsOf(s.id)).toEqual(["notes_edited"]);
    await post(`/api/team/sites/${s.id}`, { updatedAt: await stampOf(s.id), name: s.name, notes: "", directions: "" });
    expect((await siteRow(s.id)).notes).toBeNull();
    const events = await eventsOf(s.id);
    expect(events.map((e) => e.kind)).toEqual(["notes_edited", "notes_edited"]);
    expect(events[1]).toMatchObject({ before: { notes: "hello" }, after: { notes: null } });
  });

  it("a no-op edit writes nothing, not even a new stamp", async () => {
    const s = await makeSite({ name: unique("noop") });
    const stamp = await stampOf(s.id);
    const res = await post(`/api/team/sites/${s.id}`, { updatedAt: stamp, name: s.name, notes: "", directions: "" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/sites/${s.id}?done=unchanged`);
    expect(await eventsOf(s.id)).toHaveLength(0);
    expect(await stampOf(s.id)).toBe(stamp);
    const json = await postJson(`/api/team/sites/${s.id}`, { updatedAt: stamp });
    expect(json.status).toBe(200);
    expect(json.body).toEqual({ changed: 0 });
  });

  it("the page's stamp is the database's exact text; a stale or odd stamp is not accepted", async () => {
    const s = await makeSite();
    const page = (await get(`/api/team/sites/${s.id}`)).text;
    expect(stampIn(page)).toBe(await stampOf(s.id));
    expect((await get(`/api/team/sites/${s.id}`).set("Accept", "application/json")).body.updatedAt).toBe(await stampOf(s.id));
    for (const bad of ["", "yesterday", "2026-10-15", `${await stampOf(s.id)}'; drop table feeding_sites; --`]) {
      const res = await postJson(`/api/team/sites/${s.id}`, { updatedAt: bad, name: unique("x") });
      expect(res.status, bad).toBe(400);
      expect(res.body.fields).toContain("updatedAt");
    }
    expect(await eventsOf(s.id)).toHaveLength(0);
  });

  it("a stale page: 303 back with 'Someone already changed this.', JSON 409, nothing written", async () => {
    const s = await makeSite();
    const seen = await stampOf(s.id);
    expect((await post(`/api/team/sites/${s.id}`, { updatedAt: seen, name: unique("first") })).status).toBe(303);
    const eventsAfterFirst = (await eventsOf(s.id)).length;
    const late = await post(`/api/team/sites/${s.id}`, { updatedAt: seen, name: unique("second") });
    expect(late.status).toBe(303);
    expect(late.headers["location"]).toBe(`/api/team/sites/${s.id}?done=stale`);
    const page = await get(late.headers["location"] as string);
    expect(page.text).toContain("Someone else changed this first.");
    const json = await postJson(`/api/team/sites/${s.id}`, { updatedAt: seen, name: unique("third") });
    expect(json.status).toBe(409);
    expect(json.body).toEqual({ error: "Someone already changed this.", code: "STALE" });
    expect(await eventsOf(s.id)).toHaveLength(eventsAfterFirst);
  });

  it("an unknown site is a 404", async () => {
    const res = await post(`/api/team/sites/${NO_SUCH}`, { updatedAt: "2026-01-01 00:00:00.000000", name: "x" });
    expect(res.status).toBe(404);
    expect((await postJson(`/api/team/sites/${NO_SUCH}`, { updatedAt: "2026-01-01 00:00:00.000000", name: "x" })).status).toBe(404);
    expect((await post("/api/team/sites/abc", { updatedAt: "2026-01-01 00:00:00.000000", name: "x" })).status).toBe(404);
  });
});

// ── Approximate positions (SYC-705 Task 2b.7) ─────────────────────────────

describe("a position placed by area is marked approximate", () => {
  const APPROX = "Position approximate: placed by choosing an area. Move it on the map when you can.";

  it("area pick sets position_approximate: the save form's approximate=1 is stored, and the site page says so", async () => {
    const res = await post("/api/team/sites", { lat: "37.4436", lng: "24.8889", name: unique("byarea"), approximate: "1" });
    expect(res.status).toBe(303);
    const id = Number(/\/sites\/(\d+)\?done=created$/.exec(res.headers["location"] as string)![1]);
    expect((await siteRow(id)).positionApproximate).toBe(true);
    expect((await get(`/api/team/sites/${id}`)).text).toContain(APPROX);
  });

  it("typed coordinates clear it: a save with no approximate field is exact, and its page has no note", async () => {
    const res = await post("/api/team/sites", { lat: "37.4436", lng: "24.8889", name: unique("typed") });
    const id = Number(/\/sites\/(\d+)\?done=created$/.exec(res.headers["location"] as string)![1]);
    expect((await siteRow(id)).positionApproximate).toBe(false);
    expect((await get(`/api/team/sites/${id}`)).text).not.toContain("Position approximate");
  });

  it("anything but approximate=1 is refused, never read as approximate", async () => {
    const res = await post("/api/team/sites", { lat: "37.4436", lng: "24.8889", name: unique("odd"), approximate: "yes" });
    expect(res.status).toBe(400);
  });

  it("a move by area sets it; a move by pin or typed position clears it, even to the same spot", async () => {
    const s = await makeSite();
    const byArea = await post(`/api/team/sites/${s.id}/move`, { updatedAt: await stampOf(s.id), lat: "37.4436", lng: "24.8889", reason: "by area", approximate: "1" });
    expect(byArea.status).toBe(303);
    expect((await siteRow(s.id)).positionApproximate).toBe(true);
    const pinned = await post(`/api/team/sites/${s.id}/move`, { updatedAt: await stampOf(s.id), lat: "37.4436", lng: "24.8889", reason: "pinned it" });
    expect(pinned.status).toBe(303);
    expect(pinned.headers["location"]).toBe(`/api/team/sites/${s.id}?done=moved`);
    expect((await siteRow(s.id)).positionApproximate).toBe(false);
    const again = await post(`/api/team/sites/${s.id}/move`, { updatedAt: await stampOf(s.id), lat: "37.4501", lng: "24.9501", reason: "typed" });
    expect(again.status).toBe(303);
    expect((await siteRow(s.id)).positionApproximate).toBe(false);
  });
});

// ── Moving ─────────────────────────────────────────────────────────────────

describe("move", () => {
  it("the place page starts at the site, carries the page's stamp, and posts to the site's own pick", async () => {
    const s = await makeSite();
    const res = await get(`/api/team/sites/${s.id}/move`);
    expect(res.status).toBe(200);
    expect(formById(res.text, "pickform")).toContain(`action="/api/team/sites/${s.id}/move/pick"`);
    expect(res.text).not.toContain("/move/map");
    expect(stampIn(res.text)).toBe(await stampOf(s.id));
    const data = mapDataIn(res.text);
    expect(data).toMatchObject({ mode: "place", formId: "pickform", centre: [s.lat, s.lng], zoom: 17 });
    // The site's spot now is drawn on the map, as it was.
    expect(data.markers).toEqual([{ lat: s.lat, lng: s.lng, label: "Where it is now", look: "retired" }]);
    // The no-map path carries the stamp too, and offers the areas.
    const fallback = fallbackIn(res.text)!;
    expect(stampIn(fallback)).toBe(await stampOf(s.id));
    expect(fallback).toContain('name="area"');
    expect(res.text).toContain("Don&#39;t copy numbers from other map apps");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expectNoPositionInAddresses(res.text);
    expect((await get(`/api/team/sites/${NO_SUCH}/move`)).status).toBe(404);
    expect((await get("/api/team/sites/abc/move")).status).toBe(404);
  });

  it("a pick answers with old and new spots and a required reason, in one form with the map; nothing is saved yet", async () => {
    const s = await makeSite();
    const stamp = await stampOf(s.id);
    const spot = { lat: 37.4501, lng: 24.9501 };
    const res = await post(`/api/team/sites/${s.id}/move/pick`, { lat: String(spot.lat), lng: String(spot.lng), updatedAt: stamp });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Where it is now");
    expect(res.text).toContain(`The new spot: <strong>${placeLabel(spot)} &middot; <a `);
    // Words, not numbers (SYC-517); the 5-place position is in the Open map link only.
    expect(res.text.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ")).not.toMatch(/\d{2}\.\d{5}/);
    expect(res.text).toContain(encodeURIComponent(`${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}`));
    const form = formById(res.text, "detailsform")!;
    expect(form).toContain(`action="/api/team/sites/${s.id}/move"`);
    expect(form).toMatch(/name="reason" type="text" required/);
    expect(stampIn(form)).toBe(stamp);
    expect(hiddenIn(form, "lat")).toBe("37.4501");
    expect(mapDataIn(form)).toMatchObject({ mode: "place", formId: "detailsform" });
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expectNoPositionInAddresses(res.text);
    expect(await eventsOf(s.id)).toHaveLength(0);
    expect(await stampOf(s.id)).toBe(stamp);
    // By area: the area's centre, marked approximate in the save form.
    const byArea = await post(`/api/team/sites/${s.id}/move/pick`, { area: "kini", updatedAt: stamp });
    expect(byArea.status).toBe(200);
    expect(hiddenIn(formById(byArea.text, "detailsform")!, "approximate")).toBe("1");
    const far = await post(`/api/team/sites/${s.id}/move/pick`, { lat: "41", lng: "24.9501", updatedAt: stamp });
    expect(far.status).toBe(400);
    expect(far.text).toContain("outside Syros");
    expect(far.text).not.toMatch(/<script/i);
    expect((await post(`/api/team/sites/${s.id}/move/pick`, { lat: "37.4501", lng: "24.9501" })).status).toBe(400);
    expect((await post(`/api/team/sites/${NO_SUCH}/move/pick`, { lat: "37.4501", lng: "24.9501", updatedAt: stamp })).status).toBe(404);
  });

  it("zoom and pan are the map's own now: the old POST /sites/:id/move/map is gone", async () => {
    const s = await makeSite();
    expect((await post(`/api/team/sites/${s.id}/move/map`, { vz: "16", vx: "1", vy: "1", updatedAt: await stampOf(s.id) })).status).toBe(404);
  });

  it("saves the move: before and after, the reason as the note, one event", async () => {
    const s = await makeSite();
    const res = await post(`/api/team/sites/${s.id}/move`, {
      updatedAt: await stampOf(s.id),
      lat: "37.4501",
      lng: "24.9502",
      reason: "pin was on the wrong side of the road",
    });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/sites/${s.id}?done=moved`);
    expect(await siteRow(s.id)).toMatchObject({ lat: 37.4501, lng: 24.9502 });
    const events = await eventsOf(s.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "moved",
      personId: susan,
      before: { lat: s.lat, lng: s.lng },
      after: { lat: 37.4501, lng: 24.9502 },
      note: "pin was on the wrong side of the road",
    });
    const page = (await get(`/api/team/sites/${s.id}`)).text;
    expect(page).toContain("Reason: pin was on the wrong side of the road");
  });

  it("refuses a missing reason, a bad or outside position, and moving to where it already is", async () => {
    const s = await makeSite();
    const good = { updatedAt: await stampOf(s.id), lat: "37.4501", lng: "24.9502", reason: "r" };
    for (const [patch, status] of [
      [{ reason: "  " }, 400],
      [{ reason: undefined }, 400],
      [{ reason: `a${NUL}` }, 400],
      [{ reason: "r".repeat(501) }, 400],
      [{ lat: "0", lng: "0" }, 400],
      [{ lat: "41", lng: "24.9" }, 400],
      [{ lat: "1e1" }, 400],
      [{ lat: undefined }, 400],
    ] as const) {
      const body = { ...good, ...patch } as Record<string, string>;
      for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
      const res = await postJson(`/api/team/sites/${s.id}/move`, body);
      expect(res.status, JSON.stringify(patch)).toBe(status);
    }
    expect(await eventsOf(s.id)).toHaveLength(0);
    const same = await post(`/api/team/sites/${s.id}/move`, { ...good, lat: String(s.lat), lng: String(s.lng) });
    expect(same.headers["location"]).toBe(`/api/team/sites/${s.id}?done=unchanged`);
    expect(await eventsOf(s.id)).toHaveLength(0);
  });
});

// ── Change colony ──────────────────────────────────────────────────────────

describe("change colony", () => {
  it("changes it, writes one event with before and after, and can clear it", async () => {
    const a = await makeColony();
    const b = await makeColony();
    const s = await makeSite({ colonyId: a });
    const res = await post(`/api/team/sites/${s.id}/colony`, { updatedAt: await stampOf(s.id), colonyId: String(b) });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/sites/${s.id}?done=colony`);
    expect((await siteRow(s.id)).colonyId).toBe(b);
    const none = await post(`/api/team/sites/${s.id}/colony`, { updatedAt: await stampOf(s.id), colonyId: "" });
    expect(none.status).toBe(303);
    expect((await siteRow(s.id)).colonyId).toBeNull();
    const events = await eventsOf(s.id);
    expect(events.map((e) => e.kind)).toEqual(["colony_changed", "colony_changed"]);
    expect(events[0]).toMatchObject({ before: { colonyId: a }, after: { colonyId: b }, personId: susan });
    expect(events[1]).toMatchObject({ before: { colonyId: b }, after: { colonyId: null } });
  });

  it("a colony that doesn't exist, a missing field and the same colony", async () => {
    const a = await makeColony();
    const s = await makeSite({ colonyId: a });
    const stamp = await stampOf(s.id);
    expect((await post(`/api/team/sites/${s.id}/colony`, { updatedAt: stamp, colonyId: NO_SUCH })).status).toBe(400);
    expect((await post(`/api/team/sites/${s.id}/colony`, { updatedAt: stamp, colonyId: "abc" })).status).toBe(400);
    // A missing field is not "no colony".
    expect((await post(`/api/team/sites/${s.id}/colony`, { updatedAt: stamp })).status).toBe(400);
    expect((await siteRow(s.id)).colonyId).toBe(a);
    const same = await post(`/api/team/sites/${s.id}/colony`, { updatedAt: stamp, colonyId: String(a) });
    expect(same.headers["location"]).toBe(`/api/team/sites/${s.id}?done=unchanged`);
    expect(await eventsOf(s.id)).toHaveLength(0);
  });
});

// ── Test 9, early half ─────────────────────────────────────────────────────

describe("test 9 (early half): moving or re-homing a public site makes it private", () => {
  it("moving a public site makes it private and writes both events; label, code and who made it public stay", async () => {
    const s = await makeSite({ isPublic: true });
    const before = await siteRow(s.id);
    const res = await post(`/api/team/sites/${s.id}/move`, {
      updatedAt: await stampOf(s.id),
      lat: "37.4501",
      lng: "24.9502",
      reason: "wrong pin",
    });
    expect(res.headers["location"]).toBe(`/api/team/sites/${s.id}?done=movedPrivate`);
    const after = await siteRow(s.id);
    expect(after).toMatchObject({
      isPublic: false,
      publicLabel: before.publicLabel,
      publicId: before.publicId,
      madePublicBy: before.madePublicBy,
    });
    expect(after.madePublicAt?.toISOString()).toBe(before.madePublicAt?.toISOString());
    expect(await kindsOf(s.id)).toEqual(["moved", "made_private_moved"]);
    const page = await get(res.headers["location"] as string);
    expect(page.text).toContain("it&#39;s private again until you confirm the new spot");
  });

  it("changing a public site's colony makes it private and writes both events", async () => {
    const colonyId = await makeColony();
    const s = await makeSite({ isPublic: true });
    const res = await post(`/api/team/sites/${s.id}/colony`, { updatedAt: await stampOf(s.id), colonyId: String(colonyId) });
    expect(res.headers["location"]).toBe(`/api/team/sites/${s.id}?done=colonyPrivate`);
    expect(await siteRow(s.id)).toMatchObject({ isPublic: false, colonyId });
    expect(await kindsOf(s.id)).toEqual(["colony_changed", "made_private_colony_changed"]);
  });

  it("the move confirmation warns that a public site goes private", async () => {
    const s = await makeSite({ isPublic: true });
    const body = { lat: String(s.lat + 0.0003), lng: String(s.lng) };
    const res = await post(`/api/team/sites/${s.id}/move/pick`, { ...body, updatedAt: await stampOf(s.id) });
    expect(res.text).toContain("This site is public. Moving it makes it private again");
    const privateOne = await makeSite();
    const res2 = await post(`/api/team/sites/${privateOne.id}/move/pick`, { ...body, updatedAt: await stampOf(privateOne.id) });
    expect(res2.text).not.toContain("This site is public");
  });

  it("makePrivateIfPublic does nothing to a private site, and does not write for a retire", async () => {
    const priv = await makeSite();
    const pub = await makeSite({ isPublic: true });
    const changed = await db.transaction((tx) => makePrivateIfPublic(tx, { id: priv.id, isPublic: false }, "moved", susan));
    expect(changed).toBe(false);
    expect(await eventsOf(priv.id)).toHaveLength(0);
    const stampBefore = await stampOf(priv.id);
    expect(await stampOf(priv.id)).toBe(stampBefore);
    const retireOnly = await db.transaction((tx) => makePrivateIfPublic(tx, { id: pub.id, isPublic: true }, "retired", susan));
    expect(retireOnly).toBe(true);
    expect((await siteRow(pub.id)).isPublic).toBe(false);
    expect(await eventsOf(pub.id)).toHaveLength(0);
  });
});

// ── Retire and bring back ──────────────────────────────────────────────────

// ── SYC-395 PR 0.1: "Are you sure?" before Retire this site (D1) ───────────

describe("retire confirm (SYC-395 D1)", () => {
  it("a browser POST without confirm shows the Are you sure page and retires nothing", async () => {
    const s = await makeSite({ name: unique("Kini steps") });
    const stamp = await stampOf(s.id);
    const res = await post(`/api/team/sites/${s.id}/retire`, { updatedAt: stamp, reason: "Bowls gone" });
    expect(res.status).toBe(200);
    expect(res.text).toContain(`Retire ${s.name}?`);
    expect(res.text).toContain("It disappears from the map and the list. Its history stays.");
    expect(res.text).toContain("You can bring it back later with Restore.");
    expect(res.text).toContain(`action="/api/team/sites/${s.id}/retire"`);
    expect(res.text).toContain('name="confirm" value="1"');
    expect(res.text).toContain('name="reason" value="Bowls gone"');
    expect(res.text).toContain(`name="updatedAt" value="${stamp}"`);
    expect(res.text).toContain("Yes, retire it");
    expect(res.text).toContain(`href="/api/team/sites/${s.id}">Cancel</a>`);
    expect((await siteRow(s.id)).retiredAt).toBeNull();
    expect(await eventsOf(s.id)).toHaveLength(0);
  });

  it("with confirm=1 it retires the site", async () => {
    const s = await makeSite();
    const res = await post(`/api/team/sites/${s.id}/retire`, { confirm: "1", updatedAt: await stampOf(s.id), reason: "Bowls gone" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/sites/${s.id}?done=retired`);
    expect((await siteRow(s.id)).retiredAt).not.toBeNull();
    expect(await kindsOf(s.id)).toEqual(["retired"]);
  });

  it("a second Yes says the site is already retired, not that someone changed it", async () => {
    const s = await makeSite();
    const body = { confirm: "1", updatedAt: await stampOf(s.id), reason: "x" };
    await post(`/api/team/sites/${s.id}/retire`, body);
    const again = await post(`/api/team/sites/${s.id}/retire`, body);
    expect(again.status).toBe(303);
    expect(again.headers["location"]).toBe(`/api/team/sites/${s.id}?done=alreadyRetired`);
    const page = (await get(again.headers["location"] as string)).text;
    expect(page).toContain("This site is already retired.");
    expect(page).not.toContain("Someone else changed this first");
    expect(await kindsOf(s.id)).toEqual(["retired"]);
  });

  it("a retired site gets no confirm page: the answer is 'already retired' straight away", async () => {
    const gone = await makeSite({ retired: true });
    const res = await post(`/api/team/sites/${gone.id}/retire`, { updatedAt: await stampOf(gone.id), reason: "r" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/sites/${gone.id}?done=alreadyRetired`);
    expect(await eventsOf(gone.id)).toHaveLength(0);
  });

  it("a missing site answers 404 before any confirm page", async () => {
    const res = await post(`/api/team/sites/${NO_SUCH}/retire`, { updatedAt: "2026-10-01 10:00:00.000000", reason: "x" });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('name="confirm"');
  });

  it("a bad form is refused before any confirm page", async () => {
    const s = await makeSite();
    const res = await post(`/api/team/sites/${s.id}/retire`, { updatedAt: await stampOf(s.id), reason: "  " });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('name="confirm"');
  });

  it("a JSON caller still acts in one step (the confirm page protects browser slips only)", async () => {
    const s = await makeSite();
    const res = await postJson(`/api/team/sites/${s.id}/retire`, { updatedAt: await stampOf(s.id), reason: "r" });
    expect(res.status).toBe(200);
    expect((await siteRow(s.id)).retiredAt).not.toBeNull();
    const again = await postJson(`/api/team/sites/${s.id}/retire`, { updatedAt: await stampOf(s.id), reason: "r" });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ changed: 0, alreadyRetired: true });
  });

  it("a stale page still gets the confirm page, and Yes then says someone already changed it", async () => {
    const s = await makeSite();
    const old = await stampOf(s.id);
    await post(`/api/team/sites/${s.id}`, { updatedAt: old, name: unique("renamed") });
    const sure = await post(`/api/team/sites/${s.id}/retire`, { updatedAt: old, reason: "r" });
    expect(sure.status).toBe(200);
    const yes = await post(`/api/team/sites/${s.id}/retire`, { confirm: "1", updatedAt: old, reason: "r" });
    expect(yes.headers["location"]).toBe(`/api/team/sites/${s.id}?done=stale`);
    expect((await siteRow(s.id)).retiredAt).toBeNull();
  });

  it("the site's name and the typed reason show as text on the confirm page", async () => {
    const s = await makeSite({ name: `${unique("name")} <u>${MARKUP}` });
    const res = await post(`/api/team/sites/${s.id}/retire`, { updatedAt: await stampOf(s.id), reason: `<b>gone</b> ${MARKUP}` });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<img src=x");
    expect(res.text).not.toContain("<u>");
    expect(res.text).not.toContain("<b>gone");
    expect(decoded(res.text)).toContain(`Retire ${s.name}?`);
    expect(decoded(res.text)).toContain(`value="<b>gone</b> ${MARKUP}"`);
  });
});

describe("test 10: retired is never public, and bringing back never makes a site public", () => {
  it("retire sets who and when, takes the site off the default list, and writes one event with the reason", async () => {
    const s = await makeSite();
    const res = await post(`/api/team/sites/${s.id}/retire`, { confirm: "1", updatedAt: await stampOf(s.id), reason: "the gate is locked for good" });
    expect(res.headers["location"]).toBe(`/api/team/sites/${s.id}?done=retired`);
    const row = await siteRow(s.id);
    expect(row.retiredAt).not.toBeNull();
    expect(row.retiredBy).toBe(susan);
    const events = await eventsOf(s.id);
    expect(events.map((e) => e.kind)).toEqual(["retired"]);
    expect(events[0]).toMatchObject({ note: "the gate is locked for good", personId: susan });
    const allSites = (html: string) => html.slice(html.indexOf("<h2>All sites</h2>"));
    expect(allSites((await get("/api/team/sites")).text)).not.toContain(s.name);
    expect(allSites((await get("/api/team/sites?retired=1")).text)).toContain(s.name);
  });

  it("retiring a public site makes it private first; its code and label are kept; only the retire event is written", async () => {
    const s = await makeSite({ isPublic: true });
    const before = await siteRow(s.id);
    const res = await post(`/api/team/sites/${s.id}/retire`, { confirm: "1", updatedAt: await stampOf(s.id), reason: "closed" });
    expect(res.status).toBe(303);
    const row = await siteRow(s.id);
    expect(row.isPublic).toBe(false);
    expect(row.retiredAt).not.toBeNull();
    expect(row.publicId).toBe(before.publicId);
    expect(row.publicLabel).toBe(before.publicLabel);
    expect(row.madePublicBy).toBe(before.madePublicBy);
    expect(await kindsOf(s.id)).toEqual(["retired"]);
    // The one row records that it went private (spec §8).
    expect((await eventsOf(s.id))[0]!.before).toEqual({ isPublic: true, publicId: before.publicId });
    const plain = await makeSite();
    await post(`/api/team/sites/${plain.id}/retire`, { confirm: "1", updatedAt: await stampOf(plain.id), reason: "closed" });
    expect((await eventsOf(plain.id))[0]!.before).toBeNull();
  });

  it("retire then bring back: private, with retired_at and retired_by cleared; the events carry the reasons", async () => {
    const s = await makeSite({ isPublic: true });
    await post(`/api/team/sites/${s.id}/retire`, { confirm: "1", updatedAt: await stampOf(s.id), reason: "closed" });
    const res = await post(`/api/team/sites/${s.id}/restore`, { updatedAt: await stampOf(s.id), reason: "reopened by the new guardian" });
    expect(res.headers["location"]).toBe(`/api/team/sites/${s.id}?done=restored`);
    const row = await siteRow(s.id);
    expect(row).toMatchObject({ isPublic: false, retiredAt: null, retiredBy: null });
    const events = await eventsOf(s.id);
    expect(events.map((e) => e.kind)).toEqual(["retired", "restored"]);
    expect(events[1]).toMatchObject({ note: "reopened by the new guardian" });
    const page = (await get(`/api/team/sites/${s.id}`)).text;
    expect(page).toContain("Private. Only Syros Cats people");
  });

  it("a reason is required for both", async () => {
    const s = await makeSite();
    for (const path of ["retire", "restore"]) {
      for (const reason of ["", "   ", undefined]) {
        const body: Record<string, string> = { updatedAt: await stampOf(s.id) };
        if (reason !== undefined) body["reason"] = reason;
        const res = await postJson(`/api/team/sites/${s.id}/${path}`, body);
        expect(res.status, `${path} ${JSON.stringify(reason)}`).toBe(400);
        expect(res.body.fields).toContain("reason");
      }
    }
    expect(await eventsOf(s.id)).toHaveLength(0);
  });

  it("bringing back a live site is 'someone already changed this'; retiring a retired one says it already is (SYC-395)", async () => {
    const live = await makeSite();
    const gone = await makeSite({ retired: true });
    const a = await post(`/api/team/sites/${live.id}/restore`, { updatedAt: await stampOf(live.id), reason: "r" });
    expect(a.headers["location"]).toBe(`/api/team/sites/${live.id}?done=stale`);
    const b = await post(`/api/team/sites/${gone.id}/retire`, { confirm: "1", updatedAt: await stampOf(gone.id), reason: "r" });
    expect(b.headers["location"]).toBe(`/api/team/sites/${gone.id}?done=alreadyRetired`);
    expect(await eventsOf(live.id)).toHaveLength(0);
    expect(await eventsOf(gone.id)).toHaveLength(0);
  });

  it("the retire form of a public site says to take down any QR sticker; a private site's does not", async () => {
    const pub = await makeSite({ isPublic: true });
    const priv = await makeSite();
    expect((await get(`/api/team/sites/${pub.id}`)).text).toContain("If there&#39;s a QR sticker here, take it down.");
    expect((await get(`/api/team/sites/${priv.id}`)).text).not.toContain("QR sticker");
  });

  it("the site page offers Retire on a live site and Bring back on a retired one", async () => {
    const live = await makeSite();
    const gone = await makeSite({ retired: true });
    const livePage = (await get(`/api/team/sites/${live.id}`)).text;
    expect(livePage).toContain("<summary>Retire this site</summary>");
    expect(livePage).not.toContain("<summary>Bring back</summary>");
    const gonePage = (await get(`/api/team/sites/${gone.id}`)).text;
    expect(gonePage).toContain("<summary>Bring back</summary>");
    expect(gonePage).not.toContain("<summary>Retire this site</summary>");
  });
});

// ── The pages ──────────────────────────────────────────────────────────────

describe("the pages", () => {
  it("the Feeding sites page has an Add a site button (a GET form to /sites/new)", async () => {
    const html = (await get("/api/team/sites")).text;
    expect(html).toMatch(/<form method="get" action="\/api\/team\/sites\/new" class="addsite"><button type="submit">Add a site<\/button><\/form>/);
    expectNoPositionInAddresses(html);
  });

  it("the site page's actions slot holds Edit details, Move on the map, Retire and Change colony, each carrying the stamp", async () => {
    const s = await makeSite();
    const html = (await get(`/api/team/sites/${s.id}`)).text;
    for (const word of ["Edit details", "Move on the map", "Retire this site", "Change colony"]) {
      expect(html, word).toContain(word);
    }
    expect(html).toContain(`<form method="get" action="/api/team/sites/${s.id}/move" class="movesite">`);
    for (const action of ["", "/retire", "/colony"]) {
      expect(html).toContain(`<form method="post" action="/api/team/sites/${s.id}${action}">`);
    }
    expect([...html.matchAll(/name="updatedAt"/g)].length).toBe(3);
    expectNoPositionInAddresses(html);
    // SYC-705: a map page loads our own map files only (team.scriptTags.test.ts names them).
    for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) expect(tag).toMatch(/^<script src="\/api\/team\/assets\/[\w.-]+" defer>$/);
  });

  it("the banner for ?done= shows only fixed sentences", async () => {
    const s = await makeSite();
    const ok = (await get(`/api/team/sites/${s.id}?done=saved`)).text;
    expect(ok).toContain('<p class="notice" role="status">Saved.</p>');
    for (const odd of ["constructor", "__proto__", "toString", "<b>x</b>", "nothing"]) {
      const html = (await get(`/api/team/sites/${s.id}?done=${encodeURIComponent(odd)}`)).text;
      expect(html, odd).not.toContain('role="status"');
    }
  });

  it("K13 on every page this PR adds or changes: no position, tile or view in any href, action or src", async () => {
    const colonyId = await makeColony();
    const s = await makeSite({ colonyId, isPublic: true });
    const gone = await makeSite({ retired: true });
    const stamp = await stampOf(s.id);
    const pages = [
      (await get("/api/team/sites")).text,
      (await get("/api/team/sites/new")).text,
      (await post("/api/team/sites/pick", { area: "kini" })).text,
      (await post("/api/team/sites/pick", { area: "atlantis" })).text,
      (await post("/api/team/sites/pick", { lat: "37.4447", lng: "24.9417" })).text,
      (await post("/api/team/sites/pick", { lat: "0", lng: "0" })).text,
      (await get(`/api/team/sites/${s.id}`)).text,
      (await get(`/api/team/sites/${gone.id}`)).text,
      (await get(`/api/team/sites/${s.id}?done=moved`)).text,
      (await get(`/api/team/sites/${s.id}/move`)).text,
      (await post(`/api/team/sites/${s.id}/move/pick`, { area: "kini", updatedAt: stamp })).text,
      (await post(`/api/team/sites/${s.id}/move/pick`, { lat: "37.4501", lng: "24.9501", updatedAt: stamp })).text,
      (await post(`/api/team/sites/${s.id}/move/pick`, { lat: "41", lng: "24.9501", updatedAt: stamp })).text,
      (await post("/api/team/sites", { name: " ", lat: "37.4447", lng: "24.9417" })).text,
      (await post(`/api/team/sites/${s.id}/move`, { updatedAt: stamp, lat: "37.45", lng: "24.95", reason: "" })).text,
    ];
    for (const html of pages) {
      expectNoPositionInAddresses(html);
      // SYC-705: a map page loads our own map files only (team.scriptTags.test.ts names them).
      for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) expect(tag).toMatch(/^<script src="\/api\/team\/assets\/[\w.-]+" defer>$/);
    }
    // The positions are in hidden fields (and the map's own data), the one place they travel.
    expect(pages[2]).toMatch(/name="lat" value="37\.\d+"/);
    expect(pages[4]).toMatch(/name="lat" value="37\.\d+"/);
  });
});

// ── Test 11: one history row per change, in the same transaction ───────────

describe("test 11: every write writes exactly one history row per changed thing, in the same transaction", () => {
  const forceFailure = (nth = 0) => {
    const real = vi.mocked(recordMappingEvent).getMockImplementation()!;
    for (let i = 0; i < nth; i++) vi.mocked(recordMappingEvent).mockImplementationOnce(real);
    vi.mocked(recordMappingEvent).mockImplementationOnce(async () => {
      throw new Error("forced failure in the history write");
    });
  };

  it("a failed history write leaves an added site unwritten", async () => {
    const before = await totalSites();
    forceFailure();
    const res = await post("/api/team/sites", { name: unique("forced-add"), lat: "37.4447", lng: "24.9417" });
    expect(res.status).toBe(500);
    expect(await totalSites()).toBe(before);
  });

  it("a failed history write leaves an edit, a move, a colony change, a retire and a bring-back unchanged", async () => {
    const colonyId = await makeColony();
    const s = await makeSite({ name: unique("forced") });
    const retired = await makeSite({ retired: true });
    const snap = async (id: number) => ({ row: await siteRow(id), stamp: await stampOf(id), events: (await eventsOf(id)).length });
    const cases: Array<[number, string, () => Promise<Record<string, string>>]> = [
      [s.id, "", async () => ({ updatedAt: await stampOf(s.id), name: unique("never"), notes: "never" })],
      [s.id, "/move", async () => ({ updatedAt: await stampOf(s.id), lat: "37.4501", lng: "24.9502", reason: "never" })],
      [s.id, "/colony", async () => ({ updatedAt: await stampOf(s.id), colonyId: String(colonyId) })],
      [s.id, "/retire", async () => ({ confirm: "1", updatedAt: await stampOf(s.id), reason: "never" })],
      [retired.id, "/restore", async () => ({ updatedAt: await stampOf(retired.id), reason: "never" })],
    ];
    for (const [id, path, body] of cases) {
      const before = await snap(id);
      forceFailure();
      const res = await post(`/api/team/sites/${id}${path}`, await body());
      expect(res.status, path).toBe(500);
      expect(await snap(id), path).toEqual(before);
    }
  });

  it("a failure on the second history row of a move undoes the move and the make-private", async () => {
    const s = await makeSite({ isPublic: true });
    const before = { row: await siteRow(s.id), stamp: await stampOf(s.id) };
    forceFailure(1);
    const res = await post(`/api/team/sites/${s.id}/move`, { updatedAt: before.stamp, lat: "37.4501", lng: "24.9502", reason: "never" });
    expect(res.status).toBe(500);
    expect(await siteRow(s.id)).toEqual(before.row);
    expect(await stampOf(s.id)).toBe(before.stamp);
    expect(await eventsOf(s.id)).toHaveLength(0);
  });

  it("a failure on the second of three edit rows undoes the whole edit", async () => {
    const s = await makeSite();
    const before = await siteRow(s.id);
    forceFailure(1);
    const res = await post(`/api/team/sites/${s.id}`, { updatedAt: await stampOf(s.id), name: unique("never"), notes: "never", directions: "never" });
    expect(res.status).toBe(500);
    expect(await siteRow(s.id)).toEqual(before);
    expect(await eventsOf(s.id)).toHaveLength(0);
  });

  it("each successful write writes exactly one row per changed thing", async () => {
    const colonyId = await makeColony();
    const s = await makeSite({ isPublic: true });
    const counts: number[] = [];
    const count = async () => (await eventsOf(s.id)).length;
    let last = 0;
    const step = async (path: string, body: Record<string, string>) => {
      const res = await post(`/api/team/sites/${s.id}${path}`, { updatedAt: await stampOf(s.id), ...body });
      expect(res.status).toBe(303);
      const now = await count();
      counts.push(now - last);
      last = now;
    };
    await step("", { name: unique("n"), notes: "x", directions: "y" }); // three things
    await step("", { name: unique("n2") }); // one
    await step("/move", { lat: "37.4501", lng: "24.9502", reason: "r" }); // moved + made private (it is public)
    await step("/colony", { colonyId: String(colonyId) }); // one (already private)
    await step("/retire", { confirm: "1", reason: "r" }); // one
    await step("/restore", { reason: "r" }); // one
    expect(counts).toEqual([3, 1, 2, 1, 1, 1]);
  });
});

// ── Test 12: capabilities and refusals ─────────────────────────────────────

describe("test 12: refusals", () => {
  const ROUTES: Array<[string, (id: number) => string, Record<string, string>]> = [
    ["GET", () => "/api/team/sites/new", {}],
    ["POST", () => "/api/team/sites/pick", { lat: "37.4447", lng: "24.9417" }],
    ["POST", () => "/api/team/sites", { name: "x", lat: "37.4447", lng: "24.9417" }],
    ["POST", (id) => `/api/team/sites/${id}`, { name: "x" }],
    ["GET", (id) => `/api/team/sites/${id}/move`, {}],
    ["POST", (id) => `/api/team/sites/${id}/move/pick`, { lat: "37.4447", lng: "24.9417" }],
    ["POST", (id) => `/api/team/sites/${id}/move`, { lat: "37.4501", lng: "24.9502", reason: "r" }],
    ["POST", (id) => `/api/team/sites/${id}/retire`, { reason: "r" }],
    ["POST", (id) => `/api/team/sites/${id}/restore`, { reason: "r" }],
    ["POST", (id) => `/api/team/sites/${id}/colony`, { colonyId: "" }],
  ];

  const send = async (
    method: string,
    path: string,
    body: Record<string, string>,
    opts: { cookie?: string | null; origin?: string | null },
  ) => {
    if (method === "GET") {
      const t = request(app).get(path).set("Accept", "application/json");
      if (opts.cookie) t.set("Cookie", opts.cookie);
      return t;
    }
    return post(path, body, opts).set("Accept", "application/json");
  };

  it("no session: the identical 401 on every route, and nothing written", async () => {
    const s = await makeSite();
    const before = { sites: await totalSites(), events: await totalSiteEvents() };
    for (const [method, path, body] of ROUTES) {
      const res = await send(method, path(s.id), { updatedAt: await stampOf(s.id), ...body }, { cookie: null });
      expect([res.status, res.text], `${method} ${path(s.id)}`).toEqual([401, '{"error":"not_signed_in"}']);
    }
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual(before);
  });

  it("signed in without the role (a vet): 403 everywhere, nothing written", async () => {
    const s = await makeSite();
    const before = { row: await siteRow(s.id), sites: await totalSites(), events: await totalSiteEvents() };
    for (const [method, path, body] of ROUTES) {
      const res = await send(method, path(s.id), { updatedAt: await stampOf(s.id), ...body }, { cookie: vetCookie });
      expect([res.status, res.text], `${method} ${path(s.id)}`).toEqual([403, '{"error":"forbidden"}']);
    }
    expect(await siteRow(s.id)).toEqual(before.row);
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual({ sites: before.sites, events: before.events });
  });

  it("a cat guardian (SYC-209 PR 4.2): 403 on a site that isn't in her colony; the add pages open, and a site with no colony is refused; nothing written", async () => {
    const s = await makeSite(); // in no colony: not hers
    const before = { row: await siteRow(s.id), sites: await totalSites(), events: await totalSiteEvents() };
    for (const [method, path, body] of ROUTES) {
      const res = await send(method, path(s.id), { updatedAt: await stampOf(s.id), ...body }, { cookie: guardianCookie });
      const where = `${method} ${path(s.id)}`;
      if (path(s.id).includes(String(s.id))) {
        expect([res.status, res.text], where).toEqual([403, '{"error":"forbidden"}']);
      } else if (where === "POST /api/team/sites") {
        // Her site must go in one of her colonies: no colony is a 400.
        expect(res.status, where).toBe(400);
      } else {
        expect(res.status, where).toBe(200);
      }
    }
    expect(await siteRow(s.id)).toEqual(before.row);
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual({ sites: before.sites, events: before.events });
  });

  it("a foreign or missing Origin is refused on every POST, and nothing is written", async () => {
    const s = await makeSite();
    const before = { row: await siteRow(s.id), sites: await totalSites(), events: await totalSiteEvents() };
    for (const origin of [null, "https://evil.example.com", "https://admin.catspotters.com", `${TEAM_ORIGIN}.evil.com`]) {
      for (const [method, path, body] of ROUTES) {
        if (method !== "POST") continue;
        const res = await send(method, path(s.id), { updatedAt: await stampOf(s.id), ...body }, { origin });
        expect([res.status, res.text], `${origin} ${path(s.id)}`).toEqual([401, '{"error":"not_signed_in"}']);
      }
    }
    expect(await siteRow(s.id)).toEqual(before.row);
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual({ sites: before.sites, events: before.events });
  });

  it("each write asks for its own capability, and a refusal writes nothing", async () => {
    const s = await makeSite();
    const colonyId = await makeColony();
    const before = { sites: await totalSites(), events: await totalSiteEvents(), row: await siteRow(s.id) };
    const expectations: Array<[string, Array<[string, string, Record<string, string>]>]> = [
      [
        "add_feeding_site",
        [
          ["GET", "/api/team/sites/new", {}],
          ["POST", "/api/team/sites/pick", { lat: "37.4447", lng: "24.9417" }],
          ["POST", "/api/team/sites", { name: "x", lat: "37.4447", lng: "24.9417" }],
        ],
      ],
      [
        "edit_feeding_site",
        [
          ["POST", `/api/team/sites/${s.id}`, { name: "x" }],
          ["GET", `/api/team/sites/${s.id}/move`, {}],
          ["POST", `/api/team/sites/${s.id}/move/pick`, { lat: "37.4447", lng: "24.9417" }],
          ["POST", `/api/team/sites/${s.id}/move`, { lat: "37.4501", lng: "24.9502", reason: "r" }],
          ["POST", `/api/team/sites/${s.id}/retire`, { reason: "r" }],
          ["POST", `/api/team/sites/${s.id}/restore`, { reason: "r" }],
        ],
      ],
      ["reassign_feeding_site", [["POST", `/api/team/sites/${s.id}/colony`, { colonyId: String(colonyId) }]]],
    ];
    for (const [cap, routes] of expectations) {
      denied.cap = cap;
      for (const [method, path, body] of routes) {
        const res = await send(method, path, { updatedAt: await stampOf(s.id), ...body }, { cookie });
        expect([res.status, res.text], `${cap}: ${method} ${path}`).toEqual([403, '{"error":"forbidden"}']);
      }
    }
    denied.cap = null;
    expect(await siteRow(s.id)).toEqual(before.row);
    expect({ sites: await totalSites(), events: await totalSiteEvents() }).toEqual({ sites: before.sites, events: before.events });
  });

  it("the capability is checked before the body: a foreign-capability person with a broken body still gets the 403", async () => {
    const s = await makeSite();
    denied.cap = "edit_feeding_site";
    const res = await postJson(`/api/team/sites/${s.id}/retire`, {});
    expect(res.status).toBe(403);
  });
});

// ── Test 13: concurrent writes ─────────────────────────────────────────────

/**
 * Holds the site row's lock from a separate connection, runs the callback
 * (which fires the requests), waits until `waiters` statements are queued
 * behind the lock (polled from a different connection, outside any held
 * transaction), then lets go. The requests then really do queue up on the row.
 */
async function withRowLocked<T>(siteId: number, waiters: number, fire: () => Promise<T>): Promise<T> {
  const holder = await pool.connect();
  try {
    await holder.query("begin");
    await holder.query("select 1 from feeding_sites where id = $1 for update", [siteId]);
    const running = fire();
    const deadline = Date.now() + 8000;
    for (;;) {
      const r = await pool.query(
        `select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and query ilike '%feeding_sites%'`,
      );
      if (Number(r.rows[0].n) >= waiters) break;
      if (Date.now() > deadline) throw new Error("the requests never queued behind the lock");
      await new Promise((r2) => setTimeout(r2, 20));
    }
    await holder.query("commit");
    return await running;
  } catch (err) {
    await holder.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    holder.release();
  }
}

describe("test 13: concurrent writes", () => {
  it("two simultaneous moves of one site: one wins, the other sees 'Someone already changed this.', one history row", async () => {
    const s = await makeSite();
    const stamp = await stampOf(s.id);
    const targets = [
      { lat: "37.4601", lng: "24.9601" },
      { lat: "37.4602", lng: "24.9602" },
    ];
    const results = await withRowLocked(s.id, 2, () =>
      Promise.all(targets.map((t) => post(`/api/team/sites/${s.id}/move`, { updatedAt: stamp, ...t, reason: "race" }))),
    );
    expect(results.map((r) => r.status)).toEqual([303, 303]);
    const where = results.map((r) => r.headers["location"] as string).sort();
    expect(where).toEqual([`/api/team/sites/${s.id}?done=moved`, `/api/team/sites/${s.id}?done=stale`]);
    const events = await eventsOf(s.id);
    expect(events.map((e) => e.kind)).toEqual(["moved"]);
    // One definite state: the winner's position, whichever request that was.
    const row = await siteRow(s.id);
    expect(targets.map((t) => [Number(t.lat), Number(t.lng)])).toContainEqual([row.lat, row.lng]);
    expect(events[0]!.after).toEqual({ lat: row.lat, lng: row.lng });
    const loser = await get(`/api/team/sites/${s.id}?done=stale`);
    expect(loser.text).toContain("Someone else changed this first.");
  });

  it("a move racing an edit of the name: one wins, one history row, one definite state", async () => {
    const s = await makeSite();
    const stamp = await stampOf(s.id);
    const newName = unique("raced-name");
    const results = await withRowLocked(s.id, 2, () =>
      Promise.all([
        post(`/api/team/sites/${s.id}/move`, { updatedAt: stamp, lat: "37.4601", lng: "24.9601", reason: "race" }),
        post(`/api/team/sites/${s.id}`, { updatedAt: stamp, name: newName }),
      ]),
    );
    expect(results.map((r) => r.status)).toEqual([303, 303]);
    const where = results.map((r) => r.headers["location"] as string);
    expect(where.filter((w) => w.endsWith("done=stale"))).toHaveLength(1);
    const events = await eventsOf(s.id);
    expect(events).toHaveLength(1);
    const row = await siteRow(s.id);
    if (events[0]!.kind === "moved") {
      expect(row).toMatchObject({ lat: 37.4601, lng: 24.9601, name: s.name });
    } else {
      expect(events[0]!.kind).toBe("renamed");
      expect(row).toMatchObject({ name: newName, lat: s.lat, lng: s.lng });
    }
  });

  it("without holding the lock, three at once from the same page still leave one winner and one row", async () => {
    const s = await makeSite();
    const stamp = await stampOf(s.id);
    const results = await Promise.all(
      [1, 2, 3].map((i) => postJson(`/api/team/sites/${s.id}/move`, { updatedAt: stamp, lat: 37.46 + i / 1000, lng: 24.96, reason: "race" })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await kindsOf(s.id)).toEqual(["moved"]);
  });

  it("two simultaneous retires: one retires, the other is told; the same for two colony changes", async () => {
    const a = await makeColony();
    const b = await makeColony();
    const s = await makeSite();
    const stamp = await stampOf(s.id);
    const colonies = await withRowLocked(s.id, 2, () =>
      Promise.all([a, b].map((c) => post(`/api/team/sites/${s.id}/colony`, { updatedAt: stamp, colonyId: String(c) }))),
    );
    expect(colonies.map((r) => (r.headers["location"] as string).split("done=")[1]).sort()).toEqual(["colony", "stale"]);
    expect(await kindsOf(s.id)).toEqual(["colony_changed"]);
    const stamp2 = await stampOf(s.id);
    const retires = await withRowLocked(s.id, 2, () =>
      Promise.all([1, 2].map(() => post(`/api/team/sites/${s.id}/retire`, { confirm: "1", updatedAt: stamp2, reason: "race" }))),
    );
    expect(retires.map((r) => (r.headers["location"] as string).split("done=")[1]).sort()).toEqual(["alreadyRetired", "retired"]);
    expect(await kindsOf(s.id)).toEqual(["colony_changed", "retired"]);
  });
});

// ── Test 16: escaping ──────────────────────────────────────────────────────

describe("test 16: names, notes, directions, reasons and colony names with markup show as text", () => {
  it("on every page this PR draws", async () => {
    const colonyName = `${unique("col")} <b>${MARKUP}`;
    const colonyId = await makeColony(colonyName);
    const name = `${unique("name")} <u>${MARKUP}`;
    const created = await post("/api/team/sites", {
      lat: "37.4447",
      lng: "24.9417",
      name,
      colonyId: String(colonyId),
      notes: `<i>notes</i> ${MARKUP}`,
      directions: `<b>directions</b> ${MARKUP}`,
    });
    expect(created.status).toBe(303);
    const id = Number(/\/sites\/(\d+)\?/.exec(created.headers["location"] as string)![1]);
    await post(`/api/team/sites/${id}/move`, {
      updatedAt: await stampOf(id),
      lat: "37.4501",
      lng: "24.9502",
      reason: `<script>alert(1)</script> ${MARKUP}`,
    });
    await post(`/api/team/sites/${id}/retire`, { confirm: "1", updatedAt: await stampOf(id), reason: `<b>gone</b> ${MARKUP}` });
    const pages = [
      (await get(`/api/team/sites/${id}`)).text,
      (await get(`/api/team/sites/${id}?done=saved`)).text,
      (await get("/api/team/sites?retired=1")).text,
      (await get(`/api/team/sites/${id}/move`)).text,
      (await post(`/api/team/sites/${id}/move/pick`, { lat: "37.4501", lng: "24.9502", updatedAt: await stampOf(id) })).text,
      (await post("/api/team/sites/pick", { lat: "37.4447", lng: "24.9417" })).text,
    ];
    for (const html of pages) {
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<u>");
      expect(html).not.toContain("<b>");
    }
    const site = decoded(pages[0]!);
    expect(site).toContain(name);
    expect(site).toContain(colonyName);
    expect(site).toContain(`<i>notes</i> ${MARKUP}`);
    expect(site).toContain(`<b>directions</b> ${MARKUP}`);
    expect(site).toContain(`Reason: <script>alert(1)</script> ${MARKUP}`);
    expect(site).toContain(`Reason: <b>gone</b> ${MARKUP}`);
    expect(decoded(pages[2]!)).toContain(name);
    expect(decoded(pages[3]!)).toContain(name);
    expect(decoded(pages[5]!)).toContain(colonyName);
  });
});

// ── The new route is not read as an id ─────────────────────────────────────

describe("/sites/new and the site pages", () => {
  it("an id still opens a site, 'new' opens the picker, and a made-up word is a 404", async () => {
    const s = await makeSite();
    expect((await get(`/api/team/sites/${s.id}`)).text).toContain(s.name);
    expect((await get("/api/team/sites/new")).text).toContain("Add a feeding site");
    expect((await get("/api/team/sites/neww")).status).toBe(404);
  });
});

// ── The confirmation page's small map (SYC-705 Task 2b.7; SYC-355) ─────────

describe("the confirmation page's small map: drag it to move the pin, inside the one form", () => {
  const SPOTS: Position[] = [ERMOUPOLI, { lat: 37.4731, lng: 24.9892 }, { lat: 37.4012, lng: 24.8801 }, { lat: 37.4999, lng: 24.9399 }];

  it("add: the map opens on the spot, close up, and writes into the details form", async () => {
    for (const p of SPOTS) {
      const html = (await post("/api/team/sites/pick", { lat: String(p.lat), lng: String(p.lng) })).text;
      const form = formById(html, "detailsform")!;
      expect(mapDataIn(form)).toMatchObject({ mode: "place", formId: "detailsform", centre: [p.lat, p.lng], zoom: 17 });
      expect(form).toMatch(/<p class="hint" data-mapon hidden>Not quite right\? Drag the small map/);
      expect(html).toContain("Start again on the full map");
      expectNoPositionInAddresses(html);
    }
    // By area it opens wider: the area, not a street.
    expect(mapDataIn((await post("/api/team/sites/pick", { area: "kini" })).text).zoom).toBe(15);
  });

  it("the colony an add page was opened for is still chosen on Check the spot, whichever way the spot came", async () => {
    const colonyId = await makeColony();
    for (const body of [{ area: "kini" }, { lat: "37.4447", lng: "24.9417" }] as Array<Record<string, string>>) {
      const res = await post("/api/team/sites/pick", { ...body, colonyId: String(colonyId) });
      expect(res.text).toContain(`<option value="${colonyId}" selected>`);
    }
    // Junk carried in is dropped, not an error.
    const junk = await post("/api/team/sites/pick", { lat: "37.4447", lng: "24.9417", colonyId: "abc", name: "x".repeat(500), notes: `a${NUL}` });
    expect(junk.status).toBe(200);
    expect(junk.text).toContain('id="new-name"');
  });

  it("move: the map's form is the move form, with the stamp, the reason and the site's spot now on the map", async () => {
    const s = await makeSite();
    const stamp = await stampOf(s.id);
    const html = (await post(`/api/team/sites/${s.id}/move/pick`, { lat: "37.4501", lng: "24.9501", updatedAt: stamp })).text;
    const form = formById(html, "detailsform")!;
    expect(form).toContain(`action="/api/team/sites/${s.id}/move"`);
    expect(stampIn(form)).toBe(stamp);
    expect(form).toContain('name="reason"');
    expect(mapDataIn(form).markers).toEqual([{ lat: s.lat, lng: s.lng, label: "Where it is now", look: "retired" }]);
    expect(html).toContain("Start again on the full map");
    expectNoPositionInAddresses(html);
    expect(await eventsOf(s.id)).toHaveLength(0);
  });
});

describe("colonyId as a JSON integer", () => {
  it("is accepted as a number or a string, on add and on change colony", async () => {
    const colonyId = await makeColony();
    const add = await postJson("/api/team/sites", { lat: 37.4447, lng: 24.9417, name: unique("int"), colonyId });
    expect(add.status).toBe(201);
    expect((await siteRow(add.body.id)).colonyId).toBe(colonyId);
    const other = await makeColony();
    const num = await postJson(`/api/team/sites/${add.body.id}/colony`, { updatedAt: await stampOf(add.body.id), colonyId: other });
    expect(num.status).toBe(200);
    expect((await siteRow(add.body.id)).colonyId).toBe(other);
    const str = await postJson(`/api/team/sites/${add.body.id}/colony`, { updatedAt: await stampOf(add.body.id), colonyId: String(colonyId) });
    expect(str.status).toBe(200);
    const none = await postJson(`/api/team/sites/${add.body.id}/colony`, { updatedAt: await stampOf(add.body.id), colonyId: null });
    expect(none.status).toBe(200);
    expect((await siteRow(add.body.id)).colonyId).toBeNull();
    for (const bad of [1.5, -1, 0, true, {}, "1.5"]) {
      const res = await postJson(`/api/team/sites/${add.body.id}/colony`, { updatedAt: await stampOf(add.body.id), colonyId: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("the stamp does not depend on the session's date style or time zone", () => {
  it("the same stamp text, and the same comparison, under a non-ISO DateStyle and another time zone", async () => {
    const s = await makeSite();
    const plain = await stampOf(s.id);
    expect(plain).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/);
    const client = await pool.connect();
    try {
      await client.query("SET DateStyle = 'SQL, DMY'");
      await client.query("SET TimeZone = 'America/New_York'");
      // The exact expression the pages and the writes use (stampText).
      const shown = await client.query(
        `select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as s,
                (to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') = $2) as same
           from feeding_sites where id = $1`,
        [s.id, plain],
      );
      expect(shown.rows[0]).toEqual({ s: plain, same: true });
      // …whereas the plain text form changes with the session, which is why it isn't used.
      const raw = await client.query("select updated_at::text as t from feeding_sites where id = $1", [s.id]);
      expect(raw.rows[0].t).not.toMatch(/^\d{4}-\d{2}-\d{2} /);
    } finally {
      await client.query("RESET DateStyle");
      await client.query("RESET TimeZone");
      client.release();
    }
  });
});
