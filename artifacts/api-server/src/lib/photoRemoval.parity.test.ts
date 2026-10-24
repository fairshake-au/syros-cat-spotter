import { afterAll, describe, expect, it } from "vitest";
import { db, photosTable, pool, sightingsTable } from "@workspace/db";
import { standInFor } from "@workspace/db/photoRemoval";
import { catDisplayPhotoIds } from "./photoVisibility";
import { hidePhoto, seedCat } from "../test/roleKit";
import { markRemoved } from "../test/removalKit";
import { signedPerson } from "../test/roleKit";
import { cleanUpVetPhotos, keepPhoto, stagePhoto } from "../test/vetPhotoKit";

// SYC-462 spec §4.2, T14: the removal's repoint (lib/db standInFor, SQL)
// picks exactly the photo the public already sees in place of a hidden main
// photo (catDisplayPhotoIds, the api-server's one stand-in rule). Two copies
// of one rule, pinned together.

afterAll(async () => {
  await cleanUpVetPhotos();
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

async function cover(catId: number, createdAt: Date, opts: { hidden?: boolean; removedBy?: string } = {}) {
  const [p] = await db
    .insert(photosTable)
    .values({ data: Buffer.from(`cover-${createdAt.getTime()}-${Math.random()}`).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  await db
    .insert(sightingsTable)
    .values({ deviceId: "vt-parity", photoId: p!.id, lat: 37.445, lng: 24.942, status: "resolved", catId, createdAt });
  if (opts.hidden || opts.removedBy) await hidePhoto(p!.id);
  if (opts.removedBy) await markRemoved(p!.id, opts.removedBy);
  return p!.id;
}

async function bothAgree(cat: { id: number; photoId: number }): Promise<number> {
  const client = await pool.connect();
  try {
    const sql = await standInFor(client, cat.id, cat.photoId);
    const app = (await catDisplayPhotoIds([{ id: cat.id, primaryPhotoId: cat.photoId }])).get(cat.id) ?? 0;
    expect(sql).toBe(app);
    return sql;
  } finally {
    client.release();
  }
}

describe("T14: the repoint and the public stand-in agree", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));

  it("several candidates: the newest", async () => {
    const cat = await seedCat(null);
    await cover(cat.id, day(1));
    const newest = await cover(cat.id, day(5));
    await cover(cat.id, day(3));
    await hidePhoto(cat.photoId);
    expect(await bothAgree(cat)).toBe(newest);
  });

  it("the newest is hidden: the next one", async () => {
    const cat = await seedCat(null);
    const next = await cover(cat.id, day(4));
    await cover(cat.id, day(6), { hidden: true });
    await hidePhoto(cat.photoId);
    expect(await bothAgree(cat)).toBe(next);
  });

  it("the newest is removed: the next one", async () => {
    process.env["TEAM_SESSION_KEYS"] = "vitest-parity-key-0123456789abcdef-0123456789";
    const staff = await signedPerson("parity-staff", ["staff"]);
    const cat = await seedCat(null);
    const next = await cover(cat.id, day(4));
    await cover(cat.id, day(7), { removedBy: staff.id });
    await hidePhoto(cat.photoId);
    expect(await bothAgree(cat)).toBe(next);
  });

  it("the newest two are a vet visit's team-only photos (kept, staged): the next one (SYC-677)", async () => {
    const cat = await seedCat(null);
    const next = await cover(cat.id, day(4));
    await keepPhoto(await cover(cat.id, day(8)), cat.id);
    await stagePhoto(await cover(cat.id, day(9)), cat.id);
    await hidePhoto(cat.photoId);
    expect(await bothAgree(cat)).toBe(next);
  });

  it("a tie on created_at: the higher id", async () => {
    const cat = await seedCat(null);
    await cover(cat.id, day(8));
    const later = await cover(cat.id, day(8));
    await hidePhoto(cat.photoId);
    expect(await bothAgree(cat)).toBe(later);
  });

  it("no candidates: none (0)", async () => {
    const cat = await seedCat(null);
    await hidePhoto(cat.photoId);
    expect(await bothAgree(cat)).toBe(0);
  });
});
