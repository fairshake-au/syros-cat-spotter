import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import {
  catsTable,
  db,
  deviceCredentialsTable,
  markLeft,
  observationsTable,
  pool,
  sightingsTable,
} from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { moveSighting } from "../test/moves";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { escapeHtml as esc } from "../lib/teamPages/escape";
import { teamCatView } from "../lib/teamCatView";

// SYC-59 PR 4.2 (which-cat-is-which.md §4.3): the merge and its undo in the
// History of both cats, from real data through the real routes. The page
// pieces are in lib/teamPages/catPages.merges.test.ts. Cat names are letters
// only (SYC-709).

const KEY = "vitest-mergehistory-key-0123456789abcdef-0123456789abcdef";
const kit = moveKit("VitestMergeHistory");
let staff: Signed;
let staffLabel: string;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staffLabel = `historian${tag()}`;
  staff = await signedPerson(staffLabel, ["staff"]);
  guardian = await guardianOn(`mhguard${tag()}`, [await newColony("mh")]);
});
afterAll(async () => {
  await kit.cleanup();
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await markLeft(staff.email, "cli:vitest");
  await markLeft(guardian.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const get = (url: string, cookie = staff.cookie) => request(app).get(url).set("Cookie", cookie);
const count = async (catId: number) => (await teamCatView(catId))!.sightings.length;

const merge = async (mergedId: number, survivorId: number, reasonText = "Same face markings and torn left ear") =>
  request(app)
    .post("/api/team/cats/merge")
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", staff.cookie)
    .send({ survivorId, mergedId, expectedSightingCounts: [await count(survivorId), await count(mergedId)], reasonText, survivorChosen: "default" });
const undo = (mergeId: number, body: object = {}) =>
  request(app).post(`/api/team/cats/merge/${mergeId}/undo`).set("Origin", TEAM_ORIGIN).set("Cookie", staff.cookie).send({ reasonText: "Two cats after all", ...body });

async function pair() {
  const agatha = await kit.cat(daysAgo(60));
  const mimi = await kit.cat(daysAgo(40));
  const a0 = await kit.sighting(agatha, kit.device(), daysAgo(30));
  const m1 = await kit.sighting(mimi, kit.device(), daysAgo(20));
  const m2 = await kit.sighting(mimi, kit.device(), daysAgo(4));
  return { agatha, mimi, a0, m1, m2 };
}

describe("the cat that stays", () => {
  it("shows the merge with who did it, when and why, Undo merge, and Mimi's sightings tagged and worded", async () => {
    const c = await pair();
    await kit.answer(c.m1, "note", { text: "Limping" });
    await db.insert(observationsTable).values({ catId: c.mimi, kind: "team_note", value: { text: "Shy at the bowl" }, accountId: staff.id, roleAtTime: "staff", observedAt: daysAgo(2) });
    const m = await merge(c.mimi, c.agatha);
    expect(m.status).toBe(200);
    const [mimi, agatha] = [await db.select().from(catsTable).where(eq(catsTable.id, c.mimi)), await db.select().from(catsTable).where(eq(catsTable.id, c.agatha))];
    const page = await get(`/api/team/cats/${c.agatha}`);
    expect(page.status).toBe(200);
    expect(page.text).toMatch(new RegExp(`Merged with <a href="/api/team/cats/${c.mimi}">${esc(mimi[0]!.name)}</a> by Vt ${staffLabel}, \\d{1,2} \\w{3}: “Same face markings and torn left ear”`));
    expect(page.text).toContain(`2 sightings came with ${esc(mimi[0]!.name)}.`);
    expect(page.text).toContain(`href="/api/team/cats/merge/${m.body.mergeId}/undo">Undo merge</a>`);
    // Both of Mimi's sightings are tagged and say how they came; Agatha's own is not.
    expect(page.text.match(new RegExp(`class="tag from">from ${esc(mimi[0]!.name)}<`, "g"))).toHaveLength(3);
    expect(page.text).toContain("when it was merged in by Vt " + staffLabel);
    expect(page.text).not.toContain("Move back to");
    // Mimi's team note is on Agatha's page, tagged.
    expect(page.text).toMatch(new RegExp(`Shy at the bowl”</b>[^]*?from ${esc(mimi[0]!.name)}`));
    expect(agatha[0]!.id).toBe(c.agatha);
  });

  it("does not offer Undo merge to someone who may not merge: a cat guardian can't open the page at all", async () => {
    const c = await pair();
    await merge(c.mimi, c.agatha);
    expect((await get(`/api/team/cats/${c.agatha}`, guardian.cookie)).status).toBe(403);
  });

  it("the JSON view carries the merge for the team", async () => {
    const c = await pair();
    const m = await merge(c.mimi, c.agatha);
    const json = await get(`/api/team/cats/${c.agatha}`).set("Accept", "application/json");
    expect(json.body.merges).toEqual([
      expect.objectContaining({ id: m.body.mergeId, kind: "merged", mergeId: m.body.mergeId, role: "survivor", standing: true, sightings: 2, reasonText: "Same face markings and torn left ear", otherCat: expect.objectContaining({ id: c.mimi }) }),
    ]);
    expect(JSON.stringify(json.body)).not.toMatch(/by_account_id|byAccountId/);
  });
});

describe("after the undo, on both cats", () => {
  it("the undo is a row of its own, the merge says it was undone, Undo merge is gone, and the sightings say they are back", async () => {
    const c = await pair();
    const m = await merge(c.mimi, c.agatha);
    const u = await undo(m.body.mergeId);
    expect(u.status).toBe(200);
    const [mimiRow, agathaRow] = [(await db.select().from(catsTable).where(eq(catsTable.id, c.mimi)))[0]!, (await db.select().from(catsTable).where(eq(catsTable.id, c.agatha)))[0]!];

    const agatha = await get(`/api/team/cats/${c.agatha}`);
    expect(agatha.text).toMatch(new RegExp(`Merge with <a href="/api/team/cats/${c.mimi}">${esc(mimiRow.name)}</a> undone by Vt ${staffLabel}, \\d{1,2} \\w{3}: “Two cats after all”`));
    expect(agatha.text).toContain("Undone since.");
    expect(agatha.text).not.toContain("Undo merge");
    expect(agatha.text).not.toContain('class="tag from"');

    const mimi = await get(`/api/team/cats/${c.mimi}`);
    expect(mimi.text).toContain(`Merged into <a href="/api/team/cats/${c.agatha}">${esc(agathaRow.name)}</a>`);
    expect(mimi.text).toContain(`Back here from <a href="/api/team/cats/${c.agatha}">${esc(agathaRow.name)}</a>`);
    expect(mimi.text).toContain("when the merge was undone by Vt " + staffLabel);
    // No “Moved to Agatha” row for each sighting the merge took.
    expect(mimi.text).not.toContain("Moved to <a");
    // Mimi has her two sightings and two merge rows.
    const view = (await teamCatView(c.mimi))!;
    expect(view.sightings).toHaveLength(2);
    expect(view.merges.map((e) => e.kind)).toEqual(["merged", "undone"]);
  });

  it("a sighting the team moved onto Agatha after the merge, and ticked in the undo, is an ordinary move", async () => {
    const c = await pair();
    const zed = await kit.cat(daysAgo(50));
    await kit.sighting(zed, kit.device(), daysAgo(25));
    const z2 = await kit.sighting(zed, kit.device(), daysAgo(10));
    const m = await merge(c.mimi, c.agatha);
    await moveSighting(z2.id, c.agatha);
    const u = await undo(m.body.mergeId, { alsoMoveSightingIds: [z2.id] });
    expect(u.status).toBe(200);
    const s = (await db.select().from(sightingsTable).where(eq(sightingsTable.id, z2.id)))[0]!;
    expect(s.catId).toBe(c.mimi);
    const mimi = await get(`/api/team/cats/${c.mimi}`);
    // It came back by an ordinary move (reason “Other”, the undo's own reason): the ordinary line, not the merge's.
    expect(mimi.text).toContain("Why: Two cats after all.");
    expect(mimi.text).toContain("Moved here from");
  });
});

describe("a chain: Mimi into Agatha, Agatha into Dora", () => {
  it("Dora's page lists Agatha's merge and shows Mimi's sightings tagged with the cat they came from", async () => {
    const c = await pair();
    const dora = await kit.cat(daysAgo(80));
    await kit.sighting(dora, kit.device(), daysAgo(70));
    const first = await merge(c.mimi, c.agatha);
    const second = await merge(c.agatha, dora);
    expect(second.status).toBe(200);
    const page = await get(`/api/team/cats/${dora}`);
    const agatha = (await db.select().from(catsTable).where(eq(catsTable.id, c.agatha)))[0]!;
    expect(page.text).toContain(`Merged with <a href="/api/team/cats/${c.agatha}">${esc(agatha.name)}</a>`);
    // Dora's History lists her own merge only; Mimi's merge is Agatha's to undo first.
    expect(page.text).not.toContain(`/api/team/cats/merge/${first.body.mergeId}/undo`);
    expect(page.text).toContain(`/api/team/cats/merge/${second.body.mergeId}/undo`);
    // Dora has her own sighting, Agatha's and Mimi's two (they came to Agatha, then on to Dora with her).
    expect((await teamCatView(dora))!.sightings).toHaveLength(4);
  });
});
