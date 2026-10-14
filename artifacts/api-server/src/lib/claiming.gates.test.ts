import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  db,
  pool,
  catsTable,
  sightingsTable,
  sightingMatchesTable,
  catUpdatesTable,
} from "@workspace/db";
import { like } from "drizzle-orm";

// The parts of claiming.ts that need a stand-in: the PR 3 gate (critic
// HIGH-2) and haversineKm at exactly the 1 km edge (critic MEDIUM-1).
// claiming.test.ts runs everything against the real ones.
const { pr3RecordedMock, haversineOverride } = vi.hoisted(() => ({
  pr3RecordedMock: vi.fn<() => Promise<boolean>>(),
  haversineOverride: { km: null as number | null },
}));
vi.mock("./pr3Gate", () => ({ pr3Recorded: pr3RecordedMock }));
vi.mock("@workspace/geo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/geo")>();
  return {
    ...actual,
    haversineKm: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
      haversineOverride.km ?? actual.haversineKm(a, b),
  };
});

import { claimEligibility, pinWithinReach } from "./claiming";
import { deriveCatStatuses } from "./catHelpers";
import { writeObservation } from "./observations";

const NAME_PREFIX = "VitestClaimGates";
let counter = 0;
async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterEach(() => {
  pr3RecordedMock.mockReset();
  haversineOverride.km = null;
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

const dev = () => `dev-gates-${Math.random().toString(36).slice(2, 10)}`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function metCat(deviceId: string) {
  counter += 1;
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${counter}-${Math.random().toString(36).slice(2, 7)}`,
      primaryPhotoId: 0,
      lat: 37.4441,
      lng: 24.9412,
      discovererDeviceId: "dev-someone",
    })
    .returning();
  const [s] = await db
    .insert(sightingsTable)
    .values({
      catId: c!.id,
      deviceId,
      photoId: 0,
      lat: 37.44,
      lng: 24.94,
      status: "resolved",
      createdAt: daysAgo(5),
    })
    .returning();
  await db.insert(sightingMatchesTable).values({
    sightingId: s!.id,
    choice: "suggested",
    chosenCatId: c!.id,
    chosenAt: daysAgo(5),
    suggestedRank: 1,
  });
  return c!;
}

describe("claimEligibility fails closed while the PR 3 gate is shut (critic HIGH-2)", () => {
  it("a deceased cat isn't claimable through the legacy fallback", async () => {
    pr3RecordedMock.mockResolvedValue(true);
    const d = dev();
    const c = await metCat(d);
    await writeObservation(db, {
      catId: c.id,
      kind: "life_status",
      value: { status: "deceased" },
      accountId: "system:legacy-backfill",
      roleAtTime: "staff",
      observedAt: daysAgo(1),
    });
    expect(await claimEligibility(db, { catId: c.id, deviceId: d })).toEqual({
      ok: false,
      code: "NOT_ON_STREET",
    });
    pr3RecordedMock.mockResolvedValue(false);
    // The legacy fallback alone would call this cat "street".
    expect((await deriveCatStatuses([{ id: c.id, ownerDeviceId: null }])).get(c.id)!.lifeStatus).toBe("street");
    expect(await claimEligibility(db, { catId: c.id, deviceId: d })).toEqual({
      ok: false,
      code: "NOT_ON_STREET",
    });
  });

  it("no cat is claimable while the gate is shut, and every one that qualifies is once it opens", async () => {
    const d = dev();
    const c = await metCat(d);
    pr3RecordedMock.mockResolvedValue(false);
    expect(await claimEligibility(db, { catId: c.id, deviceId: d })).toEqual({
      ok: false,
      code: "NOT_ON_STREET",
    });
    pr3RecordedMock.mockResolvedValue(true);
    expect(await claimEligibility(db, { catId: c.id, deviceId: d })).toEqual({ ok: true });
  });
});

describe("deriveCatStatuses' legacy read goes through the caller's transaction (critic LOW-2)", () => {
  it("sees an uncommitted desexed care update", async () => {
    pr3RecordedMock.mockResolvedValue(false);
    const c = await metCat(dev());
    const ROLLBACK = new Error("rollback");
    let value: boolean | null | undefined;
    await db
      .transaction(async (tx) => {
        await tx
          .insert(catUpdatesTable)
          .values({ catId: c.id, updateType: "desexed", message: "test" });
        value = (await deriveCatStatuses([{ id: c.id, ownerDeviceId: null }], tx)).get(c.id)!
          .sterilised.value;
        throw ROLLBACK;
      })
      .catch((err) => {
        if (err !== ROLLBACK) throw err;
      });
    expect(value).toBe(true);
  });
});

describe("pinWithinReach is inclusive at exactly 1 km (critic MEDIUM-1)", () => {
  const cat = { lat: 37.4441, lng: 24.9412 };
  const pin = { lat: 37.45, lng: 24.95 };
  it("exactly 1.0 km is within", () => {
    haversineOverride.km = 1.0;
    expect(pinWithinReach(cat, pin)).toBe(true);
  });
  it("1.000001 km is not", () => {
    haversineOverride.km = 1.000001;
    expect(pinWithinReach(cat, pin)).toBe(false);
  });
});
