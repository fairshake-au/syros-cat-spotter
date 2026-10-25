import { afterAll, describe, expect, it } from "vitest";
import { db, pool, sightingsTable } from "@workspace/db";
import { teamOnlyPhotoIds } from "./teamOnlyPhotos";
import { catDisplayPhotoIds, catDisplayPhotos, hiddenPhotoIds } from "./photoVisibility";
import { displayPhotoOf } from "./findFromPhoto";
import { hidePhoto, seedCat } from "../test/roleKit";
import { cleanUpVetPhotos, keepPhoto, newPhoto, stagePhoto } from "../test/vetPhotoKit";

// SYC-677 Task 2: a vet visit's photos are the team's only. A photo with any
// batch link or a kept link (vet_visit_photos) is team-only, unless it is a
// cat's primary photo (a new cat's first photo), which stays public. Every public reader asks through hiddenPhotoIds, which
// counts a team-only photo as hidden, as it does a removed one.

afterAll(async () => {
  await cleanUpVetPhotos();
  await pool.end();
});

async function cover(catId: number, createdAt: Date, photoId?: number) {
  const id = photoId ?? (await newPhoto()).id;
  await db
    .insert(sightingsTable)
    .values({ deviceId: "vt-teamonly", photoId: id, lat: 37.445, lng: 24.942, status: "resolved", catId, createdAt });
  return id;
}

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));

describe("teamOnlyPhotoIds", () => {
  it("returns a staged photo and a kept photo, and not a sighting's photo", async () => {
    const cat = await seedCat(null);
    const staged = await newPhoto();
    const keptPhoto = await newPhoto();
    await stagePhoto(staged.id, cat.id);
    await keepPhoto(keptPhoto.id, cat.id);
    const sighting = await cover(cat.id, day(1));
    const got = await teamOnlyPhotoIds([staged.id, keptPhoto.id, sighting, cat.photoId]);
    expect([...got].sort((a, b) => a - b)).toEqual([staged.id, keptPhoto.id].sort((a, b) => a - b));
  });

  it("a batch photo in a SAVED batch with no kept link is still team-only (fails closed)", async () => {
    const p = await newPhoto();
    await stagePhoto(p.id, null, { saved: true });
    expect([...(await teamOnlyPhotoIds([p.id]))]).toEqual([p.id]);
  });

  it("a batch photo that is a cat's primary photo (a new cat's first photo) is not team-only", async () => {
    const cat = await seedCat(null);
    await stagePhoto(cat.photoId, cat.id, { saved: true });
    expect((await teamOnlyPhotoIds([cat.photoId])).size).toBe(0);
    const other = await seedCat(null);
    await keepPhoto(other.photoId, other.id);
    expect((await teamOnlyPhotoIds([other.photoId])).size).toBe(0);
  });

  it("a staged photo for a new cat (no cat yet) is team-only", async () => {
    const p = await newPhoto();
    await stagePhoto(p.id, null);
    expect([...(await teamOnlyPhotoIds([p.id]))]).toEqual([p.id]);
  });

  it("an empty list asks nothing and answers nothing", async () => {
    expect((await teamOnlyPhotoIds([])).size).toBe(0);
  });

  it("hiddenPhotoIds counts a team-only photo as hidden from the public", async () => {
    const cat = await seedCat(null);
    const keptPhoto = await newPhoto();
    await keepPhoto(keptPhoto.id, cat.id);
    expect((await hiddenPhotoIds([keptPhoto.id, cat.photoId])).has(keptPhoto.id)).toBe(true);
    expect((await hiddenPhotoIds([cat.photoId])).has(cat.photoId)).toBe(false);
  });
});

describe("the public's photo of a cat never is a team-only one", () => {
  it("catDisplayPhotoIds: a team-only cover never shows, and a kept main photo (the exception) still does", async () => {
    const cat = await seedCat(null);
    await cover(cat.id, day(2));
    await keepPhoto(cat.photoId, cat.id);
    const rows = [{ id: cat.id, primaryPhotoId: cat.photoId }];
    expect((await catDisplayPhotoIds(rows)).get(cat.id)).toBe(cat.photoId);
    expect((await catDisplayPhotos(rows)).get(cat.id)).toContain(cat.photoPublicId);
  });

  it("catDisplayPhotoIds never picks a team-only photo, even when it is the cat's newest", async () => {
    const cat = await seedCat(null);
    const older = await cover(cat.id, day(3));
    const staged = await cover(cat.id, day(9));
    await stagePhoto(staged, cat.id);
    const keptNewest = await cover(cat.id, day(10));
    await keepPhoto(keptNewest, cat.id);
    await hidePhoto(cat.photoId);
    expect((await catDisplayPhotoIds([{ id: cat.id, primaryPhotoId: cat.photoId }])).get(cat.id)).toBe(older);
  });

  it("catDisplayPhotoIds: only team-only photos to show gives none", async () => {
    const cat = await seedCat(null);
    await hidePhoto(cat.photoId);
    await keepPhoto(await cover(cat.id, day(5)), cat.id);
    expect((await catDisplayPhotoIds([{ id: cat.id, primaryPhotoId: cat.photoId }])).get(cat.id)).toBeNull();
  });

  it("displayPhotoOf never uses a team-only photo as a Find reference", async () => {
    const lone = await seedCat(null);
    await hidePhoto(lone.photoId);
    await keepPhoto(await cover(lone.id, day(6)), lone.id);
    const withCover = await seedCat(null);
    await hidePhoto(withCover.photoId);
    const older = await cover(withCover.id, day(4));
    await stagePhoto(await cover(withCover.id, day(9)), withCover.id);
    const got = await displayPhotoOf([lone.id, withCover.id]);
    expect(got.has(lone.id)).toBe(false);
    expect(got.get(withCover.id)).toBe(older);
  });
});
