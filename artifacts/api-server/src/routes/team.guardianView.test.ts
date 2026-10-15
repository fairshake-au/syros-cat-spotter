import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import request from "supertest";
import { addPerson, db, pool, sightingsTable } from "@workspace/db";
import app from "../app";
import router from "./index";
import { sessionCookieFor, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { createColony, updateColony } from "../lib/teamColonies";
import { addSite, changeSiteColony, colonyOptions, retireSite } from "../lib/teamSiteWrites";
import { siteView, sitesForPerson } from "../lib/teamSites";
import { visibleColonyIds, isIslandWide } from "../lib/guardianView";
import { guardianOn, putInColony, seedCat, type SeededCat, type Signed } from "../test/roleKit";
import { viewAround } from "../lib/mapTiles/geometry";
import { ISLAND_CENTRE, START_ZOOM } from "../lib/teamPages/map";
import { renderNameTaken } from "../lib/teamPages/colonyPages";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-209 PR 4.1: what a cat guardian sees (feeding-sites spec §7.3; plan
// PR 4.1). Spec test 21 (seeing) and test 12 (part: a placed check takes its
// colony from the record, never the request).
//
// The seed: Eleni is a cat guardian of colony 1. Colony 2 has its own
// guardian (Zoe, a person with a dashboard account) and its own sites, cats,
// notes, old name and history, every one carrying a distinctive marker
// ("XQ"). Colony 2's name, guardian, counts and sites must appear on NO page
// Eleni can open, and an id of colony 2's site or colony must answer byte
// for byte like an id that doesn't exist.
//
// The team is checked too, so each "absent" means something: the same pages
// show the team every one of those strings.
//
// Map-company links (SYC-362): the team may get them on dashboard pages in a
// later PR (gated on isIslandWide). A cat guardian's pages must never have
// one; this file checks that on its own, not through noMapLinks.source.test.

const RUN = randomBytes(3).toString("hex");
const KEY = "vitest-guardianview-key-0123456789abcdef-0123";
const NO_SUCH = 999_999_999;

/** Every string that belongs to colony 2 and must never reach Eleni. */
const XQ = `XQ${RUN}`;
const C2_NAME = `Kini ${XQ} Zoe's`;
const C2_OLD = `Oldname ${XQ}`;
const C2_GUARDIAN = `Zoe-${XQ}`;
const C2_NOTES = `notes2 ${XQ} the gate is round the back`;
const ZOE_PERSON = `Zoeperson ${XQ}`;
const S2_NAME = `Site2 ${XQ}`;
const S2_DIRECTIONS = `dir2 ${XQ} behind the bakery`;
const S2_NOTES = `sitenotes2 ${XQ}`;
const S2_POS = { lat: 37.43219, lng: 24.91357 };
const S0_NAME = `Site0 nocolony ${XQ}`;
const S0_POS = { lat: 37.43771, lng: 24.90611 };
const JOINED_OLD_NAME = `Joinedold ${XQ}`;
const JOINED_OLD_POS = { lat: 37.44123, lng: 24.92468 };

const C1_NAME = `Vaporia ${RUN} Eleni's`;
const S1_NAME = `Site1 ${RUN}`;
const S1_POS = { lat: 37.44681, lng: 24.94533 };
const S1_DIRECTIONS = `dir1 ${RUN} down the steps`;
const JOINED_NAME = `Joined ${RUN}`;
const JOINED_POS = { lat: 37.44234, lng: 24.93112 };

const FORBIDDEN = [
  C2_NAME,
  C2_OLD,
  C2_GUARDIAN,
  C2_NOTES,
  ZOE_PERSON,
  S2_NAME,
  S2_DIRECTIONS,
  S2_NOTES,
  S0_NAME,
  JOINED_OLD_NAME,
  XQ,
];
/** Positions, as the pages print them (5 places) and as stored. */
const FORBIDDEN_POSITIONS = [S2_POS, S0_POS, JOINED_OLD_POS].flatMap((p) => [
  p.lat.toFixed(5),
  p.lng.toFixed(5),
  String(p.lat),
  String(p.lng),
]);

/** The map companies a guardian's page may never link to (SYC-362). */
const MAP_COMPANIES =
  /google\.[a-z.]+\/maps|maps\.google\.|maps\.apple\.com|goo\.gl\/maps|geo:|waze\.com|openstreetmap\.org\/\?mlat|openstreetmap\.org\/#map/i;

let staffId: string;
let staffCookie: string;
let eleni: Signed;
let zoe: Signed;
let c1: number;
let c2: number;
let s1: number;
let s1r: number;
let s2: number;
let s0: number;
let sJ: number;
let catA: SeededCat;
let catB: SeededCat;
let catMoved: SeededCat;
let sightA: number;
let sightB: number;
let fetchSpy: MockInstance<typeof fetch>;

const staffPerson = () => ({ scopes: [{ role: "staff", colonyId: null }] });

async function sighting(catId: number, photoId: number, at: { lat: number; lng: number }) {
  const [row] = await db
    .insert(sightingsTable)
    .values({
      catId,
      deviceId: `vt-gview-device-${RUN}`,
      photoId,
      lat: at.lat,
      lng: at.lng,
      status: "resolved",
      createdAt: new Date("2026-09-12T07:15:00Z"),
    })
    .returning({ id: sightingsTable.id });
  return row!.id;
}

async function stampOf(id: number): Promise<string> {
  return (await siteView(visibleColonyIds(staffPerson()), id))!.updatedAt;
}

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  staffId = (
    await addPerson({ email: `vitest-gview-staff-${RUN}@example.com`, name: "Susan", addedBy: "cli:vitest" })
  ).id;
  staffCookie = sessionCookieFor(staffId);

  const made1 = await createColony(staffId, { name: C1_NAME, guardianName: "Eleni", notes: "notes1" });
  const made2 = await createColony(staffId, { name: C2_OLD, guardianName: C2_GUARDIAN, notes: C2_NOTES });
  if (made1.kind !== "created" || made2.kind !== "created") throw new Error("seed colonies");
  c1 = made1.id;
  c2 = made2.id;
  // Colony 2's old name stays in its name history (searchable by the team).
  await updateColony(staffId, c2, { name: C2_NAME }, () => true);

  eleni = await guardianOn(`gview-eleni-${RUN}`, [c1]);
  zoe = await guardianOn(`gview-zoe-${RUN}`, [c2]);
  await pool.query("update people set name = $1 where id = $2", [ZOE_PERSON, zoe.id]);
  await pool.query("update people set name = 'Eleni' where id = $1", [eleni.id]);

  const site = async (who: string, name: string, colonyId: number | null, at: { lat: number; lng: number }, extra: { directions?: string; notes?: string } = {}) => {
    const out = await addSite(who, { name, colonyId, lat: at.lat, lng: at.lng, directions: extra.directions ?? null, notes: extra.notes ?? null });
    if (out.kind !== "created") throw new Error(`seed site ${name}`);
    return out.id;
  };
  s1 = await site(staffId, S1_NAME, c1, S1_POS, { directions: S1_DIRECTIONS });
  s1r = await site(staffId, `Retired1 ${RUN}`, c1, { lat: 37.44511, lng: 24.94011 });
  await retireSite(staffId, s1r, await stampOf(s1r), "closed");
  // Zoe's own site, written by her (her name is in its history).
  s2 = await site(zoe.id, S2_NAME, c2, S2_POS, { directions: S2_DIRECTIONS, notes: S2_NOTES });
  s0 = await site(staffId, S0_NAME, null, S0_POS);
  // A site that was colony 2's (made and moved by Zoe) and then joined colony 1.
  sJ = await site(zoe.id, JOINED_OLD_NAME, c2, JOINED_OLD_POS);
  await pool.query("update feeding_sites set name = $1, lat = $2, lng = $3 where id = $4", [
    JOINED_NAME,
    JOINED_POS.lat,
    JOINED_POS.lng,
    sJ,
  ]);
  await changeSiteColony(staffId, sJ, await stampOf(sJ), c1);

  catA = await seedCat(c1);
  catB = await seedCat(c2);
  await pool.query("update cats set name = $1 where id = $2", [`CatB ${RUN}`, catB.id]);
  catMoved = await seedCat(c1);
  await putInColony(catMoved.id, c2); // moved from Eleni's colony to Zoe's
  sightA = await sighting(catA.id, catA.photoId, { lat: 37.44701, lng: 24.94321 });
  sightB = await sighting(catB.id, catB.photoId, S2_POS);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  // Our server fetches the map's pictures; no test reaches the internet.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 503 }));
});

afterAll(async () => {
  fetchSpy?.mockRestore();
  delete process.env["TEAM_SESSION_KEYS"];
  for (const p of [eleni, zoe]) if (p) await removeTestPerson(p.email).catch(() => undefined);
  await pool.end();
});

type Mode = "json" | "browser";

function get(path: string, cookie: string, mode: Mode = "browser") {
  const t = request(app).get(path).set("Cookie", cookie);
  return mode === "json" ? t.set("Accept", "application/json") : t.set("Sec-Fetch-Mode", "navigate");
}
function post(path: string, body: Record<string, string>, cookie: string, mode: Mode = "browser") {
  const t = request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie);
  return mode === "json" ? t.set("Accept", "application/json").send(body) : t.type("form").send(body);
}

const ISLAND = viewAround(ISLAND_CENTRE, START_ZOOM);
const moveBody = { vz: String(ISLAND.z), vx: String(ISLAND.x), vy: String(ISLAND.y), go: "in" };

/** Every page variant a cat guardian can open (spec §7.3's table), each as a request. */
const guardianPages = (): { label: string; send: (cookie: string, mode: Mode) => request.Test }[] => [
  { label: "Feeding sites", send: (c, m) => get("/api/team/sites", c, m) },
  { label: "Feeding sites, Show retired", send: (c, m) => get("/api/team/sites?retired=1", c, m) },
  { label: "Feeding sites, zoomed", send: (c, m) => post("/api/team/sites/map", moveBody, c, m) },
  { label: "Feeding sites, an area", send: (c, m) => post("/api/team/sites/map", { ...moveBody, go: "", area: "kini" }, c, m) },
  { label: "her site", send: (c, m) => get(`/api/team/sites/${s1}`, c, m) },
  { label: "the site that joined her colony", send: (c, m) => get(`/api/team/sites/${sJ}`, c, m) },
  { label: "her retired site", send: (c, m) => get(`/api/team/sites/${s1r}`, c, m) },
  { label: "colony 2's site", send: (c, m) => get(`/api/team/sites/${s2}`, c, m) },
  { label: "a site in no colony", send: (c, m) => get(`/api/team/sites/${s0}`, c, m) },
  { label: "Colonies", send: (c, m) => get("/api/team/colonies", c, m) },
  { label: "Colonies, search by colony 2's name", send: (c, m) => get(`/api/team/colonies?q=${encodeURIComponent("Kini")}`, c, m) },
  { label: "Colonies, search by colony 2's old name", send: (c, m) => get(`/api/team/colonies?q=${encodeURIComponent("Oldname")}`, c, m) },
  { label: "Colonies, search by colony 2's guardian", send: (c, m) => get(`/api/team/colonies?q=${encodeURIComponent("Zoe")}`, c, m) },
  { label: "her colony", send: (c, m) => get(`/api/team/colonies/${c1}`, c, m) },
  { label: "colony 2", send: (c, m) => get(`/api/team/colonies/${c2}`, c, m) },
  { label: "Add cats, search for colony 2's cat", send: (c, m) => get(`/api/team/colonies/${c1}/cats?q=${encodeURIComponent(`CatB ${RUN}`)}`, c, m) },
  { label: "Add cats, search by number", send: (c, m) => get(`/api/team/colonies/${c1}/cats?q=SYR-${String(catB.id).padStart(4, "0")}`, c, m) },
  { label: "Add cats, colony 2", send: (c, m) => get(`/api/team/colonies/${c2}/cats?q=vt`, c, m) },
  { label: "Make a feeding site here, her cat", send: (c, m) => post("/api/team/sites/from-sighting", { sightingId: String(sightA) }, c, m) },
  { label: "Show on our map, her cat", send: (c, m) => post("/api/team/sites/map-at-sighting", { sightingId: String(sightA) }, c, m) },
  { label: "Make a feeding site here, colony 2's cat", send: (c, m) => post("/api/team/sites/from-sighting", { sightingId: String(sightB) }, c, m) },
  { label: "Show on our map, colony 2's cat", send: (c, m) => post("/api/team/sites/map-at-sighting", { sightingId: String(sightB) }, c, m) },
  { label: "a map picture", send: (c, m) => get("/api/team/map-tiles/not-a-token", c, m) },
];

const ATTR = /\s(href|action|src)="([^"]*)"/g;

/** K13: no href, action, src or redirect holds a coordinate or a z/x/y. */
function expectNoPositionInAddresses(where: string, html: string, location?: string) {
  const values = [...html.matchAll(ATTR)].map((m) => m[2]!);
  if (location) values.push(location);
  for (const v of values) {
    expect(v, `${where}: ${v}`).not.toMatch(/\d+\.\d+/);
    expect(v, `${where}: ${v}`).not.toMatch(/\d+[/-]\d+[/-]\d+/);
    expect(v, `${where}: ${v}`).not.toMatch(/[?&](lat|lng|lon|z|x|y|vz|vx|vy)=/i);
  }
}

/** The text a browser would show, entities decoded. */
const decoded = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

describe("test 21 (seeing): colony 2 appears on no page a guardian of colony 1 can open", () => {
  for (const mode of ["browser", "json"] as const) {
    it(`no name, guardian, note, site, old name, person or position of colony 2 (${mode})`, async () => {
      for (const page of guardianPages()) {
        const res = await page.send(eleni.cookie, mode);
        const text = decoded(res.text ?? "");
        expect(res.status, `${page.label}: ${res.status}`).toBeLessThan(500);
        for (const s of FORBIDDEN) {
          expect(text.toLowerCase().includes(s.toLowerCase()), `${page.label} (${mode}) shows "${s}"`).toBe(false);
        }
        for (const p of FORBIDDEN_POSITIONS) {
          expect(text.includes(p), `${page.label} (${mode}) shows position ${p}`).toBe(false);
        }
        for (const href of [`/api/team/colonies/${c2}`, `/api/team/sites/${s2}`, `/api/team/sites/${s0}`]) {
          expect(text.includes(`${href}"`), `${page.label} links ${href}`).toBe(false);
        }
        expect(text, `${page.label}: a map company`).not.toMatch(MAP_COMPANIES);
        if (mode === "browser") expectNoPositionInAddresses(page.label, res.text ?? "", res.headers["location"]);
        // Nothing about a colony that isn't hers by number either (JSON ids).
        if (mode === "json" && res.headers["content-type"]?.includes("json")) {
          expect(res.text, `${page.label}: colony 2's id`).not.toMatch(
            new RegExp(`"colonyId":${c2}\\b|"colony":\\{"id":${c2}\\b|"movedTo":"`),
          );
        }
      }
    });
  }

  it("the same pages show the team every one of those strings (so 'absent' means something)", async () => {
    const team = [
      (await get("/api/team/sites?retired=1", staffCookie)).text,
      (await get(`/api/team/colonies?q=${encodeURIComponent("Oldname")}`, staffCookie)).text,
      (await get(`/api/team/colonies/${c2}`, staffCookie)).text,
      (await get(`/api/team/sites/${s2}`, staffCookie)).text,
      (await get(`/api/team/sites/${sJ}`, staffCookie)).text,
      (await get(`/api/team/colonies/${c1}`, staffCookie)).text,
      (await get(`/api/team/colonies/${c1}/cats?q=${encodeURIComponent(`CatB ${RUN}`)}`, staffCookie)).text,
    ].map(decoded).join("\n");
    for (const s of [C2_NAME, C2_OLD, C2_GUARDIAN, C2_NOTES, ZOE_PERSON, S2_NAME, S2_DIRECTIONS, S2_NOTES, S0_NAME, JOINED_OLD_NAME]) {
      expect(team, s).toContain(s);
    }
  });
});

describe("what a guardian does see: her own colonies, in full", () => {
  it("the count line counts her colonies' sites only", async () => {
    const html = (await get("/api/team/sites", eleni.cookie)).text;
    expect(html).toContain("<strong>3 sites: 0 public, 2 private, 1 retired</strong>");
    const json = (await get("/api/team/sites", eleni.cookie, "json")).body;
    expect(json.counts).toEqual({ total: 3, public: 0, private: 2, retired: 1 });
  });

  it("the list and map hold her sites; Show retired adds her retired one", async () => {
    const plain = (await get("/api/team/sites", eleni.cookie, "json")).body.sites.map((s: { id: number }) => s.id);
    expect(plain.sort()).toEqual([s1, sJ].sort());
    const all = (await get("/api/team/sites?retired=1", eleni.cookie, "json")).body.sites.map((s: { id: number }) => s.id);
    expect(all.sort()).toEqual([s1, s1r, sJ].sort());
    const html = decoded((await get("/api/team/sites", eleni.cookie)).text);
    expect(html).toContain(S1_NAME);
    expect(html).toContain(`href="/api/team/sites/${s1}"`);
  });

  it("her menu is Colonies and Feeding sites only, and there is no 'Add a site' (PR 4.2)", async () => {
    const html = (await get("/api/team/sites", eleni.cookie)).text;
    expect(html).toContain('href="/api/team/colonies"');
    expect(html).not.toContain("Welfare queue");
    expect(html).not.toContain('href="/api/team/cats"');
    expect(html).not.toContain('href="/api/team/likely"');
    expect(html).not.toContain('action="/api/team/sites/new"');
  });

  it("Recently changed: her sites only, and names outside her colonies read 'Syros Cats'", async () => {
    const html = decoded((await get("/api/team/sites", eleni.cookie)).text);
    const strip = html.slice(html.indexOf("Recently changed"), html.indexOf('class="map"'));
    expect(strip).toContain(S1_NAME);
    expect(strip).not.toContain("Susan");
    expect(strip).toContain("by Syros Cats");
  });

  it("her site page: exact position, how to find it, history with positions; no actions", async () => {
    const html = decoded((await get(`/api/team/sites/${s1}`, eleni.cookie)).text);
    expect(html).toContain(`${S1_POS.lat.toFixed(5)}, ${S1_POS.lng.toFixed(5)}`);
    expect(html).toContain(S1_DIRECTIONS);
    expect(html).toContain("Site created");
    expect(html).not.toContain('data-actions="site"');
    expect(html).not.toContain("Change colony");
    // K7: the "Ask the team to make this public" button is not drawn yet.
    expect(html).not.toMatch(/make this public/i);
  });

  it("a site that joined her colony shows its history only from the day it joined", async () => {
    const view = (await get(`/api/team/sites/${sJ}`, eleni.cookie, "json")).body;
    expect(view.history.map((e: { kind: string }) => e.kind)).toEqual(["colony_changed"]);
    expect(view.history[0].before).toBeNull();
    const team = (await get(`/api/team/sites/${sJ}`, staffCookie, "json")).body;
    expect(team.history.map((e: { kind: string }) => e.kind)).toEqual(["colony_changed", "created"]);
  });

  it("her colony: name, its sites, its cats (not linked to the team's cat page), history", async () => {
    const html = decoded((await get(`/api/team/colonies/${c1}`, eleni.cookie)).text);
    expect(html).toContain(C1_NAME);
    expect(html).toContain(`href="/api/team/sites/${s1}"`);
    expect(html).not.toContain(`href="/api/team/cats/`);
    // The cat that moved to colony 2 "moved to another colony", unnamed.
    expect(html).toContain("Cat moved to another colony");
    expect(html).toContain("→ another colony");
    // None of the team's actions (PR 4.2).
    expect(html).not.toContain("Change this colony");
    expect(html).not.toContain("Add a feeding site to this colony");
    expect(html).not.toContain("Take out of this colony");
  });

  it("Colonies and its search: her colony only, by any name", async () => {
    const all = (await get("/api/team/colonies", eleni.cookie, "json")).body.colonies.map((c: { id: number }) => c.id);
    expect(all).toEqual([c1]);
    const byName = (await get(`/api/team/colonies?q=Vaporia`, eleni.cookie, "json")).body.colonies;
    expect(byName.map((c: { id: number }) => c.id)).toEqual([c1]);
    for (const q of ["Kini", "Oldname", "Zoe", XQ]) {
      expect((await get(`/api/team/colonies?q=${encodeURIComponent(q)}`, eleni.cookie, "json")).body.colonies, q).toEqual([]);
    }
    expect((await get("/api/team/colonies", eleni.cookie)).text).not.toContain("Create a colony");
  });

  it("Add cats: a cat in another colony is 'In another colony', with only what the public sees", async () => {
    const res = await get(`/api/team/colonies/${c1}/cats?q=${encodeURIComponent(`CatB ${RUN}`)}`, eleni.cookie, "json");
    expect(res.status).toBe(200);
    const [hit] = res.body.results;
    expect(hit).toMatchObject({ id: catB.id, colony: null, elsewhere: true });
    // The public photo address, never the team's photo route.
    expect(hit.thumbnailUrl).toBe(`/api/photos/${catB.photoPublicId}`);
    const html = decoded((await get(`/api/team/colonies/${c1}/cats?q=${encodeURIComponent(`CatB ${RUN}`)}`, eleni.cookie)).text);
    expect(html).toContain("In another colony");
    // Adding is the team's until PR 4.2: no tick boxes, no button.
    expect(html).not.toContain('name="catIds"');
    expect(html).not.toContain("Add the ticked cats");
    const own = (await get(`/api/team/colonies/${c1}/cats?q=SYR-${String(catA.id).padStart(4, "0")}`, eleni.cookie, "json")).body.results[0];
    expect(own).toMatchObject({ id: catA.id, colony: { id: c1, name: C1_NAME }, elsewhere: false });
    expect(own.thumbnailUrl).toBe(`/api/team/photos/${catA.photoPublicId}`);
  });

  it("the team still sees the other colony's name in Add cats, with tick boxes", async () => {
    const res = await get(`/api/team/colonies/${c1}/cats?q=${encodeURIComponent(`CatB ${RUN}`)}`, staffCookie, "json");
    expect(res.body.results[0]).toMatchObject({ colony: { id: c2, name: C2_NAME }, elsewhere: false });
  });

  it("Make a feeding site here on her cat's sighting: the confirmation, with her colonies only", async () => {
    const res = await post("/api/team/sites/from-sighting", { sightingId: String(sightA) }, eleni.cookie);
    expect(res.status).toBe(200);
    const options = [...res.text.matchAll(/<option value="(\d*)"/g)].map((m) => m[1]);
    expect(options).toEqual(["", String(c1)]);
    expect(res.text).toContain(`<option value="${c1}" selected>`);
  });

  it("the colony pick lists hold her colonies only", async () => {
    const mine = await colonyOptions(visibleColonyIds({ scopes: [{ role: "guardian", colonyId: c1 }] }));
    expect(mine.map((c) => c.id)).toEqual([c1]);
    const team = await colonyOptions(visibleColonyIds(staffPerson()));
    expect(team.map((c) => c.id)).toEqual(expect.arrayContaining([c1, c2]));
  });

  it("the name-clash message names no colony she doesn't hold: 'That name can't be used', no link", () => {
    const html = decoded(renderNameTaken("Eleni", null, { href: "/api/team/colonies", label: "Back" }, { island: false }));
    expect(html).toContain("That name can't be used.");
    expect(html).not.toContain("/api/team/colonies/");
    expect(html).not.toContain("Another colony");
  });
});

describe("another colony's id answers exactly like an id that doesn't exist, for every method", () => {
  interface Layer {
    route?: { path: string; methods: Record<string, boolean> };
    handle?: { stack?: Layer[] };
  }
  function walk(stack: Layer[], out: string[]): void {
    for (const layer of stack) {
      if (layer.route) for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${layer.route.path}`);
      else if (layer.handle?.stack) walk(layer.handle.stack, out);
    }
  }
  const routes = () => {
    const all: string[] = [];
    walk((router as unknown as { stack: Layer[] }).stack, all);
    return [...new Set(all)].filter((r) => /^\w+ \/team\/(sites|colonies)\/:id/.test(r));
  };

  it("finds the id routes (so an empty walk fails)", () => {
    expect(routes().length).toBeGreaterThanOrEqual(12);
  });

  for (const mode of ["browser", "json"] as const) {
    it(`same status, same body, same length (${mode})`, async () => {
      for (const route of routes()) {
        const [method, path] = route.split(" ") as [string, string];
        const isSites = path.startsWith("/team/sites/");
        const other = isSites ? [s2, s0] : [c2];
        const send = (id: number) => {
          const url = `/api${path.replace(":id", String(id))}`;
          // A query or form naming HER colony changes nothing (test 12).
          return method === "GET"
            ? get(`${url}?colony=${c1}&colonyId=${c1}&q=vt`, eleni.cookie, mode)
            : post(url, { colonyId: String(c1), updatedAt: "2026-01-01 00:00:00.000000", reason: "x", name: "x" }, eleni.cookie, mode);
        };
        const none = await send(NO_SUCH);
        for (const id of other) {
          const res = await send(id);
          expect([res.status, res.text.length, res.text], `${route} for ${id}`).toEqual([none.status, none.text.length, none.text]);
        }
      }
    });
  }

  it("the sighting buttons: colony 2's cat's sighting answers like a sighting that doesn't exist", async () => {
    for (const path of ["/api/team/sites/from-sighting", "/api/team/sites/map-at-sighting"]) {
      for (const mode of ["browser", "json"] as const) {
        const none = await post(path, { sightingId: String(NO_SUCH) }, eleni.cookie, mode);
        // Naming her colony in the form changes nothing: the target is the sighting's cat's.
        const other = await post(path, { sightingId: String(sightB), colonyId: String(c1) }, eleni.cookie, mode);
        expect([other.status, other.text], `${path} ${mode}`).toEqual([none.status, none.text]);
        expect(other.status).toBe(403);
      }
    }
  });
});

describe("test 12 (part): every placed check takes its colony from the record, never the request", () => {
  it("Add cats on colony 2 is not found, whatever the request says", async () => {
    for (const q of [`?colony=${c1}`, `?colonyId=${c1}`, `?colonyId[]=${c1}`]) {
      const res = await get(`/api/team/colonies/${c2}/cats${q}`, eleni.cookie, "json");
      expect([res.status, res.text], q).toEqual([404, '{"error":"Not found"}']);
    }
  });

  it("from-sighting checks the sighting's CAT's colony, not the colony a site would go into", async () => {
    // Her cat's sighting passes even when the form names colony 2.
    const ok = await post("/api/team/sites/from-sighting", { sightingId: String(sightA), colonyId: String(c2) }, eleni.cookie, "json");
    expect(ok.status).toBe(200);
    expect(ok.body.colonyId).toBe(c1);
  });

  it("the writes stay the team's (PR 4.2): a guardian is refused on her own site and colony too", async () => {
    const stamp = await stampOf(s1);
    for (const [path, body] of [
      [`/api/team/sites/${s1}`, { updatedAt: stamp, name: "x" }],
      [`/api/team/sites/${s1}/retire`, { updatedAt: stamp, reason: "x" }],
      [`/api/team/colonies/${c1}`, { notes: "x" }],
      [`/api/team/colonies/${c1}/cats`, { catIds: String(catA.id) }],
      ["/api/team/sites", { name: "x", lat: "37.44", lng: "24.94", colonyId: String(c1) }],
      ["/api/team/colonies", { name: `new ${RUN}` }],
    ] as const) {
      const res = await post(path, body, eleni.cookie, "json");
      expect([res.status, res.text], path).toEqual([403, '{"error":"forbidden"}']);
    }
  });
});

describe("sitesForPerson: one query, her sites with exact positions and how to find them", () => {
  it("a guardian gets her colonies' live sites only", async () => {
    const mine = await sitesForPerson({ scopes: [{ role: "guardian", colonyId: c1 }] });
    expect(mine.map((s) => s.id).sort()).toEqual([s1, sJ].sort());
    expect(mine.find((s) => s.id === s1)).toEqual({
      id: s1,
      name: S1_NAME,
      lat: S1_POS.lat,
      lng: S1_POS.lng,
      directions: S1_DIRECTIONS,
      colony: { id: c1, name: C1_NAME },
    });
  });

  it("the team gets every colony's, and onlyColonies can narrow it but never widen it", async () => {
    const team = await sitesForPerson(staffPerson());
    expect(team.map((s) => s.id)).toEqual(expect.arrayContaining([s1, s2, sJ]));
    expect(team.map((s) => s.id)).not.toContain(s0); // in no colony: nobody's to carry
    expect((await sitesForPerson(staffPerson(), [c2])).map((s) => s.id)).toEqual([s2]);
    expect(await sitesForPerson({ scopes: [{ role: "guardian", colonyId: c1 }] }, [c2])).toEqual([]);
  });
});

describe("isIslandWide: the gate for anything only the team may see (SYC-362)", () => {
  it("is true for the team and false for a cat guardian, however many colonies she holds", () => {
    expect(isIslandWide(staffPerson())).toBe(true);
    expect(isIslandWide({ scopes: [{ role: "guardian", colonyId: c1 }, { role: "guardian", colonyId: c2 }] })).toBe(false);
    expect(visibleColonyIds({ scopes: [] }).ids).toEqual([]);
  });
});
