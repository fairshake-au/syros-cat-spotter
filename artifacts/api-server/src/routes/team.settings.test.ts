import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";

// SYC-694: the Settings tab. Its page lists Areas, Vet settings and App
// switches; each of those underlines Settings and goes back to it.

const SESSION_KEY = "vitest-settings-key-0123456789abcdef-0123456789";
const PATH = "/api/team/settings";
const PAGES = [
  ["Areas", "/api/team/areas"],
  ["Vet settings", "/api/team/vet-settings"],
  ["App switches", "/api/team/app-switches"],
] as const;

let team: Signed;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = SESSION_KEY;
  team = await signedPerson("settings-team", ["staff"]);
  guardian = await guardianOn("settings-guardian", [await newColony("settings")]);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = SESSION_KEY;
});

afterAll(async () => {
  await pool.end();
});

const get = (path: string, cookie: string) => request(app).get(path).set("Cookie", cookie).set("Accept", "text/html");

describe("the Settings page (SYC-694)", () => {
  it("lists the three settings pages, in order, with Settings underlined", async () => {
    const res = await get(PATH, team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>Settings</title>");
    expect(res.text).toContain(`<a class="here" href="${PATH}" aria-current="page">Settings</a>`);
    const at = PAGES.map(([name, href]) => res.text.indexOf(`<a href="${href}"><span class="name">${name}</span>`));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("makes each whole card the link, its note included (SYC-698)", async () => {
    const res = await get(PATH, team.cookie);
    expect(res.text).toContain(
      '<a href="/api/team/areas"><span class="name">Areas</span><span class="note">The place names shown on cats and in the Cats list filters.</span></a>',
    );
    expect(res.text).toContain("How the app and dashboard behave. Each page says what it changes.");
    expect(res.text).toContain("Changes are live for everyone.");
    expect(res.text.match(/<li id="[a-z-]+-link"><a href="[^"]+"><span class="name">[^<]+<\/span><span class="note">[^<]+<\/span><\/a><\/li>/g)).toHaveLength(3);
  });

  it.each(PAGES)("%s underlines Settings and goes back to it", async (_name, href) => {
    const res = await get(href, team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`<a class="here" href="${PATH}" aria-current="page">Settings</a>`);
    expect(res.text).toContain(`<p class="back"><a href="${PATH}">← Settings</a></p>`);
  });

  it.each(["/api/team/my", "/api/team/my/colonies"])("a cat guardian's own page %s has no Settings link (SYC-698)", async (path) => {
    const res = await get(path, guardian.cookie);
    expect(res.status).toBe(200);
    // Her own menu is drawn (both her links), so the absence below means something.
    const nav = res.text.slice(res.text.indexOf("<nav"), res.text.indexOf("</nav>"));
    expect(nav).toContain('href="/api/team/my/colonies"');
    expect(nav).toContain('href="/api/team/my"');
    expect(res.text).not.toContain(PATH);
    expect(res.text).not.toContain(">Settings<");
  });

  it("a cat guardian gets 403", async () => {
    const res = await request(app).get(PATH).set("Cookie", guardian.cookie);
    expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
  });

  it("signed out, it refuses", async () => {
    const res = await request(app).get(PATH).set("Accept", "application/json");
    expect(res.status).toBe(401);
  });
});
