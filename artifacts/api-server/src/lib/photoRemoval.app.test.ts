import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  db,
  observationsTable,
  photosTable,
  photoVariantsTable,
  photoVisibilityEventsTable,
  pool,
  sightingsTable,
} from "@workspace/db";
import { listLikelyForReview } from "./likelyReview";
import sharp from "sharp";
import { __variantHooks, variantFor } from "./photoVariants";
import { eq } from "drizzle-orm";
import { TEAM_ORIGIN } from "./teamAuth/config";
import app from "../app";
import { hiddenPhotoIds } from "./photoVisibility";
import { guardianOn, hidePhoto, newColony, seedCat, signedPerson, type Signed } from "../test/roleKit";
import { removePhoto } from "@workspace/db/photoRemoval";
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

  it("the team's full photo and every stored size (small, medium and card) answer 410 no-store", async () => {
    const cat = await seedCat(null);
    await hidePhoto(cat.photoId);
    await markRemoved(cat.photoId, staff.id);
    for (const path of ["", "/small", "/medium", "/card"]) {
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

  it("form: the removal date is the Syros day, not the UTC day (SYC-637)", async () => {
    const cat = await seedCat(null);
    await markRemoved(cat.photoId, staff.id);
    // 22:30 UTC on 10 Oct is already 11 Oct on the island.
    await db.update(photosTable).set({ removedAt: new Date("2026-10-10T22:30:00Z") }).where(eq(photosTable.id, cat.photoId));
    const r = await post(`/api/team/photos/${cat.photoPublicId}/restore`, staff.cookie)
      .type("form")
      .send({ cat: String(cat.id) });
    expect(r.text).toContain("removed for good on 2026-10-11.");
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

/** A second photo of `catId`, as the cover of a resolved sighting. */
async function resolvedSightingPhoto(catId: number) {
  const [p] = await db
    .insert(photosTable)
    .values({ data: Buffer.from("stand-in").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  const [s] = await db
    .insert(sightingsTable)
    .values({ deviceId: "vt-removal-dev", photoId: p!.id, lat: 37.445, lng: 24.942, status: "resolved", catId })
    .returning({ id: sightingsTable.id });
  return { photoId: p!.id, publicId: p!.publicId, sightingId: s!.id };
}

describe("T9 part 2: the team's pages draw no broken image (spec §6 item 8)", () => {
  it("the team cat page (HTML and JSON) leaves a removed photo out, and keeps the live one", async () => {
    const cat = await seedCat(null);
    const live = await resolvedSightingPhoto(cat.id);
    await hidePhoto(cat.photoId);
    await markRemoved(cat.photoId, staff.id);
    const html = await request(app).get(`/api/team/cats/${cat.id}`).set("Cookie", staff.cookie);
    expect(html.status).toBe(200);
    expect(html.text).not.toContain(cat.photoPublicId);
    expect(html.text).toContain(live.publicId);
    const json = await request(app)
      .get(`/api/team/cats/${cat.id}`)
      .set("Accept", "application/json")
      .set("Cookie", staff.cookie);
    expect(json.status).toBe(200);
    expect(JSON.stringify(json.body)).not.toContain(cat.photoPublicId);
  });

  it("the likely-coat list gives a removed ear-clip photo no address", async () => {
    const cat = await seedCat(null);
    const clip = await resolvedSightingPhoto(cat.id);
    await db.insert(observationsTable).values({
      catId: cat.id,
      kind: "ear_tip",
      value: { clipped: true, side: "left" },
      deviceId: "vt-removal-dev",
      roleAtTime: "public",
      sightingId: clip.sightingId,
      photoId: clip.photoId,
      observedAt: new Date(Date.now() - 3_600_000),
    });
    const before = (await listLikelyForReview()).find((c) => c.catId === cat.id);
    expect(before, "the cat is in the likely list").toBeTruthy();
    expect(JSON.stringify(before)).toContain(clip.publicId);
    await hidePhoto(clip.photoId);
    await markRemoved(clip.photoId, staff.id);
    const after = (await listLikelyForReview()).find((c) => c.catId === cat.id);
    expect(JSON.stringify(after ?? {})).not.toContain(clip.publicId);
  });
});

describe("end to end: removePhoto (the command's function), then every page", () => {
  it("the public page, the team page and a cat guardian's page show the stand-in, never the removed photo", async () => {
    const colony = await newColony("e2e-removal");
    const cat = await seedCat(colony);
    // A picture of its own: seedCat's stand-in bytes are shared by every seeded
    // cat, and the search rightly reports the same picture in another row.
    await db
      .update(photosTable)
      .set({ data: Buffer.from(`e2e-own-picture-${cat.photoId}-${Date.now()}`.repeat(4)).toString("base64") })
      .where(eq(photosTable.id, cat.photoId));
    const standIn = await resolvedSightingPhoto(cat.id);
    const eleni = await guardianOn("e2e-removal-eleni", [colony]);
    await db.insert(photoVisibilityEventsTable).values({
      photoId: cat.photoId,
      action: "hide",
      author: staff.id,
      personId: staff.id,
      reason: "privacy",
    });
    const client = await pool.connect();
    try {
      const r = await removePhoto(client as unknown as Parameters<typeof removePhoto>[0], {
        publicId: cat.photoPublicId,
        by: staff.id,
        ref: "SYC-462",
        apply: true,
        requireSwitch: false,
        recheckDelayMs: 5,
      });
      expect(r.kind).toBe("removed");
      if (r.kind === "removed") expect(r.search.lines.filter((l) => l.ok !== true)).toEqual([]);
    } finally {
      client.release();
    }
    const pub = await request(app).get(`/api/cats/${cat.id}`);
    expect(JSON.stringify(pub.body)).not.toContain(cat.photoPublicId);
    expect(JSON.stringify(pub.body)).toContain(standIn.publicId);
    const team = await request(app).get(`/api/team/cats/${cat.id}`).set("Accept", "application/json").set("Cookie", staff.cookie);
    expect(team.status).toBe(200);
    expect(JSON.stringify(team.body)).not.toContain(cat.photoPublicId);
    expect(team.body.cat.mainPhotoUrl).toContain(standIn.publicId);
    const mine = await request(app).get(`/api/team/my/cats/${cat.id}`).set("Accept", "application/json").set("Cookie", eleni.cookie);
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.body)).not.toContain(cat.photoPublicId);
  });
});

describe("step 5b: the public app is told a photo was removed (photoRemoved)", () => {
  it("a removed sighting photo says photoRemoved: true; other sightings don't carry the field", async () => {
    const cat = await seedCat(null);
    const gone = await resolvedSightingPhoto(cat.id);
    const kept = await resolvedSightingPhoto(cat.id);
    await hidePhoto(gone.photoId);
    await markRemoved(gone.photoId, staff.id);
    const r = await request(app).get(`/api/cats/${cat.id}`);
    expect(r.status).toBe(200);
    const sightings = r.body.sightings as { photoUrl: string | null; photoHidden: boolean; photoRemoved?: boolean }[];
    const removed = sightings.filter((x) => x.photoRemoved === true);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ photoUrl: null, photoHidden: true });
    const others = sightings.filter((x) => x.photoRemoved !== true);
    expect(others.some((x) => x.photoUrl?.includes(kept.publicId))).toBe(true);
    for (const x of others) expect(Object.keys(x)).not.toContain("photoRemoved");
  });
});
