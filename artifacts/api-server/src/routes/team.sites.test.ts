import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  addPerson,
  coloniesTable,
  db,
  feedingSitesTable,
  markLeft,
  pool,
  sitePageReadsTable,
  type MappingEventKind,
} from "@workspace/db";
import app from "../app";
import { sessionCookieFor, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { recordMappingEvent } from "../lib/mappingEvents";
import { countLine } from "../lib/teamPages/sitePages";
import { BANDS, viewAround } from "../lib/mapTiles/geometry";
import { mintTileToken } from "../lib/mapTiles/tileToken";
import * as teamSites from "../lib/teamSites";
import { isOpaqueAddress } from "../test/opaqueAddress";
import { expectMapNote } from "../test/mapNote";
import { isOpenMapLink } from "../test/openMapLink";
import { placeLabel } from "../lib/areas/placeLabel";

// The read insert is wrapped so one test can make it fail; every other call is real.
vi.mock("../lib/teamSites", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/teamSites")>();
  return { ...real, recordSitePageRead: vi.fn(real.recordSitePageRead) };
});

// SYC-209 PR 3.2: the Feeding sites pages, read-only. Spec tests 16
// (escaping), 5 (part: the pages and the history need view_exact_location),
// the "who looked" record (spec §8), K13 (no position in any address), and
// the list rules (counts, retired, recently changed).
//
// mapping_events and site_page_reads refuse delete, and a site with a read
// record can't be deleted, so nothing here is cleaned up: every name is
// unique to this run, and the throwaway database is dropped at the end of
// the run (src/test/globalSetup.ts).

const RUN = randomBytes(3).toString("hex");
const P = `vt-sites-${RUN}-`;
const SUSAN = `vitest-sites-susan-${RUN}@example.com`;
const MARIA = `vitest-sites-maria-${RUN}@example.com`;
const VERA = `vitest-sites-vera-${RUN}@example.com`;
const KEY = "vitest-sites-key-0123456789abcdef-0123456789";
const EXPECTED_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const MARKUP = `<img src=x onerror="alert(1)"> "q" 'x'`;

let susan: string;
let maria: string;
let cookie: string;
let vetCookie: string;
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

const post = (path: string, body: Record<string, string>, c: string | null = cookie) => {
  const t = request(app).post(path).set("Origin", TEAM_ORIGIN).type("form");
  if (c) t.set("Cookie", c);
  return t.send(body);
};

/** Sites go near the middle of the island, away from other tests' sites. */
let slot = 0;
async function makeSite(
  opts: {
    name?: string;
    colonyId?: number | null;
    isPublic?: boolean;
    label?: string;
    retired?: boolean;
    notes?: string | null;
    directions?: string | null;
  } = {},
): Promise<{ id: number; name: string; lat: number; lng: number }> {
  const name = opts.name ?? unique("site");
  const lat = 37.45 + slot * 0.0008;
  const lng = 24.93;
  slot += 1;
  const [row] = await db
    .insert(feedingSitesTable)
    .values({
      name,
      lat,
      lng,
      colonyId: opts.colonyId ?? null,
      notes: opts.notes ?? null,
      directions: opts.directions ?? null,
      ...(opts.isPublic
        ? {
            isPublic: true,
            publicLabel: opts.label ?? "A public place",
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

async function event(
  siteId: number,
  kind: MappingEventKind,
  personId: string,
  extra: { before?: Record<string, unknown>; after?: Record<string, unknown>; note?: string } = {},
) {
  await db.transaction(async (tx) => {
    await recordMappingEvent(tx, { subjectKind: "site", subjectId: siteId, kind, personId, ...extra });
  });
}

async function makeColony(name: string): Promise<number> {
  const [c] = await db
    .insert(coloniesTable)
    .values({ name, normalisedName: name.toLowerCase() })
    .returning({ id: coloniesTable.id });
  return c!.id;
}

const readsFor = async (siteId: number) =>
  (await db.select().from(sitePageReadsTable).where(eq(sitePageReadsTable.siteId, siteId))).length;
const allReads = async () => Number((await pool.query("select count(*)::int as n from site_page_reads")).rows[0].n);

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  susan = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest" })).id;
  maria = (await addPerson({ email: MARIA, name: "Maria", addedBy: "cli:vitest" })).id;
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["vet"] });
  cookie = sessionCookieFor(susan);
  vetCookie = sessionCookieFor(vera.id);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  // The map's pictures are fetched by our server; no test reaches the internet.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 503 }));
});

afterAll(async () => {
  fetchSpy?.mockRestore();
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const ATTR = /\s(href|action|src)="([^"]*)"/g;

/** K13: no href, action or src holds a coordinate or a z/x/y. */
function expectNoPositionInAddresses(html: string) {
  const values = [...html.matchAll(ATTR)].map((m) => m[2]!);
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) {
    if (isOpaqueAddress(v)) continue; // a photo uuid or a signed tile token (SYC-425)
    if (isOpenMapLink(v)) continue; // D9's outbound Open map link, for the team only (SYC-395)
    expect(v, v).not.toMatch(/\d+\.\d+/);
    expect(v, v).not.toMatch(/\d+[/-]\d+[/-]\d+/);
    expect(v, v).not.toMatch(/[?&](lat|lng|lon|z|x|y|vz|vx|vy)=/i);
  }
}

const viewOf = (html: string) => {
  const field = (name: string) => Number(new RegExp(`name="${name}" value="(-?\\d+)"`).exec(html)![1]);
  return { z: field("vz"), x: field("vx"), y: field("vy") };
};

describe("the Feeding sites page: what is on it", () => {
  it("is the dashboard's page: its header, no scripts, nothing cached, the menu item highlighted", async () => {
    const res = await get("/api/team/sites");
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).not.toMatch(/<script/i);
    // Feeding sites left the menu (SYC-450): the page underlines its parent, Colonies.
    expect(res.text).toContain('aria-current="page">Colonies</a>');
    expect(res.text).not.toContain("Feeding sites</a>");
    // The menu's Map is the Cats page's map view (SYC-396 PR 1.6), never this tap-check page.
    expect(res.text).not.toContain('href="/api/team/map"');
    expect(res.text).toContain("Recently changed");
    expect(res.text).toContain("OpenStreetMap contributors");
  });

  it("follows spec 2.1: count, then Recently changed, then the map, then the list", async () => {
    await makeSite();
    const html = (await get("/api/team/sites")).text;
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = ["<strong>", "Recently changed", '<div class="map"', "<h2>All sites</h2>"].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.indexOf('class="mapband')).toBeGreaterThan(html.indexOf("Recently changed"));
  });

  it("writes the count line the way the spec does, and the retired part only when there are any", () => {
    expect(countLine({ total: 31, public: 2, private: 28, retired: 1 })).toBe("31 sites: 2 public, 28 private, 1 retired");
    expect(countLine({ total: 30, public: 2, private: 28, retired: 0 })).toBe("30 sites: 2 public, 28 private");
    expect(countLine({ total: 1, public: 0, private: 1, retired: 0 })).toBe("1 site: 0 public, 1 private");
  });

  it("shows counts that match the sites: seeding one public, two private and one retired moves them by exactly that", async () => {
    const before = (await get("/api/team/sites").set("Accept", "application/json")).body.counts;
    await makeSite({ isPublic: true });
    await makeSite();
    await makeSite();
    await makeSite({ retired: true });
    const res = await get("/api/team/sites");
    const after = (await get("/api/team/sites").set("Accept", "application/json")).body.counts;
    expect(after).toEqual({
      total: before.total + 4,
      public: before.public + 1,
      private: before.private + 2,
      retired: before.retired + 1,
    });
    expect(after.total).toBe(after.public + after.private + after.retired);
    expect(decoded(res.text)).toContain(countLine(after));
    expect(after.retired).toBeGreaterThan(0);
    expect(res.text).toContain(`${after.retired} retired`);
  });

  it("lists sites by name with their colony (linked) or 'no colony yet', private or public, and the day last changed", async () => {
    const colonyName = unique("colony");
    const colonyId = await makeColony(colonyName);
    const a = await makeSite({ name: `${P}list-b`, colonyId, isPublic: true });
    const b = await makeSite({ name: `${P}list-a` });
    const html = (await get("/api/team/sites")).text;
    const rowOf = (name: string) => {
      const i = html.indexOf(`>${name}</a></p>`);
      expect(i, name).toBeGreaterThan(-1);
      return html.slice(i, html.indexOf("</li>", i));
    };
    expect(html.indexOf(`>${P}list-a</a>`)).toBeLessThan(html.indexOf(`>${P}list-b</a>`));
    expect(rowOf(`${P}list-b`)).toContain(`<a href="/api/team/colonies/${colonyId}">${colonyName}</a>`);
    expect(rowOf(`${P}list-b`)).toContain("Public");
    expect(rowOf(`${P}list-a`)).toContain("no colony yet");
    expect(rowOf(`${P}list-a`)).toContain("Private");
    expect(rowOf(`${P}list-a`)).toMatch(/Last changed <time datetime="[^"]+">\d{1,2} \w{3} \d{4}<\/time>/);
    expect(html).toContain(`href="/api/team/sites/${a.id}"`);
    expect(html).toContain(`href="/api/team/sites/${b.id}"`);
  });
});

describe("the map on the Feeding sites page", () => {
  it("says the map is only for the team where it can be seen, and keeps the reason behind a link (22 Oct 2026)", async () => {
    expectMapNote((await get("/api/team/sites")).text);
  });

  it("has a link marker per site: filled for public, outlined for private, each to its own page", async () => {
    const pub = await makeSite({ isPublic: true });
    const priv = await makeSite();
    const html = (await get("/api/team/sites")).text;
    expect(html).toContain(`<a class="pin site-public" style="`);
    // Every band draws the marker; read one.
    const marker = (id: number, look: string) =>
      new RegExp(`<a class="pin site-${look}" style="[^"]*" href="/api/team/sites/${id}" title="[^"]*">`);
    expect(html).toMatch(marker(pub.id, "public"));
    expect(html).toMatch(marker(priv.id, "private"));
    // The span-style CSS for the three looks is in the page.
    expect(html).toContain(".pin.site-public{background:#b3261e}");
    expect(html).toContain(".pin.site-retired{");
  });

  it("hides retired sites and their grey markers unless Show retired is ticked", async () => {
    const retired = await makeSite({ retired: true, name: `${P}gone-${++n}` });
    const kept = await makeSite();
    const plain = (await get("/api/team/sites")).text;
    expect(plain).not.toContain(retired.name);
    expect(plain).not.toContain(`/api/team/sites/${retired.id}"`);
    expect(plain).toContain(`/api/team/sites/${kept.id}"`);
    expect(plain).toContain('name="retired" value="1">');
    expect(plain).not.toMatch(/name="retired" value="1" checked/);

    const shown = (await get("/api/team/sites?retired=1")).text;
    expect(shown).toContain(`>${retired.name}</a>`);
    expect(shown).toMatch(new RegExp(`<a class="pin site-retired" style="[^"]*" href="/api/team/sites/${retired.id}"`));
    expect(shown).toMatch(/name="retired" value="1" checked/);
    // A look-alike value does not tick it.
    expect((await get("/api/team/sites?retired=yes")).text).not.toContain(retired.name);
    expect((await get("/api/team/sites?retired=1&retired=0")).text).not.toContain(retired.name);
  });

  it("ticking Show retired keeps the map where it was, through an opaque token", async () => {
    const zoomed = await post("/api/team/sites/map", { vz: "12", vx: "0", vy: "0", area: "vaporia" });
    const v = viewOf(zoomed.text);
    const field = /<form method="get"[^>]*>\s*<input type="hidden" name="view" value="([^"]+)"/.exec(zoomed.text);
    expect(field).not.toBeNull();
    expect(field![1]).toMatch(/^[A-Za-z0-9_-]{59}$/);
    const res = await get(`/api/team/sites?retired=1&view=${encodeURIComponent(field![1]!)}`);
    expect(viewOf(res.text)).toEqual(v);
    // A forged or garbled token falls back to the whole island.
    expect(viewOf((await get("/api/team/sites?view=nonsense")).text).z).toBe(12);
    expect(mintTileToken({ ...v, size: 179 })).toBe(field![1]);
  });

  it("zooms, pans and jumps to an area by POST, keeping Show retired, and writes nothing", async () => {
    const retired = await makeSite({ retired: true });
    const before = await allReads();
    const start = viewOf((await get("/api/team/sites?retired=1")).text);
    expect(start.z).toBe(12);
    const moved = await post("/api/team/sites/map", {
      vz: String(start.z),
      vx: String(start.x),
      vy: String(start.y),
      go: "in",
      retired: "1",
    });
    expect(moved.status).toBe(200);
    expect(viewOf(moved.text).z).toBe(13);
    expect(moved.text).toContain('<form method="post" action="/api/team/sites/map" class="mapmove">');
    expect(moved.text).toContain('<input type="hidden" name="retired" value="1">');
    expect(moved.text).toContain(`>${retired.name}</a>`);
    const area = await post("/api/team/sites/map", { vz: "12", vx: "0", vy: "0", area: "vaporia" });
    expect(viewOf(area.text).z).toBeGreaterThan(12);
    expect(area.text).not.toContain(retired.name);
    expect(await allReads()).toBe(before);
  });

  it("answers a bad move form with the whole island and a note, not an error page", async () => {
    const res = await post("/api/team/sites/map", { vz: "1e3", vx: "x", vy: "" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("back at the whole island");
    expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
  });

  it("has no position in any href, action or src (K13): the page, with Show retired, after a move and an area", async () => {
    await makeSite();
    const pages = [
      (await get("/api/team/sites")).text,
      (await get("/api/team/sites?retired=1")).text,
      (await post("/api/team/sites/map", { vz: "12", vx: "2370", vy: "1600", go: "in", retired: "1" })).text,
      (await post("/api/team/sites/map", { vz: "12", vx: "0", vy: "0", area: "vaporia" })).text,
      (await post("/api/team/sites/map", { vz: "x", vx: "x", vy: "x" })).text,
    ];
    for (const html of pages) expectNoPositionInAddresses(html);
    // And the markers really are links to numbers.
    expect(pages[0]).toMatch(/<a class="pin site-private"[^>]* href="\/api\/team\/sites\/\d+"/);
  });

  it("puts the island's sites in view at the opening zoom", async () => {
    const s = await makeSite();
    const v = viewOf((await get("/api/team/sites")).text);
    expect(v).toEqual(viewAround({ lat: 37.445, lng: 24.93 }, 12));
    expect(s.id).toBeGreaterThan(0);
  });
});

describe("Recently changed", () => {
  it("shows the last five site changes, newest first, with the person and 'Maria (left)'", async () => {
    const s = await makeSite({ name: unique("recent") });
    const kinds: MappingEventKind[] = [
      "created",
      "renamed",
      "notes_edited",
      "directions_edited",
      "moved",
      "retired",
      "restored",
    ];
    for (const [i, k] of kinds.entries()) await event(s.id, k, i % 2 === 0 ? susan : maria);
    await markLeft(MARIA, "cli:vitest");
    const html = (await get("/api/team/sites")).text;
    const strip = html.slice(html.indexOf("Recently changed"), html.indexOf("All sites"));
    // The newest five of the seven, newest first.
    const order = ["Brought back", "Retired", "Moved", "How to find it changed", "Notes changed"].map((w) => strip.indexOf(w));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(strip).not.toContain("Renamed");
    expect(strip).not.toContain("Site created");
    expect((strip.match(/<li>/g) ?? []).length).toBe(5);
    expect(strip).toContain("by Susan");
    expect(strip).toContain("by Maria (left)");
    expect(strip).toMatch(/<time datetime="[^"]+">\d{1,2} \w{3} \d{4}<\/time>/);
    expect(strip).toContain(`<a href="/api/team/sites/${s.id}">${s.name}</a>`);
  });
});

describe("one site", () => {
  it("shows the spec's order: name, map, visibility, colony, notes, how to find it, history, actions place", async () => {
    const colonyName = unique("colony");
    const colonyId = await makeColony(colonyName);
    const s = await makeSite({ colonyId, notes: "the gate is round the back", directions: "down the steps" });
    await event(s.id, "created", susan, { after: { name: s.name, lat: s.lat, lng: s.lng } });
    const res = await get(`/api/team/sites/${s.id}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
    const html = decoded(res.text);
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      `<h1>${s.name}</h1>`,
      'class="map"',
      "Private. Only Syros Cats people signed in here can see this place.",
      `<a href="/api/team/colonies/${colonyId}">${colonyName}</a>`,
      "the gate is round the back",
      "Please don't note people's comings and goings.",
      "How to find it",
      "down the steps",
      "<h2>History</h2>",
      'data-actions="site"',
    ].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The history says where in words, for the team (SYC-517).
    expect(html).toContain(`Site created: “${s.name}” · ${placeLabel(s)}`);
    expect(html).toContain("by Susan");
    // A small map, not the full set of buttons.
    expect(res.text).not.toContain(`class="mapmove"`);
  });

  it("prints no position as numbers; only the Open map link carries 5 decimal places", async () => {
    const s = await makeSite();
    await event(s.id, "moved", susan, {
      before: { lat: 37.450100000000006, lng: 24.930000000000003 },
      after: { lat: 37.4502, lng: 24.9301 },
    });
    await event(s.id, "created", susan, { after: { name: s.name, lat: 37.450100000000006, lng: 24.930000000000003 } });
    const html = (await get(`/api/team/sites/${s.id}`)).text;
    expect(html).toContain("37.45010%2C24.93000");
    expect(html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ")).not.toMatch(/\d{2}\.\d{5}/);
    // (The page's timestamps, such as the hidden `updatedAt` stamp, run to the
    // microsecond; they are times, not positions, wherever the page prints them.
    // SYC-367 failed here without the number being captured, so name it.)
    const withoutTimes = html.replace(/\d{4}-\d{2}-\d{2}[T ][\d:]+\.\d+(Z|[+-]\d{2}(:\d{2})?)?/g, "");
    expect(withoutTimes.match(/.{0,40}\d+\.\d{6,}.{0,10}/)?.[0]).toBeUndefined();
  });

  it("centres the small map on the site: the marker is within the central half at every width band", async () => {
    // Several spots, so a lucky alignment can't pass it.
    for (const [lat, lng] of [[37.4447, 24.9417], [37.4731, 24.9892], [37.4012, 24.8801], [37.4999, 24.9399]] as const) {
      const [row] = await db.insert(feedingSitesTable).values({ name: unique("centre"), lat, lng }).returning({ id: feedingSitesTable.id });
      const html = (await get(`/api/team/sites/${row!.id}`)).text;
      for (const b of BANDS) {
        const band = new RegExp(`<div class="mapband b${b.size}"[^>]*>(.*?)</div>`).exec(html)![0];
        const m = /class="pin site-private" style="left:(\d+)px;top:(\d+)px"/.exec(band);
        expect(m, `${lat},${lng} at ${b.size}`).not.toBeNull();
        const span = 2 * b.size;
        for (const off of [Number(m![1]), Number(m![2])]) {
          expect(Math.abs(off - span / 2), `${lat},${lng} at ${b.size}`).toBeLessThanOrEqual(span / 4 + 1);
        }
      }
    }
  });

  it("says 'no colony yet' and 'None' for a site with neither, and 'Public since' for a public one", async () => {
    const bare = await makeSite();
    const html = (await get(`/api/team/sites/${bare.id}`)).text;
    expect(html).toContain("No colony yet.");
    expect(html.match(/<p class="empty">None<\/p>/g)).toHaveLength(2);
    const pub = await makeSite({ isPublic: true });
    const page = (await get(`/api/team/sites/${pub.id}`)).text;
    expect(page).toContain("Public since 1 Sept 2026, by Susan");
    expect(page).not.toContain("Private. Only Syros Cats people");
  });

  it("shows a retired site as retired, with its map marker grey", async () => {
    const s = await makeSite({ retired: true });
    const html = (await get(`/api/team/sites/${s.id}`)).text;
    expect(html).toContain("Retired since 15 Sept 2026");
    expect(html).toContain('class="pin site-retired"');
  });

  it("shows the history newest first, moves with both positions and the reason", async () => {
    const s = await makeSite();
    await event(s.id, "created", susan, { after: { name: s.name } });
    await event(s.id, "moved", susan, {
      before: { lat: 37.1, lng: 24.1 },
      after: { lat: 37.2, lng: 24.2 },
      note: "pin was on the wrong side of the road",
    });
    const html = decoded((await get(`/api/team/sites/${s.id}`)).text);
    expect(html.indexOf("Moved:")).toBeLessThan(html.indexOf("Site created"));
    // Each position carries the team's Open map link (SYC-395, D9).
    expect(html).toMatch(
      new RegExp(
        `Moved: ${placeLabel({ lat: 37.1, lng: 24.1 })} &middot; <a [^>]*>Open map</a> → ${placeLabel({ lat: 37.2, lng: 24.2 })} &middot; <a [^>]*>Open map</a>`,
      ),
    );
    expect(html).toContain("Reason: pin was on the wrong side of the road");
  });

  it("answers an unknown or unreadable number with the not-found page, and writes no read record", async () => {
    const before = await allReads();
    for (const id of ["999999999", "abc", "1e3", "-1", "0%00", "%00"]) {
      const res = await get(`/api/team/sites/${id}`);
      expect(res.status, id).toBe(404);
      expect(res.text, id).toContain("There is no feeding site with that number.");
      expect(res.text, id).toContain("No such feeding site");
    }
    const json = await get("/api/team/sites/999999999").set("Accept", "application/json");
    expect([json.status, json.body]).toEqual([404, { error: "Not found" }]);
    expect(await allReads()).toBe(before);
  });
});

describe("who looked (spec §8)", () => {
  it("opening a site's page writes exactly one read record: person, site, time", async () => {
    const s = await makeSite();
    expect(await readsFor(s.id)).toBe(0);
    expect((await get(`/api/team/sites/${s.id}`)).status).toBe(200);
    const rows = await db.select().from(sitePageReadsTable).where(eq(sitePageReadsTable.siteId, s.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.personId).toBe(susan);
    expect(Date.now() - rows[0]!.at.getTime()).toBeLessThan(60_000);
    // The table holds no position.
    const cols = (await pool.query("select column_name from information_schema.columns where table_name = 'site_page_reads'")).rows.map((r) => r.column_name);
    expect(cols.sort()).toEqual(["at", "id", "person_id", "site_id"]);
    // Each opening is one more.
    await get(`/api/team/sites/${s.id}`);
    expect(await readsFor(s.id)).toBe(2);
  });

  it("a JSON open writes one record too; a JSON not-found writes none", async () => {
    const s = await makeSite();
    const before = await allReads();
    expect((await get(`/api/team/sites/${s.id}`).set("Accept", "application/json")).status).toBe(200);
    expect(await allReads()).toBe(before + 1);
    expect((await get("/api/team/sites/999999999").set("Accept", "application/json")).status).toBe(404);
    expect(await allReads()).toBe(before + 1);
  });

  it("a HEAD request writes no record", async () => {
    const s = await makeSite();
    const res = await request(app).head(`/api/team/sites/${s.id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(await readsFor(s.id)).toBe(0);
  });

  it("fails closed: if the record can't be written there is no page", async () => {
    const s = await makeSite({ name: unique("failclosed") });
    vi.mocked(teamSites.recordSitePageRead).mockRejectedValueOnce(new Error("disk full"));
    const res = await get(`/api/team/sites/${s.id}`);
    expect(res.status).toBe(500);
    expect(res.text).not.toContain(s.name);
    expect(await readsFor(s.id)).toBe(0);
  });

  it("the list, the map, a move and the colony page write none", async () => {
    const colonyId = await makeColony(unique("colony"));
    await makeSite({ colonyId });
    const before = await allReads();
    await get("/api/team/sites");
    await get("/api/team/sites?retired=1");
    await get("/api/team/sites").set("Accept", "application/json");
    await post("/api/team/sites/map", { vz: "12", vx: "0", vy: "0", go: "in" });
    await get("/api/team/map");
    await post("/api/team/map", { vz: "12", vx: "0", vy: "0", go: "in" });
    await get(`/api/team/colonies/${colonyId}`);
    expect(await allReads()).toBe(before);
  });

  it("a refused person leaves no record", async () => {
    const s = await makeSite();
    expect((await get(`/api/team/sites/${s.id}`, vetCookie)).status).toBe(403);
    expect((await get(`/api/team/sites/${s.id}`, null)).status).toBe(401);
    expect(await readsFor(s.id)).toBe(0);
  });
});

describe("test 5 (part): who may see the pages and the history", () => {
  it("a signed-in person without view_exact_location gets the 403; no session gets the 401", async () => {
    const s = await makeSite();
    const routes = ["/api/team/sites", `/api/team/sites/${s.id}`];
    for (const path of routes) {
      const refused = await get(path, vetCookie);
      expect([refused.status, refused.text], path).toEqual([403, '{"error":"forbidden"}']);
      expect(refused.headers["cache-control"]).toBe("no-store");
      const page = await get(path, vetCookie).set("Sec-Fetch-Mode", "navigate");
      expect(page.status, path).toBe(403);
      expect(page.text).not.toContain(s.name);
      const none = await get(path, null);
      expect([none.status, none.text], path).toEqual([401, '{"error":"not_signed_in"}']);
    }
    const move = await post("/api/team/sites/map", { vz: "12", vx: "0", vy: "0" }, vetCookie);
    expect([move.status, move.text]).toEqual([403, '{"error":"forbidden"}']);
    const noSession = await post("/api/team/sites/map", { vz: "12", vx: "0", vy: "0" }, null);
    expect([noSession.status, noSession.text]).toEqual([401, '{"error":"not_signed_in"}']);
    const elsewhere = await request(app)
      .post("/api/team/sites/map")
      .set("Origin", "https://evil.example")
      .set("Cookie", cookie)
      .type("form")
      .send({ vz: "12", vx: "0", vy: "0" });
    expect([elsewhere.status, elsewhere.text]).toEqual([401, '{"error":"not_signed_in"}']);
  });

  it("the history's positions are in no page a refused person can get", async () => {
    const s = await makeSite();
    await event(s.id, "moved", susan, { before: { lat: 37.1111, lng: 24.1111 }, after: { lat: 37.2222, lng: 24.2222 } });
    const refused = await get(`/api/team/sites/${s.id}`, vetCookie).set("Sec-Fetch-Mode", "navigate");
    expect(refused.text).not.toContain("37.11110");
    expect(refused.text).not.toContain("37.22220");
    expect((await get(`/api/team/sites/${s.id}`)).text).toContain("37.11110");
  });
});

describe("test 16: what people typed shows as text", () => {
  it("a site's name, notes and directions with markup are escaped on the site page, the list and the colony page", async () => {
    const colonyId = await makeColony(unique("colony"));
    const s = await makeSite({
      name: `${P}${MARKUP}`,
      colonyId,
      notes: `n ${MARKUP}`,
      directions: `d ${MARKUP}`,
    });
    await event(s.id, "renamed", susan, { before: { name: `old ${MARKUP}` }, after: { name: `${P}${MARKUP}` }, note: `why ${MARKUP}` });
    const pages = [
      (await get(`/api/team/sites/${s.id}`)).text,
      (await get("/api/team/sites?retired=1")).text,
      (await get(`/api/team/colonies/${colonyId}`)).text,
    ];
    for (const html of pages) {
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain('onerror="alert');
      expect(decoded(html)).toContain(`${P}${MARKUP}`);
    }
    const one = decoded(pages[0]!);
    expect(one).toContain(`n ${MARKUP}`);
    expect(one).toContain(`d ${MARKUP}`);
    expect(one).toContain(`Reason: why ${MARKUP}`);
    // The marker's label (a title and a screen-reader line) is escaped too.
    expect(pages[1]).toContain(`title="${P}&lt;img`);
  });

  it("a colony's name on a site row is escaped", async () => {
    const colonyId = await makeColony(`${P}col ${MARKUP}`);
    const s = await makeSite({ colonyId });
    const html = (await get(`/api/team/sites/${s.id}`)).text;
    expect(html).not.toContain("<img src=x");
    expect(decoded(html)).toContain(`${P}col ${MARKUP}`);
  });
});

describe("K13 on the site and colony pages", () => {
  it("no href, action or src holds a position: a public site with history, and its colony", async () => {
    const colonyId = await makeColony(unique("colony"));
    const s = await makeSite({ colonyId, isPublic: true, notes: "n" });
    await event(s.id, "created", susan, { after: { name: s.name, lat: s.lat, lng: s.lng } });
    await event(s.id, "moved", susan, { before: { lat: 37.1, lng: 24.1 }, after: { lat: 37.2, lng: 24.2 }, note: "r" });
    expectNoPositionInAddresses((await get(`/api/team/sites/${s.id}`)).text);
    expectNoPositionInAddresses((await get(`/api/team/colonies/${colonyId}`)).text);
  });
});

describe("the colony page's sites list", () => {
  it("links each of the colony's sites, and leaves retired ones out", async () => {
    const colonyId = await makeColony(unique("colony"));
    const a = await makeSite({ colonyId, name: `${P}col-a` });
    const b = await makeSite({ colonyId, name: `${P}col-b` });
    const gone = await makeSite({ colonyId, retired: true, name: `${P}col-gone` });
    const html = (await get(`/api/team/colonies/${colonyId}`)).text;
    expect(html).toContain(`<li><a href="/api/team/sites/${a.id}">${P}col-a</a></li>`);
    expect(html).toContain(`<li><a href="/api/team/sites/${b.id}">${P}col-b</a></li>`);
    expect(html).not.toContain(gone.name);
  });
});

// SYC-395 (D9) reverses SYC-245 / Decision 2B for outbound links: an
// island-wide team member gets Open map on the site's position. Nothing else
// leaves the site, and no other map company is named. (Cat guardians: see
// routes/team.guardianView.test.ts.)
describe("the Where line names the area and a public site's label (SYC-517)", () => {
  const whereLine = (html: string) => /<p class="syrline">([\s\S]*?)<\/p>/.exec(html)![1]!;
  it("a public site with a label reads Area, label; the internal name never appears", async () => {
    const s = await makeSite({ isPublic: true, label: "harbour steps", name: unique("Eleni's house") });
    const line = whereLine((await get(`/api/team/sites/${s.id}`)).text);
    expect(line).toContain(`${placeLabel(s)}, harbour steps &middot; <a `);
    expect(line).not.toContain(s.name);
  });
  it("a private site, or a blank label, reads the area only", async () => {
    const priv = await makeSite();
    expect(whereLine((await get(`/api/team/sites/${priv.id}`)).text)).toMatch(new RegExp(`^${placeLabel(priv)} &middot; <a `));
    const blank = await makeSite({ isPublic: true, label: "   " });
    const line = whereLine((await get(`/api/team/sites/${blank.id}`)).text);
    expect(line).toMatch(new RegExp(`^${placeLabel(blank)} &middot; <a `));
    expect(line).not.toContain(blank.name);
  });
});

describe("links out to a map company: Open map only", () => {
  it("the list has none; a site's page links its position once, with Open map", async () => {
    const s = await makeSite({ notes: "x" });
    const list = (await get("/api/team/sites?retired=1")).text;
    const page = (await get(`/api/team/sites/${s.id}`)).text;
    for (const html of [list, page]) {
      for (const c of ["maps.apple.com", "maps.google.", "goo.gl/maps", "geo:", "waze.com"]) {
        expect(html).not.toContain(c);
      }
    }
    // Not the menu's Workspace link: our own sign-in site, with no position in it.
    const external = (html: string) =>
      [...html.matchAll(/href="(https?:[^"]*)"/g)].map((m) => m[1]!).filter((h) => h !== "https://admin.catspotters.com/workspace");
    expect(external(list)).toEqual(["https://www.openstreetmap.org/copyright"]);
    expect(external(page).filter((h) => !isOpenMapLink(h))).toEqual(["https://www.openstreetmap.org/copyright"]);
    expect(external(page).filter(isOpenMapLink)).toHaveLength(1);
    expect(page).toContain(`query=${encodeURIComponent(`${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)}`);
  });

});
