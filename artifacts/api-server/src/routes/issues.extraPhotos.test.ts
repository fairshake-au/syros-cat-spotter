import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import {
  catsTable,
  db,
  deviceCredentialsTable,
  photosTable,
  pool,
  sightingsTable,
  welfareReportsTable,
} from "@workspace/db";
import { eq, inArray, like, sql } from "drizzle-orm";
import app from "../app";
import { deleteTestSightings } from "../test/sightings";
import { seedSpot } from "../test/extraPhotoKit";

// SYC-415 PR 3, Task 3.1 (spec §5.5, §6.3): "Report an issue" about an extra
// photo (face or body) of a spot is accepted for the cat the spot was resolved
// to, and refused (422 photo_not_of_this_cat) for any other cat. A pending
// spot's extras belong to no cat yet, so they are refused for every cat.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-issue-extra-${RUN}-`;
const SECRET = `vitest-issue-extra-secret-${RUN}-0123456789`;
// Far out at sea, away from every other file's cats.
const ORIGIN = { lat: 33.8211, lng: 23.2188 };

let n = 0;
async function seedCat(): Promise<number> {
  n += 1;
  const [p] = await db
    .insert(photosTable)
    .values({ data: Buffer.from("fake-main").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}cat-${n}`,
      description: "",
      primaryPhotoId: p!.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      discovererDeviceId: `${PREFIX}spotter`,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

let devN = 0;
let ipN = 0;
function report(catId: number, photoPublicId: string) {
  devN += 1;
  ipN += 1;
  const ref = `ref-${randomBytes(8).toString("hex")}`;
  return request(app)
    .post("/api/issues")
    .set("X-Device-Secret", SECRET)
    .set("X-Forwarded-For", `2001:db8:415:${ipN.toString(16).padStart(2, "0")}00::1`)
    .send({
      deviceId: `${PREFIX}dev-${devN}`,
      clientRef: ref,
      reason: "wrong_cat",
      catId,
      photoPublicId,
      language: "en",
      note: "a note from the reporter",
      turnstileToken: `token-for:${ref}`,
    });
}

async function cleanup() {
  await db.execute(
    sql`delete from mail_outbox where report_id in (select id from welfare_reports where reporter_device like ${PREFIX + "%"})`,
  );
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.reporterDevice, `${PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  const cats = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  if (cats.length) await db.delete(catsTable).where(inArray(catsTable.id, cats.map((c) => c.id)));
  await pool.end();
});

describe("Report an issue reaches a spot's extra photos", () => {
  it("accepts a report about the body extra of a resolved spot, for that spot's cat", async () => {
    const catA = await seedCat();
    const spot = await seedSpot({ deviceId: `${PREFIX}spotter`, catId: catA, ...ORIGIN });
    const res = await report(catA, spot.photos["body"]!.publicId);
    expect([res.status, res.body]).toEqual([201, expect.anything()]);
    const face = await report(catA, spot.photos["face"]!.publicId);
    expect(face.status).toBe(201);
  });

  it("refuses the same photo reported against another cat: 422 photo_not_of_this_cat", async () => {
    const catA = await seedCat();
    const catB = await seedCat();
    const spot = await seedSpot({ deviceId: `${PREFIX}spotter`, catId: catA, ...ORIGIN });
    const res = await report(catB, spot.photos["body"]!.publicId);
    expect([res.status, res.body]).toEqual([422, { error: "photo_not_of_this_cat" }]);
  });

  it("refuses an extra photo of a spot nobody has matched yet", async () => {
    const catA = await seedCat();
    const spot = await seedSpot({ deviceId: `${PREFIX}spotter`, ...ORIGIN });
    const res = await report(catA, spot.photos["body"]!.publicId);
    expect([res.status, res.body]).toEqual([422, { error: "photo_not_of_this_cat" }]);
  });

  it("refuses an extra photo of a PENDING sighting even when its cat id is set", async () => {
    const catA = await seedCat();
    const spot = await seedSpot({ deviceId: `${PREFIX}spotter`, ...ORIGIN });
    // Written directly, past the resolve route and the append-only guard (the
    // owner switches it off for this one statement, as test/sightings.ts does):
    // a pending row that already names a cat.
    await db.transaction(async (tx) => {
      await tx.execute(sql`alter table sightings disable trigger sightings_append_only`);
      await tx.update(sightingsTable).set({ catId: catA }).where(eq(sightingsTable.id, spot.sightingId));
      await tx.execute(sql`alter table sightings enable trigger sightings_append_only`);
    });
    const res = await report(catA, spot.photos["body"]!.publicId);
    expect([res.status, res.body]).toEqual([422, { error: "photo_not_of_this_cat" }]);
  });

  it("still accepts the cover photo and the cat's main photo (unchanged)", async () => {
    const catA = await seedCat();
    const spot = await seedSpot({ deviceId: `${PREFIX}spotter`, catId: catA, ...ORIGIN });
    expect((await report(catA, spot.photos["face"]!.publicId)).status).toBe(201);
    const [cat] = await db.select({ p: catsTable.primaryPhotoId }).from(catsTable).where(eq(catsTable.id, catA));
    const [main] = await db.select({ publicId: photosTable.publicId }).from(photosTable).where(eq(photosTable.id, cat!.p));
    expect((await report(catA, main!.publicId)).status).toBe(201);
  });
});
