/**
 * SYC-119 Slice B (SYC-151): the server's own, team-only record of what the
 * matcher compared, what it suggested, and what the spotter chose.
 * docs/specs/choose-a-different-cat.md §4.6, §9, §10 (tests 3, 4, 8) and the
 * plan's Slice B (docs/superpowers/plans/syc-119-choose-a-different-cat.md).
 *
 * Every test works far out at sea, so no cat seeded by another test file is
 * ever within 500 m and the compared set is exactly what this file seeds.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  photosTable,
  sightingsTable,
  sightingMatchesTable,
  profilesTable,
  catSubscriptionsTable,
  catUpdatesTable,
  notificationsTable,
} from "@workspace/db";
import { eq, ilike, inArray, like } from "drizzle-orm";
import { squareCentre, type LatLng } from "@workspace/geo";

const { matchCatPhoto } = vi.hoisted(() => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] as unknown[] })),
}));
vi.mock("../lib/matching", () => ({ matchCatPhoto }));

import app from "../app";

const DEVICE = "vitest-matchrecord-device";
const CAT_PREFIX = "VitestMatchRecordCat";
const SECRET = "vitest-matchrecord-secret-0123456789ab";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/** Open sea south-east of Syros: nothing else in the test database is near. */
const SEA = squareCentre({ lat: 37.3, lng: 25.1 });

function northOf(p: LatLng, km: number): LatLng {
  return { lat: p.lat + ((km / 6371) * 180) / Math.PI, lng: p.lng };
}

/** Keys that must never appear in a public payload (test 8). */
const PRIVATE_KEYS = [
  "compared",
  "comparedCatIds",
  "suggested",
  "suggestedRank",
  "choice",
  "pickedFrom",
  "missKind",
  "matcherMiss",
  "distanceMiss",
  "openedPicker",
  "matcherFailed",
  "matchRecord",
];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return p!.id;
}

let seq = 0;
async function seedCat(at: LatLng): Promise<number> {
  const photoId = await insertPhoto();
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${CAT_PREFIX}-${++seq}-${Date.now()}`,
      description: "",
      primaryPhotoId: photoId,
      lat: at.lat,
      lng: at.lng,
      discovererDeviceId: `${DEVICE}-seed`,
    })
    .returning();
  return c!.id;
}

let tick = 0;
function submit(device: string, at: LatLng, capturedAt?: string) {
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", SECRET)
    .send({
      deviceId: device,
      lat: at.lat,
      lng: at.lng,
      photoBase64: TINY_JPEG_B64,
      capturedAt:
        capturedAt ?? new Date(Date.now() - 120_000 + ++tick * 1000).toISOString(),
    });
}

function resolve(sightingId: number, device: string, body: object) {
  return request(app)
    .post(`/api/sightings/${sightingId}/resolve`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: device, ...body });
}

async function record(sightingId: number) {
  const [row] = await db
    .select()
    .from(sightingMatchesTable)
    .where(eq(sightingMatchesTable.sightingId, sightingId));
  return row;
}

/** The matcher scores these cats, in this order. */
function matcherReturns(scores: Record<number, number>) {
  matchCatPhoto.mockImplementationOnce(async () => ({
    isCatPhoto: true,
    matches: Object.entries(scores).map(([catId, confidence]) => ({
      catId: Number(catId),
      confidence,
      reasoning: "test",
    })),
  }));
}

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id, photoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(ilike(catsTable.name, `${CAT_PREFIX}%`));
  const catIds = cats.map((c) => c.id);
  if (catIds.length > 0) {
    const updates = await db
      .select({ id: catUpdatesTable.id })
      .from(catUpdatesTable)
      .where(inArray(catUpdatesTable.catId, catIds));
    if (updates.length > 0) {
      await db.delete(notificationsTable).where(
        inArray(
          notificationsTable.catUpdateId,
          updates.map((u) => u.id),
        ),
      );
    }
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, catIds));
    await db
      .delete(catSubscriptionsTable)
      .where(inArray(catSubscriptionsTable.catId, catIds));
  }
  const rows = await db
    .select({ id: sightingsTable.id, photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  if (rows.length > 0) {
    await db.delete(sightingMatchesTable).where(
      inArray(
        sightingMatchesTable.sightingId,
        rows.map((r) => r.id),
      ),
    );
  }
  await db.delete(sightingsTable).where(like(sightingsTable.deviceId, `${DEVICE}%`));
  const photoIds = [...rows.map((r) => r.photoId), ...cats.map((c) => c.photoId)];
  if (catIds.length > 0) await db.delete(catsTable).where(inArray(catsTable.id, catIds));
  if (photoIds.length > 0) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await db
    .delete(catSubscriptionsTable)
    .where(like(catSubscriptionsTable.deviceId, `${DEVICE}%`));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("the match record is written when matching runs", () => {
  it("records the cats compared and the cats suggested, with rank and score", async () => {
    const device = `${DEVICE}-write`;
    const a = await seedCat(northOf(SEA, 0.1));
    const b = await seedCat(northOf(SEA, 0.2));
    const c = await seedCat(northOf(SEA, 0.3));
    await seedCat(northOf(SEA, 0.9)); // beyond 500 m: never compared
    matcherReturns({ [a]: 0.4, [b]: 0.8, [c]: 0.05 });

    const res = await submit(device, SEA);
    expect(res.status).toBe(201);

    const row = await record(res.body.sightingId);
    expect(row).toBeDefined();
    expect([...row!.comparedCatIds!].sort((x, y) => x - y)).toEqual(
      [a, b, c].sort((x, y) => x - y),
    );
    expect(row!.suggested).toEqual([
      { catId: b, rank: 1, score: 0.8 },
      { catId: a, rank: 2, score: 0.4 },
    ]);
    expect(row!.matcherFailed).toBe(false);
    expect(row!.choice).toBeNull();
  });

  it("records a failed matcher call, with nothing suggested", async () => {
    const device = `${DEVICE}-failed`;
    const a = await seedCat(northOf(SEA, 0.1));
    matchCatPhoto.mockImplementationOnce(async () => {
      throw new Error("model down");
    });

    const res = await submit(device, SEA);
    expect(res.status).toBe(201);
    expect(res.body.candidates).toEqual([]);

    const row = await record(res.body.sightingId);
    expect(row!.comparedCatIds).toContain(a);
    expect(row!.suggested).toEqual([]);
    expect(row!.matcherFailed).toBe(true);
  });

  it("the dedupe-hit path stores the set it actually returned last", async () => {
    const device = `${DEVICE}-dedupe`;
    const a = await seedCat(northOf(SEA, 0.1));
    const b = await seedCat(northOf(SEA, 0.2));
    const capturedAt = new Date(Date.now() - 90_000).toISOString();

    matcherReturns({ [a]: 0.9 });
    const first = await submit(device, SEA, capturedAt);
    matcherReturns({ [b]: 0.7 });
    const second = await submit(device, SEA, capturedAt);

    expect(second.body.sightingId).toBe(first.body.sightingId);
    expect(second.body.candidates.map((c: { catId: number }) => c.catId)).toEqual([b]);
    const row = await record(first.body.sightingId);
    expect(row!.suggested).toEqual([{ catId: b, rank: 1, score: 0.7 }]);

    // So a pick of b, which the phone was actually shown, is "suggested".
    const res = await resolve(first.body.sightingId, device, { catId: b });
    expect(res.status).toBe(200);
    expect((await record(first.body.sightingId))!.choice).toBe("suggested");
  });
});

describe("resolve labels the choice from the stored set (test 4)", () => {
  it("a suggested cat is labelled suggested, with its rank", async () => {
    const device = `${DEVICE}-suggested`;
    const a = await seedCat(northOf(SEA, 0.1));
    const b = await seedCat(northOf(SEA, 0.2));
    matcherReturns({ [a]: 0.9, [b]: 0.6 });
    const sub = await submit(device, SEA);

    const res = await resolve(sub.body.sightingId, device, { catId: b });
    expect(res.status).toBe(200);
    const row = await record(sub.body.sightingId);
    expect(row).toMatchObject({
      choice: "suggested",
      chosenCatId: b,
      suggestedRank: 2,
      pickedFrom: null,
      missKind: null,
    });
    expect(row!.chosenAt).toBeInstanceOf(Date);
  });

  it("test 4: pickedFrom can't make a hand pick look suggested, or a suggestion look like a hand pick", async () => {
    const device = `${DEVICE}-claims`;
    const a = await seedCat(northOf(SEA, 0.1));
    const notSuggested = await seedCat(northOf(SEA, 0.2));
    matcherReturns({ [a]: 0.9 });
    const s1 = await submit(device, SEA);
    matcherReturns({ [a]: 0.9 });
    const s2 = await submit(device, SEA);

    // A hand pick, sent without pickedFrom, as a modified app might.
    await resolve(s1.body.sightingId, device, { catId: notSuggested });
    expect((await record(s1.body.sightingId))!.choice).toBe("hand_pick");

    // A suggested cat, sent claiming it came from search.
    await resolve(s2.body.sightingId, device, { catId: a, pickedFrom: "search" });
    const row = await record(s2.body.sightingId);
    expect(row!.choice).toBe("suggested");
    expect(row!.suggestedRank).toBe(1);
  });

  it("a hand pick of a cat that was compared but scored too low is a matcher miss", async () => {
    const device = `${DEVICE}-matcher-miss`;
    const a = await seedCat(northOf(SEA, 0.1));
    const low = await seedCat(northOf(SEA, 0.2));
    matcherReturns({ [a]: 0.9, [low]: 0.02 });
    const sub = await submit(device, SEA);

    await resolve(sub.body.sightingId, device, { catId: low, pickedFrom: "nearby" });
    expect(await record(sub.body.sightingId)).toMatchObject({
      choice: "hand_pick",
      chosenCatId: low,
      pickedFrom: "nearby",
      missKind: "matcher_miss",
      suggestedRank: null,
    });
  });

  it("a hand pick of a cat that was never compared is a distance miss", async () => {
    const device = `${DEVICE}-distance-miss`;
    const near = await seedCat(northOf(SEA, 0.1));
    const beyond = await seedCat(northOf(SEA, 1.0)); // nearby (1.5 km), not compared (500 m)
    matcherReturns({ [near]: 0.9 });
    const sub = await submit(device, SEA);

    await resolve(sub.body.sightingId, device, { catId: beyond, pickedFrom: "search" });
    expect(await record(sub.body.sightingId)).toMatchObject({
      choice: "hand_pick",
      chosenCatId: beyond,
      pickedFrom: "search",
      missKind: "distance_miss",
    });
  });

  it("a stored suggestion is accepted even if the nearby rule would refuse it", async () => {
    // Belt and braces (plan Slice B): a real suggestion is always within
    // 500 m, but the server trusts its own record over the geometry.
    const device = `${DEVICE}-stored-wins`;
    const far = await seedCat(northOf(SEA, 5));
    const sub = await submit(device, SEA);
    await db
      .update(sightingMatchesTable)
      .set({ suggested: [{ catId: far, rank: 1, score: 0.9 }] })
      .where(eq(sightingMatchesTable.sightingId, sub.body.sightingId));

    const res = await resolve(sub.body.sightingId, device, { catId: far });
    expect(res.status).toBe(200);
    expect((await record(sub.body.sightingId))!.choice).toBe("suggested");
  });

  it("a cat that is neither suggested nor nearby is still refused, and nothing is recorded", async () => {
    const device = `${DEVICE}-refused`;
    const far = await seedCat(northOf(SEA, 5));
    const sub = await submit(device, SEA);

    const res = await resolve(sub.body.sightingId, device, { catId: far });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("NOT_NEARBY");
    expect((await record(sub.body.sightingId))!.choice).toBeNull();
  });

  it("a new cat records whether the spotter opened the picker first", async () => {
    const device = `${DEVICE}-new-cat`;
    const s1 = await submit(device, SEA);
    const s2 = await submit(device, SEA);

    await resolve(s1.body.sightingId, device, {
      newCatName: `${CAT_PREFIX}-New-${Date.now()}`,
      openedPicker: true,
    });
    await resolve(s2.body.sightingId, device, {
      newCatName: `${CAT_PREFIX}-New2-${Date.now()}`,
    });

    expect(await record(s1.body.sightingId)).toMatchObject({
      choice: "new_cat",
      openedPicker: true,
    });
    expect(await record(s2.body.sightingId)).toMatchObject({
      choice: "new_cat",
      openedPicker: false,
    });
  });

  it("a sighting from before match records existed is resolved and marked unlabelled", async () => {
    const device = `${DEVICE}-legacy`;
    const cat = await seedCat(northOf(SEA, 0.1));
    const photoId = await insertPhoto();
    const [s] = await db
      .insert(sightingsTable)
      .values({ deviceId: device, photoId, lat: SEA.lat, lng: SEA.lng, status: "pending" })
      .returning();

    const res = await resolve(s!.id, device, { catId: cat, pickedFrom: "nearby" });
    expect(res.status).toBe(200);
    expect(await record(s!.id)).toMatchObject({
      choice: "unlabelled",
      chosenCatId: cat,
      comparedCatIds: null,
      suggested: null,
    });
  });
});

describe("nothing about the record reaches a spotter", () => {
  it("test 3: suggested, matcher-miss and distance-miss picks get responses of the same shape", async () => {
    const device = `${DEVICE}-shape`;
    const a = await seedCat(northOf(SEA, 0.1));
    const low = await seedCat(northOf(SEA, 0.2));
    const beyond = await seedCat(northOf(SEA, 1.0));
    const shapes: string[][] = [];
    for (const [catId, scores] of [
      [a, { [a]: 0.9 }],
      [low, { [a]: 0.9, [low]: 0.02 }],
      [beyond, { [a]: 0.9 }],
    ] as const) {
      matcherReturns(scores);
      const sub = await submit(device, SEA);
      const res = await resolve(sub.body.sightingId, device, { catId });
      expect(res.status).toBe(200);
      shapes.push([...keysDeep(res.body)].sort());
    }
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it("test 8: no public payload carries the record, pickedFrom or a label", async () => {
    const device = `${DEVICE}-public`;
    const a = await seedCat(northOf(SEA, 0.1));
    const low = await seedCat(northOf(SEA, 0.2));
    matcherReturns({ [a]: 0.9, [low]: 0.02 });
    const sub = await submit(device, SEA);
    const resolved = await resolve(sub.body.sightingId, device, {
      catId: low,
      pickedFrom: "search",
    });
    expect(resolved.status).toBe(200);

    const payloads = [
      sub.body,
      resolved.body,
      (await request(app).get("/api/cats")).body,
      (await request(app).get(`/api/cats?lat=${SEA.lat}&lng=${SEA.lng}`)).body,
      (await request(app).get(`/api/cats/${low}`)).body,
      (await request(app).get(`/api/cats/${a}`)).body,
      (
        await request(app)
          .get(`/api/profiles/${device}`)
          .set("X-Device-Secret", SECRET)
      ).body,
    ];
    for (const body of payloads) {
      const keys = keysDeep(body);
      for (const k of PRIVATE_KEYS) expect(keys.has(k), k).toBe(false);
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/matcher_miss|distance_miss|hand_pick/);
    }
  });
});
