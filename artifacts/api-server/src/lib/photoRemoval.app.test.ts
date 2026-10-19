import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, photosTable, photoVariantsTable, photoVisibilityEventsTable, pool } from "@workspace/db";
import sharp from "sharp";
import { __variantHooks, variantFor } from "./photoVariants";
import { eq } from "drizzle-orm";
import { TEAM_ORIGIN } from "./teamAuth/config";
import app from "../app";
import { hiddenPhotoIds } from "./photoVisibility";
import { hidePhoto, seedCat, signedPerson, type Signed } from "../test/roleKit";
import { markRemoved } from "../test/removalKit";

// SYC-462 (spec §6, §8.4): a photo removed for good is gone from every
// address, answers plainly, and is never shown, sent or rebuilt.
//
// The team people made here stay: photos.removed_by links to them, and the
// throwaway test database is dropped at the end of the run.

const KEY = "vitest-photoremoval-key-0123456789abcdef-0123456789";
let staff: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  staff = await signedPerson("pr-staff", ["staff"]);
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const raw = (path: string, cookie?: string) => {
  const r = request(app)
    .get(path)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  return cookie ? r.set("Cookie", cookie) : r;
};

describe("T9/T18: a removed photo is gone from every address", () => {
  it("T18: a removed photo counts as hidden, even with no hide event", async () => {
    const cat = await seedCat(null);
    await markRemoved(cat.photoId, staff.id);
    expect((await hiddenPhotoIds([cat.photoId])).has(cat.photoId)).toBe(true);
  });

  it("the public address answers 404 no-store, even with no hide event", async () => {
    const cat = await seedCat(null);
    await markRemoved(cat.photoId, staff.id);
    const r = await raw(`/api/photos/${cat.photoPublicId}`);
    expect(r.status).toBe(404);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("the team's full photo and both versions answer 410 no-store", async () => {
    const cat = await seedCat(null);
    await hidePhoto(cat.photoId);
    await markRemoved(cat.photoId, staff.id);
    for (const path of ["", "/small", "/medium"]) {
      const r = await raw(`/api/team/photos/${cat.photoPublicId}${path}`, staff.cookie);
      expect(r.status, path || "full").toBe(410);
      expect(r.headers["cache-control"], path || "full").toContain("no-store");
    }
  });

  it("the cat's public details never contain the removed photo's id", async () => {
    const cat = await seedCat(null);
    await hidePhoto(cat.photoId);
    await markRemoved(cat.photoId, staff.id);
    const r = await request(app).get(`/api/cats/${cat.id}`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(cat.photoPublicId);
  });
});

const countEvents = async (photoId: number) =>
  (await db.select().from(photoVisibilityEventsTable).where(eq(photoVisibilityEventsTable.photoId, photoId)))
    .length;
const post = (path: string, cookie: string) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie);

describe("T10: restoring a removed photo is refused (spec §6 item 2)", () => {
  it("JSON: 409 REMOVED, and no event is written", async () => {
    const cat = await seedCat(null);
    await hidePhoto(cat.photoId);
    await markRemoved(cat.photoId, staff.id);
    const before = await countEvents(cat.photoId);
    const r = await post(`/api/team/photos/${cat.photoPublicId}/restore`, staff.cookie).send({
      cat: String(cat.id),
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("REMOVED");
    expect(await countEvents(cat.photoId)).toBe(before);
  });

  it("form: a plain page saying it was removed for good, and no event is written", async () => {
    const cat = await seedCat(null);
    await hidePhoto(cat.photoId);
    await markRemoved(cat.photoId, staff.id);
    const before = await countEvents(cat.photoId);
    const r = await post(`/api/team/photos/${cat.photoPublicId}/restore`, staff.cookie)
      .type("form")
      .send({ cat: String(cat.id) });
    expect(r.status).toBe(409);
    expect(r.text).toContain("removed for good");
    expect(r.text).toContain("can't be restored");
    expect(await countEvents(cat.photoId)).toBe(before);
  });

  it("hiding a removed photo again writes nothing (it is hidden already)", async () => {
    const cat = await seedCat(null);
    await hidePhoto(cat.photoId);
    await markRemoved(cat.photoId, staff.id);
    const before = await countEvents(cat.photoId);
    const r = await post(`/api/team/photos/${cat.photoPublicId}/hide`, staff.cookie).send({});
    expect(r.status).toBe(409);
    expect(await countEvents(cat.photoId)).toBe(before);
  });
});

const countVariants = async (photoId: number) =>
  (await db.select().from(photoVariantsTable).where(eq(photoVariantsTable.photoId, photoId))).length;

/** A cat whose main photo is a real JPEG, so a version can actually be made. */
async function realJpegCat() {
  const cat = await seedCat(null);
  const jpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#284" } })
    .jpeg()
    .toBuffer();
  await db.update(photosTable).set({ data: jpeg.toString("base64") }).where(eq(photosTable.id, cat.photoId));
  return cat;
}

describe("T15: no version is made from a removed photo (spec §4.3)", () => {
  it("returns null and saves nothing", async () => {
    const cat = await realJpegCat();
    await markRemoved(cat.photoId, staff.id);
    expect(await variantFor(cat.photoId, "small")).toBeNull();
    expect(await countVariants(cat.photoId)).toBe(0);
  });

  it("a removal that lands between the read and the save wins: nothing is saved", async () => {
    const cat = await realJpegCat();
    __variantHooks.afterRead = async () => {
      await markRemoved(cat.photoId, staff.id);
    };
    try {
      expect(await variantFor(cat.photoId, "small")).toBeNull();
    } finally {
      __variantHooks.afterRead = undefined;
    }
    expect(await countVariants(cat.photoId)).toBe(0);
  });

  it("an ordinary photo still gets its version, saved once", async () => {
    const cat = await realJpegCat();
    expect(await variantFor(cat.photoId, "small")).not.toBeNull();
    expect(await countVariants(cat.photoId)).toBe(1);
  });
});
