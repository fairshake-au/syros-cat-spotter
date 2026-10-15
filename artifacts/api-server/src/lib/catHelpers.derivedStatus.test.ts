/**
 * `deriveCatStatuses` (data-spine.md PR 4): `hasHome`, `lifeStatus`,
 * `notSeenSince` and `sterilised`, and the PR 3 code gate itself end to end
 * through the function every reader calls. Named tests per the plan's PR 4
 * bullet: "with PR 3's step not recorded, a claimed cat with no `homed`
 * observation still has `hasHome: true`; once it's recorded, `hasHome`
 * follows life status." `pr3Gate.ts`'s own unit tests cover `pr3Recorded`
 * in isolation; this file mocks it to exercise both of its states without
 * touching the real migrations history.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  db,
  pool,
  catsTable,
  photosTable,
  catUpdatesTable,
} from "@workspace/db";
import { like, inArray } from "drizzle-orm";
import { writeObservation } from "./observations";

const { pr3RecordedMock } = vi.hoisted(() => ({
  pr3RecordedMock: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("./pr3Gate", () => ({ pr3Recorded: pr3RecordedMock }));

import { deriveCatStatuses } from "./catHelpers";

const NAME_PREFIX = "VitestDerivedStatus";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let seq = 0;

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return p!.id;
}

async function seedCat(opts: {
  ownerDeviceId?: string | null;
  createdAt?: Date;
}): Promise<{ id: number; ownerDeviceId: string | null }> {
  const photoId = await insertPhoto();
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}-${++seq}-${Date.now()}`,
      description: "",
      primaryPhotoId: photoId,
      lat: 37.4448,
      lng: 24.9425,
      discovererDeviceId: "vitest-derivedstatus-seed",
      ownerDeviceId: opts.ownerDeviceId ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  return { id: c!.id, ownerDeviceId: c!.ownerDeviceId };
}

async function cleanup() {
  await db.delete(catUpdatesTable).where(
    inArray(
      catUpdatesTable.catId,
      (
        await db
          .select({ id: catsTable.id })
          .from(catsTable)
          .where(like(catsTable.name, `${NAME_PREFIX}%`))
      ).map((r) => r.id),
    ),
  );
  // observations is append-only -- never deleted; catId has no FK.
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}

beforeAll(cleanup);
afterEach(() => pr3RecordedMock.mockReset());
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("deriveCatStatuses: the PR 3 gate (plan PR 4)", () => {
  it("gate CLOSED: a claimed cat with no homed observation still has hasHome: true (legacy fallback)", async () => {
    pr3RecordedMock.mockResolvedValue(false);
    const cat = await seedCat({ ownerDeviceId: "vitest-owner-device" });

    const result = await deriveCatStatuses([cat]);

    expect(result.get(cat.id)).toEqual({
      hasHome: true,
      lifeStatus: "homed",
      notSeenSince: null,
      sterilised: { value: null, confidence: "unknown", clippedTipSightings: 0 },
      coat: [],
      markings: [],
    });
  });

  it("gate OPEN: the same claimed cat, still with no homed observation, now has hasHome: false", async () => {
    pr3RecordedMock.mockResolvedValue(true);
    const cat = await seedCat({ ownerDeviceId: "vitest-owner-device-2" });

    const result = await deriveCatStatuses([cat]);

    // This is exactly the risk the gate exists to prevent (plan R1/R28) --
    // demonstrated here deliberately, with the gate forced open, to prove
    // the gate (not luck) is what keeps it from happening in practice.
    expect(result.get(cat.id)).toEqual({
      hasHome: false,
      lifeStatus: "street",
      notSeenSince: null,
      sterilised: { value: null, confidence: "unknown", clippedTipSightings: 0 },
      coat: [],
      markings: [],
    });
  });

  it("gate OPEN: hasHome follows life status once a homed observation exists", async () => {
    pr3RecordedMock.mockResolvedValue(true);
    const cat = await seedCat({ ownerDeviceId: "vitest-owner-device-3" });
    await writeObservation(db, {
      catId: cat.id,
      kind: "life_status",
      value: { status: "homed" },
      deviceId: "vitest-owner-device-3",
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: new Date(),
    });

    const result = await deriveCatStatuses([cat]);

    expect(result.get(cat.id)?.hasHome).toBe(true);
    expect(result.get(cat.id)?.lifeStatus).toBe("homed");
  });

  it("gate OPEN: a claimed cat set back to Street by a later staff statement has hasHome: false", async () => {
    pr3RecordedMock.mockResolvedValue(true);
    const cat = await seedCat({ ownerDeviceId: "vitest-owner-device-4" });
    await writeObservation(db, {
      catId: cat.id,
      kind: "life_status",
      value: { status: "homed" },
      deviceId: "vitest-owner-device-4",
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: new Date(Date.now() - 60_000),
    });
    await writeObservation(db, {
      catId: cat.id,
      kind: "life_status",
      value: { status: "street" },
      accountId: "staff-vitest-derivedstatus",
      roleAtTime: "staff",
      observedAt: new Date(),
    });

    const result = await deriveCatStatuses([cat]);

    expect(result.get(cat.id)?.hasHome).toBe(false);
    expect(result.get(cat.id)?.lifeStatus).toBe("street");
  });

  it("gate CLOSED: the sterilised line falls back to the legacy desexed care update", async () => {
    pr3RecordedMock.mockResolvedValue(false);
    const cat = await seedCat({});
    await db.insert(catUpdatesTable).values({
      catId: cat.id,
      updateType: "desexed",
      message: "legacy desexed update",
    });

    const result = await deriveCatStatuses([cat]);

    expect(result.get(cat.id)?.sterilised).toEqual({
      value: true,
      confidence: "confirmed",
      clippedTipSightings: 0,
    });
  });
});

describe("deriveCatStatuses: life and sterilised states (gate open)", () => {
  it("a staff sterilised:true observation reads confirmed", async () => {
    pr3RecordedMock.mockResolvedValue(true);
    const cat = await seedCat({});
    await writeObservation(db, {
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: true },
      accountId: "staff-vitest-derivedstatus",
      roleAtTime: "staff",
      observedAt: new Date(),
    });

    const result = await deriveCatStatuses([cat]);

    expect(result.get(cat.id)?.sterilised).toEqual({
      value: true,
      confidence: "confirmed",
      clippedTipSightings: 0,
    });
  });

  it("a staff sterilised:false observation is a confirmed negative, shown publicly (D4)", async () => {
    pr3RecordedMock.mockResolvedValue(true);
    const cat = await seedCat({});
    await writeObservation(db, {
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: false },
      accountId: "staff-vitest-derivedstatus",
      roleAtTime: "staff",
      observedAt: new Date(),
    });

    const result = await deriveCatStatuses([cat]);

    expect(result.get(cat.id)?.sterilised).toEqual({
      value: false,
      confidence: "confirmed",
      clippedTipSightings: 0,
    });
  });

  it("a photo-backed clipped ear_tip shows publicly as Likely (SYC-75: Q2's gate is open)", async () => {
    pr3RecordedMock.mockResolvedValue(true);
    const cat = await seedCat({});
    await writeObservation(db, {
      catId: cat.id,
      kind: "ear_tip",
      value: { clipped: true },
      deviceId: "vitest-spotter-derivedstatus",
      roleAtTime: "public",
      photoId: 1,
      observedAt: new Date(),
    });

    const result = await deriveCatStatuses([cat]);

    // LIKELY_STERILISED_PUBLIC_LIVE is true (likelyGate.ts): the team can
    // now correct a wrong clip from the Probably sterilised list, so the
    // public line says "Probably" -- value true, but never "confirmed".
    expect(result.get(cat.id)?.sterilised).toEqual({
      value: true,
      confidence: "likely",
      clippedTipSightings: 1,
    });
  });

  it("an ear_tip with no clip seen is never negative evidence, gate open or not", async () => {
    pr3RecordedMock.mockResolvedValue(true);
    const cat = await seedCat({});
    await writeObservation(db, {
      catId: cat.id,
      kind: "ear_tip",
      value: { clipped: false },
      deviceId: "vitest-spotter-derivedstatus-2",
      roleAtTime: "public",
      photoId: 1,
      observedAt: new Date(),
    });

    const result = await deriveCatStatuses([cat]);

    // SYC-75's critical rule: a missing clip says nothing about whether the
    // cat was done. Not known yet -- never value: false.
    expect(result.get(cat.id)?.sterilised).toEqual({
      value: null,
      confidence: "unknown",
      clippedTipSightings: 0,
    });
  });

  it("a cat created today with no sightings is not presumed deceased", async () => {
    pr3RecordedMock.mockResolvedValue(true);
    const cat = await seedCat({});

    const result = await deriveCatStatuses([cat]);

    expect(result.get(cat.id)?.notSeenSince).toBeNull();
  });

  it("a cat with no evidence of life for over 36 months carries notSeenSince, never lifeStatus: deceased", async () => {
    pr3RecordedMock.mockResolvedValue(true);
    const old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 40);
    const cat = await seedCat({ createdAt: old });

    const result = await deriveCatStatuses([cat]);

    // Public payload precision: a calendar date (YYYY-MM-DD, UTC day), not
    // the full ISO timestamp resolve.ts computes internally -- a
    // three-year-old "last seen" doesn't need time-of-day precision, and a
    // bare date avoids a timezone round-trip when the app renders it.
    expect(result.get(cat.id)?.notSeenSince).toBe(
      old.toISOString().slice(0, 10),
    );
    expect(result.get(cat.id)?.notSeenSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.get(cat.id)?.lifeStatus).not.toBe("deceased");
    expect(result.get(cat.id)?.lifeStatus).toBe("street");
  });
});
