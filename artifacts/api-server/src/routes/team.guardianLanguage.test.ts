import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import request from "supertest";
import { addPerson, pool } from "@workspace/db";
import app from "../app";
import { sessionCookieFor } from "../lib/teamAuth/__fixtures__/queueKit";
import { createColony } from "../lib/teamColonies";
import { addSite } from "../lib/teamSiteWrites";
import { guardianOn, type Signed } from "../test/roleKit";
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
