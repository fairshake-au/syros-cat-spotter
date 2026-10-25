/**
 * SYC-119 Slice B (SYC-151): the server's own, team-only record of what the
 * matcher compared, what it suggested, and what the spotter chose.
 * docs/specs/choose-a-different-cat.md §4.6, §9, §10 (tests 3, 4, 8) and the
 * plan's Slice B (docs/superpowers/plans/syc-119-choose-a-different-cat.md).
 *
 * Every test works far out at sea, so no cat seeded by another test file is
 * ever within 500 m and the compared set is exactly what this file seeds.
 */
import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { type LatLng } from "@workspace/geo";
import { blurPosition } from "../lib/blur";

/** The published cell centre, as the server publishes it (data spine PR 6). */
const squareCentre = (p: LatLng): LatLng => blurPosition(p.lat, p.lng);

const { matchCatPhoto } = vi.hoisted(() => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] as unknown[] })),
}));
vi.mock("../lib/matching", () => ({ matchCatPhoto }));
// This file uploads more than the 20-per-IP AI budget allows (the budget has
// its own tests in rateLimit.test.ts). Review of PR #64 (B1) restored
// `aiLimiter` on POST /sightings after it had been dropped in favour of the
// per-device limiter alone — this mock is still needed, and more load-bearing
// than before: without it every test past the 20th upload in this file would
// 429 against the real aiLimiter, which is keyed on supertest's one shared
// local IP across the whole file, not per device. (Each test here uses its
// own device id, so the per-device limiter below is never what would trip.)
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";

// SYC-709: a cat name can't hold a phone-number-like run of digits, so
// names made here get a letters-only tag instead of Date.now().
const nameTag = (): string => Date.now().toString(36).replace(/\d/g, (d) => "abcdefghij"[Number(d)]!);

const DEVICE = "vitest-matchrecord-device";
const CAT_PREFIX = "VitestMatchRecordCat";
const SECRET = "vitest-matchrecord-secret-0123456789ab";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/**
 * Open sea south-east of Syros: nothing else in the test database is near.
 * Each test takes its own spot, about 5 km from the last, so no test's cats
 * crowd another test's 500 m.
 */
let spots = 0;
function spot(): LatLng {
  return squareCentre({ lat: 37.3, lng: 25.1 + ++spots * 0.06 });
}

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
  "colourFilterOn",
  "colour_filter_on",
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
      name: `${CAT_PREFIX}-${++seq}-${nameTag()}`,
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
/** Upload a photo; fails the test loudly if the upload itself is refused. */
async function submit(device: string, at: LatLng, capturedAt?: string) {
  const res = await request(app)
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
  expect(res.status, `upload refused: ${JSON.stringify(res.body)}`).toBe(201);
  return res;
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
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
  const photoIds = [...rows.map((r) => r.photoId), ...cats.map((c) => c.photoId)];
  if (catIds.length > 0) await db.delete(catsTable).where(inArray(catsTable.id, catIds));
  if (photoIds.length > 0) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await db
    .delete(catSubscriptionsTable)
    .where(like(catSubscriptionsTable.deviceId, `${DEVICE}%`));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
// Review F8: a queued matcher result must never leak into the next test.
beforeEach(() => {
  matchCatPhoto.mockReset();
  matchCatPhoto.mockImplementation(async () => ({ isCatPhoto: true, matches: [] }));
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("the match record is written when matching runs", () => {
  it("records the cats compared and the cats suggested, with rank and score", async () => {
    const SEA = spot();
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
    const SEA = spot();
    const device = `${DEVICE}-failed`;
    const a = await seedCat(northOf(SEA, 0.1));
    matchCatPhoto.mockImplementationOnce(async () => {
      throw new Error("model down");
    });

    const res = await submit(device, SEA);
    expect(res.status).toBe(201);
    expect(res.body.candidates).toEqual([]);

    const row = await record(res.body.sightingId);
    // Nothing was scored, so nothing counts as compared (review F1).
    expect(row!.comparedCatIds).toEqual([]);
    expect(a).toBeGreaterThan(0);
    expect(row!.suggested).toEqual([]);
    expect(row!.matcherFailed).toBe(true);
  });

  it("the dedupe-hit path stores the set it actually returned last", async () => {
    const SEA = spot();
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
    const SEA = spot();
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
    const SEA = spot();
    const device = `${DEVICE}-claims`;
    const a = await seedCat(northOf(SEA, 0.1));
    const notSuggested = await seedCat(northOf(SEA, 0.2));
    matcherReturns({ [a]: 0.9 });
    const s1 = await submit(device, SEA);
    matcherReturns({ [a]: 0.9 });
    const s2 = await submit(device, SEA);

    // A hand pick, sent without pickedFrom, as a modified app might.
    expect(
      (await resolve(s1.body.sightingId, device, { catId: notSuggested })).status,
    ).toBe(200);
    expect((await record(s1.body.sightingId))!.choice).toBe("hand_pick");

    // A suggested cat, sent claiming it came from search.
    await resolve(s2.body.sightingId, device, { catId: a, pickedFrom: "search" });
    const row = await record(s2.body.sightingId);
    expect(row!.choice).toBe("suggested");
    expect(row!.suggestedRank).toBe(1);
  });

  // SYC-569 D3 (design-review-fixes-oct22.md §2.5): `cat_page` is recorded
  // on every pick from the cat page's question, suggestion or not. Without
  // it a primed "Yes" is lost silently: the row is written, just without
  // the fact, so nothing errors.
  it("cat_page is recorded on a suggested pick, and the label is still the stored set's", async () => {
    const SEA = spot();
    const device = `${DEVICE}-cat-page-suggested`;
    const a = await seedCat(northOf(SEA, 0.1));
    const b = await seedCat(northOf(SEA, 0.2));
    matcherReturns({ [a]: 0.9, [b]: 0.6 });
    const sub = await submit(device, SEA);

    const res = await resolve(sub.body.sightingId, device, { catId: b, pickedFrom: "cat_page" });
    expect(res.status).toBe(200);
    expect(res.body.pickedFrom).toBeUndefined();
    expect(await record(sub.body.sightingId)).toMatchObject({
      choice: "suggested",
      chosenCatId: b,
      suggestedRank: 2,
      pickedFrom: "cat_page",
      missKind: null,
    });
  });

  it("cat_page is recorded on a hand pick, and it stays a hand pick", async () => {
    const SEA = spot();
    const device = `${DEVICE}-cat-page-hand`;
    const a = await seedCat(northOf(SEA, 0.1));
    const low = await seedCat(northOf(SEA, 0.2));
    // Compared but below the threshold: never shown, so a hand pick even
    // though the cat page "suggested" it to the spotter.
    matcherReturns({ [a]: 0.9, [low]: 0.02 });
    const sub = await submit(device, SEA);

    await resolve(sub.body.sightingId, device, { catId: low, pickedFrom: "cat_page" });
    expect(await record(sub.body.sightingId)).toMatchObject({
      choice: "hand_pick",
      chosenCatId: low,
      suggestedRank: null,
      pickedFrom: "cat_page",
      missKind: "matcher_miss",
    });
  });

  it("every other screen's word is still dropped on a suggested pick", async () => {
    const SEA = spot();
    const device = `${DEVICE}-other-suggested`;
    const a = await seedCat(northOf(SEA, 0.1));
    for (const pickedFrom of ["nearby", "search", "name_prompt"]) {
      matcherReturns({ [a]: 0.9 });
      const sub = await submit(device, SEA);
      expect((await resolve(sub.body.sightingId, device, { catId: a, pickedFrom })).status).toBe(200);
      expect(await record(sub.body.sightingId), pickedFrom).toMatchObject({
        choice: "suggested",
        suggestedRank: 1,
        pickedFrom: null,
      });
    }
  });

  it("a hand pick of a cat that was compared but scored too low is a matcher miss", async () => {
    const SEA = spot();
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
    const SEA = spot();
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
    const SEA = spot();
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
    const SEA = spot();
    const device = `${DEVICE}-refused`;
    const far = await seedCat(northOf(SEA, 5));
    const sub = await submit(device, SEA);

    const res = await resolve(sub.body.sightingId, device, { catId: far });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("NOT_NEARBY");
    expect((await record(sub.body.sightingId))!.choice).toBeNull();
  });

  it("a new cat records whether the spotter opened the picker first", async () => {
    const SEA = spot();
    const device = `${DEVICE}-new-cat`;
    const s1 = await submit(device, SEA);
    const s2 = await submit(device, SEA);

    await resolve(s1.body.sightingId, device, {
      newCatName: `${CAT_PREFIX}-New-${nameTag()}`,
      openedPicker: true,
    });
    await resolve(s2.body.sightingId, device, {
      newCatName: `${CAT_PREFIX}-New2-${nameTag()}`,
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
    const SEA = spot();
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

describe("review findings (adversarial review of #64)", () => {
  // S2: a below-threshold candidate is withheld from the public response
  // (sightings.matchHardening.test.ts covers that), but it was still sitting
  // in the stored `suggested` set — before this fix, a spotter who hand-
  // picked it anyway (having spotted the cat by eye, having had it withheld)
  // was recorded as "suggested, rank 2", as if the server had offered it.
  // That's wrong twice over: the phone never showed it, and the rank/score
  // wouldn't mean what the rest of the data assumes "suggested" means.
  it("S2: hand-picking a withheld (below-threshold) candidate is a matcher miss, not a suggestion", async () => {
    const SEA = spot();
    const device = `${DEVICE}-s2-withheld`;
    const a = await seedCat(northOf(SEA, 0.1));
    const hidden = await seedCat(northOf(SEA, 0.2));
    // 0.25 clears the 0.1 noise floor (compared, scored) but not
    // CONFIDENCE_THRESHOLD (0.4) — withheld from the response, per S1.
    matcherReturns({ [a]: 0.9, [hidden]: 0.25 });
    const sub = await submit(device, SEA);
    expect(sub.body.candidates.map((c: { catId: number }) => c.catId)).toEqual([a]);

    await resolve(sub.body.sightingId, device, { catId: hidden, pickedFrom: "nearby" });
    const row = await record(sub.body.sightingId);
    expect(row).toMatchObject({
      choice: "hand_pick",
      chosenCatId: hidden,
      pickedFrom: "nearby",
      missKind: "matcher_miss",
      suggestedRank: null,
    });
    // The withheld candidate's id and score must still be in the team's
    // record — the fix is in the labelling, not in dropping the candidate
    // from `suggested` (that would lose the data a future recalibration of
    // CONFIDENCE_THRESHOLD needs). Kills mutant M4 ("team record redacted").
    expect(row!.suggested).toEqual(
      expect.arrayContaining([expect.objectContaining({ catId: hidden, score: 0.25 })]),
    );
  });

  // The flip side: a candidate that WAS shown (confidence at or above the
  // threshold) is unaffected by the S2 fix and is still labelled "suggested".
  it("S2 regression guard: a shown candidate is still labelled suggested when hand-picked", async () => {
    const SEA = spot();
    const device = `${DEVICE}-s2-shown`;
    const a = await seedCat(northOf(SEA, 0.1));
    const shown = await seedCat(northOf(SEA, 0.2));
    matcherReturns({ [a]: 0.9, [shown]: 0.4 }); // exactly at threshold: shown
    const sub = await submit(device, SEA);
    expect(sub.body.candidates.map((c: { catId: number }) => c.catId).sort()).toEqual(
      [a, shown].sort(),
    );

    await resolve(sub.body.sightingId, device, { catId: shown });
    expect(await record(sub.body.sightingId)).toMatchObject({
      choice: "suggested",
      chosenCatId: shown,
      suggestedRank: 2,
      missKind: null,
    });
  });
});

describe("review findings (adversarial review of #59)", () => {
  it("F1: when the matcher fails, a hand pick has no miss kind, because nothing was compared", async () => {
    const SEA = spot();
    const device = `${DEVICE}-f1`;
    const a = await seedCat(northOf(SEA, 0.1));
    matchCatPhoto.mockImplementationOnce(async () => {
      throw new Error("model down");
    });
    const sub = await submit(device, SEA);
    const res = await resolve(sub.body.sightingId, device, { catId: a, pickedFrom: "nearby" });
    expect(res.status).toBe(200);
    const row = await record(sub.body.sightingId);
    expect(row!.matcherFailed).toBe(true);
    expect(row!.comparedCatIds).toEqual([]);
    expect(row).toMatchObject({ choice: "hand_pick", missKind: null });
  });

  it("F2: a dedupe re-submit after the choice never rewrites the sets behind the label", async () => {
    const SEA = spot();
    const device = `${DEVICE}-f2`;
    const a = await seedCat(northOf(SEA, 0.1));
    const b = await seedCat(northOf(SEA, 0.2));
    const capturedAt = new Date(Date.now() - 80_000).toISOString();
    matcherReturns({ [a]: 0.9 });
    const first = await submit(device, SEA, capturedAt);
    expect((await resolve(first.body.sightingId, device, { catId: a })).status).toBe(200);
    const before = await record(first.body.sightingId);

    matcherReturns({ [b]: 0.8 });
    const again = await submit(device, SEA, capturedAt);
    expect(again.body.sightingId).toBe(first.body.sightingId);

    const after = await record(first.body.sightingId);
    expect(after!.suggested).toEqual(before!.suggested);
    expect(after!.comparedCatIds).toEqual(before!.comparedCatIds);
    expect(after!.choice).toBe("suggested");
  });

  it("F4: a dedupe hit whose photo has gone records the empty set it returned", async () => {
    const SEA = spot();
    const device = `${DEVICE}-f4`;
    const a = await seedCat(northOf(SEA, 0.1));
    const capturedAt = new Date(Date.now() - 70_000).toISOString();
    matcherReturns({ [a]: 0.9 });
    const first = await submit(device, SEA, capturedAt);
    const [s] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, first.body.sightingId));
    await db.delete(photosTable).where(eq(photosTable.id, s!.photoId));

    const again = await submit(device, SEA, capturedAt);
    expect(again.body.candidates).toEqual([]);
    const row = await record(first.body.sightingId);
    expect(row!.suggested).toEqual([]);
    expect(row!.matcherFailed).toBe(true);

    // Nothing was compared, so a hand pick is neither kind of miss.
    await resolve(first.body.sightingId, device, { catId: a, pickedFrom: "nearby" });
    expect(await record(first.body.sightingId)).toMatchObject({
      choice: "hand_pick",
      missKind: null,
    });
  });

  it("F5: a cat the matcher was never sent (no photo) can't be suggested", async () => {
    const SEA = spot();
    const device = `${DEVICE}-f5`;
    const a = await seedCat(northOf(SEA, 0.1));
    const ghost = await seedCat(northOf(SEA, 0.2));
    const [g] = await db.select().from(catsTable).where(eq(catsTable.id, ghost));
    await db.delete(photosTable).where(eq(photosTable.id, g!.primaryPhotoId));
    matcherReturns({ [a]: 0.5, [ghost]: 0.9 });

    const sub = await submit(device, SEA);
    expect(sub.body.candidates.map((c: { catId: number }) => c.catId)).toEqual([a]);
    const row = await record(sub.body.sightingId);
    expect(row!.comparedCatIds).toEqual([a]);
    expect(row!.suggested!.map((x) => x.catId)).toEqual([a]);
  });

  it("F6: two resolves sent at once: exactly one wins, points are awarded once, and the label matches", async () => {
    const SEA = spot();
    const device = `${DEVICE}-f6`;
    const a = await seedCat(northOf(SEA, 0.1));
    const b = await seedCat(northOf(SEA, 0.2));
    matcherReturns({ [a]: 0.9, [b]: 0.6 });
    const sub = await submit(device, SEA);

    const results = await Promise.all([
      resolve(sub.body.sightingId, device, { catId: a }),
      resolve(sub.body.sightingId, device, { catId: b }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [p] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.deviceId, device));
    expect(p!.points).toBe(results.find((r) => r.status === 200)!.body.pointsAwarded);
    const [s] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, sub.body.sightingId));
    expect((await record(sub.body.sightingId))!.chosenCatId).toBe(s!.catId);
  });
});

describe("the record never costs a spotter their sighting", () => {
  it("if the label can't be written, the resolve still succeeds and awards points", async () => {
    const SEA = spot();
    const device = `${DEVICE}-label-fails`;
    const cat = await seedCat(northOf(SEA, 0.1));
    matcherReturns({ [cat]: 0.9 });
    const sub = await submit(device, SEA);

    const realInsert = db.insert.bind(db);
    const spy = vi.spyOn(db, "insert").mockImplementation(((table: unknown) => {
      if (table === sightingMatchesTable) throw new Error("table unavailable");
      return realInsert(table as never);
    }) as typeof db.insert);
    try {
      const res = await resolve(sub.body.sightingId, device, { catId: cat });
      expect(res.status).toBe(200);
      expect(res.body.pointsAwarded).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
    const [s] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, sub.body.sightingId));
    expect(s!.status).toBe("resolved");
  });
});

describe("nothing about the record reaches a spotter", () => {
  it("test 3: suggested, matcher-miss and distance-miss picks get responses of the same shape", async () => {
    const SEA = spot();
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
    const SEA = spot();
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

describe("SYC-398 PR D: colour_filter_on records whether a chip was picked (coat-colours-and-pattern.md §5)", () => {
  it("is true or false as the phone says, for a hand pick and for a new cat", async () => {
    const SEA = spot();
    const device = `${DEVICE}-colour-filter`;
    const a = await seedCat(northOf(SEA, 0.1));
    const b = await seedCat(northOf(SEA, 0.2));
    const s1 = await submit(device, SEA);
    const s2 = await submit(device, SEA);
    const s3 = await submit(device, SEA);
    const s4 = await submit(device, SEA);

    expect((await resolve(s1.body.sightingId, device, { catId: a, pickedFrom: "nearby", colourFilterOn: true })).status).toBe(200);
    expect((await resolve(s2.body.sightingId, device, { catId: b, pickedFrom: "search", colourFilterOn: false })).status).toBe(200);
    await resolve(s3.body.sightingId, device, {
      newCatName: `${CAT_PREFIX}-Filtered-${nameTag()}`,
      openedPicker: true,
      colourFilterOn: true,
    });
    await resolve(s4.body.sightingId, device, {
      newCatName: `${CAT_PREFIX}-Unfiltered-${nameTag()}`,
      openedPicker: true,
      colourFilterOn: false,
    });

    expect((await record(s1.body.sightingId))!.colourFilterOn).toBe(true);
    expect((await record(s2.body.sightingId))!.colourFilterOn).toBe(false);
    expect(await record(s3.body.sightingId)).toMatchObject({ choice: "new_cat", colourFilterOn: true });
    expect(await record(s4.body.sightingId)).toMatchObject({ choice: "new_cat", colourFilterOn: false });
  });

  it("is left empty when the phone doesn't say (a suggestion, or an older phone)", async () => {
    const SEA = spot();
    const device = `${DEVICE}-colour-filter-unsaid`;
    const a = await seedCat(northOf(SEA, 0.1));
    matcherReturns({ [a]: 0.9 });
    const sub = await submit(device, SEA);
    expect((await resolve(sub.body.sightingId, device, { catId: a })).status).toBe(200);
    expect(await record(sub.body.sightingId)).toMatchObject({ choice: "suggested", colourFilterOn: null });
  });

  it("anything but a boolean is refused", async () => {
    const SEA = spot();
    const device = `${DEVICE}-colour-filter-bad`;
    const a = await seedCat(northOf(SEA, 0.1));
    const sub = await submit(device, SEA);
    const res = await resolve(sub.body.sightingId, device, { catId: a, colourFilterOn: "yes" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await record(sub.body.sightingId))!.colourFilterOn).toBeNull();
  });
});
