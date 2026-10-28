import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { desc, eq, like } from "drizzle-orm";
import {
  catsTable,
  db,
  deviceCredentialsTable,
  duplicateDecisionsTable,
  duplicateReportsTable,
  markLeft,
  newCatChecksTable,
  pool,
  profilesTable,
  sightingMatchesTable,
} from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { newCatsAfterFailedCheck } from "../lib/matcherHealth";

// SYC-59 PR 5.1 (which-cat-is-which.md §3.3): the Possible duplicates page,
// its two answers, the notes on both cats' pages, and "New cats to check"
// with the nearby cats, "Same as…" and "Checked, it's new". Through the real
// routes. A cat guardian gets the 403 everywhere; every value is escaped.
// Cat names are letters only (SYC-709).

const KEY = "vitest-dupes-key-0123456789abcdef-0123456789abcdef";
const kit = moveKit("VitestDupPage");
let staff: Signed;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staff = await signedPerson(`dupreviewer${tag()}`, ["staff"]);
  guardian = await guardianOn(`dupguard${tag()}`, [await newColony("dpg")]);
});
afterAll(async () => {
  await kit.cleanup();
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${kit.devicePrefix}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await markLeft(staff.email, "cli:vitest");
  await markLeft(guardian.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const get = (url: string, cookie: string | null = staff.cookie) => {
  const r = request(app).get(url);
  return cookie ? r.set("Cookie", cookie) : r;
};
const post = (url: string, body: Record<string, string>, cookie: string | null = staff.cookie, origin = TEAM_ORIGIN) => {
  const r = request(app).post(url).set("Origin", origin).type("form");
  return (cookie ? r.set("Cookie", cookie) : r).send(body);
};
const decide = (body: Record<string, string>, cookie: string | null = staff.cookie) => post("/api/team/duplicates/decide", body, cookie);

const noon = (back: number) => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return new Date(d.getTime() - back * 86_400_000);
};

/** A pair at a spot of its own, so "nearby" lists in other tests don't crowd it. */
let spot = 0;
async function pair() {
  const here = { lat: 37.62 + ++spot * 0.05, lng: 24.7 };
  const a = await kit.cat();
  const b = await kit.cat();
  for (const id of [a, b]) await db.update(catsTable).set(here).where(eq(catsTable.id, id));
  const name = async (id: number) => (await db.select().from(catsTable).where(eq(catsTable.id, id)))[0]!.name;
  return { lo: Math.min(a, b), hi: Math.max(a, b), loName: await name(Math.min(a, b)), hiName: await name(Math.max(a, b)) };
}
async function countingPhone(nickname?: string): Promise<string> {
  const device = kit.device();
  const spare = await kit.cat();
  for (const n of [3, 4, 5]) await kit.sighting(spare, device, daysAgo(n));
  if (nickname) await db.insert(profilesTable).values({ deviceId: device, nickname });
  return device;
}
async function newPhone(nickname?: string): Promise<string> {
  const device = kit.device();
  await kit.sighting(await kit.cat(), device, daysAgo(2));
  if (nickname) await db.insert(profilesTable).values({ deviceId: device, nickname });
  return device;
}
const said = (p: { lo: number; hi: number }, deviceId: string, createdAt: Date, says = "same") =>
  db.insert(duplicateReportsTable).values({ catLow: p.lo, catHigh: p.hi, source: "spotter_question", says, deviceId, createdAt });
/** The card of one pair out of the whole page. */
const cardOf = (html: string, p: { lo: number; hi: number }) => {
  const start = html.indexOf(`id="p-${p.lo}-${p.hi}"`);
  expect(start, "the pair is on the page").toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start));
};

describe("who may open the list and answer on it", () => {
  it("refuses anyone signed out and a cat guardian: no page, no decision written", async () => {
    const p = await pair();
    await said(p, await countingPhone(), noon(2));
    expect((await get("/api/team/duplicates", null)).status).toBe(401);
    expect((await get("/api/team/duplicates", guardian.cookie)).status).toBe(403);
    const form = { a: String(p.lo), b: String(p.hi), decision: "different" };
    expect((await decide(form, null)).status).toBe(401);
    expect((await decide(form, guardian.cookie)).status).toBe(403);
    const crossSite = await post("/api/team/duplicates/decide", form, staff.cookie, "https://evil.example.com");
    expect(crossSite.status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(duplicateDecisionsTable).where(eq(duplicateDecisionsTable.catLow, p.lo))).toEqual([]);
    expect((await post("/api/team/new-cats-to-check/1/checked", {}, guardian.cookie)).status).toBe(403);
  });
});

describe("the list", () => {
  it("draws each pair with the spec's words, the three buttons, the merge link with both cats filled in, and Likely first", async () => {
    const quiet = await pair();
    const strong = await pair();
    await said(quiet, await countingPhone(), noon(1));
    const first = await countingPhone("Eleni");
    await said(strong, first, noon(4));
    await said(strong, await countingPhone(), noon(3));
    const html = (await get("/api/team/duplicates")).text;

    expect(html).toContain("Possible duplicates");
    expect(html.indexOf(`id="p-${strong.lo}-${strong.hi}"`)).toBeLessThan(html.indexOf(`id="p-${quiet.lo}-${quiet.hi}"`));
    const card = cardOf(html, strong);
    expect(card).toContain("Likely");
    expect(card).toContain(strong.loName);
    expect(card).toContain(strong.hiName);
    expect(card).toContain("2 spotters said same cat");
    expect(card).toContain("Eleni: same cat");
    expect(card).toContain("Same cat, merge…");
    expect(card).toContain("Different cats");
    expect(card).toContain("Not sure yet");
    expect(card).toContain(`href="/api/team/cats/merge?a=${strong.lo}&amp;b=${strong.hi}"`);
    expect(cardOf(html, quiet)).toContain("Possible");
    // Nobody's device id is on the page.
    expect(html).not.toContain(kit.devicePrefix);

    // The merge button opens the merge screen with both cats drawn.
    const screen = await get(`/api/team/cats/merge?a=${strong.lo}&b=${strong.hi}`);
    expect(screen.status).toBe(200);
    expect(screen.text).toContain(strong.loName);
    expect(screen.text).toContain(strong.hiName);
    expect(screen.text).toContain("Why?");
  });

  it("marks a report from a phone that doesn't count yet as 'new phone', and not one that does", async () => {
    const p = await pair();
    await said(p, await newPhone("Newcomer"), noon(2));
    await said(p, await countingPhone("Regular"), noon(1));
    const card = cardOf((await get("/api/team/duplicates")).text, p);
    expect(card).toMatch(/Newcomer: same cat <span class="tag unchecked">new phone<\/span>/);
    expect(card).toContain("Regular: same cat</li>");
    expect(card).toContain("Possible");
  });

  it("shows a spotter who has deleted themselves as 'a spotter', never a device", async () => {
    const p = await pair();
    await db.insert(duplicateReportsTable).values({ catLow: p.lo, catHigh: p.hi, source: "spotter_question", says: "same", deviceId: null, redactedAt: noon(1), createdAt: noon(2) });
    const card = cardOf((await get("/api/team/duplicates")).text, p);
    expect(card).toContain("a spotter: same cat");
  });

  it("says why in plain words: a new-cat check, fingerprints, and the photo check being down", async () => {
    const p = await pair();
    const newCat = p.hi;
    const s = await kit.sighting(newCat, kit.device(), daysAgo(1));
    await db.insert(sightingMatchesTable).values({ sightingId: s.id, suggested: [{ catId: p.lo, rank: 1, score: 0.7 }], choice: "new_cat", chosenCatId: newCat, chosenAt: noon(1), matcherFailed: false });
    await db.insert(duplicateReportsTable).values({ catLow: p.lo, catHigh: p.hi, source: "new_cat_check", says: "not_sure", deviceId: s.deviceId, sightingId: s.id, score: 0.7, createdAt: noon(1) });
    await db.insert(duplicateReportsTable).values({ catLow: p.lo, catHigh: p.hi, source: "sweep", says: "same", score: 0.9, createdAt: noon(1) });
    const card = cardOf((await get("/api/team/duplicates")).text, p);
    expect(card).toContain(`${p.hiName} was added as a new cat though the photo check had suggested ${p.loName}`);
    expect(card).toContain("fingerprints very alike");
  });

  it("escapes every typed value: a nickname and a note can't add markup", async () => {
    const p = await pair();
    const evil = "<script>alert(1)</script>";
    await said(p, await countingPhone(evil), noon(2));
    const note = `<img src=x onerror=alert(2)> ${tag()}`;
    await decide({ a: String(p.lo), b: String(p.hi), decision: "not_sure", note });
    const html = (await get("/api/team/duplicates")).text;
    expect(html).not.toContain(evil);
    expect(html).not.toContain("<img src=x");
    const card = cardOf(html, p);
    expect(card).toContain("&lt;script&gt;alert(1)&lt;/script&gt;: same cat");
    expect(card).toContain("&lt;img src=x onerror=alert(2)&gt;");
    // And on the cat's own page.
    const page = (await get(`/api/team/cats/${p.lo}`)).text;
    expect(page).not.toContain("<img src=x");
    expect(page).toContain("&lt;img src=x onerror=alert(2)&gt;");
  });
});

describe("the three buttons", () => {
  it("'Different cats' takes the pair off the list and writes a decision with who decided", async () => {
    const p = await pair();
    await said(p, await countingPhone(), noon(2));
    expect((await get("/api/team/duplicates")).text).toContain(`id="p-${p.lo}-${p.hi}"`);
    const res = await decide({ a: String(p.hi), b: String(p.lo), decision: "different" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe("/api/team/duplicates?done=different");
    const rows = await db.select().from(duplicateDecisionsTable).where(eq(duplicateDecisionsTable.catLow, p.lo));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ catHigh: p.hi, decision: "different", byAccountId: staff.id });
    const after = await get("/api/team/duplicates?done=different");
    expect(after.text).not.toContain(`id="p-${p.lo}-${p.hi}"`);
    expect(after.text).toContain("It only comes back with new evidence");
  });

  it("'Not sure yet' keeps the row with the note, which shows on both cats' team pages", async () => {
    const p = await pair();
    await said(p, await countingPhone(), noon(2));
    const note = `needs a clear face photo ${tag()}`;
    expect((await decide({ a: String(p.lo), b: String(p.hi), decision: "not_sure", note })).status).toBe(303);
    const html = (await get("/api/team/duplicates")).text;
    expect(cardOf(html, p)).toContain(`Team note: ${note}`);
    for (const [cat, other] of [
      [p.lo, p.hiName],
      [p.hi, p.loName],
    ] as const) {
      const page = (await get(`/api/team/cats/${cat}`)).text;
      expect(page).toContain(`Team note: ${note}`);
      expect(page).toContain(other);
    }
    // A later "different" replaces it: the note goes from both pages.
    await decide({ a: String(p.lo), b: String(p.hi), decision: "different" });
    expect((await get(`/api/team/cats/${p.lo}`)).text).not.toContain(note);
  });

  it("refuses a form that isn't right, a note that's too long, a cat that isn't there and a pair already one cat", async () => {
    const p = await pair();
    expect((await decide({ a: "x", b: String(p.hi), decision: "different" })).status).toBe(400);
    expect((await decide({ a: String(p.lo), b: String(p.hi), decision: "merged" })).status).toBe(400);
    expect((await decide({ a: String(p.lo), b: String(p.hi), decision: "not_sure", note: "n".repeat(501) })).status).toBe(400);
    expect((await decide({ a: String(p.lo), b: "999999999", decision: "different" })).status).toBe(404);
    expect((await decide({ a: String(p.lo), b: String(p.lo), decision: "different" })).status).toBe(409);
    expect(await db.select().from(duplicateDecisionsTable).where(eq(duplicateDecisionsTable.catLow, p.lo))).toEqual([]);
  });

  it("'Same cat, merge…' merges through the merge screen, and the pair leaves the list", async () => {
    const mimi = await kit.cat(daysAgo(40));
    const agatha = await kit.cat(daysAgo(60));
    const m = await kit.sighting(mimi, kit.device(), daysAgo(5));
    const a = await kit.sighting(agatha, kit.device(), daysAgo(6));
    expect([m, a].every(Boolean)).toBe(true);
    const p = { lo: Math.min(mimi, agatha), hi: Math.max(mimi, agatha) };
    await said(p, await countingPhone(), noon(2));
    expect((await get("/api/team/duplicates")).text).toContain(`id="p-${p.lo}-${p.hi}"`);
    const res = await post("/api/team/cats/merge/form", {
      a: String(mimi),
      b: String(agatha),
      survivor: String(agatha),
      n0: "1",
      n1: "1",
      reasonText: "Same face markings",
    });
    expect(res.status).toBe(303);
    expect((await get("/api/team/duplicates")).text).not.toContain(`id="p-${p.lo}-${p.hi}"`);
  });
});

describe("New cats to check", () => {
  /** A cat named while the photo check was down, with two neighbours at its own spot. */
  async function newCatWithNeighbours() {
    const spotLat = 37.9 + ++spot * 0.05;
    const mk = async () => {
      const id = await kit.cat();
      await db.update(catsTable).set({ lat: spotLat, lng: 24.6 }).where(eq(catsTable.id, id));
      return id;
    };
    const [fresh, near1, near2] = [await mk(), await mk(), await mk()];
    const s = await kit.sighting(fresh, kit.device(), daysAgo(1));
    await db.insert(sightingMatchesTable).values({ sightingId: s.id, matcherFailed: true, choice: "new_cat", chosenCatId: fresh, chosenAt: new Date(Date.now() - 60_000) });
    return { fresh, near1, near2 };
  }

  it("shows the nearby cats' photos, 'Same as…' to the merge screen, and 'Checked, it's new'", async () => {
    const c = await newCatWithNeighbours();
    const html = (await get("/api/team/new-cats-to-check")).text;
    const start = html.indexOf(`id="c-${c.fresh}"`);
    expect(start).toBeGreaterThan(-1);
    const card = html.slice(start, html.indexOf("</article>", start));
    expect(card).toContain("Cats nearby");
    expect(card).toContain(`href="/api/team/cats/${c.near1}"`);
    expect(card).toContain(`href="/api/team/cats/${c.near2}"`);
    expect(card).toMatch(/<img src="\/api\/team\/photos\/[^"]+\/small"/);
    expect(card).toContain("Same as…");
    expect(card).toContain(`href="/api/team/cats/merge?a=${c.fresh}"`);
    expect(card).toContain("Checked, it's new");

    const choose = await get(`/api/team/cats/merge?a=${c.fresh}`);
    expect(choose.status).toBe(200);
    expect(choose.text).toContain("Which cat is");
  });

  it("'Checked, it's new' writes the check and the cat leaves the list, and the Home count", async () => {
    const c = await newCatWithNeighbours();
    expect((await newCatsAfterFailedCheck()).map((x) => x.catId)).toContain(c.fresh);
    const res = await post(`/api/team/new-cats-to-check/${c.fresh}/checked`, {});
    expect(res.status).toBe(303);
    const rows = await db.select().from(newCatChecksTable).where(eq(newCatChecksTable.catId, c.fresh)).orderBy(desc(newCatChecksTable.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.byAccountId).toBe(staff.id);
    expect((await newCatsAfterFailedCheck()).map((x) => x.catId)).not.toContain(c.fresh);
    expect((await get("/api/team/new-cats-to-check")).text).not.toContain(`id="c-${c.fresh}"`);
    expect((await post(`/api/team/new-cats-to-check/999999999/checked`, {})).status).toBe(404);
  });

  it("Home links to the list for someone who may review duplicates, with the count", async () => {
    const p = await pair();
    await said(p, await countingPhone(), noon(1));
    const html = (await get("/api/team/home")).text;
    expect(html).toMatch(/href="\/api\/team\/duplicates"[^>]*><span class="hn">\d+<\/span> <span>possible duplicates?<\/span>/);
  });
});
