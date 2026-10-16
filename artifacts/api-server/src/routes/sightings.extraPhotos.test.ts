/**
 * SYC-415 plan Task 2.5 (docs/specs/photo-tips-and-extra-photos.md §4.4,
 * §5.2, §5.3, §6.1, §6.2): POST /api/sightings takes up to two extra photos,
 * checks them all first, saves them with the sighting in one go, and sends
 * them all to the matcher — on a fresh upload and on a repeat.
 */
import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import {
  appSettingsTable,
  db,
  pool,
  photosTable,
  sightingsTable,
  sightingPhotosTable,
  sightingMatchesTable,
  deviceCredentialsTable,
} from "@workspace/db";
import { asc, count, eq, inArray, like } from "drizzle-orm";

const { matchCatPhoto } = vi.hoisted(() => ({
  matchCatPhoto: vi.fn(
    async (): Promise<{ isCatPhoto: boolean; mixedCats?: boolean; matches: unknown[] }> => ({
      isCatPhoto: true,
      matches: [],
    }),
  ),
}));
vi.mock("../lib/matching", () => ({ matchCatPhoto }));

import app from "../app";
import { peek } from "../lib/limits";
import { _resetAppSettingsCacheForTests } from "../lib/appSettings";
import { DEVICE_MATCH_WINDOW_MS } from "../middlewares/rateLimit";

const PREFIX = "vitest-extraphotos-";

// Out at sea, so no other file's cats are compared.
const LAT = 37.2;
const LNG = 25.4;

async function cleanup() {
  const sightings = await db
    .select({ id: sightingsTable.id, photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${PREFIX}%`));
  const extra = sightings.length
    ? await db
        .select({ photoId: sightingPhotosTable.photoId })
        .from(sightingPhotosTable)
        .where(inArray(sightingPhotosTable.sightingId, sightings.map((s) => s.id)))
    : [];
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  const photoIds = [...new Set([...sightings.map((s) => s.photoId), ...extra.map((e) => e.photoId)])];
  if (photoIds.length) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(cleanup);
beforeEach(() => {
  matchCatPhoto.mockReset();
  matchCatPhoto.mockImplementation(async () => ({ isCatPhoto: true, matches: [] }));
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

const secretFor = (deviceId: string) => `vitest-secret-${deviceId}-0123456789`;

/** A small JPEG of one colour, carrying EXIF with a GPS position. */
async function jpeg(r: number, g: number, b: number): Promise<string> {
  const buf = await sharp({ create: { width: 80, height: 60, channels: 3, background: { r, g, b } } })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Copyright: "vitest fixture" },
        GPS: {
          GPSLatitudeRef: "N",
          GPSLatitude: "37/1 26/1 24/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "24/1 56/1 0/1",
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    .toBuffer();
  return buf.toString("base64");
}

let RED = "";
let GREEN = "";
let BLUE = "";
beforeAll(async () => {
  RED = await jpeg(220, 20, 20);
  GREEN = await jpeg(20, 220, 20);
  BLUE = await jpeg(20, 20, 220);
  // The fixture really carries the position the server must drop.
  expect((await sharp(Buffer.from(RED, "base64")).metadata()).exif).toBeDefined();
});

let offset = 0;
/** A capture time unique to each call, a day ago (within the 30-day clamp). */
function freshCapturedAt(): string {
  offset += 1000;
  return new Date(Date.now() - 86_400_000 - offset).toISOString();
}

function post(deviceId: string, body: Record<string, unknown>) {
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", secretFor(deviceId))
    .send({ deviceId, lat: LAT, lng: LNG, ...body });
}

async function sightingsOf(deviceId: string) {
  return db.select().from(sightingsTable).where(eq(sightingsTable.deviceId, deviceId));
}

async function rowsOf(sightingId: number) {
  return db
    .select()
    .from(sightingPhotosTable)
    .where(eq(sightingPhotosTable.sightingId, sightingId))
    .orderBy(asc(sightingPhotosTable.position));
}

async function photoCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(photosTable);
  return Number(row!.n);
}

async function sightingPhotoCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(sightingPhotosTable);
  return Number(row!.n);
}

/** The photos the matcher was sent on its nth call (0-based). */
function matcherPhotos(call = 0): { role: string; photoBase64: string }[] {
  return (matchCatPhoto.mock.calls[call] as unknown[])[0] as { role: string; photoBase64: string }[];
}

const THREE = () => ({
  photoBase64: RED,
  extraPhotos: [
    { role: "face", photoBase64: GREEN },
    { role: "body", photoBase64: BLUE },
  ],
});

describe("POST /api/sightings with extra photos", () => {
  it("1. saves three photos together, covered by the face photo, and matches all three in order", async () => {
    const device = `${PREFIX}three`;
    const res = await post(device, { ...THREE(), capturedAt: freshCapturedAt() });
    expect(res.status).toBe(201);
    const [s] = await sightingsOf(device);
    expect(s!.id).toBe(res.body.sightingId);
    const rows = await rowsOf(s!.id);
    expect(rows.map((r) => [r.position, r.role])).toEqual([
      [1, "first"],
      [2, "face"],
      [3, "body"],
    ]);
    expect(s!.photoId).toBe(rows[1]!.photoId);
    expect(matchCatPhoto).toHaveBeenCalledTimes(1);
    const sent = matcherPhotos();
    expect(sent.map((p) => p.role)).toEqual(["first", "face", "body"]);
    // The matcher gets the stored (normalised) photos, not the raw upload.
    const stored = await db
      .select()
      .from(photosTable)
      .where(inArray(photosTable.id, rows.map((r) => r.photoId)));
    const byId = new Map(stored.map((p) => [p.id, p.data]));
    expect(sent.map((p) => p.photoBase64)).toEqual(rows.map((r) => byId.get(r.photoId)));
  });

  it("2. one photo means no change: one 'first' row, which is the cover, and one photo matched", async () => {
    const device = `${PREFIX}one`;
    const res = await post(device, { photoBase64: RED, capturedAt: freshCapturedAt() });
    expect(res.status).toBe(201);
    const [s] = await sightingsOf(device);
    const rows = await rowsOf(s!.id);
    expect(rows.map((r) => [r.position, r.role])).toEqual([[1, "first"]]);
    expect(s!.photoId).toBe(rows[0]!.photoId);
    expect(matcherPhotos().map((p) => p.role)).toEqual(["first"]);
  });

  it("3. a bad extra photo saves nothing and says which photo failed", async () => {
    const device = `${PREFIX}badextra`;
    const photosBefore = await photoCount();
    const linksBefore = await sightingPhotoCount();
    const res = await post(device, {
      photoBase64: RED,
      extraPhotos: [{ role: "face", photoBase64: "not-base64!!" }],
      capturedAt: freshCapturedAt(),
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "photoBase64 is not valid base64", photo: "face" });
    expect(await sightingsOf(device)).toHaveLength(0);
    expect(await photoCount()).toBe(photosBefore);
    expect(await sightingPhotoCount()).toBe(linksBefore);
    expect(matchCatPhoto).not.toHaveBeenCalled();
  });

  it("4. two photos with the same role are refused, and nothing is saved", async () => {
    const device = `${PREFIX}duprole`;
    const photosBefore = await photoCount();
    const res = await post(device, {
      photoBase64: RED,
      extraPhotos: [
        { role: "face", photoBase64: GREEN },
        { role: "face", photoBase64: BLUE },
      ],
      capturedAt: freshCapturedAt(),
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Only one face photo and one body photo per spot." });
    expect(await sightingsOf(device)).toHaveLength(0);
    expect(await photoCount()).toBe(photosBefore);
  });

  it("5. a repeat returns the same spot, saves nothing new, and matches all its photos in order", async () => {
    const device = `${PREFIX}repeat`;
    const capturedAt = freshCapturedAt();
    const first = await post(device, { ...THREE(), capturedAt });
    expect(first.status).toBe(201);
    const photosBefore = await photoCount();
    const linksBefore = await sightingPhotoCount();
    const second = await post(device, { ...THREE(), capturedAt });
    expect(second.status).toBe(201);
    expect(second.body.sightingId).toBe(first.body.sightingId);
    expect(await sightingsOf(device)).toHaveLength(1);
    expect(await photoCount()).toBe(photosBefore);
    expect(await sightingPhotoCount()).toBe(linksBefore);
    expect(matchCatPhoto).toHaveBeenCalledTimes(2);
    expect(matcherPhotos(1).map((p) => p.role)).toEqual(["first", "face", "body"]);
    expect(matcherPhotos(1).map((p) => p.photoBase64)).toEqual(
      matcherPhotos(0).map((p) => p.photoBase64),
    );
  });

  it("6. a repeat of an older one-photo sighting (no sighting_photos row) matches its photo_id", async () => {
    const device = `${PREFIX}older`;
    const capturedAt = freshCapturedAt();
    const [photo] = await db.insert(photosTable).values({ data: RED, mime: "image/jpeg" }).returning();
    const [old] = await db
      .insert(sightingsTable)
      .values({
        deviceId: device,
        photoId: photo!.id,
        lat: LAT,
        lng: LNG,
        status: "pending",
        createdAt: new Date(capturedAt),
      })
      .returning();
    expect(await rowsOf(old!.id)).toHaveLength(0);
    const res = await post(device, { photoBase64: RED, capturedAt });
    expect(res.status).toBe(201);
    expect(res.body.sightingId).toBe(old!.id);
    expect(matcherPhotos().map((p) => [p.role, p.photoBase64])).toEqual([["first", RED]]);
    const [m] = await db
      .select()
      .from(sightingMatchesTable)
      .where(eq(sightingMatchesTable.sightingId, old!.id));
    expect(m!.matcherFailed).toBe(false);
  });

  describe("7. the match record", () => {
    async function recordFor(sightingId: number) {
      const [m] = await db
        .select()
        .from(sightingMatchesTable)
        .where(eq(sightingMatchesTable.sightingId, sightingId));
      return m!;
    }

    it("notes 'no cat in any photo' and tells the phone", async () => {
      matchCatPhoto.mockImplementation(async () => ({ isCatPhoto: false, mixedCats: false, matches: [] }));
      const res = await post(`${PREFIX}nocat`, { ...THREE(), capturedAt: freshCapturedAt() });
      expect(res.status).toBe(201);
      expect(res.body.isCatPhoto).toBe(false);
      const m = await recordFor(res.body.sightingId);
      expect(m.noCatInAnyPhoto).toBe(true);
      expect(m.mixedCats).toBe(false);
      expect(m.matcherFailed).toBe(false);
    });

    it("notes 'may be more than one cat'", async () => {
      matchCatPhoto.mockImplementation(async () => ({ isCatPhoto: true, mixedCats: true, matches: [] }));
      const res = await post(`${PREFIX}mixed`, { ...THREE(), capturedAt: freshCapturedAt() });
      expect(res.status).toBe(201);
      const m = await recordFor(res.body.sightingId);
      expect(m.mixedCats).toBe(true);
      expect(m.noCatInAnyPhoto).toBe(false);
    });

    it("an answer in the old shape is 'not mixed', not unknown", async () => {
      matchCatPhoto.mockImplementation(async () => ({ isCatPhoto: true, matches: [] }));
      const res = await post(`${PREFIX}oldshape`, { ...THREE(), capturedAt: freshCapturedAt() });
      const m = await recordFor(res.body.sightingId);
      expect(m.mixedCats).toBe(false);
      expect(m.noCatInAnyPhoto).toBe(false);
    });

    it("when the matcher fails, both are unknown and every photo is still saved", async () => {
      matchCatPhoto.mockImplementation(async () => {
        throw new Error("Connection error.");
      });
      const device = `${PREFIX}failed`;
      const res = await post(device, { ...THREE(), capturedAt: freshCapturedAt() });
      expect(res.status).toBe(201);
      const m = await recordFor(res.body.sightingId);
      expect(m.matcherFailed).toBe(true);
      expect(m.noCatInAnyPhoto).toBeNull();
      expect(m.mixedCats).toBeNull();
      expect(await rowsOf(res.body.sightingId)).toHaveLength(3);
    });
  });

  it("8. a three-photo spot counts once against the device's match limit", async () => {
    const device = `${PREFIX}countonce`;
    const before = (await peek("device_match", device, DEVICE_MATCH_WINDOW_MS)).hits;
    const res = await post(device, { ...THREE(), capturedAt: freshCapturedAt() });
    expect(res.status).toBe(201);
    const after = (await peek("device_match", device, DEVICE_MATCH_WINDOW_MS)).hits;
    expect(after - before).toBe(1);
  });

  it("9. no stored photo keeps hidden data such as where it was taken", async () => {
    const device = `${PREFIX}exif`;
    const res = await post(device, { ...THREE(), capturedAt: freshCapturedAt() });
    expect(res.status).toBe(201);
    const rows = await rowsOf(res.body.sightingId);
    const stored = await db
      .select()
      .from(photosTable)
      .where(inArray(photosTable.id, rows.map((r) => r.photoId)));
    expect(stored).toHaveLength(3);
    for (const p of stored) {
      const meta = await sharp(Buffer.from(p.data, "base64")).metadata();
      expect(meta.exif).toBeUndefined();
    }
  });

  it("10. takes extra photos whatever the switch says (it only hides the boxes)", async () => {
    // A phone that queued extras while the switch was on must not lose them
    // after it goes off (plan Task 2.6).
    await db
      .insert(appSettingsTable)
      .values({ key: "extra_photos_on", value: false })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: false } });
    _resetAppSettingsCacheForTests();
    const device = `${PREFIX}switchoff`;
    const res = await post(device, {
      photoBase64: RED,
      extraPhotos: [{ role: "body", photoBase64: BLUE }],
      capturedAt: freshCapturedAt(),
    });
    expect(res.status).toBe(201);
    const rows = await rowsOf(res.body.sightingId);
    expect(rows.map((r) => r.role)).toEqual(["first", "body"]);
  });
});

