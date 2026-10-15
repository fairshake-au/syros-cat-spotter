import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, photosTable, pool } from "@workspace/db";
import app from "../app";
import { removeTestPerson } from "../test/removeTestPerson";
import {
  guardianOn,
  hidePhoto,
  newColony,
  seedCat,
  signedPerson,
  type SeededCat,
  type Signed,
} from "../test/roleKit";

// SYC-396 PR 1.2 (spec §11): GET /api/team/photos/:publicId/:size has exactly
// the checks of GET /api/team/photos/:publicId (one shared helper), and
// serves a small or medium JPEG that the browser may keep privately.

const KEY = "vitest-photovariants-key-0123456789abcdef-0123456789";
const FORBIDDEN = [403, '{"error":"forbidden"}'];

let colonyA: number;
let colonyB: number;
let catA: SeededCat;
let catB: SeededCat;
let catNowhere: SeededCat;
let hiddenA: SeededCat;
let eleni: Signed;
let staff: Signed;
const people: string[] = [];

/** A real picture in place of seedCat's stand-in bytes, so a version can be made. */
async function realPhoto(cat: SeededCat): Promise<SeededCat> {
  const jpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#284" } })
    .jpeg()
    .toBuffer();
  await db
    .update(photosTable)
    .set({ data: jpeg.toString("base64") })
    .where(eq(photosTable.id, cat.photoId));
  return cat;
}

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colonyA = await newColony("pv-A");
  colonyB = await newColony("pv-B");
  catA = await realPhoto(await seedCat(colonyA));
  catB = await realPhoto(await seedCat(colonyB));
  catNowhere = await realPhoto(await seedCat(null));
  hiddenA = await realPhoto(await seedCat(colonyA));
  await hidePhoto(hiddenA.photoId);
  eleni = await guardianOn("pv-eleni", [colonyA]);
  staff = await signedPerson("pv-staff", ["staff"]);
  people.push(eleni.email, staff.email);
});

afterAll(async () => {
  for (const e of people) await removeTestPerson(e);
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

/** Status and body text (the picture parser leaves `res.text` empty). */
const said = (res: request.Response): [number, string] => [res.status, (res.body as Buffer).toString("utf8")];

const version = (publicId: string, size: string, cookie?: string) => {
  const r = request(app)
    .get(`/api/team/photos/${publicId}/${size}`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  return cookie ? r.set("Cookie", cookie) : r;
};

describe("the photo version route", () => {
  it("gives the team a JPEG of each size, no wider than the size", async () => {
    for (const [size, width] of [
      ["small", 160],
      ["medium", 640],
    ] as const) {
      const res = await version(catA.photoPublicId, size, staff.cookie);
      expect(res.status, size).toBe(200);
      expect(res.headers["content-type"]).toBe("image/jpeg");
      expect((await sharp(res.body as Buffer).metadata()).width).toBe(width);
    }
  });

  it("is kept privately by the browser for a day, and never public", async () => {
    const res = await version(catA.photoPublicId, "small", staff.cookie);
    expect(res.headers["cache-control"]).toBe("private, max-age=86400");
    expect(res.headers["cache-control"]).not.toMatch(/public/);
  });

  it("answers 404 for any other size", async () => {
    for (const size of ["large", "original", "0", "Small", "constructor", "__proto__"]) {
      const res = await version(catA.photoPublicId, size, staff.cookie);
      expect(res.status, size).toBe(404);
    }
  });

  it("answers 404 for a photo whose stored bytes aren't an image (nothing crashes)", async () => {
    const odd = await seedCat(colonyA);
    const res = await version(odd.photoPublicId, "small", staff.cookie);
    expect(res.status).toBe(404);
  });

  it("answers the sign-in 401 with no session", async () => {
    const res = await version(catA.photoPublicId, "small");
    expect(said(res)).toEqual([401, '{"error":"not_signed_in"}']);
  });

  it("a hidden photo's versions go only to a holder of hide_photo: the team, never a guardian", async () => {
    for (const size of ["small", "medium"]) {
      const refused = await version(hiddenA.photoPublicId, size, eleni.cookie);
      expect(said(refused), size).toEqual(FORBIDDEN);
      expect((await version(hiddenA.photoPublicId, size, staff.cookie)).status, size).toBe(200);
    }
  });

  it("a guardian gets her own colony's cat, never another colony's or a cat in none", async () => {
    expect((await version(catA.photoPublicId, "small", eleni.cookie)).status).toBe(200);
    for (const cat of [catB, catNowhere]) {
      for (const size of ["small", "medium"]) {
        const res = await version(cat.photoPublicId, size, eleni.cookie);
        expect(said(res), `${cat.id} ${size}`).toEqual(FORBIDDEN);
      }
    }
  });

  it("the team sees every cat's, in any colony or none", async () => {
    for (const cat of [catA, catB, catNowhere]) {
      expect((await version(cat.photoPublicId, "small", staff.cookie)).status).toBe(200);
    }
  });
});
