import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  db,
  deviceCredentialsTable,
  duplicateDecisionsTable,
  duplicateReportsTable,
  observationsTable,
  pool,
  profilesTable,
  sightingMatchesTable,
  sightingsTable,
} from "@workspace/db";
import { ResolveSightingResponse, AnswerSightingQuestionsResponse } from "@workspace/api-zod";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { moveKit, tag } from "../test/moveKit";
import { deleteTestSightings } from "../test/sightings";
import { libMerge } from "../test/merges";
import { listDuplicates } from "../lib/duplicateList";
import { recordDuplicateAnswer } from "../lib/duplicateQuestion";
import { TEAM_DESK_DEVICE } from "../lib/teamDesk";
import { writeObservation } from "../lib/observations";

// SYC-59 PR 5.2 (which-cat-is-which.md §3.1 item 1, D8, §9.6; spec test 23
// and the first clause of test 25): "Are these the same cat?" is offered in
// the resolve response only when the spotter confirmed one of the photo
// check's suggestions and another suggestion scored at least 0.4 and within
// 0.15 of it, neither cat has died, and the team has not decided the pair.
// The answer is a `spotter_question` report: once per sighting, and it only
// ever asks: one such answer stays Possible. Cat names are letters only.

const kit = moveKit("VitestDupQuestion");
const SECRET = "vitest-dupquestion-secret-0123456789ab";

const deskSightings: number[] = [];
beforeAll(kit.cleanup);
afterAll(async () => {
  // The team desk's spots are not under this kit's device prefix.
  if (deskSightings.length > 0) await deleteTestSightings(inArray(sightingsTable.id, deskSightings));
  await kit.cleanup();
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${kit.devicePrefix}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await pool.end();
});

type Suggested = { catId: number; rank: number; score: number };
const suggest = (...pairs: [number, number][]): Suggested[] => pairs.map(([catId, score], i) => ({ catId, rank: i + 1, score }));

/** A pending spot with the suggestions the photo check stored for it. */
async function pendingSpot(suggested: Suggested[] | null) {
  const device = kit.device();
  const photoId = await kit.photo();
  const [s] = await db.insert(sightingsTable).values({ deviceId: device, photoId, lat: 37.4441, lng: 24.9412, status: "pending" }).returning();
  await db.insert(sightingMatchesTable).values({ sightingId: s!.id, suggested, matcherFailed: suggested === null, comparedCatIds: suggested?.map((x) => x.catId) ?? [], matchedAt: new Date() });
  return { sightingId: s!.id, device };
}

const resolveTo = (sightingId: number, device: string, catId: number) =>
  request(app).post(`/api/sightings/${sightingId}/resolve`).set("X-Device-Secret", SECRET).send({ deviceId: device, catId });
const answer = (sightingId: number, device: string, body: object) =>
  request(app).post(`/api/sightings/${sightingId}/answers`).set("X-Device-Secret", SECRET).send({ deviceId: device, ...body });
// The spotter's own answers only: a new cat also writes new_cat_check reports (PR 5.1).
const reportsFor = (sightingId: number) =>
  db.select().from(duplicateReportsTable).where(and(eq(duplicateReportsTable.sightingId, sightingId), eq(duplicateReportsTable.source, "spotter_question")));

/** Resolve a spot to its first suggestion and return what the resolve offered. */
async function resolved(suggested: Suggested[], chosen = suggested[0]!.catId) {
  const spot = await pendingSpot(suggested);
  const res = await resolveTo(spot.sightingId, spot.device, chosen);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { ...spot, res, question: res.body.duplicateQuestion as { catId: number; otherCatId: number } | null | undefined };
}

describe("resolve offers 'Are these the same cat?' (spec test 23, §9.6)", () => {
  it("offers the confirmed cat and the look-alike when both scored 0.4 or more and within 0.15", async () => {
    const [agatha, mimi] = [await kit.cat(), await kit.cat()];
    const { res, question } = await resolved(suggest([agatha, 0.82], [mimi, 0.74]));
    expect(question).toEqual({ catId: agatha, otherCatId: mimi });
    // The oldest app's schema (before this field) reads the answer and drops it.
    const old = ResolveSightingResponse.omit({ duplicateQuestion: true }).safeParse(res.body);
    expect(old.success, JSON.stringify(old.error?.issues)).toBe(true);
    expect((old.data as Record<string, unknown>)["duplicateQuestion"]).toBeUndefined();
    // The current schema reads it too.
    const now = ResolveSightingResponse.safeParse(res.body);
    expect(now.success, JSON.stringify(now.error?.issues)).toBe(true);
    expect(now.data!.duplicateQuestion).toEqual({ catId: agatha, otherCatId: mimi });
  });

  it("asks about the look-alike even when the spotter confirmed the lower-scoring cat", async () => {
    const [agatha, mimi] = [await kit.cat(), await kit.cat()];
    const { question } = await resolved(suggest([agatha, 0.82], [mimi, 0.74]), mimi);
    expect(question).toEqual({ catId: mimi, otherCatId: agatha });
  });

  it("the edges: a gap of exactly 0.15 and a score of exactly 0.4 still ask; a hair over, or under, does not", async () => {
    const [a, b, c, d] = [await kit.cat(), await kit.cat(), await kit.cat(), await kit.cat()];
    expect((await resolved(suggest([a, 0.55], [b, 0.4]))).question).toEqual({ catId: a, otherCatId: b });
    expect((await resolved(suggest([a, 0.56], [c, 0.4]))).question ?? null).toBeNull();
    expect((await resolved(suggest([a, 0.45], [d, 0.39]))).question ?? null).toBeNull();
  });

  it("with several look-alikes it asks about the closest score", async () => {
    const [a, far, near] = [await kit.cat(), await kit.cat(), await kit.cat()];
    const { question } = await resolved(suggest([a, 0.9], [far, 0.76], [near, 0.88]));
    expect(question).toEqual({ catId: a, otherCatId: near });
  });

  it("is not offered with one suggestion, for a new cat, or for a hand pick", async () => {
    const [a, b, handPicked] = [await kit.cat(), await kit.cat(), await kit.cat()];
    expect((await resolved(suggest([a, 0.9]))).question ?? null).toBeNull();

    const spot = await pendingSpot(suggest([a, 0.8], [b, 0.75]));
    const asNew = await request(app).post(`/api/sightings/${spot.sightingId}/resolve`).set("X-Device-Secret", SECRET).send({ deviceId: spot.device, newCatName: `VitestDupQuestion${tag()}x` });
    expect(asNew.status, JSON.stringify(asNew.body)).toBe(200);
    expect(asNew.body.duplicateQuestion ?? null).toBeNull();

    // A cat the spotter found themselves, not one of the suggestions.
    expect((await resolved(suggest([a, 0.8], [b, 0.75]), handPicked)).question ?? null).toBeNull();
  });

  it("is not offered when the photo check failed and nothing was compared", async () => {
    const cat = await kit.cat();
    const spot = await pendingSpot(null);
    const res = await resolveTo(spot.sightingId, spot.device, cat);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.duplicateQuestion ?? null).toBeNull();
  });

  it("is never offered for a cat recorded as having died", async () => {
    const [a, dead] = [await kit.cat(), await kit.cat()];
    await writeObservation(db, { catId: dead, kind: "life_status", value: { status: "deceased" }, accountId: "staff-vitest-dupquestion", roleAtTime: "staff", observedAt: new Date() });
    expect((await resolved(suggest([a, 0.8], [dead, 0.78]))).question ?? null).toBeNull();
  });

  it("is never offered for a pair the team has already decided, whichever way", async () => {
    for (const decision of ["different", "not_sure", "merge_undone"]) {
      const [a, b] = [await kit.cat(), await kit.cat()];
      await db.insert(duplicateDecisionsTable).values({ catLow: Math.min(a, b), catHigh: Math.max(a, b), decision, mergeId: decision === "merge_undone" ? 1 : null, byAccountId: "staff-vitest-dupquestion" });
      expect((await resolved(suggest([a, 0.8], [b, 0.78]))).question ?? null, decision).toBeNull();
    }
    // A cat that has no decision with the first still gets asked about.
    const [a, b, c] = [await kit.cat(), await kit.cat(), await kit.cat()];
    await db.insert(duplicateDecisionsTable).values({ catLow: Math.min(a, b), catHigh: Math.max(a, b), decision: "different", byAccountId: "staff-vitest-dupquestion" });
    expect((await resolved(suggest([a, 0.8], [b, 0.79], [c, 0.7]))).question).toEqual({ catId: a, otherCatId: c });
  });

  it("is never offered once the two suggestions are one cat (a merge)", async () => {
    const [mimi, agatha] = [await kit.cat(), await kit.cat()];
    await kit.sighting(mimi, kit.device());
    await libMerge(mimi, agatha);
    // Both suggestions are Agatha now.
    expect((await resolved(suggest([mimi, 0.8], [agatha, 0.75]), agatha)).question ?? null).toBeNull();
  });

  it("a decision made about a cat before it was merged away still holds for the cat it is part of", async () => {
    const [mimi, agatha, bella] = [await kit.cat(), await kit.cat(), await kit.cat()];
    await db.insert(duplicateDecisionsTable).values({ catLow: Math.min(mimi, bella), catHigh: Math.max(mimi, bella), decision: "different", byAccountId: "staff-vitest-dupquestion" });
    await kit.sighting(mimi, kit.device());
    await libMerge(mimi, agatha);
    expect((await resolved(suggest([agatha, 0.8], [bella, 0.78]))).question ?? null).toBeNull();
  });
});

describe("the answer (POST /sightings/:id/answers { duplicate })", () => {
  it.each(["same", "different", "not_sure"] as const)("'%s' is written as a spotter_question report and nothing else", async (says) => {
    const [agatha, mimi] = [await kit.cat(), await kit.cat()];
    const { sightingId, device } = await resolved(suggest([agatha, 0.82], [mimi, 0.74]));
    const res = await answer(sightingId, device, { duplicate: says });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ recorded: ["duplicate"] });
    expect(AnswerSightingQuestionsResponse.safeParse(res.body).success).toBe(true);
    const rows = await reportsFor(sightingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ catLow: Math.min(agatha, mimi), catHigh: Math.max(agatha, mimi), source: "spotter_question", says, deviceId: device, sightingId, score: null, redactedAt: null });
    // A report for the team, not a statement about either cat.
    expect(await db.select().from(observationsTable).where(eq(observationsTable.sightingId, sightingId))).toEqual([]);
  });

  it("goes with the other answers in one request", async () => {
    const [agatha, mimi] = [await kit.cat(), await kit.cat()];
    const { sightingId, device } = await resolved(suggest([agatha, 0.82], [mimi, 0.74]));
    const res = await answer(sightingId, device, { foodAndWater: "yes", duplicate: "same" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recorded.sort()).toEqual(["duplicate", "food_and_water"]);
    expect(await reportsFor(sightingId)).toHaveLength(1);
  });

  it("once per sighting: a second answer is refused and the first stands", async () => {
    const [agatha, mimi] = [await kit.cat(), await kit.cat()];
    const { sightingId, device } = await resolved(suggest([agatha, 0.82], [mimi, 0.74]));
    expect((await answer(sightingId, device, { duplicate: "same" })).status).toBe(200);
    const again = await answer(sightingId, device, { duplicate: "different" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_ANSWERED");
    const rows = await reportsFor(sightingId);
    expect(rows.map((r) => r.says)).toEqual(["same"]);
  });

  it("a second answer sent with something new records the new thing and leaves the duplicate out", async () => {
    const [agatha, mimi] = [await kit.cat(), await kit.cat()];
    const { sightingId, device } = await resolved(suggest([agatha, 0.82], [mimi, 0.74]));
    expect((await answer(sightingId, device, { duplicate: "same" })).status).toBe(200);
    const res = await answer(sightingId, device, { duplicate: "different", foodAndWater: "no" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recorded).toEqual(["food_and_water"]);
    expect((await reportsFor(sightingId)).map((r) => r.says)).toEqual(["same"]);
  });

  it("two answers sent at the same moment write one report", async () => {
    const [agatha, mimi] = [await kit.cat(), await kit.cat()];
    const { sightingId, device } = await resolved(suggest([agatha, 0.82], [mimi, 0.74]));
    const [x, y] = await Promise.all([answer(sightingId, device, { duplicate: "same" }), answer(sightingId, device, { duplicate: "different" })]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await reportsFor(sightingId)).toHaveLength(1);
  });

  it("is refused when the resolve did not ask about a pair and it is all the request holds", async () => {
    const [a, b] = [await kit.cat(), await kit.cat()];
    // Too far apart: no question.
    const { sightingId, device } = await resolved(suggest([a, 0.9], [b, 0.5]));
    const res = await answer(sightingId, device, { duplicate: "same" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("NO_DUPLICATE_QUESTION");
    expect(await reportsFor(sightingId)).toEqual([]);
  });

  it("when no question stands, the duplicate answer is left out and the rest of the request is saved", async () => {
    const [a, b] = [await kit.cat(), await kit.cat()];
    const { sightingId, device } = await resolved(suggest([a, 0.9], [b, 0.5]));
    const res = await answer(sightingId, device, { duplicate: "same", foodAndWater: "yes", note: "a limp" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recorded.sort()).toEqual(["food_and_water", "note"]);
    expect(await reportsFor(sightingId)).toEqual([]);
    expect((await db.select().from(observationsTable).where(eq(observationsTable.sightingId, sightingId))).map((o) => o.kind).sort()).toEqual(["food_and_water", "note"]);
  });

  it("is refused for a spot that was a new cat, or hand-picked", async () => {
    const [a, b, other] = [await kit.cat(), await kit.cat(), await kit.cat()];
    const spot = await pendingSpot(suggest([a, 0.8], [b, 0.78]));
    const asNew = await request(app).post(`/api/sightings/${spot.sightingId}/resolve`).set("X-Device-Secret", SECRET).send({ deviceId: spot.device, newCatName: `VitestDupQuestion${tag()}x` });
    expect(asNew.status, JSON.stringify(asNew.body)).toBe(200);
    expect((await answer(spot.sightingId, spot.device, { duplicate: "same" })).body.code).toBe("NO_DUPLICATE_QUESTION");

    const hand = await resolved(suggest([a, 0.8], [b, 0.78]), other);
    expect((await answer(hand.sightingId, hand.device, { duplicate: "same" })).body.code).toBe("NO_DUPLICATE_QUESTION");
    expect(await reportsFor(spot.sightingId)).toEqual([]);
    expect(await reportsFor(hand.sightingId)).toEqual([]);
  });

  it("is refused when the team decided the pair between the resolve and the answer", async () => {
    const [a, b] = [await kit.cat(), await kit.cat()];
    const { sightingId, device, question } = await resolved(suggest([a, 0.8], [b, 0.78]));
    expect(question).not.toBeNull();
    await db.insert(duplicateDecisionsTable).values({ catLow: Math.min(a, b), catHigh: Math.max(a, b), decision: "different", byAccountId: "staff-vitest-dupquestion" });
    const res = await answer(sightingId, device, { duplicate: "same" });
    expect(res.status).toBe(422);
    expect(await reportsFor(sightingId)).toEqual([]);
    // Beside a note it is left out and the note is kept.
    const withNote = await answer(sightingId, device, { duplicate: "same", note: "still here" });
    expect(withNote.status, JSON.stringify(withNote.body)).toBe(200);
    expect(withNote.body.recorded).toEqual(["note"]);
    expect(await reportsFor(sightingId)).toEqual([]);
  });

  it("when the look-alike was merged into another cat after the resolve, the question names the cat that was shown and the report the cat it is part of now", async () => {
    const [a, mimi, bella] = [await kit.cat(), await kit.cat(), await kit.cat()];
    // Mimi was part of Bella by the time the spotter's photo was checked, yet the check still named her.
    await kit.sighting(mimi, kit.device());
    await libMerge(mimi, bella);
    const { sightingId, device, question } = await resolved(suggest([a, 0.8], [mimi, 0.75]));
    expect(question).toEqual({ catId: a, otherCatId: mimi });
    expect((await answer(sightingId, device, { duplicate: "same" })).status).toBe(200);
    const rows = await reportsFor(sightingId);
    expect(rows).toHaveLength(1);
    expect([rows[0]!.catLow, rows[0]!.catHigh].sort()).toEqual([a, bella].sort());
  });

  it("is refused for someone else's sighting, as every answer is", async () => {
    const [a, b] = [await kit.cat(), await kit.cat()];
    const { sightingId } = await resolved(suggest([a, 0.8], [b, 0.78]));
    const res = await answer(sightingId, kit.device(), { duplicate: "same" });
    expect(res.status).toBe(403);
    expect(await reportsFor(sightingId)).toEqual([]);
  });

  it("is refused from the team desk, which is nobody's phone", async () => {
    const [a, b] = [await kit.cat(), await kit.cat()];
    // Through the route: a spot filed under the team desk's id answers 403 and writes nothing.
    const photoId = await kit.photo();
    const [s] = await db.insert(sightingsTable).values({ catId: a, deviceId: TEAM_DESK_DEVICE, photoId, lat: 37.4441, lng: 24.9412, status: "resolved" }).returning();
    deskSightings.push(s!.id);
    await db.insert(sightingMatchesTable).values({ sightingId: s!.id, suggested: suggest([a, 0.8], [b, 0.78]), choice: "suggested", chosenCatId: a, suggestedRank: 1, chosenAt: new Date(), matchedAt: new Date() });
    const res = await answer(s!.id, TEAM_DESK_DEVICE, { duplicate: "same" });
    expect([401, 403]).toContain(res.status);
    expect(await reportsFor(s!.id)).toEqual([]);
    // And the writer itself refuses it, whatever the route did first.
    const refused = await recordDuplicateAnswer(db, {
      sightingId: s!.id,
      deviceId: TEAM_DESK_DEVICE,
      says: "same",
      match: { choice: "suggested", chosenCatId: a, suggested: suggest([a, 0.8], [b, 0.78]) },
    });
    expect(refused).toEqual({ ok: false, refused: "TEAM_DESK" });
    expect(await reportsFor(s!.id)).toEqual([]);
  });

  it("rejects an answer that is not same, different or not_sure", async () => {
    const [a, b] = [await kit.cat(), await kit.cat()];
    const { sightingId, device } = await resolved(suggest([a, 0.8], [b, 0.78]));
    const res = await answer(sightingId, device, { duplicate: "maybe" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await reportsFor(sightingId)).toEqual([]);
  });
});

describe("the near-tie only asks (spec test 25, first clause)", () => {
  it("a question that is not answered writes nothing, and nothing is on the list", async () => {
    const [a, b] = [await kit.cat(), await kit.cat()];
    const { sightingId, question } = await resolved(suggest([a, 0.8], [b, 0.79]));
    expect(question).not.toBeNull();
    expect(await reportsFor(sightingId)).toEqual([]);
    expect((await listDuplicates()).filter((p) => p.low === Math.min(a, b) && p.high === Math.max(a, b))).toEqual([]);
  });

  it("one new phone answering 'same' puts the pair on the list as Possible, never Likely", async () => {
    const [a, b] = [await kit.cat(), await kit.cat()];
    const { sightingId, device } = await resolved(suggest([a, 0.8], [b, 0.79]));
    expect((await answer(sightingId, device, { duplicate: "same" })).status).toBe(200);
    const listed = (await listDuplicates()).filter((p) => p.low === Math.min(a, b) && p.high === Math.max(a, b));
    expect(listed).toHaveLength(1);
    expect(listed[0]!.level).toBe("possible");
    expect([...listed[0]!.newPhones]).toEqual([device]);
  });

  it("a 'different' or 'not sure' answer does not put the pair on the list by itself", async () => {
    const [a, b, c, d] = [await kit.cat(), await kit.cat(), await kit.cat(), await kit.cat()];
    const x = await resolved(suggest([a, 0.8], [b, 0.79]));
    expect((await answer(x.sightingId, x.device, { duplicate: "different" })).status).toBe(200);
    const y = await resolved(suggest([c, 0.8], [d, 0.79]));
    expect((await answer(y.sightingId, y.device, { duplicate: "not_sure" })).status).toBe(200);
    const listed = await listDuplicates();
    expect(listed.filter((p) => p.low === Math.min(a, b) && p.high === Math.max(a, b))).toEqual([]);
    expect(listed.filter((p) => p.low === Math.min(c, d) && p.high === Math.max(c, d))).toEqual([]);
  });

  it("two new phones saying 'same' on different days is still not Likely (only counting phones count)", async () => {
    const [a, b] = [await kit.cat(), await kit.cat()];
    const x = await resolved(suggest([a, 0.8], [b, 0.79]));
    const y = await resolved(suggest([a, 0.8], [b, 0.79]));
    expect((await answer(x.sightingId, x.device, { duplicate: "same" })).status).toBe(200);
    expect((await answer(y.sightingId, y.device, { duplicate: "same" })).status).toBe(200);
    const listed = (await listDuplicates()).filter((p) => p.low === Math.min(a, b) && p.high === Math.max(a, b));
    expect(listed).toHaveLength(1);
    expect(listed[0]!.level).toBe("possible");
  });
});
