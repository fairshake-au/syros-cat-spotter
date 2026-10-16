import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { db, pool, photosTable, sightingsTable, sightingPhotosTable } from "@workspace/db";
import { asc, count, eq, inArray, like } from "drizzle-orm";
import { deleteTestSightings } from "../test/sightings";
import {
  coverRole,
  saveSpotWithPhotos,
  spotPhotoList,
  validateSpotPhotos,
  type ValidatedSpotPhoto,
} from "./spotPhotos";

// SYC-415 plan Task 2.3: the cover rule, checking every photo, and saving a
// spot with all its photos in one transaction (spec §5.1, §6.2).

const DEVICE = "vitest-spotphotos";

async function cleanup() {
  const rows = await db
    .select({ photoId: sightingPhotosTable.photoId })
    .from(sightingPhotosTable)
    .innerJoin(sightingsTable, eq(sightingsTable.id, sightingPhotosTable.sightingId))
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
  if (rows.length) {
    await db.delete(photosTable).where(inArray(photosTable.id, rows.map((r) => r.photoId)));
  }
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function solid(r: number, g: number, b: number): Promise<ValidatedSpotPhoto["buffer"]> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r, g, b } } })
    .jpeg()
    .toBuffer();
}

async function photoCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(photosTable);
  return Number(row!.n);
}

describe("coverRole (spec §5.1)", () => {
  it("is the face photo when there is one", () => {
    expect(coverRole(["first", "face", "body"])).toBe("face");
    expect(coverRole(["first", "face"])).toBe("face");
  });
  it("is the first photo otherwise", () => {
    expect(coverRole(["first"])).toBe("first");
    expect(coverRole(["first", "body"])).toBe("first");
  });
});

describe("spotPhotoList", () => {
  it("puts the first photo first, then extras in the order sent", () => {
    const r = spotPhotoList({
      photoBase64: "A",
      extraPhotos: [
        { role: "body", photoBase64: "B" },
        { role: "face", photoBase64: "C" },
      ],
    });
    expect(r).toEqual({
      ok: true,
      photos: [
        { role: "first", photoBase64: "A" },
        { role: "body", photoBase64: "B" },
        { role: "face", photoBase64: "C" },
      ],
    });
  });
  it("is just the first photo with no extras", () => {
    expect(spotPhotoList({ photoBase64: "A" })).toEqual({
      ok: true,
      photos: [{ role: "first", photoBase64: "A" }],
    });
  });
  it("refuses two photos with the same role", () => {
    expect(
      spotPhotoList({
        photoBase64: "A",
        extraPhotos: [
          { role: "face", photoBase64: "B" },
          { role: "face", photoBase64: "C" },
        ],
      }),
    ).toEqual({ ok: false, error: "Only one face photo and one body photo per spot." });
  });
});

describe("validateSpotPhotos", () => {
  it("names the photo that failed", async () => {
    const good = (await solid(200, 10, 10)).toString("base64");
    const r = await validateSpotPhotos([
      { role: "first", photoBase64: good },
      { role: "face", photoBase64: "not-base64!!" },
    ]);
    expect(r).toEqual({ ok: false, error: "photoBase64 is not valid base64", photo: "face" });
  });

  it("refuses the same photo twice, even sent as different bytes", async () => {
    // PNG is lossless: two compression levels give different base64 for the
    // same pixels, so only the normalised output can show they're the same.
    const raw = sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 140, b: 60 } } });
    const a = await raw.clone().png({ compressionLevel: 0 }).toBuffer();
    const b = await raw.clone().png({ compressionLevel: 9 }).toBuffer();
    expect(a.toString("base64")).not.toBe(b.toString("base64"));
    const r = await validateSpotPhotos([
      { role: "first", photoBase64: a.toString("base64") },
      { role: "face", photoBase64: b.toString("base64") },
    ]);
    expect(r).toEqual({
      ok: false,
      error: "The same photo can only be used once in a spot.",
      photo: "face",
    });
  });

  it("passes different photos through, normalised to JPEG, in order", async () => {
    const r = await validateSpotPhotos([
      { role: "first", photoBase64: (await solid(200, 10, 10)).toString("base64") },
      { role: "body", photoBase64: (await solid(10, 200, 10)).toString("base64") },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.photos.map((p) => [p.role, p.mime])).toEqual([
      ["first", "image/jpeg"],
      ["body", "image/jpeg"],
    ]);
  });
});

describe("saveSpotWithPhotos (database)", () => {
  const capturedAt = new Date("2026-10-01T10:00:00Z");

  it("saves one sighting, covered by the face photo, with all three photos in order", async () => {
    const photos: ValidatedSpotPhoto[] = [
      { role: "first", buffer: await solid(200, 10, 10), mime: "image/jpeg" },
      { role: "face", buffer: await solid(10, 200, 10), mime: "image/jpeg" },
      { role: "body", buffer: await solid(10, 10, 200), mime: "image/jpeg" },
    ];
    const saved = await saveSpotWithPhotos({
      deviceId: `${DEVICE}-three`,
      lat: 37.44,
      lng: 24.9,
      capturedAt,
      photos,
    });
    const sightings = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, `${DEVICE}-three`));
    expect(sightings).toHaveLength(1);
    expect(sightings[0]!.id).toBe(saved.sightingId);
    const face = saved.photos.find((p) => p.role === "face")!;
    expect(sightings[0]!.photoId).toBe(face.photoId);
    expect(sightings[0]!.createdAt.toISOString()).toBe(capturedAt.toISOString());

    const rows = await db
      .select()
      .from(sightingPhotosTable)
      .where(eq(sightingPhotosTable.sightingId, saved.sightingId))
      .orderBy(asc(sightingPhotosTable.position));
    expect(rows.map((r) => [r.position, r.role])).toEqual([
      [1, "first"],
      [2, "face"],
      [3, "body"],
    ]);
    expect(rows.map((r) => r.photoId)).toEqual(saved.photos.map((p) => p.photoId));
  });

  it("saves nothing if one photo can't be saved", async () => {
    const before = await photoCount();
    await expect(
      saveSpotWithPhotos({
        deviceId: `${DEVICE}-atomic`,
        lat: 37.44,
        lng: 24.9,
        capturedAt,
        photos: [
          { role: "first", buffer: await solid(200, 10, 10), mime: "image/jpeg" },
          { role: "face", buffer: await solid(10, 200, 10), mime: "image/jpeg" },
          // Breaks sighting_photos_role_ck on the last insert.
          { role: "bogus" as never, buffer: await solid(10, 10, 200), mime: "image/jpeg" },
        ],
      }),
    ).rejects.toThrow();
    expect(
      await db.select().from(sightingsTable).where(eq(sightingsTable.deviceId, `${DEVICE}-atomic`)),
    ).toHaveLength(0);
    expect(await photoCount()).toBe(before);
  });

  it("drops a photo's sighting_photos row when the photo is deleted for good", async () => {
    const saved = await saveSpotWithPhotos({
      deviceId: `${DEVICE}-cascade`,
      lat: 37.44,
      lng: 24.9,
      capturedAt,
      photos: [
        { role: "first", buffer: await solid(200, 10, 10), mime: "image/jpeg" },
        { role: "body", buffer: await solid(10, 10, 200), mime: "image/jpeg" },
      ],
    });
    const body = saved.photos.find((p) => p.role === "body")!;
    await db.delete(photosTable).where(eq(photosTable.id, body.photoId));
    const rows = await db
      .select()
      .from(sightingPhotosTable)
      .where(eq(sightingPhotosTable.sightingId, saved.sightingId));
    expect(rows.map((r) => r.role)).toEqual(["first"]);
  });
});
