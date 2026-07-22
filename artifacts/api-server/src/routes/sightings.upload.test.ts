import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { db, pool, photosTable, sightingsTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";

// Keep the AI matcher out of upload tests: it is network-bound, and this suite
// only verifies the photo validation/normalization path.
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const MAX_STORED_BYTES = 5 * 1024 * 1024;
const DEVICE = "vitest-upload-device";

async function cleanup() {
  const rows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  await db.delete(sightingsTable).where(like(sightingsTable.deviceId, `${DEVICE}%`));
  for (const r of rows) {
    await db.delete(photosTable).where(eq(photosTable.id, r.photoId));
  }
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

function noiseRaw(width: number, height: number): Buffer {
  const buf = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) % 256;
  return buf;
}

describe("POST /api/sightings photo handling", () => {
  it("accepts an oversized PNG and stores a normalized JPEG under 5 MB", async () => {
    // Big enough to exceed the 5 MB stored cap, small enough that its base64
    // form stays under the JSON body limit.
    const width = 2400;
    const height = 1800;
    const png = await sharp(noiseRaw(width, height), {
      raw: { width, height, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(png.length).toBeGreaterThan(MAX_STORED_BYTES);

    const res = await request(app).post("/api/sightings").send({
      deviceId: DEVICE,
      lat: 37.44,
      lng: 24.9,
      photoBase64: png.toString("base64"),
    });
    expect(res.status).toBe(201);
    expect(res.body.sightingId).toBeTypeOf("number");

    const [sighting] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, res.body.sightingId));
    const [photo] = await db
      .select()
      .from(photosTable)
      .where(eq(photosTable.id, sighting!.photoId));

    const stored = Buffer.from(photo!.data, "base64");
    expect(photo!.mime).toBe("image/jpeg");
    expect(stored.length).toBeLessThanOrEqual(MAX_STORED_BYTES);
    expect((await sharp(stored).metadata()).format).toBe("jpeg");
  }, 60000);

  it("rejects a corrupt file with valid magic bytes with 400", async () => {
    const fake = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.from("garbage".repeat(50)),
    ]);
    const res = await request(app).post("/api/sightings").send({
      deviceId: DEVICE,
      lat: 37.44,
      lng: 24.9,
      photoBase64: fake.toString("base64"),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/corrupt/i);
  });

  it("rejects invalid base64 with 400", async () => {
    const res = await request(app).post("/api/sightings").send({
      deviceId: DEVICE,
      lat: 37.44,
      lng: 24.9,
      photoBase64: "!!!not-base64!!!",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/base64/i);
  });

  it("does not persist a sighting or photo for a rejected upload", async () => {
    const before = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, `${DEVICE}-rejected`));
    expect(before).toHaveLength(0);

    await request(app).post("/api/sightings").send({
      deviceId: `${DEVICE}-rejected`,
      lat: 37.44,
      lng: 24.9,
      photoBase64: "AAAA", // valid base64, not an image
    });

    const after = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, `${DEVICE}-rejected`));
    expect(after).toHaveLength(0);
  });
});
