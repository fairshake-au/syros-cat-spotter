import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import request from "supertest";
import { addPerson, db, observationsTable, pool, sightingsTable } from "@workspace/db";
import app from "../app";
import { sessionCookieFor, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { fr } from "../lib/teamPages/strings/fr";
import { createColony } from "../lib/teamColonies";
import { addSite } from "../lib/teamSiteWrites";
import { guardianOn, newColony, seedCat, type Signed } from "../test/roleKit";
import { formatDate } from "../lib/teamPages/strings";
import { removeTestPerson } from "../test/removeTestPerson";
import { el } from "../lib/teamPages/strings/el";
import { en } from "../lib/teamPages/strings/en";

// SYC-209 PR 4.1, spec Decision 9 and test 19 (guardian pages): a cat
// guardian reads the Colonies and Feeding sites pages in her own language;
// the team keeps reading English. Greek and French aren't live until Johnny
// signs them off (SYC-283), so this file switches every language on, as
// SYC-291's one-line change will.

vi.mock("../lib/teamPages/strings", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/teamPages/strings")>();
  const ALL = ["en", "el", "fr"] as const;
  return {
    ...real,
    LIVE_LANGUAGES: ALL,
    pageLanguage: (r: string | null | undefined, live: readonly string[] = ALL) =>
      real.pageLanguage(r, live as never),
    tr: (r: string | null | undefined, k: never, v?: Record<string, string>, live: readonly string[] = ALL) =>
      real.tr(r, k, v, live as never),
    formatDate: (r: string | null | undefined, at: Date, live: readonly string[] = ALL) =>
      real.formatDate(r, at, live as never),
  };
});

const RUN = randomBytes(3).toString("hex");
const KEY = "vitest-guardianlang-key-0123456789abcdef-0123";
let eleni: Signed;
let staffCookie: string;
let colony: number;
let site: number;
let fetchSpy: MockInstance<typeof fetch>;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  const staff = await addPerson({ email: `vitest-glang-staff-${RUN}@example.com`, name: "Susan", addedBy: "cli:vitest" });
  await pool.query("update people set language = 'el' where id = $1", [staff.id]);
  staffCookie = sessionCookieFor(staff.id);
  const made = await createColony(staff.id, { name: `Vaporia ${RUN}`, guardianName: "Eleni", notes: null });
  if (made.kind !== "created") throw new Error("seed");
  colony = made.id;
  const s = await addSite(staff.id, { name: `Site ${RUN}`, colonyId: colony, lat: 37.4461, lng: 24.9441, directions: null, notes: null });
  if (s.kind !== "created") throw new Error("seed");
  site = s.id;
  eleni = await guardianOn(`glang-${RUN}`, [colony]);
  await pool.query("update people set language = 'el' where id = $1", [eleni.id]);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 503 }));
});

afterAll(async () => {
  fetchSpy?.mockRestore();
  delete process.env["TEAM_SESSION_KEYS"];
  if (eleni) await removeTestPerson(eleni.email).catch(() => undefined);
  await pool.end();
});

const page = (path: string, cookie: string) =>
  request(app).get(path).set("Cookie", cookie).set("Sec-Fetch-Mode", "navigate");

const unescape = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("a cat guardian reads her pages in her language; the team reads English", () => {
  const pages = () => [
    ["/api/team/sites", el["sites.title"], en["sites.title"], el["sites.recentTitle"]],
    [`/api/team/sites/${site}`, el["site.historyTitle"], en["site.historyTitle"], el["site.position"]],
    ["/api/team/colonies", el["colonies.title"], en["colonies.title"], el["colonies.searchLabel"]],
    [`/api/team/colonies/${colony}`, el["colony.historyTitle"], en["colony.historyTitle"], el["colonies.guardian"]],
    [`/api/team/colonies/${colony}/cats`, el["add.searchLabel"], en["add.searchLabel"], el["add.prompt"]],
  ] as const;

  it("Greek for a guardian whose language is Greek, with her menu in Greek", async () => {
    for (const [path, greek, , more] of pages()) {
      const res = await page(path, eleni.cookie);
      expect(res.status, path).toBe(200);
      const text = unescape(res.text);
      expect(text, path).toContain('<html lang="el">');
      expect(text, path).toContain(greek);
      expect(text, path).toContain(more);
      expect(text, path).toContain(el["nav.sites"]);
    }
  });

  it("English for a team member, even one whose saved language is Greek (spec Decision 9)", async () => {
    for (const [path, , english] of pages()) {
      const res = await page(path, staffCookie);
      expect(res.status, path).toBe(200);
      const text = unescape(res.text);
      expect(text, path).toContain('<html lang="en">');
      expect(text, path).toContain(english);
    }
  });

  it("the map's buttons and labels follow the page", async () => {
    const text = unescape((await page("/api/team/sites", eleni.cookie)).text);
    expect(text).toContain(el["map.zoomIn"]);
    expect(text).toContain(el["map.attribLink"]);
    expect(text).not.toContain(">Zoom in<");
  });

  it("no English word the catalogue covers is left on her pages", async () => {
    // Every English sentence of the catalogue that differs from its Greek one.
    const english = Object.entries(en)
      .filter(([k, v]) => v.length > 12 && el[k as keyof typeof el] !== v)
      .map(([, v]) => v);
    for (const [path] of pages()) {
      // The style sheet's comments are not words on the page.
      const text = unescape((await page(path, eleni.cookie)).text).replace(/<style>[\s\S]*?<\/style>/, "");
      for (const s of english) expect(text.includes(s), `${path}: "${s}"`).toBe(false);
    }
  });
});

describe("the error pages she can reach are in her language too (review F2)", () => {
  const formPost = (path: string, body: Record<string, string>, cookie: string) =>
    request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).type("form").send(body);

  it("a map move that can't be read (POST /sites/map, 400)", async () => {
    const res = await formPost("/api/team/sites/map", { vz: "nonsense" }, eleni.cookie);
    expect(res.status).toBe(400);
    const text = unescape(res.text);
    expect(text).toContain(el["sites.moveNote"]);
    expect(text).not.toContain(en["sites.moveNote"]);
    // The team's is in English.
    const team = unescape((await formPost("/api/team/sites/map", { vz: "nonsense" }, staffCookie)).text);
    expect(team).toContain(en["sites.moveNote"]);
  });

  it("a site or colony that isn't there (404)", async () => {
    for (const [path, greek] of [
      ["/api/team/sites/999999999", el["site.noSuchBody"]],
      ["/api/team/colonies/999999999", el["none.body"]],
      ["/api/team/colonies/999999999/cats", el["none.body"]],
    ] as const) {
      const res = await page(path, eleni.cookie);
      expect(res.status, path).toBe(404);
      expect(unescape(res.text), path).toContain(greek);
    }
  });
});

describe("her colony page and the Colonies list (browser check)", () => {
  it("her notes are just 'Notes'; the team's stay 'Team-only notes'", async () => {
    const hers = unescape((await page(`/api/team/colonies/${colony}`, eleni.cookie)).text);
    expect(hers).toContain(`<h2>${el["colony.notesOwn"]}</h2>`);
    expect(hers).not.toContain(el["colony.notes"]);
    const team = unescape((await page(`/api/team/colonies/${colony}`, staffCookie)).text);
    expect(team).toContain("<h2>Team-only notes</h2>");
  });

  it("counts are singular for one, in every language", async () => {
    const hers = unescape((await page("/api/team/colonies", eleni.cookie)).text);
    expect(hers).toContain(`${el["count.colonySite"].replace("{n}", "1")} · ${el["count.colonyCats"].replace("{n}", "0")}`);
    const team = unescape((await page("/api/team/colonies", staffCookie)).text);
    expect(team).toContain("1 feeding site · 0 cats");
    expect(team).not.toContain("1 feeding sites");
    expect(fr["count.colonyCat"].replace("{n}", "1")).toBe("1 chat");
  });
});

describe("SYC-619 §7.2: her colony's cat rows are in her language, the date only", () => {
  it("Greek mark words and the Greek date for a guardian whose language is Greek; English for the team", async () => {
    const own = await newColony(`glang-rows-${RUN}`);
    const cat = await seedCat(own);
    const never = await seedCat(own);
    await db.insert(observationsTable).values({
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: false },
      deviceId: `vt-glang-${RUN}`,
      roleAtTime: "staff",
      observedAt: new Date("2026-09-20T10:00:00Z"),
    });
    await db.insert(sightingsTable).values({
      catId: cat.id,
      deviceId: `vt-glang-${RUN}`,
      photoId: cat.photoId,
      lat: 37.4402,
      lng: 24.9381,
      status: "resolved",
      createdAt: new Date("2026-10-03T09:00:00Z"),
    });
    const g = await guardianOn(`glang-rows-${RUN}`, [own]);
    try {
      await pool.query("update people set language = 'el' where id = $1", [g.id]);
      const hers = unescape((await page(`/api/team/colonies/${own}`, g.cookie)).text);
      const list = /<ul class="cats">[\s\S]*?<\/ul>/.exec(hers)?.[0] ?? "";
      expect(list).toContain(el["colonies.mark.notSterilised"]);
      expect(list).toContain(el["colonies.mark.notKnown"]);
      expect(list).toContain(el["gcat.lastSeen"].replace("{date}", formatDate("el", new Date("2026-10-03T12:00:00Z"))));
      expect(list).toContain(el["gcat.neverSeen"]);
      for (const english of [en["colonies.mark.notSterilised"], en["gcat.neverSeen"], "Last seen", "Not known"]) {
        expect(list, english).not.toContain(english);
      }
      const team = unescape((await page(`/api/team/colonies/${own}`, staffCookie)).text);
      expect(team).toContain(">Not sterilised</span>");
      expect(team).toContain("Never seen since first recorded");
    } finally {
      await removeTestPerson(g.email).catch(() => undefined);
    }
  });
});
