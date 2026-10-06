import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, photosTable, sightingsTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";

// Keep the AI matcher out of these tests — only name moderation is under test.
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const DEVICE = "vitest-catname-modn-device";

async function cleanup() {
  const rows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
  for (const r of rows) {
    await db.delete(photosTable).where(eq(photosTable.id, r.photoId));
  }
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function createPendingSighting() {
  const [photo] = await db
    .insert(photosTable)
    .values({ data: "dGVzdA==", mime: "image/jpeg" })
    .returning();
  const [sighting] = await db
    .insert(sightingsTable)
    .values({
      deviceId: DEVICE,
      photoId: photo!.id,
      lat: 37.44,
      lng: 24.9,
      status: "pending",
    })
    .returning();
  return sighting!;
}

describe("POST /api/sightings/:id/resolve cat name moderation", () => {
  it("rejects an offensive new cat name with 400 and code OFFENSIVE_NAME", async () => {
    const sighting = await createPendingSighting();
    const res = await request(app)
      .post(`/api/sightings/${sighting.id}/resolve`)
      .set("X-Device-Secret", "vitest-resolve-secret-0123456789ab")
      .send({ deviceId: DEVICE, newCatName: "malakas the cat" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NAME");
  });

  it("rejects a disguised offensive cat name", async () => {
    const sighting = await createPendingSighting();
    const res = await request(app)
      .post(`/api/sightings/${sighting.id}/resolve`)
      .set("X-Device-Secret", "vitest-resolve-secret-0123456789ab")
      .send({ deviceId: DEVICE, newCatName: "p u t a i n" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NAME");
  });
});

// SYC-101 (review of #92): a name with nothing left once folded (only
// invisible characters) can't name a new cat; nothing is created.
describe("POST /api/sightings/:id/resolve with a name that folds to nothing", () => {
  it("rejects it with 400 EMPTY_NAME and leaves the sighting pending", async () => {
    const sighting = await createPendingSighting();
    const res = await request(app)
      .post(`/api/sightings/${sighting.id}/resolve`)
      .set("X-Device-Secret", "vitest-resolve-secret-0123456789ab")
      .send({ deviceId: DEVICE, newCatName: "\u200b\u2060\u200b" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Cat name is empty", code: "EMPTY_NAME" });
    const [after] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, sighting.id));
    expect(after!.status).toBe("pending");
    expect(after!.catId).toBeNull();
  });
});
