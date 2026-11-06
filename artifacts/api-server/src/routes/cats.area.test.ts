import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { like } from "drizzle-orm";
import {
  catsTable,
  db,
  deviceCredentialsTable,
  photosTable,
  pool,
  sightingsTable,
} from "@workspace/db";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async (_photo: string, candidates: { catId: number }[]) => ({
    isCatPhoto: true,
    matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.9, reasoning: "test" })),
  })),
}));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";

// SYC-810: every route that sends a cat carries the area of its published
// cell centre: GET /cats, GET /cats/:id and the resolve reply. (The other
// callers share serialiseCat; the unit test is in lib/catHelpers.area.test.ts.)

const PREFIX = "vitest-syc810-";
const DEVICE = `${PREFIX}device`;
const SECRET = "vitest-syc810-secret-0123456789abcdef";
const KINI = { lat: 37.4436, lng: 24.8889 };
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
let catId: number;

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(async () => {
  await cleanup();
  const [photo] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}main`, data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}Kinicat`,
      description: "Waits by the harbour",
      primaryPhotoId: photo!.id,
      lat: KINI.lat,
      lng: KINI.lng,
      discovererDeviceId: `${PREFIX}discoverer`,
      createdAt: new Date("2026-09-01T09:00:00Z"),
    })
    .returning({ id: catsTable.id });
  catId = cat!.id;
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("the area on the routes that send a cat", () => {
  it("GET /cats carries areaKey and areaName", async () => {
    const res = await request(app).get(`/api/cats?lat=${KINI.lat}&lng=${KINI.lng}&pageSize=200`);
    expect(res.status).toBe(200);
    const cat = (res.body.cats as { id: number; areaKey: string | null; areaName: string | null }[]).find(
      (c) => c.id === catId,
    );
    expect(cat?.areaKey).toBe("kini");
    expect(cat?.areaName).toBe("Kini");
  });

  it("GET /cats/:id carries areaKey and areaName", async () => {
    const res = await request(app).get(`/api/cats/${catId}`);
    expect(res.status).toBe(200);
    expect(res.body.cat.areaKey).toBe("kini");
    expect(res.body.cat.areaName).toBe("Kini");
  });

  it("the resolve reply carries areaKey and areaName", async () => {
    const sighting = await request(app)
      .post("/api/sightings")
      .set("X-Device-Secret", SECRET)
      .send({
        deviceId: DEVICE,
        lat: KINI.lat,
        lng: KINI.lng,
        photoBase64: TINY_JPEG_B64,
        capturedAt: new Date(Date.now() - 7_200_000).toISOString(),
      });
    expect(sighting.status).toBe(201);
    const resolved = await request(app)
      .post(`/api/sightings/${sighting.body.sightingId}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, catId });
    expect(resolved.status).toBe(200);
    expect(resolved.body.cat.areaKey).toBe("kini");
    expect(resolved.body.cat.areaName).toBe("Kini");
  });
});
