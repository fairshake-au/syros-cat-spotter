import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { like } from "drizzle-orm";
import { catsTable, db, photosTable, pool, sightingsTable } from "@workspace/db";
import app from "../app";
import { deleteTestSightings } from "../test/sightings";
import { seedSpot, type SeededSpot } from "../test/extraPhotoKit";
import { RUN, hidePhoto } from "../test/roleKit";

// SYC-415 PR 3, Task 3.2 (spec §5.5, §6.3): the public cat page lists each
// sighting's extra photos next to its cover. The key is left out when a
// sighting has none (so the byte-exact snapshots don't move), a hidden extra
// is null, and nothing from a spot nobody has matched yet is public.

const PREFIX = `vt-cats-extra-${RUN}-`;
// Out at sea, away from every other file's cats.
const AT = { lat: 33.9011, lng: 23.3188 };

let catId: number;
let threePhoto: SeededSpot;
let onePhoto: SeededSpot;
let pending: SeededSpot;

beforeAll(async () => {
  const [mainPhoto] = await db
    .insert(photosTable)
    .values({ data: Buffer.from("fake-main").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}cat`,
      description: "",
      primaryPhotoId: mainPhoto!.id,
      ...AT,
      discovererDeviceId: `${PREFIX}spotter`,
    })
    .returning({ id: catsTable.id });
  catId = cat!.id;
  // A face extra makes the face the cover; the first and body photos are extras.
  threePhoto = await seedSpot({
    deviceId: `${PREFIX}spotter`,
    catId,
    ...AT,
    createdAt: new Date(Date.now() - 2 * 86_400_000),
  });
  onePhoto = await seedSpot({
    deviceId: `${PREFIX}spotter`,
    catId,
    roles: ["first"],
    ...AT,
    createdAt: new Date(Date.now() - 5 * 86_400_000),
  });
  // A spot nobody has matched yet, close by.
  pending = await seedSpot({ deviceId: `${PREFIX}spotter`, ...AT });
});

afterAll(async () => {
  // Photos with hide events stay (the log is append-only); the throwaway test
  // database goes at the end of the run.
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await pool.end();
});

type Sighting = {
  photoUrl: string | null;
  extraPhotos?: { role: string; photoUrl: string | null }[];
};
const url = (s: SeededSpot, role: string) => `/api/photos/${s.photos[role]!.publicId}`;

async function sightings(): Promise<Sighting[]> {
  const res = await request(app).get(`/api/cats/${catId}`);
  expect(res.status).toBe(200);
  return res.body.sightings as Sighting[];
}

describe("GET /api/cats/:id lists a sighting's extra photos", () => {
  it("a three-photo spot: the face is the cover, the first and body photos are the extras, in order", async () => {
    const s = (await sightings()).find((x) => x.photoUrl === url(threePhoto, "face"));
    expect(s).toBeDefined();
    expect(s!.extraPhotos).toEqual([
      { role: "first", photoUrl: url(threePhoto, "first") },
      { role: "body", photoUrl: url(threePhoto, "body") },
    ]);
  });

  it("a one-photo spot has no extraPhotos key at all", async () => {
    const s = (await sightings()).find((x) => x.photoUrl === url(onePhoto, "first"));
    expect(s).toBeDefined();
    expect("extraPhotos" in s!).toBe(false);
  });

  it("a pending spot's photos appear nowhere public", async () => {
    const ids = Object.values(pending.photos).map((p) => p.publicId);
    const detail = await request(app).get(`/api/cats/${catId}`);
    const list = await request(app).get(`/api/cats?lat=${AT.lat}&lng=${AT.lng}`);
    expect(list.status).toBe(200);
    for (const id of ids) {
      expect(detail.text).not.toContain(id);
      expect(list.text).not.toContain(id);
    }
  });

  it("a hidden extra is null while the others stay (run last: hiding is permanent here)", async () => {
    await hidePhoto(threePhoto.photos["body"]!.id);
    const s = (await sightings()).find((x) => x.photoUrl === url(threePhoto, "face"));
    expect(s!.photoUrl).toBe(url(threePhoto, "face"));
    expect(s!.extraPhotos).toEqual([
      { role: "first", photoUrl: url(threePhoto, "first") },
      { role: "body", photoUrl: null },
    ]);
    // The body photo's address is not in the page at all.
    const detail = await request(app).get(`/api/cats/${catId}`);
    expect(detail.text).not.toContain(threePhoto.photos["body"]!.publicId);
  });
});
