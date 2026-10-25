import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { catsOfPhoto } from "../lib/capabilityTargets";
import { removeTestPerson } from "../test/removeTestPerson";
import { guardianOn, hidePhoto, newColony, seedCat, signedPerson, type Signed } from "../test/roleKit";
import { cleanUpVetPhotos, keepPhoto, newPhoto, stagePhoto } from "../test/vetPhotoKit";

// SYC-677 Task 2: a vet visit's staged and kept photos are the team's only.
// The public photo route answers one exactly as it answers an unknown id;
// the team photo route serves it to the team, and refuses a cat guardian of
// the cat's own colony with the very 403 a hidden photo gets.

const KEY = "vitest-teamonly-key-0123456789abcdef-0123456789";
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 1]);

let colony: number;
let eleni: Signed;
let staff: Signed;
let kept: { id: number; publicId: string };
let staged: { id: number; publicId: string };
let hiddenPublicId: string;
let catId: number;
const people: string[] = [];

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("teamonly");
  const cat = await seedCat(colony);
  catId = cat.id;
  kept = await newPhoto(BYTES);
  await keepPhoto(kept.id, cat.id);
  staged = await newPhoto(BYTES);
  await stagePhoto(staged.id, cat.id);
  const hidden = await seedCat(colony);
  await hidePhoto(hidden.photoId);
  hiddenPublicId = hidden.photoPublicId;
  eleni = await guardianOn("teamonly-eleni", [colony]);
  staff = await signedPerson("teamonly-staff", ["staff"]);
  people.push(eleni.email, staff.email);
});

afterAll(async () => {
  await cleanUpVetPhotos();
  for (const e of people) await removeTestPerson(e);
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const get = (path: string, cookie?: string) => {
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

/** Status, the cache header and the body, all of which must match. */
const answer = (res: request.Response) => ({
  status: res.status,
  cacheControl: res.headers["cache-control"],
  contentType: res.headers["content-type"],
  body: (res.body as Buffer).toString("utf8"),
});

describe("GET /api/photos/:publicId", () => {
  it("answers a kept photo, and a staged one, exactly as it answers an unknown id", async () => {
    const unknown = answer(await get("/api/photos/no-such-photo-teamonly-0000"));
    expect(unknown.status).toBe(404);
    expect(answer(await get(`/api/photos/${kept.publicId}`))).toEqual(unknown);
    expect(answer(await get(`/api/photos/${staged.publicId}`))).toEqual(unknown);
  });
});

describe("GET /api/team/photos/:publicId", () => {
  it("serves a kept photo, and a staged one, to the team", async () => {
    for (const p of [kept, staged]) {
      const res = await get(`/api/team/photos/${p.publicId}`, staff.cookie);
      expect(res.status).toBe(200);
      expect(Buffer.compare(res.body as Buffer, BYTES)).toBe(0);
    }
  });

  it("ties a kept or staged photo to its cat, so her colony's check passes and the photo's own refusal is what answers", async () => {
    expect(await catsOfPhoto(kept.publicId)).toContain(catId);
    expect(await catsOfPhoto(staged.publicId)).toContain(catId);
  });

  it("refuses a cat guardian of the cat's colony with the same 403 a hidden photo gets", async () => {
    const hidden = answer(await get(`/api/team/photos/${hiddenPublicId}`, eleni.cookie));
    expect(hidden.status).toBe(403);
    expect(answer(await get(`/api/team/photos/${kept.publicId}`, eleni.cookie))).toEqual(hidden);
    expect(answer(await get(`/api/team/photos/${staged.publicId}`, eleni.cookie))).toEqual(hidden);
    // Her colony's other photos still reach her: the refusal is the photo's, not the colony's.
    const visible = await seedCat(colony);
    expect((await get(`/api/team/photos/${visible.photoPublicId}`, eleni.cookie)).status).toBe(200);
  });

  it("and the same for each smaller size", async () => {
    const hidden = answer(await get(`/api/team/photos/${hiddenPublicId}/small`, eleni.cookie));
    expect(hidden.status).toBe(403);
    expect(answer(await get(`/api/team/photos/${kept.publicId}/small`, eleni.cookie))).toEqual(hidden);
  });
});
