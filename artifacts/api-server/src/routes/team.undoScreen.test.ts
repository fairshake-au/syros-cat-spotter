import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import {
  catSubscriptionsTable,
  catsTable,
  db,
  deviceCredentialsTable,
  markLeft,
  pool,
  sightingsTable,
} from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { libMerge, libUndo } from "../test/merges";
import { moveSighting } from "../test/moves";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { canonicalCatOf, mergeRecord } from "../lib/catIdentity";
import { filedUnderSurvivorSinceMerge, MERGE_WORDS } from "../lib/mergeCats";
import { escapeHtml as esc } from "../lib/teamPages/escape";

// SYC-59 PR 4.2 (which-cat-is-which.md §4.4, §4.5): the undo screen and the
// form behind it, through the real routes and real data. The undo itself is
// PR 4.1's (team.mergeCats.test.ts); here the tick list must be the sightings
// `filedUnderSurvivorSinceMerge` says (the helper the route checks the ticks
// with), every refusal must reach the screen in words, and a cat guardian gets
// a 403 everywhere. Cat names are letters only (SYC-709).

const KEY = "vitest-undoscreen-key-0123456789abcdef-0123456789abcdef";
const kit = moveKit("VitestUndoScreen");
let staff: Signed;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staff = await signedPerson(`undoer${tag()}`, ["staff"]);
  guardian = await guardianOn(`uscguard${tag()}`, [await newColony("us")]);
});
afterAll(async () => {
  await kit.cleanup();
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
const post = (mergeId: number | string, body: Record<string, string | string[]>, cookie: string | null = staff.cookie) => {
  const r = request(app).post(`/api/team/cats/merge/${mergeId}/undo/form`).set("Origin", TEAM_ORIGIN).type("form");
  return (cookie ? r.set("Cookie", cookie) : r).send(body);
};
const screen = (mergeId: number | string) => `/api/team/cats/merge/${mergeId}/undo`;
const catRow = async (id: number) => (await db.select().from(catsTable).where(eq(catsTable.id, id)))[0]!;
const sightingRow = async (id: number) => (await db.select().from(sightingsTable).where(eq(sightingsTable.id, id)))[0]!;
const standing = async (id: number) => (await canonicalCatOf([id])).get(id);

/** Agatha (older, one sighting) and Mimi (two), merged: Mimi into Agatha. */
async function merged() {
  const agatha = await kit.cat(daysAgo(60));
  const mimi = await kit.cat(daysAgo(40));
  const a0 = await kit.sighting(agatha, kit.device(), daysAgo(30));
  const m1 = await kit.sighting(mimi, kit.device(), daysAgo(20));
  const m2 = await kit.sighting(mimi, kit.device(), daysAgo(4));
  const m = await libMerge(mimi, agatha, "Same face markings and torn left ear");
  return { agatha, mimi, a0, m1, m2, mergeId: m.mergeId };
}

/** A spot sent after the merge and filed under Agatha. */
async function afterMerge(agatha: number) {
  return kit.sighting(agatha, kit.device(), new Date(Date.now() + 60_000));
}

describe("who may open the screen and undo (D5)", () => {
  it("refuses anyone signed out, and a cat guardian: no screen, nothing is undone", async () => {
    const c = await merged();
    expect((await get(screen(c.mergeId), null)).status).toBe(401);
    expect((await get(screen(c.mergeId), guardian.cookie)).status).toBe(403);
    expect((await post(c.mergeId, { reasonText: "x" }, null)).status).toBe(401);
    expect((await post(c.mergeId, { reasonText: "x" }, guardian.cookie)).status).toBe(403);
    expect(await standing(c.mimi)).toBe(c.agatha);
  });

  it("a form post from another site is refused before anything is read", async () => {
    const c = await merged();
    const res = await request(app)
      .post(`/api/team/cats/merge/${c.mergeId}/undo/form`)
      .set("Origin", "https://evil.example.com")
      .set("Cookie", staff.cookie)
      .type("form")
      .send({ reasonText: "x" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await standing(c.mimi)).toBe(c.agatha);
  });
});

describe("the screen: what undoing does (§4.4)", () => {
  it("names the merge, its reason, the sightings that go back, and what else happens", async () => {
    const c = await merged();
    const res = await get(screen(c.mergeId));
    expect(res.status).toBe(200);
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    expect(res.text).toContain(`Undo the merge of ${esc(m.name)} into ${esc(a.name)}`);
    expect(res.text).toContain("“Same face markings and torn left ear”");
    expect(res.text).toContain(`2 sightings go back to ${esc(m.name)}.`);
    expect(res.text).toContain("Going back to ");
    expect(res.text).toContain(esc(`${m.name}'s own statements stop counting for ${a.name}.`));
    expect(res.text).toContain("Answers a spotter added after the merge");
    expect(res.text).toContain("The 10 points for finding this duplicate are kept.");
    expect(res.text).toContain(`action="/api/team/cats/merge/${c.mergeId}/undo/form"`);
    expect(res.text).toContain(">Undo merge</button>");
    // The sightings that go back carry their photos; nothing else is ticked for them.
    expect(res.text).not.toContain('name="tick"');
    expect(res.text).not.toMatch(/lat=|lng=|37\.44/);
  });

  it("counts the followers the merge added", async () => {
    const agatha = await kit.cat(daysAgo(60));
    const mimi = await kit.cat(daysAgo(40));
    await kit.sighting(agatha, kit.device(), daysAgo(30));
    await kit.sighting(mimi, kit.device(), daysAgo(20));
    const [f1, f2] = [kit.device(), kit.device()];
    await db.insert(catSubscriptionsTable).values([f1, f2].map((deviceId) => ({ deviceId, catId: mimi })));
    const m = await libMerge(mimi, agatha);
    const res = await get(screen(m.mergeId));
    expect(res.text).toContain("2 followers the merge added to");
  });
});

describe("the screen: the sightings to tick, decided by the helper (§4.4)", () => {
  it("a spot sent after the merge and filed under Agatha is offered with a tick box; Agatha's own older spot and the merge's own sightings are not", async () => {
    const c = await merged();
    const later = await afterMerge(c.agatha);
    const res = await get(screen(c.mergeId));
    expect(res.text).toContain("Tick any that are ");
    expect(res.text).toContain(`name="tick" value="${later.id}"`);
    expect(res.text).not.toContain(`name="tick" value="${c.a0.id}"`);
    for (const own of [c.m1, c.m2]) expect(res.text).not.toContain(`name="tick" value="${own.id}"`);
    const a = await catRow(c.agatha);
    expect(res.text).toContain(esc(`Filed under ${a.name} since the merge.`));
    // The same sightings the helper names: the screen and the route agree.
    const record = (await mergeRecord(c.mergeId))!;
    expect(await filedUnderSurvivorSinceMerge(db, record, [later.id, c.a0.id])).toEqual(new Set([later.id]));
  });

  it("a spot sent BEFORE the merge but matched to Agatha after it is offered too (sent-time is not the rule)", async () => {
    const c = await merged();
    const [waiting] = await db
      .insert(sightingsTable)
      .values({ deviceId: kit.device(), photoId: await kit.photo(), lat: 37.4441, lng: 24.9412, status: "awaiting_team", createdAt: daysAgo(2) })
      .returning();
    // Sent two days ago, matched after the merge: filed under Agatha, with the resolve's ledger row stamped now.
    await db.update(sightingsTable).set({ status: "resolved", catId: c.agatha }).where(eq(sightingsTable.id, waiting!.id));
    await pool.query(
      "insert into points_ledger (device_id, sighting_id, cat_id, points, athens_day, week_start, earned_at, source) values ($1, $2, $3, 0, current_date, current_date, now(), 'live')",
      [waiting!.deviceId, waiting!.id, c.agatha],
    );
    const res = await get(screen(c.mergeId));
    expect(res.text).toContain(`name="tick" value="${waiting!.id}"`);
    expect(res.text).not.toContain(`name="tick" value="${c.a0.id}"`);
  });

  it("an older spot the team moved onto Agatha after the merge is offered", async () => {
    const c = await merged();
    const zed = await kit.cat(daysAgo(50));
    await kit.sighting(zed, kit.device(), daysAgo(25));
    const z2 = await kit.sighting(zed, kit.device(), daysAgo(10));
    await moveSighting(z2.id, c.agatha);
    const res = await get(screen(c.mergeId));
    expect(res.text).toContain(`name="tick" value="${z2.id}"`);
  });

  it("one of Mimi's sightings the team moved again after the merge is offered, saying where it is now, and does not go back by itself", async () => {
    const c = await merged();
    const zed = await kit.cat(daysAgo(50));
    await kit.sighting(zed, kit.device(), daysAgo(25));
    await kit.sighting(zed, kit.device(), daysAgo(10));
    await moveSighting(c.m2.id, zed);
    const res = await get(screen(c.mergeId));
    const z = await catRow(zed);
    expect(res.text).toContain(`name="tick" value="${c.m2.id}"`);
    expect(res.text).toContain(esc(`Moved again after the merge; filed under ${z.name} now.`));
    // Only the one still where the merge put it goes back by itself.
    expect(res.text).toContain("1 sighting goes back to ");
    expect(res.text).not.toContain(`name="tick" value="${c.m1.id}"`);
  });

  it("nothing left where the merge put it: the screen says so and offers the tick list", async () => {
    const c = await merged();
    const zed = await kit.cat(daysAgo(50));
    await kit.sighting(zed, kit.device(), daysAgo(25));
    await kit.sighting(zed, kit.device(), daysAgo(10));
    await moveSighting(c.m1.id, zed);
    await moveSighting(c.m2.id, zed);
    const res = await get(screen(c.mergeId));
    expect(res.text).toContain("None of ");
    expect(res.text).toContain(`name="tick" value="${c.m1.id}"`);
    expect(res.text).toContain(`name="tick" value="${c.m2.id}"`);
  });
});

describe("the screen stops, in the refusal's words", () => {
  it("a merge that doesn't exist, or an address that isn't a number, is a 404 stop page", async () => {
    expect((await get(screen(999999999))).status).toBe(404);
    expect((await get(screen(999999999))).text).toContain(esc(MERGE_WORDS.notFound));
    expect((await get(screen("abc"))).status).toBe(404);
    expect((await post("abc", { reasonText: "x" })).status).toBe(404);
  });

  it("ALREADY_UNDONE: a merge undone already has no undo screen, and says where Mimi is now", async () => {
    const c = await merged();
    await libUndo(c.mergeId);
    const res = await get(screen(c.mergeId));
    expect(res.status).toBe(409);
    expect(res.text).toContain(esc(MERGE_WORDS.alreadyUndone));
    expect(res.text).toContain(`href="/api/team/cats/${c.mimi}"`);
    const again = await post(c.mergeId, { reasonText: "Again" });
    expect(again.status).toBe(409);
    expect(again.text).toContain(esc(MERGE_WORDS.alreadyUndone));
  });

  it("UNDO_LATER_MERGE_FIRST: while Agatha is part of Dora, Mimi's merge waits", async () => {
    const c = await merged();
    const dora = await kit.cat(daysAgo(80));
    await kit.sighting(dora, kit.device(), daysAgo(70));
    await libMerge(c.agatha, dora);
    const res = await get(screen(c.mergeId));
    const [a, d] = [await catRow(c.agatha), await catRow(dora)];
    expect(res.status).toBe(409);
    expect(res.text).toContain(esc(MERGE_WORDS.undoLaterFirst(a.name, d.name)));
    expect(res.text).toContain(`href="/api/team/cats/${dora}"`);
    const forced = await post(c.mergeId, { reasonText: "Try" });
    expect(forced.status).toBe(409);
    expect(forced.text).toContain(esc(MERGE_WORDS.undoLaterFirst(a.name, d.name)));
    expect(await standing(c.mimi)).toBe(dora);
  });
});

describe("Undo merge (the form)", () => {
  it("undoes, sends the team to Mimi, and the sightings are back; a ticked later spot goes with them", async () => {
    const c = await merged();
    const later = await afterMerge(c.agatha);
    const res = await post(c.mergeId, { reasonText: "Different cats after all", tick: [String(later.id)] });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${c.mimi}?done=undone#history`);
    expect(await standing(c.mimi)).toBe(c.mimi);
    for (const s of [c.m1, c.m2, later]) expect((await sightingRow(s.id)).catId).toBe(c.mimi);
    expect((await sightingRow(c.a0.id)).catId).toBe(c.agatha);
    expect((await get(`/api/team/cats/${c.mimi}?done=undone`)).text).toContain("The merge is undone");
  });

  it("unticked later spots stay where they are", async () => {
    const c = await merged();
    const later = await afterMerge(c.agatha);
    const res = await post(c.mergeId, { reasonText: "Different cats after all" });
    expect(res.status).toBe(303);
    expect((await sightingRow(later.id)).catId).toBe(c.agatha);
    expect((await sightingRow(c.m1.id)).catId).toBe(c.mimi);
  });

  it("a reason is required; what was typed and ticked comes back; nothing is undone", async () => {
    const c = await merged();
    const later = await afterMerge(c.agatha);
    const none = await post(c.mergeId, { reasonText: "  ", tick: [String(later.id)] });
    expect(none.status).toBe(400);
    expect(none.text).toContain("Say why you are undoing the merge. Nothing was undone.");
    expect(none.text).toContain(`name="tick" value="${later.id}" checked`);
    const tooLong = await post(c.mergeId, { reasonText: "x".repeat(501) });
    expect(tooLong.text).toContain("Keep the reason to 500 characters.");
    expect(tooLong.text).toContain(`value="${"x".repeat(501)}"`);
    expect(await standing(c.mimi)).toBe(c.agatha);
  });

  it("NOT_TO_MOVE: ticking Agatha's own older spot is refused, in words, and nothing is undone", async () => {
    const c = await merged();
    const res = await post(c.mergeId, { reasonText: "Different cats after all", tick: [String(c.a0.id)] });
    expect(res.status).toBe(409);
    expect(res.text).toContain(esc(MERGE_WORDS.notToMove));
    expect(res.text).toContain("Nothing was undone.");
    expect(await standing(c.mimi)).toBe(c.agatha);
    expect((await sightingRow(c.a0.id)).catId).toBe(c.agatha);
  });
});

describe("escaping", () => {
  it("names and reasons are escaped everywhere on the screen", async () => {
    const c = await merged();
    const evil = `VitestUndoScreen<script>alert(1)</script>${tag()}`;
    await db.update(catsTable).set({ name: evil }).where(eq(catsTable.id, c.mimi));
    const reason = `"><img src=x onerror=alert(2)>`;
    const res = await post(c.mergeId, { reasonText: reason, tick: [String(c.a0.id)] });
    expect(res.status).toBe(409);
    for (const bad of ["<script>alert(1)</script>", "<img src=x onerror=alert(2)>"]) expect(res.text).not.toContain(bad);
    expect(res.text).toContain(esc(reason));
    expect(res.text).toContain(esc(evil));
  });

  it("the merge's own reason is escaped where the screen quotes it", async () => {
    const agatha = await kit.cat(daysAgo(60));
    const mimi = await kit.cat(daysAgo(40));
    await kit.sighting(agatha, kit.device(), daysAgo(30));
    await kit.sighting(mimi, kit.device(), daysAgo(20));
    const m = await libMerge(mimi, agatha, `<b onmouseover=alert(3)>why</b>`);
    const res = await get(screen(m.mergeId));
    expect(res.text).not.toContain("<b onmouseover=alert(3)>");
    expect(res.text).toContain(esc("<b onmouseover=alert(3)>why</b>"));
  });
});
