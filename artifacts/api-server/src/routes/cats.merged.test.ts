import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  catNewsBaselineTable,
  catNewsChangesTable,
  catNewsRunsTable,
  catSubscriptionsTable,
  catUpdatesTable,
  catsTable,
  db,
  deviceCredentialsTable,
  markLeft,
  notificationsTable,
  observationsTable,
  pool,
  sightingsTable,
  welfareReportsTable,
} from "@workspace/db";
import { GetCatResponse, ListNotificationsResponse } from "@workspace/api-zod";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
const push = vi.hoisted(() => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/push", () => push);

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { libMerge } from "../test/merges";
import { signedPerson, type Signed } from "../test/roleKit";
import { seedReport, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { issueStripFor } from "../lib/issues/queue";
import { syrNumber, searchTeamCats } from "../lib/teamCatView";
import { loadMoveScreen } from "../lib/moveScreen";
import { runNightlyNewsCheck, seedNewsBaseline } from "../lib/news/nightly";
import { MERGE_WORDS } from "../lib/mergeCats";

// SYC-59 PR 4.1 (which-cat-is-which.md §4.2, §9.3): after Mimi is merged
// into Agatha, every public read and write that names Mimi means Agatha.
// Her page opens Agatha with `mergedFrom`; naming and claiming her are
// refused MERGED with Agatha's id; follow, let-go, an owner's edit, a team
// correction and a resolve act on Agatha; the bell shows her news under
// Agatha, plus the two new kinds, shaped for the oldest app still in use.
// Spec test 21 ("also known as"). And a merge is never news (§9.12).
// Cat names are letters only (SYC-709).

const KEY = "vitest-merged-key-0123456789abcdef-0123456789abcd";
const SECRET = "vitest-merged-secret-0123456789abcdef";
const kit = moveKit("VitestMergedReads");
let staff: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staff = await signedPerson(`mreads${tag()}`, ["staff"]);
});
afterAll(async () => {
  await kit.cleanup();
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await markLeft(staff.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const bound = async () => {
  const d = kit.device();
  expect((await request(app).get(`/api/profiles/${d}/username`).set("X-Device-Secret", SECRET)).status).toBe(200);
  return d;
};
const catRow = async (id: number) => (await db.select().from(catsTable).where(eq(catsTable.id, id)))[0]!;

/** Mimi merged into Agatha, through the route's lib. */
async function merged(opts: { mimiPending?: boolean } = {}) {
  const agatha = await kit.cat(daysAgo(60));
  const mimi = await kit.cat(daysAgo(40));
  if (opts.mimiPending) await db.update(catsTable).set({ name: syrNumber(mimi), namePending: true }).where(eq(catsTable.id, mimi));
  await kit.sighting(agatha, kit.device(), daysAgo(30));
  const m = await kit.sighting(mimi, kit.device(), daysAgo(5));
  return { agatha, mimi, m, mimiName: (await catRow(mimi)).name, agathaName: (await catRow(agatha)).name };
}

describe("GET /cats/:id for a merged-away cat (spec test 14's last clause)", () => {
  it("answers with the survivor and mergedFrom; the oldest app's types read it as Agatha's page", async () => {
    const c = await merged();
    await libMerge(c.mimi, c.agatha);
    const res = await request(app).get(`/api/cats/${c.mimi}`);
    expect(res.status).toBe(200);
    expect(res.body.mergedFrom).toEqual({ id: c.mimi, name: c.mimiName });
    expect(res.body.cat).toMatchObject({ id: c.agatha, name: c.agathaName, sightingsCount: 2 });
    // An app that doesn't know the field: the schema it was built from
    // parses the answer and drops `mergedFrom` (zod strips unknown keys).
    const old = GetCatResponse.safeParse(res.body);
    expect(old.success, JSON.stringify(old.error?.issues)).toBe(true);
    expect((old.data as Record<string, unknown>)["mergedFrom"]).toBeUndefined();
    expect(old.data!.cat.id).toBe(c.agatha);
  });
});

describe("naming and claiming a merged-away cat: MERGED, with the survivor's id", () => {
  it("POST /cats/:id/name", async () => {
    const c = await merged({ mimiPending: true });
    await db.update(catsTable).set({ name: syrNumber(c.agatha), namePending: true }).where(eq(catsTable.id, c.agatha));
    await libMerge(c.mimi, c.agatha);
    const d = await bound();
    const res = await request(app).post(`/api/cats/${c.mimi}/name`).set("X-Device-Secret", SECRET).set("X-Forwarded-For", "2001:db8:59::1").send({ deviceId: d, name: `Vtmerged${tag()}` });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "MERGED", catId: c.agatha });
    expect((await catRow(c.mimi)).namePending).toBe(true);
  });

  it("POST /cats/:id/claim", async () => {
    const c = await merged();
    await libMerge(c.mimi, c.agatha);
    const d = await bound();
    const res = await request(app)
      .post(`/api/cats/${c.mimi}/claim`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: d, livesOnSyros: true, livesInMyHome: true, homePin: { lat: 37.4441, lng: 24.9412 } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "MERGED", catId: c.agatha });
    expect((await catRow(c.mimi)).ownerDeviceId).toBeNull();
  });
});

describe("writes on a merged-away id act on the survivor", () => {
  it("follow and unfollow", async () => {
    const c = await merged();
    await libMerge(c.mimi, c.agatha);
    const d = await bound();
    const res = await request(app).post(`/api/cats/${c.mimi}/follow`).set("X-Device-Secret", SECRET).send({ deviceId: d });
    expect(res.status).toBe(200);
    const follows = await db.select().from(catSubscriptionsTable).where(eq(catSubscriptionsTable.deviceId, d));
    expect(follows.map((f) => f.catId)).toEqual([c.agatha]);
    expect((await request(app).post(`/api/cats/${c.mimi}/unfollow`).set("X-Device-Secret", SECRET).send({ deviceId: d })).status).toBe(200);
    expect(await db.select().from(catSubscriptionsTable).where(eq(catSubscriptionsTable.deviceId, d))).toEqual([]);
  });

  it("the owner's edit and let-go, sent from a phone still showing Mimi", async () => {
    const c = await merged();
    const owner = await bound();
    await db.update(catsTable).set({ ownerDeviceId: owner, ownerName: "Vt" }).where(eq(catsTable.id, c.agatha));
    await libMerge(c.mimi, c.agatha);
    const edit = await request(app).patch(`/api/cats/${c.mimi}`).set("X-Device-Secret", SECRET).send({ deviceId: owner, homeDescription: "By the blue door" });
    expect(edit.status).toBe(200);
    expect((await catRow(c.agatha)).homeDescription).toBe("By the blue door");
    expect((await catRow(c.mimi)).homeDescription).toBeNull();
    const letGo = await request(app).post(`/api/cats/${c.mimi}/let-go`).set("X-Device-Secret", SECRET).send({ deviceId: owner });
    expect(letGo.status).toBe(200);
    expect((await catRow(c.agatha)).ownerDeviceId).toBeNull();
  });

  it("a team correction (a note) on Mimi's page lands on Agatha", async () => {
    const c = await merged();
    await libMerge(c.mimi, c.agatha);
    const res = await request(app).post(`/api/team/cats/${c.mimi}/note`).set("Origin", TEAM_ORIGIN).set("Cookie", staff.cookie).send({ text: "Limps a little" });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(observationsTable).where(eq(observationsTable.id, res.body.statementId));
    expect(row!.catId).toBe(c.agatha);
  });

  it("a resolve choosing Mimi files under Agatha", async () => {
    const c = await merged();
    await libMerge(c.mimi, c.agatha);
    const d = await bound();
    const [p] = await db
      .insert(sightingsTable)
      .values({ deviceId: d, photoId: await kit.photo(), lat: 37.4441, lng: 24.9412, status: "pending", createdAt: new Date() })
      .returning();
    const res = await request(app).post(`/api/sightings/${p!.id}/resolve`).set("X-Device-Secret", SECRET).send({ deviceId: d, catId: c.mimi, pickedFrom: "nearby" });
    expect(res.status).toBe(200);
    expect(res.body.cat.id).toBe(c.agatha);
    expect((await db.select().from(sightingsTable).where(eq(sightingsTable.id, p!.id)))[0]!.catId).toBe(c.agatha);
  });
});

describe("reports about Mimi show on Agatha's team page (§9.3: welfare_reports readers)", () => {
  it("the issue strip lists a report tied to the merged-away cat", async () => {
    const c = await merged();
    const report = await seedReport({ kind: "content", reason: "other", catId: c.mimi, publicId: `vt-merged-${tag()}` });
    const team = { scopes: [{ role: "staff", colonyId: null }] };
    expect((await issueStripFor(team, c.agatha))!.total).toBe(0);
    await libMerge(c.mimi, c.agatha);
    const strip = await issueStripFor(team, c.agatha);
    expect(strip!.reports).toHaveLength(1);
    expect(strip!.total).toBe(1);
    await db.delete(welfareReportsTable).where(eq(welfareReportsTable.publicId, report.publicId));
  });
});

describe("spec test 21: also known as", () => {
  it("search finds Agatha by Mimi's name and SYR number, never Mimi; the move screen's search says 'Mimi (now part of Agatha)'", async () => {
    const c = await merged();
    const dora = await kit.cat(daysAgo(80));
    const d0 = await kit.sighting(dora, kit.device(), daysAgo(9));
    await kit.sighting(dora, kit.device(), daysAgo(8));
    await libMerge(c.mimi, c.agatha);
    const byName = await searchTeamCats(c.mimiName);
    expect(byName.map((r) => r.id)).toEqual([c.agatha]);
    expect(byName[0]).toMatchObject({ name: c.agathaName, alsoKnownAs: c.mimiName });
    expect((await searchTeamCats(syrNumber(c.mimi))).map((r) => r.id)).toEqual([c.agatha]);
    // Agatha's own name still finds her, with no "also known as".
    expect((await searchTeamCats(c.agathaName))[0]).toEqual(expect.not.objectContaining({ alsoKnownAs: expect.anything() }));
    const load = await loadMoveScreen({ scopes: [{ role: "staff", colonyId: null }] }, { cat: dora, sightingIds: [d0.id], fresh: false, q: c.mimiName });
    expect(load.kind).toBe("ok");
    const cats = load.kind === "ok" ? (load.screen.results?.cats ?? []) : [];
    expect(cats).toEqual([expect.objectContaining({ id: c.agatha, name: `${c.mimiName} (now part of ${c.agathaName})` })]);
  });

  it("the name-taken prompt names Agatha, and nobody can give a new cat Mimi's name", async () => {
    const c = await merged();
    await libMerge(c.mimi, c.agatha);
    const d = await bound();
    const [p] = await db
      .insert(sightingsTable)
      .values({ deviceId: d, photoId: await kit.photo(), lat: 37.4441, lng: 24.9412, status: "pending", createdAt: new Date() })
      .returning();
    const res = await request(app).post(`/api/sightings/${p!.id}/resolve`).set("X-Device-Secret", SECRET).send({ deviceId: d, newCatName: c.mimiName });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "NAME_TAKEN", cat: { id: c.agatha, name: c.agathaName } });
    expect((await db.select().from(sightingsTable).where(eq(sightingsTable.id, p!.id)))[0]!.status).toBe("pending");
  });
});

describe("the bell (plan C5; D4, D10)", () => {
  it("cat news about Mimi shows under Agatha; the merged line is listed, shaped like a weekly result for the oldest app; nothing pushed", async () => {
    push.sendPushNotification.mockClear();
    const c = await merged();
    const d = await bound();
    await db.insert(catSubscriptionsTable).values({ deviceId: d, catId: c.mimi });
    const [update] = await db.insert(catUpdatesTable).values({ catId: c.mimi, updateType: "general", message: `${c.mimiName} has a new collar` }).returning();
    await db.insert(notificationsTable).values({ deviceId: d, catUpdateId: update!.id, kind: "cat", createdAt: daysAgo(1) });
    await libMerge(c.mimi, c.agatha);

    const res = await request(app).get(`/api/notifications/${d}`).set("X-Device-Secret", SECRET);
    expect(res.status).toBe(200);
    const [mergedLine, news] = res.body as Record<string, unknown>[];
    expect(news).toMatchObject({ catId: c.agatha, catName: c.agathaName, catUpdateId: update!.id, message: `${c.mimiName} has a new collar` });
    expect(mergedLine).toEqual({
      id: expect.any(Number),
      catId: null,
      catUpdateId: null,
      catName: null,
      catPhotoUrl: null,
      updateType: "general",
      message: MERGE_WORDS.merged(c.mimiName, c.agathaName),
      place: null,
      weekPoints: null,
      read: false,
      createdAt: expect.any(String),
    });
    // The oldest app's own schema reads every row.
    const parsed = ListNotificationsResponse.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(push.sendPushNotification).not.toHaveBeenCalled();
  });

  it("a duplicate_points row is listed the same way", async () => {
    const d = await bound();
    await db.insert(notificationsTable).values({ deviceId: d, kind: "duplicate_points", message: MERGE_WORDS.duplicatePoints("Mimi", "Agatha") });
    const res = await request(app).get(`/api/notifications/${d}`).set("X-Device-Secret", SECRET);
    expect(res.body).toEqual([expect.objectContaining({ catId: null, message: MERGE_WORDS.duplicatePoints("Mimi", "Agatha"), place: null, weekPoints: null })]);
    expect(ListNotificationsResponse.safeParse(res.body).success).toBe(true);
  });
});

describe("a merge is never news (§9.12)", () => {
  it("Agatha, last seen 300 days ago, takes in Mimi's sighting from 2 days ago: the nightly check says nothing, and silences it `merged` if it read the old baseline", async () => {
    const agatha = await kit.cat(daysAgo(400));
    const mimi = await kit.cat(daysAgo(400));
    await kit.sighting(agatha, kit.device(), daysAgo(300));
    await kit.sighting(mimi, kit.device(), daysAgo(2));
    await seedNewsBaseline([agatha, mimi], db, daysAgo(1));
    const [old] = await db.select().from(catNewsBaselineTable).where(eq(catNewsBaselineTable.catId, agatha));

    await libMerge(mimi, agatha);
    // The merge re-baselined Agatha: the walk finds nothing to say.
    await db.delete(catNewsRunsTable);
    expect((await runNightlyNewsCheck()).status).toBe("ran");
    const after = await db.select().from(catNewsChangesTable).where(inArray(catNewsChangesTable.catId, [agatha, mimi]));
    expect(after.filter((x) => x.state !== "silenced")).toEqual([]);
    await db.delete(catNewsChangesTable).where(inArray(catNewsChangesTable.catId, [agatha, mimi]));

    // A walk that read Agatha's baseline from before the merge: the change is silenced as `merged`.
    await db.update(catNewsBaselineTable).set({ lastSightingAt: old!.lastSightingAt, updatedAt: old!.updatedAt }).where(eq(catNewsBaselineTable.catId, agatha));
    await db.delete(catNewsRunsTable);
    expect((await runNightlyNewsCheck()).status).toBe("ran");
    const changes = await db.select().from(catNewsChangesTable).where(eq(catNewsChangesTable.catId, agatha));
    expect(changes.map((x) => [x.change, x.state, x.silencedReason])).toEqual([["seen_again", "silenced", "merged"]]);
    await db.delete(catNewsBaselineTable).where(inArray(catNewsBaselineTable.catId, [agatha, mimi]));
  });
});
