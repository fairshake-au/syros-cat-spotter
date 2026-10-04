/**
 * SYC-119 Slice D, built inside data spine PR 4 per the plan
 * (`docs/superpowers/plans/data-spine.md`, PR 4 — "built in this PR's
 * checklist if #52 has merged"; #52 merged 30 Sep 2026). Spec
 * `choose-a-different-cat.md` §4.8 / `cat-record-data-spine.md` §3.2:
 *
 * - resolve refuses a **hand pick** of a cat recorded as deceased, with the
 *   same NOT_NEARBY-style refusal a too-far pick gets (so a refusal never
 *   tells a prober *why* it failed);
 * - a **suggested** match of the same cat still goes through and clears the
 *   death, because the resolving sighting is itself the evidence (§3.2).
 *
 * Until PR 8 ships (the team endpoint that writes a `deceased` observation),
 * nothing in production can put a cat into this state — these tests seed
 * the observation directly through `writeObservation`, exactly as the plan
 * says to: "until the team can record a death (PR 8), this is a no-op,
 * which is fine."
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  photosTable,
  sightingsTable,
  profilesTable,
  catSubscriptionsTable,
  catUpdatesTable,
  notificationsTable,
} from "@workspace/db";
import { eq, ilike, inArray, like } from "drizzle-orm";
import { squareCentre, type LatLng } from "@workspace/geo";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";
import { writeObservation } from "../lib/observations";
import { sightingMatchesTable } from "@workspace/db";

const DEVICE = "vitest-deceasedguard-device";
const CAT_PREFIX = "VitestDeceasedGuardCat";
const SECRET = "vitest-deceasedguard-secret-0123456789ab";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const SQUARE = squareCentre({ lat: 37.4448, lng: 24.9425 });

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return p!.id;
}

async function insertSighting(deviceId: string, at: LatLng): Promise<number> {
  const photoId = await insertPhoto();
  const [s] = await db
    .insert(sightingsTable)
    .values({ deviceId, photoId, lat: at.lat, lng: at.lng, status: "pending" })
    .returning();
  return s!.id;
}

let seq = 0;
async function seedCat(at: LatLng): Promise<{ id: number; photoId: number }> {
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
  return { id: c!.id, photoId };
}

async function markDeceased(catId: number, observedAt = new Date()): Promise<void> {
  await writeObservation(db, {
    catId,
    kind: "life_status",
    value: { status: "deceased" },
    accountId: "staff-vitest-deceasedguard",
    roleAtTime: "staff",
    observedAt,
  });
}

async function suggest(sightingId: number, catId: number, score = 0.9): Promise<void> {
  await db
    .insert(sightingMatchesTable)
    .values({
      sightingId,
      comparedCatIds: [catId],
      suggested: [{ catId, rank: 1, score }],
      matchedAt: new Date(),
    });
}

function resolve(sightingId: number, device: string, body: object) {
  return request(app)
    .post(`/api/sightings/${sightingId}/resolve`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: device, ...body });
}

async function sightingRow(id: number) {
  const [s] = await db.select().from(sightingsTable).where(eq(sightingsTable.id, id));
  return s!;
}

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id, photoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(ilike(catsTable.name, `${CAT_PREFIX}%`));
  const catIds = cats.map((c) => c.id);
  // observations is append-only (cat-record-data-spine.md §10.1) — this
  // file never deletes a row from it. observations.catId has no FK, so
  // orphaned rows from a dropped cat are harmless, and the whole database
  // is thrown away at the end of the run (src/test/globalSetup.ts).
  if (catIds.length > 0) {
    const updates = await db
      .select({ id: catUpdatesTable.id })
      .from(catUpdatesTable)
      .where(inArray(catUpdatesTable.catId, catIds));
    if (updates.length > 0) {
      await db.delete(notificationsTable).where(
        inArray(notificationsTable.catUpdateId, updates.map((u) => u.id)),
      );
    }
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, catIds));
    await db.delete(catSubscriptionsTable).where(inArray(catSubscriptionsTable.catId, catIds));
  }
  const rows = await db
    .select({ photoId: sightingsTable.photoId, id: sightingsTable.id })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  if (rows.length > 0) {
    await db
      .delete(sightingMatchesTable)
      .where(inArray(sightingMatchesTable.sightingId, rows.map((r) => r.id)));
  }
  await db.delete(sightingsTable).where(like(sightingsTable.deviceId, `${DEVICE}%`));
  const photoIds = [...rows.map((r) => r.photoId), ...cats.map((c) => c.photoId)];
  if (catIds.length > 0) await db.delete(catsTable).where(inArray(catsTable.id, catIds));
  if (photoIds.length > 0) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await db.delete(catSubscriptionsTable).where(like(catSubscriptionsTable.deviceId, `${DEVICE}%`));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("resolve's hand-pick guard refuses a deceased cat (SYC-119 Slice D)", () => {
  it("refuses a hand pick of a cat recorded as deceased, with the NOT_NEARBY refusal", async () => {
    const device = `${DEVICE}-handpick-dead`;
    const cat = await seedCat(SQUARE);
    await markDeceased(cat.id);
    const sightingId = await insertSighting(device, SQUARE);

    const res = await resolve(sightingId, device, { catId: cat.id });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "That cat isn't listed near where you took this photo.",
      code: "NOT_NEARBY",
    });
    const s = await sightingRow(sightingId);
    expect(s.status).toBe("pending");
    expect(s.catId).toBeNull();
  });

  it("accepts a hand pick of the same cat once a later statement clears the death", async () => {
    const device = `${DEVICE}-handpick-cleared`;
    const cat = await seedCat(SQUARE);
    await markDeceased(cat.id, new Date(Date.now() - 60_000));
    // A newer non-deceased life_status statement clears it (§10.2's
    // resolver rule, tested directly in resolve.test.ts) -- a staff
    // correction, for this test, rather than a sighting (the sighting
    // being attempted here is itself what needs to succeed).
    await writeObservation(db, {
      catId: cat.id,
      kind: "life_status",
      value: { status: "street" },
      accountId: "staff-vitest-deceasedguard",
      roleAtTime: "staff",
      observedAt: new Date(),
    });
    const sightingId = await insertSighting(device, SQUARE);

    const res = await resolve(sightingId, device, { catId: cat.id });

    expect(res.status).toBe(200);
    expect(res.body.cat.id).toBe(cat.id);
  });

  it("accepts a SUGGESTED match of a deceased cat, and the resolve clears the death (§3.2)", async () => {
    const device = `${DEVICE}-suggested-dead`;
    const cat = await seedCat(SQUARE);
    await markDeceased(cat.id, new Date(Date.now() - 60_000));
    const sightingId = await insertSighting(device, SQUARE);
    await suggest(sightingId, cat.id);

    const res = await resolve(sightingId, device, { catId: cat.id });

    expect(res.status).toBe(200);
    expect(res.body.cat.id).toBe(cat.id);

    // The resolving sighting is the evidence that clears the death: a fresh
    // read is no longer deceased (resolve.test.ts covers the resolver rule
    // itself in isolation; this proves it end to end through the route).
    const { loadCatRecords } = await import("../lib/observations");
    const { resolveCat } = await import("../lib/resolve");
    const records = (await loadCatRecords([cat.id])).get(cat.id)!;
    const snapshot = resolveCat(records.observations, records.evidenceOfLife, new Date());
    expect(snapshot.lifeStatus).not.toBe("deceased");
  });

  it("still refuses a too-far hand pick identically, so the deceased guard doesn't change the refusal's shape", async () => {
    const device = `${DEVICE}-far-and-alive`;
    const cat = await seedCat(SQUARE);
    const sightingId = await insertSighting(device, {
      lat: SQUARE.lat + 1,
      lng: SQUARE.lng,
    });

    const res = await resolve(sightingId, device, { catId: cat.id });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "That cat isn't listed near where you took this photo.",
      code: "NOT_NEARBY",
    });
  });
});
