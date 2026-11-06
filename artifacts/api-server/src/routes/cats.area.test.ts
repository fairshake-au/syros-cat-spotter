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
import { areaFor } from "../lib/areas/namedAreas";
import { blurPosition } from "../lib/blur";

// SYC-810: every route that sends a cat carries the area of its published
// cell centre: GET /cats, GET /cats/:id and the resolve reply. (The other
// callers share serialiseCat; the unit test is in lib/catHelpers.area.test.ts.)

const PREFIX = "vitest-syc810-";
const DEVICE = `${PREFIX}device`;
const SECRET = "vitest-syc810-secret-0123456789abcdef";
const KINI = { lat: 37.4436, lng: 24.8889 };
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const OWNER = `${PREFIX}owner`;
const OWNER_SECRET = "vitest-syc810-owner-0123456789abcdef";
/** A home pin in Kini, a third area: neither the exact spot's nor the cell's. */
const PIN = { homeLat: KINI.lat, homeLng: KINI.lng };

/** An exact spot whose own area differs from its published cell's. */
function borderSpot() {
  const lat = 37.4447;
  for (let i = 0; i <= 2000; i++) {
    const lng = 24.935 + i * 0.00005;
    const cell = blurPosition(lat, lng);
    if (areaFor(lat, lng).key !== areaFor(cell.lat, cell.lng).key) return { lat, lng, cell };
  }
  throw new Error("no border spot");
}
const SPOT = borderSpot();
const CELL_AREA = areaFor(SPOT.cell.lat, SPOT.cell.lng) as { key: string; name: string };

let catId: number;
let ownedId: number;

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
  const [owned] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}Bordercat`,
      description: "",
      primaryPhotoId: photo!.id,
      lat: SPOT.lat,
      lng: SPOT.lng,
      discovererDeviceId: `${PREFIX}discoverer`,
      ownerDeviceId: OWNER,
      ownerName: "Ownerperson",
      homeDescription: "blue door",
      ...PIN,
      createdAt: new Date("2026-09-01T09:00:00Z"),
    })
    .returning({ id: catsTable.id });
  ownedId = owned!.id;
  // Any first post with a secret registers the device, so it can read as owner.
  const first = await request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", OWNER_SECRET)
    .send({
      deviceId: OWNER,
      lat: SPOT.lat,
      lng: SPOT.lng,
      photoBase64: TINY_JPEG_B64,
      capturedAt: new Date(Date.now() - 7_200_000).toISOString(),
    });
  expect(first.status).toBe(201);
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

  describe("a cat across a border from its cell, with a home pin in a third area", () => {
    const expectCellArea = (cat: { areaKey?: string | null; areaName?: string | null }) => {
      expect(cat.areaKey).toBe(CELL_AREA.key);
      expect(cat.areaName).toBe(CELL_AREA.name);
    };

    it("the spot, the cell and the pin really are in different areas", () => {
      const spotKey = (areaFor(SPOT.lat, SPOT.lng) as { key: string }).key;
      const pinKey = (areaFor(PIN.homeLat, PIN.homeLng) as { key: string }).key;
      expect(new Set([spotKey, CELL_AREA.key, pinKey]).size).toBe(3);
    });

    it("GET /cats gives the cell's area and position", async () => {
      const res = await request(app).get(`/api/cats?lat=${SPOT.cell.lat}&lng=${SPOT.cell.lng}&pageSize=200`);
      const cat = (res.body.cats as { id: number; lat: number; lng: number }[]).find((c) => c.id === ownedId);
      expect(cat).toBeTruthy();
      expectCellArea(cat!);
      expect([cat!.lat, cat!.lng]).toEqual([SPOT.cell.lat, SPOT.cell.lng]);
    });

    it("GET /cats/:id gives the public the cell's area and nothing finer", async () => {
      const res = await request(app).get(`/api/cats/${ownedId}`);
      expectCellArea(res.body.cat);
      expect([res.body.cat.lat, res.body.cat.lng]).toEqual([SPOT.cell.lat, SPOT.cell.lng]);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(String(SPOT.lng));
      expect(text).not.toContain(String(PIN.homeLng));
      expect(text).not.toContain("blue door");
    });

    it("the owner's GET /cats/:id and PATCH keep the same area", async () => {
      const read = await request(app)
        .get(`/api/cats/${ownedId}`)
        .set("X-Device-Id", OWNER)
        .set("X-Device-Secret", OWNER_SECRET);
      expect(read.body.cat.locationPrecision).toBe("exact");
      expectCellArea(read.body.cat);
      const patched = await request(app)
        .patch(`/api/cats/${ownedId}`)
        .set("X-Device-Secret", OWNER_SECRET)
        .send({ deviceId: OWNER, homeDescription: "green door" });
      expect(patched.status).toBe(200);
      expectCellArea(patched.body);
    });

    it("the resolve reply gives the cell's area", async () => {
      const sighting = await request(app)
        .post("/api/sightings")
        .set("X-Device-Secret", SECRET)
        .send({
          deviceId: DEVICE,
          lat: SPOT.cell.lat,
          lng: SPOT.cell.lng,
          photoBase64: TINY_JPEG_B64,
          capturedAt: new Date(Date.now() - 7_200_000).toISOString(),
        });
      expect(sighting.status).toBe(201);
      const resolved = await request(app)
        .post(`/api/sightings/${sighting.body.sightingId}/resolve`)
        .set("X-Device-Secret", SECRET)
        .send({ deviceId: DEVICE, catId: ownedId });
      expect(resolved.status).toBe(200);
      expectCellArea(resolved.body.cat);
    });
  });
});
