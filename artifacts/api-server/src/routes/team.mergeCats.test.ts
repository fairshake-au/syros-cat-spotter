import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  catSubscriptionsTable,
  catUnfollowsTable,
  catsTable,
  db,
  deviceCredentialsTable,
  duplicateDecisionsTable,
  duplicateReportsTable,
  markLeft,
  mergeFollowChangesTable,
  notificationsTable,
  observationsTable,
  pointsLedgerTable,
  pool,
  profilesTable,
  sightingMatchesTable,
  sightingMovesTable,
  sightingsTable,
} from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
const push = vi.hoisted(() => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/push", () => push);

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { libMerge, libUndo } from "../test/merges";
import { moveSighting } from "../test/moves";
import { signedPerson, guardianOn, newColony, type Signed } from "../test/roleKit";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { canonicalCatOf } from "../lib/catIdentity";
import { deriveCatStatuses, listCatsWithStats, totalCatCount } from "../lib/catHelpers";
import { hasMetCat, letGoWithinDays } from "../lib/claiming";
import { computeBadgeStats } from "../lib/badges/stats";
import { loadCatRecords, writeObservation } from "../lib/observations";
import { agreeWithClip } from "../lib/teamCorrections";
import { severTeamMember } from "../lib/severPerson";
import { MERGE_WORDS } from "../lib/mergeCats";
import { matcherPool } from "./sightings";

// SYC-59 PR 4.1 (which-cat-is-which.md §4, §9.7 merge and undo, §9.8): the
// team's "these two records are the same cat", through the route and its
// lib. Spec tests 14, 15 (through the route), 16, 16b, 17, 18, 19, 20, 22 and
// 28, the refusals, and the in-app lines (never pushed). Test 16a and the
// races are in team.mergeCats.race.test.ts; test 21 ("also known as") in
// team.alsoKnownAs.test.ts. Cat names are letters only (SYC-709).

const KEY = "vitest-merge-key-0123456789abcdef-0123456789abcdef";
const kit = moveKit("VitestMergeRoute");
let staff: Signed;
let guardian: Signed;
const STAFF = () => ({ id: staff.id, scopes: [{ role: "staff", colonyId: null }] });

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staff = await signedPerson(`merger${tag()}`, ["staff"]);
  guardian = await guardianOn(`mguard${tag()}`, [await newColony("merge")]);
});
afterAll(async () => {
  await kit.cleanup();
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await markLeft(staff.email, "cli:vitest");
  await markLeft(guardian.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const resolvedCount = async (catId: number) =>
  (await db.select({ id: sightingsTable.id }).from(sightingsTable).where(and(eq(sightingsTable.catId, catId), eq(sightingsTable.status, "resolved"))))
    .length;

const merge = async (mergedId: number, survivorId: number, extra: object = {}, cookie = staff.cookie) =>
  request(app)
    .post("/api/team/cats/merge")
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", cookie)
    .send({
      survivorId,
      mergedId,
      expectedSightingCounts: [await resolvedCount(survivorId), await resolvedCount(mergedId)],
      reasonText: "Same face markings and torn left ear",
      survivorChosen: "default",
      ...extra,
    });

const undo = (mergeId: number, body: object = {}, cookie = staff.cookie) =>
  request(app)
    .post(`/api/team/cats/merge/${mergeId}/undo`)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", cookie)
    .send({ reasonText: "Different cats after all", ...body });

const catRow = async (id: number) => (await db.select().from(catsTable).where(eq(catsTable.id, id)))[0]!;
const sightingRow = async (id: number) => (await db.select().from(sightingsTable).where(eq(sightingsTable.id, id)))[0]!;

/** Mimi (two sightings) and Agatha (one, older): Agatha stays by default (D7). */
async function pair() {
  const agatha = await kit.cat(daysAgo(60));
  const mimi = await kit.cat(daysAgo(40));
  const a0 = await kit.sighting(agatha, kit.device(), daysAgo(30));
  const m1 = await kit.sighting(mimi, kit.device(), daysAgo(20));
  const m2 = await kit.sighting(mimi, kit.device(), daysAgo(4));
  return { agatha, mimi, a0, m1, m2 };
}

describe("who may merge (D5)", () => {
  it("refuses anyone signed out, and a cat guardian; nothing changes", async () => {
    const c = await pair();
    expect((await request(app).post("/api/team/cats/merge").set("Origin", TEAM_ORIGIN).send({})).status).toBe(401);
    const refused = await merge(c.mimi, c.agatha, {}, guardian.cookie);
    expect([401, 403]).toContain(refused.status);
    expect((await sightingRow(c.m1.id)).catId).toBe(c.mimi);
    expect((await canonicalCatOf([c.mimi])).get(c.mimi)).toBe(c.mimi);
  });
});

describe("a merge (§9.7 merge steps 1–8)", () => {
  it("one merge row, a `merged` move per sighting in one batch, the sightings filed under the survivor, no statement copied", async () => {
    const c = await pair();
    const ear = await kit.answer(c.m1, "ear_tip", { clipped: true, side: "left" });
    const res = await merge(c.mimi, c.agatha);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ survivorId: c.agatha, mergedId: c.mimi, moved: [c.m1.id, c.m2.id] });
    expect((await canonicalCatOf([c.mimi])).get(c.mimi)).toBe(c.agatha);
    for (const s of [c.m1, c.m2]) expect((await sightingRow(s.id)).catId).toBe(c.agatha);
    const moves = await db.select().from(sightingMovesTable).where(inArray(sightingMovesTable.sightingId, [c.m1.id, c.m2.id]));
    expect(moves).toHaveLength(2);
    expect(new Set(moves.map((m) => m.batchId)).size).toBe(1);
    for (const m of moves) {
      expect(m).toMatchObject({ fromCatId: c.mimi, toCatId: c.agatha, mergeId: res.body.mergeId, reason: "merged", source: "merge", movedByAccountId: staff.id, roleAtTime: "staff" });
    }
    // §9.5: a merge's moves copy nothing. Mimi's answer stays on Mimi, and counts for Agatha through the merge.
    expect((await kit.rowsOf(c.agatha)).filter((o) => o.sightingMoveId !== null)).toEqual([]);
    expect((await kit.rowsOf(c.mimi)).map((o) => o.id)).toContain(ear.id);
    const records = (await loadCatRecords([c.agatha])).get(c.agatha)!;
    expect(records.observations.map((o) => o.id)).toContain(ear.id);
    // The decision, and the reason the team gave.
    const [decision] = await db.select().from(duplicateDecisionsTable).where(eq(duplicateDecisionsTable.mergeId, res.body.mergeId));
    expect(decision).toMatchObject({ catLow: Math.min(c.mimi, c.agatha), catHigh: Math.max(c.mimi, c.agatha), decision: "merged", byAccountId: staff.id });
  });

  it("the record that stays is written as what it was: the earlier, unless switched (D7)", async () => {
    const c = await pair();
    const res = await merge(c.agatha, c.mimi, { survivorChosen: "default" });
    expect(res.status).toBe(200);
    const merged = await db.select().from(sightingMovesTable).where(eq(sightingMovesTable.mergeId, res.body.mergeId));
    expect(merged.every((m) => m.toCatId === c.mimi)).toBe(true);
    // Agatha is the earlier record, so keeping Mimi is a switch, whatever the screen said.
    const [row] = await pool.query<{ survivor_chosen: string; reason_text: string }>("select survivor_chosen, reason_text from cat_identity where id = $1", [res.body.mergeId]).then((r) => r.rows);
    expect(row).toEqual({ survivor_chosen: "switched", reason_text: "Same face markings and torn left ear" });
  });
});

describe("spec test 14: the survivor equals one cat holding both records", () => {
  /**
   * The same history on two cats (Mimi's half and Agatha's half) or on one:
   * Agatha seen 30 and 12 days ago; Mimi recorded as having died 25 days ago,
   * then seen 20 and 4 days ago, the first time with a clipped ear the team
   * agreed with.
   */
  async function history(agathaSide: number, mimiSide: number) {
    await kit.sighting(agathaSide, kit.device(), daysAgo(30));
    await kit.sighting(agathaSide, kit.device(), daysAgo(12));
    await writeObservation(db, { catId: mimiSide, kind: "life_status", value: { status: "deceased" }, accountId: "vitest-merge-team", roleAtTime: "staff", observedAt: daysAgo(25) });
    const s = await kit.sighting(mimiSide, kit.device(), daysAgo(20));
    const ear = await kit.answer(s, "ear_tip", { clipped: true, side: "left" });
    await agreeWithClip(STAFF(), ear.id);
    await kit.sighting(mimiSide, kit.device(), daysAgo(4));
  }
  const view = async (catId: number) => {
    const body = (await request(app).get(`/api/cats/${catId}`)).body;
    const { sightingsCount, lastSeenAt, lifeStatus, notSeenSince, sterilised, hasHome } = body.cat;
    const derived = (await deriveCatStatuses([{ id: catId, ownerDeviceId: null }])).get(catId)!;
    // How many statements of each kind stand behind the record: a merge that
    // copied statements would count each of Mimi's twice.
    const records = (await loadCatRecords([catId])).get(catId)!.observations.filter((o) => !("elsewhere" in o && o.elsewhere));
    const statements: Record<string, number> = {};
    for (const o of records) statements[o.kind] = (statements[o.kind] ?? 0) + 1;
    return { sightingsCount, lastSeenAt, lifeStatus, notSeenSince, sterilised, hasHome, derivedSterilised: derived.sterilised, derivedLife: derived.lifeStatus, statements };
  };

  it("sterilised, life status, last seen and sightings match; Mimi is gone from the list, the pool and the count; her page opens Agatha", async () => {
    const agatha = await kit.cat(daysAgo(60));
    const mimi = await kit.cat(daysAgo(50));
    await history(agatha, mimi);
    const both = await kit.cat(daysAgo(60));
    await history(both, both);
    const totalBefore = await totalCatCount();

    const res = await merge(mimi, agatha);
    expect(res.status).toBe(200);
    const merged = await view(agatha);
    expect(merged).toEqual(await view(both));
    expect(merged.sightingsCount).toBe(4);
    expect(merged.lifeStatus).not.toBe("deceased");
    expect(merged.sterilised.value).not.toBe("unknown");

    expect(await totalCatCount()).toBe(totalBefore - 1);
    const listed = (await listCatsWithStats({ from: { lat: 37.4441, lng: 24.9412 }, pageSize: 200 })).cats.map((c) => c.id);
    expect(listed).toContain(agatha);
    expect(listed).not.toContain(mimi);
    const pool = (await matcherPool()).map((c) => c.id);
    expect(pool).toContain(agatha);
    expect(pool).not.toContain(mimi);

    const page = await request(app).get(`/api/cats/${mimi}`);
    expect(page.status).toBe(200);
    expect(page.body.cat.id).toBe(agatha);
    expect(page.body.mergedFrom).toEqual({ id: mimi, name: (await catRow(mimi)).name });
    expect((await request(app).get(`/api/cats/${agatha}`)).body.mergedFrom).toBeUndefined();
  });

  it("spec test 15 through the route: merge then undo, and both cats read as before", async () => {
    const agatha = await kit.cat(daysAgo(60));
    const mimi = await kit.cat(daysAgo(50));
    await history(agatha, mimi);
    const before = { agatha: await view(agatha), mimi: await view(mimi), total: await totalCatCount() };
    const records = async (id: number) => (await loadCatRecords([id])).get(id)!.observations.map((o) => o.id).sort((a, b) => a - b);
    const recordsBefore = { agatha: await records(agatha), mimi: await records(mimi) };
    const res = await merge(mimi, agatha);
    expect(res.status).toBe(200);
    expect((await undo(res.body.mergeId)).status).toBe(200);
    expect({ agatha: await view(agatha), mimi: await view(mimi), total: await totalCatCount() }).toEqual(before);
    expect({ agatha: await records(agatha), mimi: await records(mimi) }).toEqual(recordsBefore);
  });
});

describe("spec test 16: chains", () => {
  it("Mimi→Agatha→Dora counts for Dora; undoing Mimi→Agatha first is refused; undoing Agatha→Dora leaves Mimi in Agatha; a loop is refused", async () => {
    const dora = await kit.cat(daysAgo(90));
    const c = await pair();
    const first = await merge(c.mimi, c.agatha);
    expect(first.status).toBe(200);
    const second = await merge(c.agatha, dora);
    expect(second.status).toBe(200);
    expect((await canonicalCatOf([c.mimi])).get(c.mimi)).toBe(dora);
    for (const s of [c.a0, c.m1, c.m2]) expect((await sightingRow(s.id)).catId).toBe(dora);

    const early = await undo(first.body.mergeId);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("UNDO_LATER_MERGE_FIRST");
    expect(early.body.error).toBe(MERGE_WORDS.undoLaterFirst((await catRow(c.agatha)).name, (await catRow(dora)).name));
    expect((await canonicalCatOf([c.mimi])).get(c.mimi)).toBe(dora);

    // A loop: Dora into Mimi, while Mimi is part of Dora.
    const loop = await merge(dora, c.mimi);
    expect(loop.status).toBe(409);
    expect(loop.body.code).toBe("ALREADY_MERGED");

    expect((await undo(second.body.mergeId)).status).toBe(200);
    expect((await canonicalCatOf([c.mimi, c.agatha])).get(c.mimi)).toBe(c.agatha);
    expect((await canonicalCatOf([c.agatha])).get(c.agatha)).toBe(c.agatha);
    // Agatha's merge moved Mimi's sightings on to Dora; its undo brings them back to Agatha, still Mimi's merge's.
    for (const s of [c.a0, c.m1, c.m2]) expect((await sightingRow(s.id)).catId).toBe(c.agatha);

    expect((await undo(first.body.mergeId)).status).toBe(200);
    expect((await sightingRow(c.a0.id)).catId).toBe(c.agatha);
    expect((await sightingRow(c.m1.id)).catId).toBe(c.mimi);
    expect((await sightingRow(c.m2.id)).catId).toBe(c.mimi);
  });
});

describe("spec test 16b: a late answer goes back with its sighting", () => {
  it("an answer added on the survivor after the merge is copied back to Mimi on undo, in the spotter's name, and stops counting for Agatha", async () => {
    const c = await pair();
    const res = await merge(c.mimi, c.agatha);
    expect(res.status).toBe(200);
    const late = await kit.answer(await sightingRow(c.m2.id), "ear_tip", { clipped: true, side: "right" });
    expect(late.catId).toBe(c.agatha);
    expect((await undo(res.body.mergeId)).status).toBe(200);
    const copies = (await kit.rowsOf(c.mimi)).filter((o) => o.supersedesId === late.id);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ kind: "ear_tip", deviceId: c.m2.deviceId, roleAtTime: "public", accountId: null, sightingId: c.m2.id, supersedeReason: "moved" });
    const agathaRows = (await loadCatRecords([c.agatha])).get(c.agatha)!.observations;
    expect(agathaRows.find((o) => o.id === late.id)).toBeDefined();
    expect(agathaRows.find((o) => o.id === copies[0]!.id)).toMatchObject({ elsewhere: true });
    // Mimi's own earlier rows were never copied: only the late answer.
    expect((await kit.rowsOf(c.mimi)).filter((o) => o.sightingMoveId !== null)).toHaveLength(1);
  });
});

describe("spec test 17: followers", () => {
  it("move without duplicates, unfollows win, deleted phones are skipped; undo takes back only what the merge added and nobody changed since", async () => {
    const c = await pair();
    const [onlyMimi, both, leftAgatha, unfollowedMimi, refollows] = [kit.device(), kit.device(), kit.device(), kit.device(), kit.device()];
    const gone = `deleted:${kit.devicePrefix}${tag()}`;
    await db.insert(catSubscriptionsTable).values([
      { deviceId: onlyMimi, catId: c.mimi },
      { deviceId: both, catId: c.mimi },
      { deviceId: both, catId: c.agatha },
      { deviceId: leftAgatha, catId: c.mimi },
      { deviceId: gone, catId: c.mimi },
      { deviceId: refollows, catId: c.mimi },
    ]);
    await db.insert(catUnfollowsTable).values([
      { deviceId: leftAgatha, catId: c.agatha },
      { deviceId: unfollowedMimi, catId: c.mimi },
    ]);
    const res = await merge(c.mimi, c.agatha);
    expect(res.status).toBe(200);
    expect(res.body.followsAdded).toBe(2);
    const followsAgatha = async () =>
      (await db.select().from(catSubscriptionsTable).where(eq(catSubscriptionsTable.catId, c.agatha))).map((r) => r.deviceId).sort();
    const unfollowsAgatha = async () =>
      (await db.select().from(catUnfollowsTable).where(eq(catUnfollowsTable.catId, c.agatha))).map((r) => r.deviceId).sort();
    expect(await followsAgatha()).toEqual([both, onlyMimi, refollows].sort());
    expect(await unfollowsAgatha()).toEqual([leftAgatha, unfollowedMimi].sort());
    const changes = await db.select().from(mergeFollowChangesTable).where(eq(mergeFollowChangesTable.mergeId, res.body.mergeId));
    expect(changes.map((x) => `${x.kind}:${x.deviceId}`).sort()).toEqual([`follow:${onlyMimi}`, `follow:${refollows}`, `unfollow:${unfollowedMimi}`].sort());

    // After the merge, one phone unfollows and follows Agatha again: that row is theirs now.
    await db.delete(catSubscriptionsTable).where(and(eq(catSubscriptionsTable.deviceId, refollows), eq(catSubscriptionsTable.catId, c.agatha)));
    await db.insert(catSubscriptionsTable).values({ deviceId: refollows, catId: c.agatha });

    const u = await undo(res.body.mergeId);
    expect(u.status).toBe(200);
    expect(u.body.followsRemoved).toBe(2);
    expect(await followsAgatha()).toEqual([both, refollows].sort());
    expect(await unfollowsAgatha()).toEqual([leftAgatha]);
  });
});

describe("spec test 18: owners, names, claim waits, colour and markings", () => {
  const owned = async (catId: number) => {
    const owner = kit.device();
    await db.update(catsTable).set({ ownerDeviceId: owner, ownerName: "Vt" }).where(eq(catsTable.id, catId));
    return owner;
  };

  it("the record with an owner must stay; two owners are refused; the owner stays with the survivor", async () => {
    const c = await pair();
    await owned(c.mimi);
    const wrongWay = await merge(c.mimi, c.agatha);
    expect(wrongWay.status).toBe(409);
    expect(wrongWay.body).toMatchObject({ code: "OWNER_MUST_STAY", catId: c.mimi });
    await owned(c.agatha);
    expect((await merge(c.mimi, c.agatha)).body.code).toBe("TWO_OWNERS");
    expect((await merge(c.agatha, c.mimi)).body.code).toBe("TWO_OWNERS");
    expect((await sightingRow(c.m1.id)).catId).toBe(c.mimi);

    const d = await pair();
    const owner = await owned(d.agatha);
    const ok = await merge(d.mimi, d.agatha);
    expect(ok.status).toBe(200);
    expect((await catRow(d.agatha)).ownerDeviceId).toBe(owner);
    expect((await catRow(d.mimi)).ownerDeviceId).toBeNull();
  });

  it("an owner whose phone was deleted still counts as an owner (their \"has a home\" stands)", async () => {
    const c = await pair();
    const homed = await writeObservation(db, { catId: c.mimi, kind: "life_status", value: { status: "homed" }, deviceId: kit.device(), roleAtTime: "public", authorityScope: "owner_of_this_cat", observedAt: daysAgo(5) });
    // Deletion unlinked the owner (D13): the owner link is gone, the row stays with nobody on it.
    await pool.query("update observations set device_id = null, redacted_at = now(), redaction_reason = 'deleted by the person' where id = $1", [homed.id]);
    expect((await catRow(c.mimi)).ownerDeviceId).toBeNull();
    expect((await merge(c.mimi, c.agatha)).body.code).toBe("OWNER_MUST_STAY");
  });

  it("a pending name never stays over a named record", async () => {
    const c = await pair();
    await db.update(catsTable).set({ name: `SYR-${c.agatha}`, namePending: true }).where(eq(catsTable.id, c.agatha));
    const res = await merge(c.mimi, c.agatha);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "NAME_PENDING_MUST_GO", catId: c.agatha });
    expect((await merge(c.agatha, c.mimi)).status).toBe(200);
  });

  it("the claim waits are checked across both records; colour and markings stay the survivor's own", async () => {
    const c = await pair();
    const phone = kit.device();
    const homed = await writeObservation(db, { catId: c.mimi, kind: "life_status", value: { status: "homed" }, deviceId: phone, roleAtTime: "public", authorityScope: "owner_of_this_cat", observedAt: daysAgo(3) });
    await writeObservation(db, { catId: c.mimi, kind: "life_status", value: { withdrawn: true }, allowWithdrawal: true, deviceId: phone, roleAtTime: "public", authorityScope: "owner_of_this_cat", observedAt: daysAgo(2), supersedesId: homed.id, supersedeReason: "owner: doesn't live with me any more" });
    const coat = (catId: number, colours: string[]) =>
      writeObservation(db, { catId, kind: "coat", value: { colours, pattern: "plain" }, accountId: "vitest-merge-team", roleAtTime: "staff", observedAt: daysAgo(10) });
    await coat(c.agatha, ["ginger"]);
    await coat(c.mimi, ["black"]);
    expect(await letGoWithinDays(db, c.agatha, phone, 30)).toBe(false);
    expect((await merge(c.mimi, c.agatha)).status).toBe(200);
    expect(await letGoWithinDays(db, c.agatha, phone, 30)).toBe(true);
    const derived = (await deriveCatStatuses([{ id: c.agatha, ownerDeviceId: null }])).get(c.agatha)!;
    expect(derived.coatColours).toEqual(["ginger"]);
  });
});

describe("spec test 19: duplicate-finder points", () => {
  /** A phone with resolved spots on `days` different Athens days (3 makes it count). */
  async function phoneWith(days: number, catId: number) {
    const d = kit.device();
    for (let i = 0; i < days; i++) await kit.sighting(catId, d, daysAgo(70 + i * 2));
    return d;
  }
  const report = (a: number, b: number, deviceId: string, says: "same" | "different" = "same", createdAt = daysAgo(1)) =>
    db.insert(duplicateReportsTable).values({ catLow: Math.min(a, b), catHigh: Math.max(a, b), source: "spotter_question", says, deviceId, createdAt });
  const pointsOf = async (d: string) => (await db.select().from(profilesTable).where(eq(profilesTable.deviceId, d)))[0]?.points ?? 0;
  const ledgerOf = (d: string) => db.select().from(pointsLedgerTable).where(and(eq(pointsLedgerTable.deviceId, d), eq(pointsLedgerTable.source, "duplicate")));

  it("10 once per counting phone per pair, only for 'same' reports dated before the merge; kept after an undo; not paid again on a re-merge", async () => {
    const c = await pair();
    const elsewhere = await kit.cat(daysAgo(200));
    const counting = await phoneWith(3, elsewhere);
    const twice = await phoneWith(4, elsewhere);
    const newPhone = await phoneWith(2, elsewhere);
    const saidDifferent = await phoneWith(3, elsewhere);
    const tooLate = await phoneWith(3, elsewhere);
    await report(c.mimi, c.agatha, counting);
    await report(c.mimi, c.agatha, twice);
    await report(c.agatha, c.mimi, twice, "same", daysAgo(2));
    await report(c.mimi, c.agatha, newPhone);
    await report(c.mimi, c.agatha, saidDifferent, "different");
    await report(c.mimi, c.agatha, tooLate, "same", new Date(Date.now() + 3_600_000));
    const before = { counting: await pointsOf(counting), twice: await pointsOf(twice), newPhone: await pointsOf(newPhone) };

    const res = await merge(c.mimi, c.agatha);
    expect(res.status).toBe(200);
    expect(res.body.paid).toBe(2);
    expect(await pointsOf(counting)).toBe(before.counting + 10);
    expect(await pointsOf(twice)).toBe(before.twice + 10);
    expect(await pointsOf(newPhone)).toBe(before.newPhone);
    expect(await ledgerOf(saidDifferent)).toEqual([]);
    expect(await ledgerOf(tooLate)).toEqual([]);
    const [row] = await ledgerOf(counting);
    expect(row).toMatchObject({
      sightingId: null,
      duplicateCatLow: Math.min(c.mimi, c.agatha),
      duplicateCatHigh: Math.max(c.mimi, c.agatha),
      catId: c.agatha,
      points: 10,
    });

    // Undo keeps them; merging again (either way round) pays nobody twice.
    expect((await undo(res.body.mergeId)).status).toBe(200);
    expect(await pointsOf(counting)).toBe(before.counting + 10);
    const again = await merge(c.agatha, c.mimi, { survivorChosen: "switched" });
    expect(again.status).toBe(200);
    expect(again.body.paid).toBe(0);
    expect(await pointsOf(counting)).toBe(before.counting + 10);
    expect(await ledgerOf(counting)).toHaveLength(1);
    expect(await ledgerOf(twice)).toHaveLength(1);
  });

  it("the points count on the week board, never as an active week or a spotted cat (C4)", async () => {
    const c = await pair();
    const elsewhere = await kit.cat(daysAgo(200));
    const phone = await phoneWith(3, elsewhere);
    await report(c.mimi, c.agatha, phone);
    const statsBefore = await db.transaction((tx) => computeBadgeStats(tx, phone));
    expect((await merge(c.mimi, c.agatha)).status).toBe(200);
    const statsAfter = await db.transaction((tx) => computeBadgeStats(tx, phone));
    // The points went up; nothing else a badge counts did (weeks, cats, spots).
    expect(statsAfter).toEqual({ ...statsBefore, points: Number(statsBefore.points) + 10 });
    const week = await pool.query<{ n: number }>(
      "select coalesce(sum(points), 0)::int as n from points_ledger where device_id = $1 and week_start = (select week_start from points_ledger where device_id = $1 and source = 'duplicate')",
      [phone],
    );
    expect(week.rows[0]!.n).toBeGreaterThanOrEqual(10);
  });

  it("the paid phones get the in-app line; nobody is pushed", async () => {
    push.sendPushNotification.mockClear();
    const c = await pair();
    const elsewhere = await kit.cat(daysAgo(200));
    const phone = await phoneWith(3, elsewhere);
    await report(c.mimi, c.agatha, phone);
    const follower = kit.device();
    await db.insert(catSubscriptionsTable).values({ deviceId: follower, catId: c.mimi });
    expect((await merge(c.mimi, c.agatha)).status).toBe(200);
    const [mimiName, agathaName] = [(await catRow(c.mimi)).name, (await catRow(c.agatha)).name];
    const lines = await db.select().from(notificationsTable).where(inArray(notificationsTable.deviceId, [phone, follower]));
    expect(lines.map((l) => ({ deviceId: l.deviceId, kind: l.kind, message: l.message, catUpdateId: l.catUpdateId })).sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { deviceId: phone, kind: "duplicate_points", message: MERGE_WORDS.duplicatePoints(mimiName, agathaName), catUpdateId: null },
      { deviceId: follower, kind: "merged", message: MERGE_WORDS.merged(mimiName, agathaName), catUpdateId: null },
    ]);
    // Give any stray background send a moment, then: no push for either kind.
    await new Promise((r) => setTimeout(r, 50));
    expect(push.sendPushNotification).not.toHaveBeenCalled();
  });
});

describe("spec test 20: a spotter who matched Mimi has met Agatha", () => {
  it("for naming and for claiming", async () => {
    const c = await pair();
    const spotter = c.m1.deviceId!;
    await db.insert(sightingMatchesTable).values({ sightingId: c.m1.id, choice: "hand_pick", chosenCatId: c.mimi, chosenAt: c.m1.createdAt });
    expect(await hasMetCat(db, c.agatha, spotter, "claim")).toBe(false);
    expect((await merge(c.mimi, c.agatha)).status).toBe(200);
    expect(await hasMetCat(db, c.agatha, spotter, "claim")).toBe(true);
    expect(await hasMetCat(db, c.agatha, spotter, "name")).toBe(true);
  });
});

describe("spec test 22: undo moves back only the merge's own moves", () => {
  it("a sighting moved again stays; ticked post-merge sightings go to Mimi as ordinary moves; Agatha's own can't be ticked", async () => {
    const c = await pair();
    const dora = await kit.cat(daysAgo(90));
    await kit.sighting(dora, kit.device(), daysAgo(50));
    const res = await merge(c.mimi, c.agatha);
    expect(res.status).toBe(200);
    // After the merge: m1 is moved on to Dora; a new spot of Agatha arrives (it is Mimi really).
    await moveSighting(c.m1.id, dora);
    const later = await kit.sighting(c.agatha, kit.device(), new Date());
    const laterEar = await kit.answer(later, "food_and_water", { present: true });

    const tickedOwn = await undo(res.body.mergeId, { alsoMoveSightingIds: [c.a0.id] });
    expect(tickedOwn.status).toBe(409);
    expect(tickedOwn.body.code).toBe("NOT_TO_MOVE");

    const u = await undo(res.body.mergeId, { alsoMoveSightingIds: [later.id] });
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ movedBack: [c.m2.id], alsoMoved: [later.id] });
    expect((await sightingRow(c.m2.id)).catId).toBe(c.mimi);
    expect((await sightingRow(later.id)).catId).toBe(c.mimi);
    expect((await sightingRow(c.m1.id)).catId).toBe(dora);
    expect((await sightingRow(c.a0.id)).catId).toBe(c.agatha);
    const [laterMove] = await db.select().from(sightingMovesTable).where(and(eq(sightingMovesTable.sightingId, later.id)));
    expect(laterMove).toMatchObject({ fromCatId: c.agatha, toCatId: c.mimi, mergeId: null, reason: "other", source: "undo", reasonText: "Different cats after all" });
    // An ordinary move: the spotter's answer went with it.
    expect((await kit.rowsOf(c.mimi)).find((o) => o.supersedesId === laterEar.id)).toMatchObject({ deviceId: later.deviceId, roleAtTime: "public" });
    // The undo row and the decision.
    const [decision] = await db.select().from(duplicateDecisionsTable).where(eq(duplicateDecisionsTable.mergeId, u.body.undoId));
    expect(decision).toMatchObject({ decision: "merge_undone" });
    expect((await canonicalCatOf([c.mimi])).get(c.mimi)).toBe(c.mimi);
  });
});

describe("refusals", () => {
  it("SAME_CAT, NOT_FOUND, ALREADY_MERGED, STALE and ALREADY_UNDONE; nothing written", async () => {
    const c = await pair();
    expect((await merge(c.mimi, c.mimi)).body.code).toBe("SAME_CAT");
    expect((await merge(c.mimi, 2_000_000_000)).status).toBe(404);
    const stale = await merge(c.mimi, c.agatha, { expectedSightingCounts: [1, 1] });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "STALE", error: MERGE_WORDS.stale });
    expect((await sightingRow(c.m1.id)).catId).toBe(c.mimi);
    const ok = await merge(c.mimi, c.agatha);
    expect(ok.status).toBe(200);
    const third = await kit.cat();
    expect((await merge(c.mimi, third)).body.code).toBe("ALREADY_MERGED");
    expect((await merge(third, c.mimi)).body.code).toBe("ALREADY_MERGED");
    expect((await undo(ok.body.mergeId)).status).toBe(200);
    expect((await undo(ok.body.mergeId)).body.code).toBe("ALREADY_UNDONE");
    expect((await undo(2_000_000_000)).status).toBe(404);
    expect((await request(app).post("/api/team/cats/merge").set("Origin", TEAM_ORIGIN).set("Cookie", staff.cookie).send({ survivorId: c.agatha, mergedId: c.mimi })).status).toBe(400);
  });
});

describe("spec test 28: a deleted team member's merges and decisions are kept, with who made them cleared", () => {
  it("severTeamMember clears the merger on the merge row, its moves, the follow-up undo and the decisions", async () => {
    const mover = await signedPerson(`gone${tag()}`, ["staff"]);
    const c = await pair();
    const res = await merge(c.mimi, c.agatha, {}, mover.cookie);
    expect(res.status).toBe(200);
    const u = await undo(res.body.mergeId, {}, mover.cookie);
    expect(u.status).toBe(200);
    await db.transaction((tx) => severTeamMember(tx, { accountId: mover.id, reason: "deleted by the person" }));
    const rows = await pool.query("select id, by_account_id, redacted_at from cat_identity where id in ($1, $2)", [res.body.mergeId, u.body.undoId]);
    expect(rows.rows).toHaveLength(2);
    for (const r of rows.rows) {
      expect(r.by_account_id).toBeNull();
      expect(r.redacted_at).not.toBeNull();
    }
    const moves = await db.select().from(sightingMovesTable).where(inArray(sightingMovesTable.mergeId, [res.body.mergeId, u.body.undoId]));
    expect(moves.length).toBe(4);
    expect(moves.every((m) => m.movedByAccountId === null && m.redactedAt !== null)).toBe(true);
    const decisions = await db.select().from(duplicateDecisionsTable).where(inArray(duplicateDecisionsTable.mergeId, [res.body.mergeId, u.body.undoId]));
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.byAccountId === null && d.redactedAt !== null)).toBe(true);
    await markLeft(mover.email, "cli:vitest");
  });
});

describe("statements stay where they were written", () => {
  it("no row of Mimi's is rewritten or copied by the merge", async () => {
    const c = await pair();
    await kit.answer(c.m1, "note", { text: "Shy" });
    const before = await db.select().from(observationsTable).where(eq(observationsTable.catId, c.mimi));
    expect((await merge(c.mimi, c.agatha)).status).toBe(200);
    expect(await db.select().from(observationsTable).where(eq(observationsTable.catId, c.mimi))).toEqual(before);
  });
});
