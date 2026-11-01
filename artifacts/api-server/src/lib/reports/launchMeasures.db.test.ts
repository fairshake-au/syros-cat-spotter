import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, photosTable, pool, sightingMatchesTable, sightingMovesTable, sightingsTable } from "@workspace/db";
import { nameTag } from "../../test/nameTag";
import { deleteTestSightings } from "../../test/sightings";
import { coverageReport } from "./coverage";
import { launchMeasuresReport } from "./launchMeasures";
import { parseRange } from "./range";

// SYC-795 Task 4 (launch measures spec §4.1, §4.3): the loader, against the
// database. Only this file seeds 2005, so a custom range there holds only its
// own sightings. The launch date is mocked, so another file setting the real
// one can't change these figures.

const settings = vi.hoisted(() => ({ launchDate: null as string | null }));
vi.mock("../appSettings", async (importOriginal) => {
  const real = await importOriginal<typeof import("../appSettings")>();
  return { ...real, getAppSettings: async () => ({ ...(await real.getAppSettings()), launchDate: settings.launchDate }) };
});

const TAG = nameTag();
const NOW = new Date("2026-10-21T10:00:00Z");
const at = (iso: string) => new Date(iso);
const PLACE = { lat: 37.4447123, lng: 24.9417456 };
let photoId: number;

beforeAll(async () => {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `VitestLaunch${TAG}`, data: Buffer.from("x").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  photoId = p!.id;
});

afterAll(async () => {
  // Matches go with their sightings (on delete cascade). Moves are add-only and name no device; they stay.
  await deleteTestSightings(eq(sightingsTable.photoId, photoId));
  await db.delete(photosTable).where(eq(photosTable.id, photoId));
  await pool.end();
});

async function sighting(deviceId: string, createdAt: Date, status = "resolved"): Promise<number> {
  const [s] = await db.insert(sightingsTable).values({ deviceId, photoId, ...PLACE, status, createdAt }).returning({ id: sightingsTable.id });
  return s!.id;
}

describe("launchMeasuresReport agrees with Coverage (§4.1)", () => {
  // Wed 1 – Sun 19 Jun 2005: three weeks, the first starting Mon 30 May.
  const RANGE = parseRange({ range: "custom", from: "2005-06-01", to: "2005-06-19" }, NOW);
  const dev = (n: string) => `vitest-launch-${TAG}-${n}`;

  it("counts the same sightings week by week, and the same spotters", async () => {
    settings.launchDate = "2005-05-02";
    // Since launch, before the range: seeds dev b as returning, never counted.
    await sighting(dev("b"), at("2005-05-20T10:00:00Z"));
    // Before the range, in its first week: counted by neither.
    await sighting(dev("c"), at("2005-05-31T10:00:00Z"));
    await sighting(dev("a"), at("2005-06-01T10:00:00Z"));
    await sighting(dev("a"), at("2005-06-07T10:00:00Z"), "pending");
    await sighting(dev("b"), at("2005-06-08T10:00:00Z"));
    await sighting(dev("a"), at("2005-06-16T10:00:00Z"));
    const gone = await sighting(dev("gone"), at("2005-06-17T10:00:00Z"));
    await db.update(sightingsTable).set({ deviceId: null, redactedAt: at("2005-06-18T10:00:00Z"), redactionReason: "test" }).where(eq(sightingsTable.id, gone));
    // After the range, within 7 days of dev a's 16 Jun: it came back, but isn't counted.
    await sighting(dev("a"), at("2005-06-21T10:00:00Z"), "pending");
    // Spotted in the first week, sent (inserted) last: counted in the week it was spotted.
    await sighting(dev("d"), at("2005-06-02T10:00:00Z"));

    const [r, c] = await Promise.all([launchMeasuresReport(RANGE, NOW), coverageReport(RANGE, NOW)]);
    expect(r.weeks.map((w) => ({ at: w.at, sightings: w.sightings }))).toEqual(c.perWeek);
    expect(r.weeks.map((w) => w.sightings)).toEqual([2, 2, 2]);
    expect(r.sightings).toBe(c.sightings);
    expect(r.spotters).toBe(c.spotters);
    expect(r.spotters).toBe(3);
    expect(r.withoutSpotter).toBe(c.withoutSpotter);
    expect(r.weeks.map((w) => w.spotters)).toEqual([2, 2, 1]);
    // b (seen 20 May) returns in week 2, a (seen 1 Jun) in weeks 2 and 3.
    expect(r.weeks.map((w) => w.returning)).toEqual([0, 2, 1]);
    // Week 3: a's 16 Jun came back on 21 Jun; the deleted spotter's isn't eligible.
    expect(r.weeks[2]!.followUp).toEqual({ eligible: 1, cameBack: 1 });
    expect(r.weeks.every((w) => w.label === "after")).toBe(true);
    expect(r.launchDate).toBe("2005-05-02");
    expect(JSON.stringify(r)).not.toContain(TAG);
  });
});

describe("the loader's match record and corrections (§4.3)", () => {
  // August 2005, a range of its own.
  const RANGE = parseRange({ range: "custom", from: "2005-08-01", to: "2005-08-07" }, NOW);
  const dev = `vitest-launch-${TAG}-m`;

  async function matched(createdAt: Date, m: Partial<typeof sightingMatchesTable.$inferInsert> = {}): Promise<number> {
    const id = await sighting(dev, createdAt);
    await db.insert(sightingMatchesTable).values({
      sightingId: id,
      comparedCatIds: [1, 2],
      suggested: [],
      matcherFailed: false,
      matchedAt: createdAt,
      choice: "suggested",
      suggestedRank: 1,
      chosenAt: createdAt,
      noCatInAnyPhoto: false,
      ...m,
    });
    return id;
  }

  async function move(sightingId: number, reason: string, mergeId: number | null) {
    await db.insert(sightingMovesTable).values({
      sightingId,
      fromCatId: 1,
      toCatId: 2,
      batchId: randomUUID(),
      reason,
      source: mergeId === null ? "cat_page" : "merge",
      mergeId,
      movedByAccountId: "vitest-launch-mover",
      roleAtTime: "staff",
    });
  }

  it("a merge move isn't a correction; a real move is", async () => {
    settings.launchDate = null;
    const merged = await matched(at("2005-08-02T10:00:00Z"));
    await move(merged, "merged", 990_001);
    const undone = await matched(at("2005-08-02T11:00:00Z"));
    await move(undone, "merge_undone", 990_002);
    const wrong = await matched(at("2005-08-02T12:00:00Z"), { teamAction: "looks_right", teamAt: at("2005-08-03T10:00:00Z"), teamByAccountId: "vitest-launch-checker" });
    await move(wrong, "wrong_pick", null);
    const r = await launchMeasuresReport(RANGE, NOW);
    expect(r.weeks).toHaveLength(1);
    const w = r.weeks[0]!;
    expect(w.accuracy).toMatchObject({ right_first: 2, corrected: 1 });
    expect(w.corrected).toBe(1);
    expect(w.checked).toEqual({ right: 0, total: 1 });
  });

  it("reads compared counts, waits, a missing match record and an unfinished sighting", async () => {
    settings.launchDate = null;
    const hand = { choice: "hand_pick", suggestedRank: null, missKind: "distance_miss" } as const;
    await matched(at("2005-08-04T10:00:00Z"), { ...hand, comparedCatIds: [5] });
    await matched(at("2005-08-04T11:00:00Z"), { ...hand, comparedCatIds: null });
    await matched(at("2005-08-04T12:00:00Z"), { ...hand, comparedCatIds: [] });
    await matched(at("2005-08-05T10:00:00Z"), { serverWaitMs: 1200, phoneWaitMs: 2400 });
    await matched(at("2005-08-05T11:00:00Z"), { choice: null, suggestedRank: null, chosenAt: null, matcherFailed: true, comparedCatIds: [] });
    await sighting(dev, at("2005-08-05T12:00:00Z"));
    await sighting(dev, at("2005-08-05T13:00:00Z"), "pending");
    const w = (await launchMeasuresReport(RANGE, NOW)).weeks[0]!;
    expect(w.accuracy).toMatchObject({ missed_far: 1, missed_nothing: 2 });
    expect(w.wait).toMatchObject({ serverP50: 1200, phoneP50: 2400, matcherDown: 1 });
    // Earlier test's three suggestions, plus this one.
    expect(w.groups).toEqual({ not_finished: 1, no_cat: 0, suggested: 4, hand_pick: 3, new_cat: 0, other: 2 });
  });
});
