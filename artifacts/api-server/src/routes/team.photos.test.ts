import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  addPerson,
  db,
  pool,
  photosTable,
  removePerson,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
  signInThroughHandoff,
} from "../lib/teamAuth/__fixtures__/queueKit";

// SYC-43 part 2 plan, test P1-3 (spec §8.6 #12, team half): the team's
// report-photo route serves the bytes to a signed-in person and 401s without
// one, and the public photo route never serves a report photo.

const EMAIL = "vitest-tphoto-susan@example.com";
const KEY = "vitest-tphoto-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let cookie: string;
const REPORT_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 250]);
const CATALOGUE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6]);
let reportPhotoId: string;
let cataloguePhotoId: string;

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
  await removePerson(EMAIL);
  const susan = await addPerson({
    email: EMAIL,
    name: "Susan",
    addedBy: "cli:vitest",
  });
  cookie = await signInThroughHandoff(app, handoffKey, susan.id);
  const [photo] = await db
    .insert(photosTable)
    .values({ data: CATALOGUE_BYTES.toString("base64"), mime: "image/png" })
    .returning({ publicId: photosTable.publicId });
  cataloguePhotoId = photo!.publicId;
});

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
  const r = await seedReport({
    photo: { mime: "image/jpeg", bytes: REPORT_BYTES },
  });
  reportPhotoId = r.photoPublicId!;
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  await db.delete(photosTable).where(eq(photosTable.publicId, cataloguePhotoId));
  await removePerson(EMAIL);
  await pool.end();
});

const binary = (res: request.Response, parsed: Buffer) => {
  expect(res.status).toBe(200);
  expect(Buffer.compare(res.body as Buffer, parsed)).toBe(0);
};

const get = (path: string, withCookie = true) => {
  const r = request(app)
    .get(path)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  return withCookie ? r.set("Cookie", cookie) : r;
};

describe("P1-3: the team report-photo route", () => {
  it("serves the bytes, with the stored type, never cached or sniffed", async () => {
    const res = await get(`/api/team/report-photos/${reportPhotoId}`);
    binary(res, REPORT_BYTES);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("img-src 'self'");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("is a 401 without a session, the same refusal as everywhere", async () => {
    const res = await request(app).get(
      `/api/team/report-photos/${reportPhotoId}`,
    );
    expect(res.status).toBe(401);
    expect(res.text).toBe('{"error":"not_signed_in"}');
    expect(res.body).not.toBeInstanceOf(Buffer);
  });

  it("is a 404 for an id that doesn't exist, and for a catalogue photo's id", async () => {
    expect((await get("/api/team/report-photos/nope")).status).toBe(404);
    expect(
      (await get(`/api/team/report-photos/${cataloguePhotoId}`)).status,
    ).toBe(404);
  });

  it("is never served by the public photo route", async () => {
    const res = await request(app).get(`/api/photos/${reportPhotoId}`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(REPORT_BYTES.toString());
  });
});

describe("the team catalogue-photo route", () => {
  it("serves a catalogue photo to a signed-in person, and 401s without one", async () => {
    const res = await get(`/api/team/photos/${cataloguePhotoId}`);
    binary(res, CATALOGUE_BYTES);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const refused = await request(app).get(
      `/api/team/photos/${cataloguePhotoId}`,
    );
    expect(refused.status).toBe(401);
    expect(refused.text).toBe('{"error":"not_signed_in"}');
  });

  it("is a 404 for an unknown id, and for a report photo's id", async () => {
    expect((await get("/api/team/photos/nope")).status).toBe(404);
    expect((await get(`/api/team/photos/${reportPhotoId}`)).status).toBe(404);
  });
});
