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
    const at = PAGES.map(([name, href]) => res.text.indexOf(`<a href="${href}">${name}</a>`));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it.each(PAGES)("%s underlines Settings and goes back to it", async (_name, href) => {
    const res = await get(href, team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`<a class="here" href="${PATH}" aria-current="page">Settings</a>`);
    expect(res.text).toContain(`<p class="back"><a href="${PATH}">← Settings</a></p>`);
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
