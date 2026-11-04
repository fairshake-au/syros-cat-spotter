import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, markLeft, pool, sightingMatchesTable } from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

const settings = vi.hoisted(() => ({ launchDate: null as string | null }));
vi.mock("../lib/appSettings", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/appSettings")>();
  return { ...real, getAppSettings: async () => ({ ...(await real.getAppSettings()), launchDate: settings.launchDate }) };
});

import app from "../app";
import { moveKit, tag } from "../test/moveKit";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { renderMatchesToCheckPage } from "../lib/teamPages/matchesToCheckPage";

// SYC-795 Task 10 (launch measures spec §4.6): the Matches to check page,
// its "Looks right" form, the Home tile, and the "Different cat" link. Every
// sighting is dated 2041 and the launch date mocked to 2041-03-01, so rows
// other test files make can't appear. Cat names are letters only (SYC-709).

const KEY = "vitest-matchcheck-key-0123456789abcdef-0123456789";
const kit = moveKit("VitestMatchPage");
const LAUNCH = "2041-03-01";
let staff: Signed;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  settings.launchDate = LAUNCH;
  await kit.cleanup();
  staff = await signedPerson(`matchchecker${tag()}`, ["staff"]);
  guardian = await guardianOn(`matchguard${tag()}`, [await newColony("mcg")]);
});
afterAll(async () => {
  await kit.cleanup();
  await markLeft(staff.email, "cli:vitest");
  await markLeft(guardian.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const get = (url: string, cookie: string | null = staff.cookie) => {
  const r = request(app).get(url).set("Accept", "text/html");
  return cookie ? r.set("Cookie", cookie) : r;
};
const post = (url: string, cookie: string | null = staff.cookie, origin: string | null = TEAM_ORIGIN) => {
  let r = request(app).post(url).type("form");
  if (origin) r = r.set("Origin", origin);
  return (cookie ? r.set("Cookie", cookie) : r).send({});
};

async function suggested(cat: number, createdAt: Date, rank = 1): Promise<number> {
  const s = await kit.sighting(cat, kit.device(), createdAt);
  await db.insert(sightingMatchesTable).values({
    sightingId: s.id,
    comparedCatIds: [cat],
    suggested: [],
    matcherFailed: false,
    matchedAt: createdAt,
    choice: "suggested",
    chosenCatId: cat,
    suggestedRank: rank,
    chosenAt: createdAt,
    noCatInAnyPhoto: false,
  });
  return s.id;
}
const at = (iso: string) => new Date(iso);
/** The row of one sighting out of the whole page. */
const rowOf = (html: string, id: number) => {
  const start = html.indexOf(`id="m-${id}"`);
  expect(start, "the sighting is on the page").toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start));
};

describe("who may open the list", () => {
  it("refuses anyone signed out and a cat guardian, and the Looks right form too", async () => {
    const cat = await kit.cat();
    const s = await suggested(cat, at("2041-03-02T10:00:00Z"));
    expect((await get("/api/team/matches-to-check", null)).status).toBe(401);
    expect((await get("/api/team/matches-to-check", guardian.cookie)).status).toBe(403);
    expect((await post(`/api/team/matches-to-check/${s}/looks-right`, guardian.cookie)).status).toBe(403);
    expect((await db.select().from(sightingMatchesTable).where(eq(sightingMatchesTable.sightingId, s)))[0]!.teamAction).toBeNull();
  });

  it("Home shows the tile with the count for someone with the permission; a cat guardian gets no Home at all", async () => {
    expect((await get("/api/team/home", guardian.cookie)).status).toBe(403);
    const cat = await kit.cat();
    await suggested(cat, at("2041-03-03T10:00:00Z"));
    const home = await get("/api/team/home");
    expect(home.status).toBe(200);
    expect(home.text).toMatch(/class="htile" href="\/api\/team\/matches-to-check"><span class="hn">\d+<\/span> <span>(match|matches) to check<\/span>/);
    expect(home.text).toContain("Suggestions spotters took. Check the photo matches the cat.");
  });
});

describe("the list", () => {
  it("is oldest first, with the two photos, name and number, area and day, and which suggestion", async () => {
    const cat = await kit.cat();
    const second = await suggested(cat, at("2041-03-06T10:00:00Z"), 2);
    const first = await suggested(cat, at("2041-03-05T10:00:00Z"), 3);
    const res = await get("/api/team/matches-to-check");
    expect(res.status).toBe(200);
    expect(res.text.indexOf(`id="m-${first}"`)).toBeLessThan(res.text.indexOf(`id="m-${second}"`));
    const row = rowOf(res.text, first);
    expect(row).toContain("5 Mar 2041");
    expect(row).toContain("3rd suggestion");
    expect(rowOf(res.text, second)).toContain("2nd suggestion");
    expect(row).toMatch(/#\d+/);
    expect(row).toMatch(/<img[^>]+src="\/api\/team\/photos\/[^"]+\/card"/);
    expect(row).toMatch(/<img[^>]+src="\/api\/team\/photos\/[^"]+\/card"/);
    expect(row).toContain("Looks right");
    expect(row).toContain("Different cat");
    expect(res.text).not.toMatch(/<script/i);
    expect(res.text).not.toContain("vitest-");
  });

  it("Looks right without an Origin is refused and writes nothing", async () => {
    const cat = await kit.cat();
    const s = await suggested(cat, at("2041-03-07T10:00:00Z"));
    const res = await post(`/api/team/matches-to-check/${s}/looks-right`, staff.cookie, null);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await db.select().from(sightingMatchesTable).where(eq(sightingMatchesTable.sightingId, s)))[0]!.teamAction).toBeNull();
  });

  it("Looks right answers 303 back to the list, and the row is gone; a second press is harmless", async () => {
    const cat = await kit.cat();
    const s = await suggested(cat, at("2041-03-08T10:00:00Z"));
    const res = await post(`/api/team/matches-to-check/${s}/looks-right`);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe("/api/team/matches-to-check");
    expect((await get("/api/team/matches-to-check")).text).not.toContain(`id="m-${s}"`);
    expect((await post(`/api/team/matches-to-check/${s}/looks-right`)).status).toBe(303);
    expect((await post(`/api/team/matches-to-check/${randomUUID()}/looks-right`)).status).toBe(404);
  });

  it("Different cat opens the move screen with the sighting ticked", async () => {
    const cat = await kit.cat();
    const s = await suggested(cat, at("2041-03-09T10:00:00Z"));
    const page = (await get("/api/team/matches-to-check")).text;
    const href = new RegExp(`href="(/api/team/sightings/move\\?[^"]*s=${s}[^"]*)"`).exec(rowOf(page, s))?.[1];
    expect(href).toBeDefined();
    const url = href!.replace(/&amp;/g, "&");
    expect(url).toBe(`/api/team/sightings/move?cat=${cat}&s=${s}&source=match_check`);
    const screen = await get(url);
    expect(screen.status).toBe(200);
    expect(screen.text).toContain(`<input type="hidden" name="s" value="${s}">`);
    expect(screen.text).toContain('Moving this sighting');
    expect(screen.text).toContain('<input type="hidden" name="source" value="match_check">');
  });
});

describe("the page as drawn", () => {
  it("an empty list says so and has no script", () => {
    expect(renderMatchesToCheckPage([], "Sam")).toContain("Nothing to check");
    expect(renderMatchesToCheckPage([], "Sam")).not.toMatch(/<script/i);
  });
});
