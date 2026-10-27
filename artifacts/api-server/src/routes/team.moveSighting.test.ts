import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  catNewsBaselineTable,
  catsTable,
  catSubscriptionsTable,
  catUnfollowsTable,
  db,
  markLeft,
  observationsTable,
  photoVisibilityEventsTable,
  pool,
  sightingMatchesTable,
  sightingMovesTable,
  sightingsTable,
  welfareReportsTable,
} from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { recordedMerge } from "../test/merges";
import { seedSpot } from "../test/extraPhotoKit";
import { guardianOn, newColony, putInColony, signedPerson, type Signed } from "../test/roleKit";
import { seedReport, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { catsOfPhoto, photoTargets } from "../lib/capabilityTargets";
import { hasMetCat } from "../lib/claiming";
import { applyHideRules, prepareHide } from "../lib/issues/hide";
import { MOVE_WORDS } from "../lib/moveSightings";

// SYC-150 PR 3.2 (which-cat-is-which.md §5, §9.7 move, D6): the team's
// "move this sighting to the right cat", through the route. Spec tests 8–12,
// the refusals, and the move steps (follows, the report, the match record,
// the news baselines). Tests 6 and 13 (races) are in
// team.moveSighting.race.test.ts. Cat names are letters only (SYC-709).

const KEY = "vitest-move-key-0123456789abcdef-0123456789abcdef";
const kit = moveKit("VitestMoveRoute");
let staff: Signed;
let guardian: Signed;
let colony: number;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staff = await signedPerson(`mover${tag()}`, ["staff"]);
  colony = await newColony("move");
  guardian = await guardianOn(`guard${tag()}`, [colony]);
});
afterAll(async () => {
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.publicId, "vt-move-%"));
  await kit.cleanup();
  await markLeft(staff.email, "cli:vitest");
  await markLeft(guardian.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const move = (body: object, cookie = staff.cookie) =>
  request(app).post("/api/team/sightings/move").set("Origin", TEAM_ORIGIN).set("Cookie", cookie).send(body);

const catRow = async (id: number) => (await db.select().from(catsTable).where(eq(catsTable.id, id)))[0]!;
const sightingRow = async (id: number) => (await db.select().from(sightingsTable).where(eq(sightingsTable.id, id)))[0]!;
const publicIdOf = async (photoId: number) =>
  (await pool.query<{ public_id: string }>("select public_id from photos where id = $1", [photoId])).rows[0]!.public_id;

/** Mimi with two sightings (so a move leaves her something), and Agatha. */
async function twoCats() {
  const mimi = await kit.cat();
  const agatha = await kit.cat();
  const spotter = kit.device();
  const older = await kit.sighting(mimi, kit.device(), daysAgo(9));
  const s = await kit.sighting(mimi, spotter, daysAgo(3));
  return { mimi, agatha, spotter, older, s };
}

/** A machine colour reading of a photo, as the coat reader writes one. */
async function machineReading(catId: number, photoId: number) {
  const [row] = await db
    .insert(observationsTable)
    .values({
      catId,
      kind: "coat",
      value: { colours: ["ginger"], pattern: "plain", modelVersion: "vitest" },
      accountId: "vision",
      roleAtTime: "system",
      provenance: "machine",
      photoId,
      observedAt: daysAgo(2),
    })
    .returning();
  return row!;
}

describe("who may move", () => {
  it("refuses anyone signed out, and a cat guardian (move_sighting is the team's, D5); nothing moves", async () => {
    const c = await twoCats();
    const body = { sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: c.agatha, reason: "wrong_pick", source: "cat_page" };
    expect((await request(app).post("/api/team/sightings/move").set("Origin", TEAM_ORIGIN).send(body)).status).toBe(401);
    const refused = await move(body, guardian.cookie);
    expect([401, 403]).toContain(refused.status);
    expect((await sightingRow(c.s.id)).catId).toBe(c.mimi);
  });
});

describe("a move (§9.7 move steps 3–8)", () => {
  it("files the sighting under the right cat, with one move row, and carries the spotter's answers in their name", async () => {
    const c = await twoCats();
    const ear = await kit.answer(c.s, "ear_tip", { clipped: true, side: "left" });
    const res = await move({
      sightingIds: [c.s.id],
      expectedCatId: c.mimi,
      toCatId: c.agatha,
      reason: "other",
      reasonText: "Two cats at the bowl",
      source: "cat_page",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fromCatId: c.mimi, toCatId: c.agatha, madeNewCat: false });
    expect((await sightingRow(c.s.id)).catId).toBe(c.agatha);
    const moves = await db.select().from(sightingMovesTable).where(eq(sightingMovesTable.sightingId, c.s.id));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      fromCatId: c.mimi,
      toCatId: c.agatha,
      reason: "other",
      reasonText: "Two cats at the bowl",
      source: "cat_page",
      movedByAccountId: staff.id,
      roleAtTime: "staff",
      madeNewCat: false,
      batchId: res.body.batchId,
    });
    const [copy] = await db.select().from(observationsTable).where(eq(observationsTable.supersedesId, ear.id));
    expect(copy).toMatchObject({ catId: c.agatha, deviceId: c.spotter, roleAtTime: "public", accountId: null, sightingMoveId: moves[0]!.id });
  });

  it("the spotter follows the right cat unless they unfollowed it, and keeps following the old one (§5.9)", async () => {
    const c = await twoCats();
    await db.insert(catSubscriptionsTable).values({ deviceId: c.spotter, catId: c.mimi });
    expect((await move({ sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: c.agatha, reason: "wrong_pick", source: "cat_page" })).status).toBe(200);
    const follows = await db.select().from(catSubscriptionsTable).where(eq(catSubscriptionsTable.deviceId, c.spotter));
    expect(follows.map((f) => f.catId).sort()).toEqual([c.mimi, c.agatha].sort());

    const d = await twoCats();
    await db.insert(catUnfollowsTable).values({ deviceId: d.spotter, catId: d.agatha });
    expect((await move({ sightingIds: [d.s.id], expectedCatId: d.mimi, toCatId: d.agatha, reason: "wrong_pick", source: "cat_page" })).status).toBe(200);
    expect(await db.select().from(catSubscriptionsTable).where(eq(catSubscriptionsTable.deviceId, d.spotter))).toEqual([]);
  });

  it("closes the \"That's a different cat\" report it came from, as done", async () => {
    const c = await twoCats();
    const report = await seedReport({ publicId: `vt-move-${tag()}`, kind: "content", reason: "wrong_cat", catId: c.mimi, photoId: c.s.photoId });
    const res = await move({
      sightingIds: [c.s.id],
      expectedCatId: c.mimi,
      toCatId: c.agatha,
      reason: "different_markings",
      source: "report",
      reportId: report.publicId,
    });
    expect(res.status).toBe(200);
    const [after] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.id, report.id));
    expect(after).toMatchObject({ state: "done", stateChangedBy: staff.id });

    // Another kind of report isn't one to close: nothing moves.
    const d = await twoCats();
    const other = await seedReport({ publicId: `vt-move-${tag()}`, kind: "content", reason: "wrong_name", catId: d.mimi });
    const refused = await move({ sightingIds: [d.s.id], expectedCatId: d.mimi, toCatId: d.agatha, reason: "wrong_pick", source: "report", reportId: other.publicId });
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe("REPORT_NOT_FOUND");
    expect((await sightingRow(d.s.id)).catId).toBe(d.mimi);
  });

  it("fills the match record's team step once, after the commit (step 8)", async () => {
    const c = await twoCats();
    await db.insert(sightingMatchesTable).values({ sightingId: c.s.id, choice: "hand_pick", chosenCatId: c.mimi, chosenAt: daysAgo(3) });
    expect((await move({ sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: c.agatha, reason: "wrong_pick", source: "matched_by_hand" })).status).toBe(200);
    const [m] = await db.select().from(sightingMatchesTable).where(eq(sightingMatchesTable.sightingId, c.s.id));
    expect(m).toMatchObject({ teamAction: "different_cat", teamCatId: c.agatha, teamByAccountId: staff.id, choice: "hand_pick", chosenCatId: c.mimi });
    // Moved back (Agatha keeps a sighting of her own): the first team step stays.
    await kit.sighting(c.agatha, kit.device());
    expect((await move({ sightingIds: [c.s.id], expectedCatId: c.agatha, toCatId: c.mimi, reason: "wrong_pick", source: "cat_page" })).status).toBe(200);
    const [again] = await db.select().from(sightingMatchesTable).where(eq(sightingMatchesTable.sightingId, c.s.id));
    expect(again).toMatchObject({ teamAction: "different_cat", teamCatId: c.agatha });
  });

  it("re-baselines both cats' news, so the nightly check sees no change from it (§9.12)", async () => {
    const c = await twoCats();
    const stale = new Date("2026-01-01T00:00:00Z");
    for (const catId of [c.mimi, c.agatha]) {
      await db.insert(catNewsBaselineTable).values({ catId, sterilisedConfirmed: false, lifeStatus: "street", lastSightingAt: stale, updatedAt: stale });
    }
    expect((await move({ sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: c.agatha, reason: "wrong_pick", source: "cat_page" })).status).toBe(200);
    const rows = await db.select().from(catNewsBaselineTable).where(inArray(catNewsBaselineTable.catId, [c.mimi, c.agatha]));
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.updatedAt.getTime()).toBeGreaterThan(stale.getTime());
    expect(rows.find((r) => r.catId === c.agatha)!.lastSightingAt!.getTime()).toBe(c.s.createdAt.getTime());
  });

  it("to a cat merged into another files it under that cat (§6: Mimi, once part of Agatha, means Agatha)", async () => {
    const c = await twoCats();
    const dora = await kit.cat();
    await recordedMerge(c.agatha, dora);
    const res = await move({ sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: c.agatha, reason: "wrong_pick", source: "cat_page" });
    expect(res.status).toBe(200);
    expect(res.body.toCatId).toBe(dora);
    expect((await sightingRow(c.s.id)).catId).toBe(dora);
  });

  it("spec test 18's move half: an owner never moves; the cat keeps its owner when the owner's own spot moves", async () => {
    const c = await twoCats();
    await db.update(catsTable).set({ ownerDeviceId: c.spotter, ownerName: "Eleni" }).where(eq(catsTable.id, c.mimi));
    expect((await move({ sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: c.agatha, reason: "wrong_pick", source: "cat_page" })).status).toBe(200);
    expect(await catRow(c.mimi)).toMatchObject({ ownerDeviceId: c.spotter, ownerName: "Eleni" });
    expect(await catRow(c.agatha)).toMatchObject({ ownerDeviceId: null, ownerName: null });
  });
});

describe("the refusals (§6, §9.7 move step 1)", () => {
  const to = (c: Awaited<ReturnType<typeof twoCats>>, over: object = {}) => ({
    sightingIds: [c.s.id],
    expectedCatId: c.mimi,
    toCatId: c.agatha,
    reason: "wrong_pick",
    source: "cat_page",
    ...over,
  });

  it("NOT_RESOLVED: a spot still waiting to be matched gets matched, not moved", async () => {
    const c = await twoCats();
    const [pending] = await db
      .insert(sightingsTable)
      .values({ deviceId: kit.device(), photoId: await kit.photo(), lat: 37.4441, lng: 24.9412, status: "awaiting_team" })
      .returning();
    const res = await move(to(c, { sightingIds: [pending!.id] }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "NOT_RESOLVED", error: MOVE_WORDS.notResolved });
  });

  it("SAME_CAT: never to the cat it's under, nor to a cat merged into it", async () => {
    const c = await twoCats();
    expect((await move(to(c, { toCatId: c.mimi }))).body.code).toBe("SAME_CAT");
    const old = await kit.cat();
    await recordedMerge(old, c.mimi);
    const res = await move(to(c, { toCatId: old }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SAME_CAT");
    expect((await sightingRow(c.s.id)).catId).toBe(c.mimi);
  });

  it("MOVED_ALREADY: the screen expected another cat; it is told where each sighting is now, and nothing moves", async () => {
    const c = await twoCats();
    const res = await move(to(c, { expectedCatId: c.agatha, toCatId: await kit.cat() }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "MOVED_ALREADY", error: "Someone changed this a moment ago." });
    expect(res.body.current).toEqual([{ sightingId: c.s.id, catId: c.mimi, status: "resolved" }]);
    expect(await db.select().from(sightingMovesTable).where(eq(sightingMovesTable.sightingId, c.s.id))).toEqual([]);
  });

  it("refuses a body that names a cat and a new cat, neither, or \"Other\" without words", async () => {
    const c = await twoCats();
    expect((await move(to(c, { newCat: { name: "Kiki", letSpottersName: false } }))).status).toBe(400);
    expect((await move({ ...to(c), toCatId: undefined })).status).toBe(400);
    const other = await move(to(c, { reason: "other" }));
    expect(other.status).toBe(400);
    expect(other.body.fields).toContain("reasonText");
  });

  it("the name refusals for a new cat: empty, offensive, a SYR number, taken", async () => {
    const c = await twoCats();
    const named = (name: string) => to(c, { toCatId: undefined, newCat: { name, letSpottersName: false } });
    expect((await move(named("   "))).body.code).toBe("EMPTY_NAME");
    expect((await move(named("fuck"))).body.code).toBe("OFFENSIVE_NAME");
    expect((await move(named("SYR-0042"))).body.code).toBe("SYR_SHAPED_NAME");
    const agatha = await catRow(c.agatha);
    const taken = await move(named(agatha.name.toLowerCase()));
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: "NAME_TAKEN", cat: { id: c.agatha, name: agatha.name } });
    expect((await sightingRow(c.s.id)).catId).toBe(c.mimi);
  });
});

describe("spec test 8: the photo keeps its id", () => {
  it("a photo restored before the move still can't be hidden again by a report after it", async () => {
    const c = await twoCats();
    await db.insert(photoVisibilityEventsTable).values([
      { photoId: c.s.photoId, action: "hide", author: staff.id, personId: staff.id, reason: "vitest" },
      { photoId: c.s.photoId, action: "restore", author: staff.id, personId: staff.id, reason: "vitest" },
    ]);
    expect((await move({ sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: c.agatha, reason: "wrong_pick", source: "cat_page" })).status).toBe(200);
    expect((await sightingRow(c.s.id)).photoId).toBe(c.s.photoId);

    const report = await seedReport({ publicId: `vt-move-${tag()}`, kind: "content", reason: "photo_private", photoId: c.s.photoId, catId: c.agatha });
    const limitsAt = await prepareHide();
    const result = await db.transaction((tx) =>
      applyHideRules(tx, { reportId: report.id, reason: "photo_private", photoId: c.s.photoId, tokenOk: true, address: "203.0.113.9", limitsAt }),
    );
    expect(result).toEqual({ hiddenByReport: false, skipped: "restored_before" });
  });
});

describe("spec test 9: the main photo", () => {
  it("moving the cat's main photo needs the team's choice of the next one (MAIN_PHOTO_NEEDED)", async () => {
    const c = await twoCats();
    await db.update(catsTable).set({ primaryPhotoId: c.s.photoId }).where(eq(catsTable.id, c.mimi));
    const body = { sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: c.agatha, reason: "wrong_pick", source: "cat_page" };
    const res = await move(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MAIN_PHOTO_NEEDED");
    // Not one of the photos staying with her: refused too.
    expect((await move({ ...body, newMainPhotoId: c.s.photoId })).body.code).toBe("MAIN_PHOTO_NEEDED");
    expect((await move({ ...body, newMainPhotoId: await kit.photo() })).body.code).toBe("MAIN_PHOTO_NEEDED");
    // One of hers that stays: chosen.
    expect((await move({ ...body, newMainPhotoId: c.older.photoId })).status).toBe(200);
    expect((await catRow(c.mimi)).primaryPhotoId).toBe(c.older.photoId);
  });

  it("\"No photo for now\" (0) leaves the placeholder, and the colour read from the moved photo stops counting: for the cat, for catsOfPhoto, and for her cat guardians", async () => {
    const c = await twoCats();
    await db.update(catsTable).set({ primaryPhotoId: c.s.photoId }).where(eq(catsTable.id, c.mimi));
    await putInColony(c.mimi, colony);
    const reading = await machineReading(c.mimi, c.s.photoId);
    const publicId = await publicIdOf(c.s.photoId);
    expect(await catsOfPhoto(publicId)).toEqual(expect.arrayContaining([c.mimi]));

    const res = await move({ sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: c.agatha, reason: "wrong_pick", source: "cat_page", newMainPhotoId: 0 });
    expect(res.status).toBe(200);
    expect((await catRow(c.mimi)).primaryPhotoId).toBe(0);
    const [retraction] = await db.select().from(observationsTable).where(eq(observationsTable.supersedesId, reading.id));
    expect(retraction).toMatchObject({ catId: c.mimi, kind: "coat", value: { retracted: true }, accountId: staff.id });
    // The photo is Agatha's now, and only hers.
    expect([...new Set(await catsOfPhoto(publicId))]).toEqual([c.agatha]);
    expect(await photoTargets(publicId)).toEqual([{ colonyId: null }]);
  });
});

describe("spec test 10: the photo that started a cat (D6)", () => {
  it("its map spot moves to the earliest remaining sighting; its name and discoverer stay", async () => {
    const mimi = await kit.cat();
    const agatha = await kit.cat();
    const first = await kit.sighting(mimi, kit.device(), daysAgo(20));
    const [later] = await db
      .insert(sightingsTable)
      .values({ catId: mimi, deviceId: kit.device(), photoId: await kit.photo(), lat: 37.45, lng: 24.95, status: "resolved", createdAt: daysAgo(10) })
      .returning();
    const before = await catRow(mimi);
    expect((await move({ sightingIds: [first.id], expectedCatId: mimi, toCatId: agatha, reason: "two_cats", source: "cat_page" })).status).toBe(200);
    expect(await catRow(mimi)).toMatchObject({ lat: later!.lat, lng: later!.lng, name: before.name, discovererDeviceId: before.discovererDeviceId });
  });

  it("a later sighting moving leaves the map spot where it is", async () => {
    const c = await twoCats();
    await db.update(catsTable).set({ lat: 37.43, lng: 24.93 }).where(eq(catsTable.id, c.mimi));
    expect((await move({ sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: c.agatha, reason: "two_cats", source: "cat_page" })).status).toBe(200);
    expect(await catRow(c.mimi)).toMatchObject({ lat: 37.43, lng: 24.93 });
  });

  it("\"Nothing left\" gives MERGE_INSTEAD (D1): the spec's words, and nothing moves", async () => {
    const mimi = await kit.cat();
    const agatha = await kit.cat();
    const only = await kit.sighting(mimi, kit.device());
    await kit.answer(only, "ear_tip", { clipped: true, side: "left" });
    // The machine's colour of her main photo is not "something".
    await machineReading(mimi, (await catRow(mimi)).primaryPhotoId);
    const res = await move({ sightingIds: [only.id], expectedCatId: mimi, toCatId: agatha, reason: "wrong_pick", source: "cat_page" });
    expect(res.status).toBe(409);
    const [m, a] = [await catRow(mimi), await catRow(agatha)];
    expect(res.body).toMatchObject({ code: "MERGE_INSTEAD", error: MOVE_WORDS.mergeInstead(m.name, a.name), cat: { id: agatha } });
    expect(res.body.error).toBe(`This is everything ${m.name} has, so ${m.name} and ${a.name} are the same cat. Merge ${m.name} into ${a.name}?`);
    expect((await sightingRow(only.id)).catId).toBe(mimi);
    // "It's a new cat" isn't offered either: she already is one.
    const own = await move({ sightingIds: [only.id], expectedCatId: mimi, newCat: { letSpottersName: true }, reason: "wrong_pick", source: "cat_page" });
    expect(own.body.code).toBe("ALREADY_ITS_OWN_CAT");
  });

  it("something anyone recorded about the cat (a team note) means she isn't empty: the move goes ahead", async () => {
    const mimi = await kit.cat();
    const agatha = await kit.cat();
    const only = await kit.sighting(mimi, kit.device());
    await db.insert(observationsTable).values({ catId: mimi, kind: "team_note", value: { text: "Shy" }, accountId: staff.id, roleAtTime: "staff", observedAt: daysAgo(1) });
    expect((await move({ sightingIds: [only.id], expectedCatId: mimi, toCatId: agatha, reason: "wrong_pick", source: "cat_page" })).status).toBe(200);
  });
});

describe("spec test 11: a spot moves whole (D2)", () => {
  it("its face and body photos follow, and the old cat shows none of them", async () => {
    const c = await twoCats();
    const spot = await seedSpot({ deviceId: kit.device(), catId: c.mimi, createdAt: daysAgo(2) });
    expect((await move({ sightingIds: [spot.sightingId], expectedCatId: c.mimi, toCatId: c.agatha, reason: "two_cats", source: "cat_page" })).status).toBe(200);
    for (const p of Object.values(spot.photos)) expect([...new Set(await catsOfPhoto(p.publicId))]).toEqual([c.agatha]);
    const oldPage = await request(app).get(`/api/cats/${c.mimi}`);
    const shown = JSON.stringify(oldPage.body.sightings);
    for (const p of Object.values(spot.photos)) expect(shown).not.toContain(p.publicId);
    // Agatha's page shows all three (the same check, seen to find them).
    const newPage = await request(app).get(`/api/cats/${c.agatha}`);
    const onAgatha = JSON.stringify(newPage.body.sightings);
    for (const p of Object.values(spot.photos)) expect(onAgatha).toContain(p.publicId);
    const moved = newPage.body.sightings.find((s: { extraPhotos?: unknown[] }) => s.extraPhotos);
    // The cover and its two other photos: the spot came whole.
    expect(moved.extraPhotos).toHaveLength(2);
  });
});

describe("spec test 12: moving several sightings to a new cat (a split, §5.5)", () => {
  it("starts the new cat from the oldest: its photo, its place, its spotter; one batch; made_new_cat on the first move only", async () => {
    const mimi = await kit.cat();
    await kit.sighting(mimi, kit.device(), daysAgo(30));
    const finder = kit.device();
    const [oldest] = await db
      .insert(sightingsTable)
      .values({ catId: mimi, deviceId: finder, photoId: await kit.photo(), lat: 37.46, lng: 24.96, status: "resolved", createdAt: daysAgo(12) })
      .returning();
    const newer = await kit.sighting(mimi, kit.device(), daysAgo(4));
    const name = `VitestMoveRoute${tag()}`;
    const res = await move({
      sightingIds: [newer.id, oldest!.id],
      expectedCatId: mimi,
      newCat: { name, letSpottersName: false },
      reason: "two_cats",
      source: "cat_page",
    });
    expect(res.status).toBe(200);
    expect(res.body.madeNewCat).toBe(true);
    const kiki = await catRow(res.body.toCatId);
    expect(kiki).toMatchObject({ name, namePending: false, primaryPhotoId: oldest!.photoId, lat: 37.46, lng: 24.96, discovererDeviceId: finder });
    const moves = await db.select().from(sightingMovesTable).where(eq(sightingMovesTable.batchId, res.body.batchId));
    expect(moves.map((m) => [m.sightingId, m.madeNewCat]).sort()).toEqual([[oldest!.id, true], [newer.id, false]].sort());
    const [nameRow] = await db.select().from(observationsTable).where(and(eq(observationsTable.catId, kiki.id), eq(observationsTable.kind, "name")));
    expect(nameRow).toMatchObject({ accountId: staff.id, roleAtTime: "staff", deviceId: null });
    // No extra points: nothing in the ledger for the new cat.
    expect((await pool.query("select 1 from points_ledger where cat_id = $1", [kiki.id])).rowCount).toBe(0);
  });

  it("\"Let spotters name it\": the SYR number until named, and the spotter whose photo started it may name it, not claim it (D3)", async () => {
    const mimi = await kit.cat();
    await kit.sighting(mimi, kit.device(), daysAgo(30));
    const finder = kit.device();
    const first = await kit.sighting(mimi, finder, daysAgo(8));
    const second = await kit.sighting(mimi, finder, daysAgo(2));
    const res = await move({
      sightingIds: [first.id, second.id],
      expectedCatId: mimi,
      newCat: { letSpottersName: true },
      reason: "two_cats",
      source: "cat_page",
    });
    expect(res.status).toBe(200);
    const kiki = await catRow(res.body.toCatId);
    expect(kiki).toMatchObject({ name: `SYR-${String(kiki.id).padStart(4, "0")}`, namePending: true, discovererDeviceId: finder });
    const moves = await db.select().from(sightingMovesTable).where(eq(sightingMovesTable.batchId, res.body.batchId));
    expect(moves.find((m) => m.sightingId === first.id)).toMatchObject({ madeNewCat: true, letSpottersName: true });
    expect(moves.find((m) => m.sightingId === second.id)).toMatchObject({ madeNewCat: false, letSpottersName: false });
    expect(await hasMetCat(db, kiki.id, finder, "name")).toBe(true);
    expect(await hasMetCat(db, kiki.id, finder, "claim")).toBe(false);
  });

  it("a deleted spotter's oldest sighting starts a cat with no discoverer, stamped redacted", async () => {
    const mimi = await kit.cat();
    await kit.sighting(mimi, kit.device(), daysAgo(30));
    const gone = kit.device();
    const s = await kit.sighting(mimi, gone, daysAgo(5));
    await pool.query(
      "update sightings set device_id = null, redacted_at = now(), redaction_reason = 'deleted by the person' where id = $1",
      [s.id],
    );
    const res = await move({ sightingIds: [s.id], expectedCatId: mimi, newCat: { letSpottersName: true }, reason: "two_cats", source: "cat_page" });
    expect(res.status).toBe(200);
    const kiki = await catRow(res.body.toCatId);
    expect(kiki.discovererDeviceId).toBeNull();
    expect(kiki.redactedAt).not.toBeNull();
  });
});
