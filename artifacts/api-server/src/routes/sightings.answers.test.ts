/**
 * Data spine PR 7 (plan `docs/superpowers/plans/data-spine.md`, "PR 7 — The
 * sighting questions and the note"; cat-record-data-spine.md §4.4, §7,
 * §10.7): the ear-tip question, the food-and-water question and the
 * team-only note, asked on the reward screen after the points and sent to
 * `POST /sightings/{id}/answers` (Conflicts C5).
 *
 * Runs on SYC-111's throwaway database, which has the observations
 * append-only triggers, so nothing here deletes an observation: every test
 * uses its own device ids and cats, and the whole database is dropped at the
 * end of the run.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  observationsTable,
  photosTable,
  profilesTable,
  sightingsTable,
  sightingMatchesTable,
} from "@workspace/db";
import { and, eq, like, sql } from "drizzle-orm";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";
import { loadCatRecords } from "../lib/observations";
import { resolveCat } from "../lib/resolve";

const DEVICE = "vitest-answers";
const SECRET = "vitest-answers-secret-0123456789abcd";
const OTHER_SECRET = "vitest-answers-other-0123456789abcd";
const CAT_PREFIX = "VitestAnswersCat";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let seq = 0;
const uid = () => `${Date.now()}-${++seq}`;

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return p!.id;
}

async function seedCat(): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${CAT_PREFIX}-${uid()}`,
      description: "",
      primaryPhotoId: await insertPhoto(),
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: `${DEVICE}-seed`,
    })
    .returning();
  return c!.id;
}

async function insertSighting(
  deviceId: string,
  createdAt: Date = new Date(Date.now() - 60_000),
): Promise<{ id: number; photoId: number; createdAt: Date }> {
  const photoId = await insertPhoto();
  const [s] = await db
    .insert(sightingsTable)
    .values({ deviceId, photoId, lat: 37.44, lng: 24.9, status: "pending", createdAt })
    .returning();
  return { id: s!.id, photoId, createdAt: s!.createdAt };
}

function resolve(sightingId: number, deviceId: string, body: object, secret = SECRET) {
  return request(app)
    .post(`/api/sightings/${sightingId}/resolve`)
    .set("X-Device-Secret", secret)
    .send({ deviceId, ...body });
}

function answer(sightingId: number, deviceId: string, body: object, secret = SECRET) {
  return request(app)
    .post(`/api/sightings/${sightingId}/answers`)
    .set("X-Device-Secret", secret)
    .send({ deviceId, ...body });
}

/** A fresh device with a sighting resolved to `catId` (or a new cat). */
async function resolvedSighting(catId?: number) {
  const device = `${DEVICE}-${uid()}`;
  const sighting = await insertSighting(device);
  const res = await resolve(
    sighting.id,
    device,
    catId != null ? { catId } : { newCatName: `${CAT_PREFIX}-${uid()}` },
  );
  expect(res.status).toBe(200);
  return { device, sighting, catId: res.body.cat.id as number, res };
}

async function observationsForSighting(sightingId: number) {
  return db
    .select()
    .from(observationsTable)
    .where(eq(observationsTable.sightingId, sightingId));
}

afterAll(async () => {
  // Every resolve here awards points, and test files share one database:
  // left behind, these profiles would crowd other files' devices off the
  // top-20 leaderboard. Profiles aren't append-only, so they can go.
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
  await pool.end();
});

describe("resolve's askEarTip (each spotter is asked once per cat, Q3 → B)", () => {
  it("is true the first time a device spots a cat", async () => {
    const catId = await seedCat();
    const { res } = await resolvedSighting(catId);
    expect(res.body.askEarTip).toBe(true);
  });

  it("is true for a brand-new cat", async () => {
    const { res } = await resolvedSighting();
    expect(res.body.askEarTip).toBe(true);
  });

  for (const earTip of ["clipped_left", "looks_whole", "cant_tell"] as const) {
    it(`is false after any ear-tip answer from this device for this cat ("${earTip}")`, async () => {
      const catId = await seedCat();
      const first = await resolvedSighting(catId);
      expect(
        (await answer(first.sighting.id, first.device, { earTip })).status,
      ).toBe(200);

      const second = await insertSighting(first.device);
      const res = await resolve(second.id, first.device, { catId });
      expect(res.status).toBe(200);
      expect(res.body.askEarTip).toBe(false);
    });
  }

  it("is still true for a different device spotting the same cat", async () => {
    const catId = await seedCat();
    const first = await resolvedSighting(catId);
    await answer(first.sighting.id, first.device, { earTip: "clipped_left" });

    const other = await resolvedSighting(catId);
    expect(other.res.body.askEarTip).toBe(true);
  });

  it("stays true when this device only answered food and water or left a note", async () => {
    const catId = await seedCat();
    const first = await resolvedSighting(catId);
    await answer(first.sighting.id, first.device, { foodAndWater: "yes", note: "by the boat" });

    const second = await insertSighting(first.device);
    const res = await resolve(second.id, first.device, { catId });
    expect(res.body.askEarTip).toBe(true);
  });
});

describe("POST /api/sightings/:id/answers", () => {
  it("writes each answer as its own observation, with the sighting's photo and capture time", async () => {
    const catId = await seedCat();
    const { device, sighting } = await resolvedSighting(catId);

    const res = await answer(sighting.id, device, {
      earTip: "clipped_left",
      foodAndWater: "no",
      note: "  limping on back left, hiding under the blue boat  ",
    });
    expect(res.status).toBe(200);
    expect(res.body.recorded.sort()).toEqual(["ear_tip", "food_and_water", "note"]);

    const rows = await observationsForSighting(sighting.id);
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    expect(rows.filter((r) => r.kind !== "name")).toHaveLength(3);
    expect(byKind.get("ear_tip")!.value).toEqual({ clipped: true, side: "left" });
    expect(byKind.get("food_and_water")!.value).toEqual({ present: false });
    expect(byKind.get("note")!.value).toEqual({
      text: "limping on back left, hiding under the blue boat",
    });
    for (const kind of ["ear_tip", "food_and_water", "note"]) {
      const row = byKind.get(kind)!;
      expect(row.catId).toBe(catId);
      expect(row.deviceId).toBe(device);
      expect(row.accountId).toBeNull();
      expect(row.roleAtTime).toBe("public");
      expect(row.authorityScope).toBe("none");
      expect(row.provenance).toBe("volunteered");
      expect(row.sightingId).toBe(sighting.id);
      expect(row.photoId).toBe(sighting.photoId);
      expect(row.observedAt.getTime()).toBe(sighting.createdAt.getTime());
    }
  });

  it.each([
    ["clipped_right", { clipped: true, side: "right" }],
    ["clipped_unsure", { clipped: true, side: "unsure" }],
    ["looks_whole", { clipped: false }],
    ["cant_tell", { clipped: "cant_tell" }],
  ])("records the ear-tip answer %s faithfully", async (earTip, value) => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    expect((await answer(sighting.id, device, { earTip })).status).toBe(200);
    const [row] = (await observationsForSighting(sighting.id)).filter(
      (r) => r.kind === "ear_tip",
    );
    expect(row!.value).toEqual(value);
  });

  it.each([
    ["yes", { present: true }],
    ["cant_tell", { present: "cant_tell" }],
  ])("records the food-and-water answer %s faithfully", async (foodAndWater, value) => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    expect((await answer(sighting.id, device, { foodAndWater })).status).toBe(200);
    const [row] = (await observationsForSighting(sighting.id)).filter(
      (r) => r.kind === "food_and_water",
    );
    expect(row!.value).toEqual(value);
  });

  it("skipping writes nothing", async () => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    const res = await answer(sighting.id, device, { note: "   " });
    expect(res.status).toBe(200);
    expect(res.body.recorded).toEqual([]);
    expect(await observationsForSighting(sighting.id)).toHaveLength(0);
  });

  it("answers from another device are refused", async () => {
    const { sighting } = await resolvedSighting(await seedCat());
    const intruder = `${DEVICE}-intruder-${uid()}`;
    const res = await answer(
      sighting.id,
      intruder,
      { earTip: "clipped_left" },
      OTHER_SECRET,
    );
    expect(res.status).toBe(403);
    expect(await observationsForSighting(sighting.id)).toHaveLength(0);
  });

  it("answers with the right device id but the wrong secret are refused", async () => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    const res = await answer(
      sighting.id,
      device,
      { earTip: "clipped_left" },
      "vitest-answers-WRONG-secret-0123456",
    );
    expect(res.status).toBe(403);
    expect(await observationsForSighting(sighting.id)).toHaveLength(0);
  });

  it("a second set of answers is refused", async () => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    expect((await answer(sighting.id, device, { foodAndWater: "yes" })).status).toBe(200);

    const second = await answer(sighting.id, device, {
      foodAndWater: "no",
      note: "changed my mind",
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("ALREADY_ANSWERED");
    const rows = await observationsForSighting(sighting.id);
    expect(rows.map((r) => r.kind)).toEqual(["food_and_water"]);
  });

  it("two sets of answers sent at once record only one", async () => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    const results = await Promise.all([
      answer(sighting.id, device, { foodAndWater: "yes" }),
      answer(sighting.id, device, { foodAndWater: "no" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await observationsForSighting(sighting.id)).toHaveLength(1);
  });

  it("answers after 24 hours are refused", async () => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    await db
      .update(sightingMatchesTable)
      .set({ chosenAt: new Date(Date.now() - 24 * 3_600_000 - 60_000) })
      .where(eq(sightingMatchesTable.sightingId, sighting.id));

    const res = await answer(sighting.id, device, { earTip: "clipped_left" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("ANSWERS_CLOSED");
    expect(await observationsForSighting(sighting.id)).toHaveLength(0);
  });

  it("answers just inside 24 hours are accepted", async () => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    await db
      .update(sightingMatchesTable)
      .set({ chosenAt: new Date(Date.now() - 23 * 3_600_000) })
      .where(eq(sightingMatchesTable.sightingId, sighting.id));
    expect((await answer(sighting.id, device, { foodAndWater: "yes" })).status).toBe(200);
  });

  it("without a match record, the 24 hours count from the capture time, never later", async () => {
    // A sighting taken two days ago and synced from the offline queue now:
    // its match record says it was resolved just now, so answers are open.
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const old = await insertSighting(device, new Date(Date.now() - 48 * 3_600_000));
    expect((await resolve(old.id, device, { catId })).status).toBe(200);
    expect((await answer(old.id, device, { foodAndWater: "yes" })).status).toBe(200);

    // Without that record (a best-effort write that failed), the server
    // falls back to the capture time, which can only be earlier than the
    // resolve, so the fallback is stricter, never looser.
    const orphan = await insertSighting(device, new Date(Date.now() - 48 * 3_600_000));
    expect((await resolve(orphan.id, device, { catId })).status).toBe(200);
    await db
      .delete(sightingMatchesTable)
      .where(eq(sightingMatchesTable.sightingId, orphan.id));
    const res = await answer(orphan.id, device, { foodAndWater: "yes" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("ANSWERS_CLOSED");
  });

  it("answers for a sighting that hasn't been resolved are refused", async () => {
    const device = `${DEVICE}-${uid()}`;
    const sighting = await insertSighting(device);
    const res = await answer(sighting.id, device, { earTip: "clipped_left" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_RESOLVED");
  });

  it("answers for a missing sighting are a 404", async () => {
    const res = await answer(2_000_000_000, `${DEVICE}-${uid()}`, { foodAndWater: "yes" });
    expect(res.status).toBe(404);
  });

  it("an ear-tip answer for a cat this device has already answered about is refused", async () => {
    const catId = await seedCat();
    const first = await resolvedSighting(catId);
    await answer(first.sighting.id, first.device, { earTip: "cant_tell" });

    const second = await insertSighting(first.device);
    await resolve(second.id, first.device, { catId });
    const res = await answer(second.id, first.device, {
      earTip: "clipped_left",
      foodAndWater: "yes",
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EAR_TIP_ALREADY_ANSWERED");
    expect(await observationsForSighting(second.id)).toHaveLength(0);
  });

  it.each([
    ["an unknown ear-tip answer", { earTip: "notched" }],
    ["an unknown food-and-water answer", { foodAndWater: "maybe" }],
    ["a note over 500 characters", { note: "x".repeat(501) }],
  ])("refuses %s", async (_label, body) => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    const res = await answer(sighting.id, device, body);
    expect(res.status).toBe(400);
    expect(await observationsForSighting(sighting.id)).toHaveLength(0);
  });

  it("accepts a note of exactly 500 characters", async () => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    expect((await answer(sighting.id, device, { note: "x".repeat(500) })).status).toBe(200);
  });

  it("no sightings row is updated (SYC-63's append-only guard)", async () => {
    const { device, sighting } = await resolvedSighting(await seedCat());
    const [before] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, sighting.id));
    const xminBefore = await db.execute(
      sql`select xmin::text as x from sightings where id = ${sighting.id}`,
    );

    await answer(sighting.id, device, {
      earTip: "clipped_left",
      foodAndWater: "yes",
      note: "fine",
    });

    const [after] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, sighting.id));
    const xminAfter = await db.execute(
      sql`select xmin::text as x from sightings where id = ${sighting.id}`,
    );
    expect(after).toEqual(before);
    // xmin changes on any UPDATE, even one that writes the same values.
    expect(xminAfter.rows[0]).toEqual(xminBefore.rows[0]);
  });

  it('"looks whole" moves nothing: no number of spotters saying it moves sterilised (rule 1, end to end)', async () => {
    // The cost of getting this wrong: a volunteer sent to trap a cat that
    // was sterilised years ago (cat-record-data-spine.md §4.1).
    const catId = await seedCat();
    for (let i = 0; i < 5; i++) {
      const { device, sighting } = await resolvedSighting(catId);
      expect((await answer(sighting.id, device, { earTip: "looks_whole" })).status).toBe(200);
    }
    const records = await loadCatRecords([catId]);
    const record = records.get(catId)!;
    expect(record.observations.filter((o) => o.kind === "ear_tip")).toHaveLength(5);
    const snapshot = resolveCat(record.observations, record.evidenceOfLife, new Date());
    expect(snapshot.sterilised.confidence).toBe("unknown");
    expect(snapshot.sterilised.value).toBeNull();

    const page = await request(app).get(`/api/cats/${catId}`);
    expect(page.body.cat.sterilised.confidence).toBe("unknown");
    expect(page.body.cat.sterilised.value).toBeNull();
  });

  it("a clipped answer reaches Likely in the record, but the public line stays Not known yet (Q2 → A)", async () => {
    const catId = await seedCat();
    const { device, sighting } = await resolvedSighting(catId);
    await answer(sighting.id, device, { earTip: "clipped_left" });

    const record = (await loadCatRecords([catId])).get(catId)!;
    const snapshot = resolveCat(record.observations, record.evidenceOfLife, new Date());
    expect(snapshot.sterilised.confidence).toBe("likely");

    const page = await request(app).get(`/api/cats/${catId}`);
    expect(page.body.cat.sterilised.confidence).toBe("unknown");
  });

  it("a note never appears in any public payload (§10.8.8)", async () => {
    const catId = await seedCat();
    const secret = `NOTE-CANARY-${uid()}`;
    const { device, sighting } = await resolvedSighting(catId);
    expect((await answer(sighting.id, device, { note: secret })).status).toBe(200);

    // The note is stored...
    const [noteRow] = await db
      .select()
      .from(observationsTable)
      .where(and(eq(observationsTable.sightingId, sighting.id), eq(observationsTable.kind, "note")));
    expect(noteRow!.value).toEqual({ text: secret });

    // ...and no public payload carries it: the catalogue, the cat page, a
    // later resolve of the same cat, or the spotter's own profile.
    const later = await resolvedSighting(catId);
    const payloads = [
      await request(app).get("/api/cats"),
      await request(app).get(`/api/cats/${catId}`),
      later.res,
      await request(app)
        .get(`/api/profiles/${device}`)
        .set("X-Device-Secret", SECRET),
    ];
    for (const p of payloads) {
      expect(JSON.stringify(p.body)).not.toContain(secret);
    }
  });
});
