import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pool, db, photosTable, sightingsTable } from "@workspace/db";
import { like, inArray } from "drizzle-orm";
import app from "../app";
import { catsOfPhoto, photoTargets } from "./capabilityTargets";
import { TEAM_ORIGIN } from "./teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";
import { deleteTestSightings } from "../test/sightings";
import { seedSpot, type SeededSpot } from "../test/extraPhotoKit";
import {
  RUN,
  guardianOn,
  newColony,
  seedCat,
  signedPerson,
  type SeededCat,
  type Signed,
} from "../test/roleKit";

// SYC-415 PR 3, Task 3.1 (spec §5.5, §6.3): a spot's extra photos (face,
// body) belong to the cat the spot was resolved to, so who may view them, hide
// them or restore them is judged by that cat's colony, read from the record.

const KEY = "vitest-extraphoto-targets-key-0123456789abcdef";
const DEVICE = `vt-extraphotos-targets-${RUN}`;

let colonyA: number;
let colonyB: number;
let catA: SeededCat;
let catB: SeededCat;
let spotA: SeededSpot;
let guardianA: Signed;
let guardianB: Signed;
let staff: Signed;
const emails: string[] = [];

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colonyA = await newColony("extra-A");
  colonyB = await newColony("extra-B");
  catA = await seedCat(colonyA);
  catB = await seedCat(colonyB);
  spotA = await seedSpot({ deviceId: DEVICE, catId: catA.id });
  guardianA = await guardianOn("extra-gA", [colonyA]);
  guardianB = await guardianOn("extra-gB", [colonyB]);
  staff = await signedPerson("extra-staff", ["staff"]);
  // The staff person hides a photo, which signs the append-only log, so she
  // can't be removed afterwards; the throwaway database goes at the end of the run.
  emails.push(guardianA.email, guardianB.email);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  // The photos stay: a hide event is append-only, and the throwaway test
  // database goes at the end of the run.
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
  for (const e of emails) await removeTestPerson(e);
  await pool.end();
});

const viewer = (publicId: string, who: Signed) =>
  request(app).get(`/api/team/photos/${publicId}`).set("Cookie", who.cookie).buffer(true);

const hide = (publicId: string, who: Signed) =>
  request(app)
    .post(`/api/team/photos/${publicId}/hide`)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", who.cookie)
    .type("json")
    .send({});

describe("Task 3.1: extra photos reach the colony rules", () => {
  it("(a) catsOfPhoto finds the cat of a face extra, a body extra and the cover alike", async () => {
    expect(await catsOfPhoto(spotA.photos["face"]!.publicId)).toContain(catA.id);
    expect(await catsOfPhoto(spotA.photos["body"]!.publicId)).toEqual([catA.id]);
    expect(await catsOfPhoto(spotA.photos["first"]!.publicId)).toEqual([catA.id]);
  });

  it("(a) the body extra's target is cat A's colony, not 'no colony'", async () => {
    expect(await photoTargets(spotA.photos["body"]!.publicId)).toEqual([{ colonyId: colonyA }]);
  });

  it("(a) a pending spot's extra photos belong to no cat yet", async () => {
    const pending = await seedSpot({ deviceId: `${DEVICE}-pending` });
    try {
      expect(await catsOfPhoto(pending.photos["body"]!.publicId)).toEqual([]);
    } finally {
      await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}-pending%`));
      await db
        .delete(photosTable)
        .where(inArray(photosTable.id, Object.values(pending.photos).map((p) => p.id)));
    }
  });

  it("(c) the team photo viewer serves the body extra to guardian A and refuses guardian B", async () => {
    const body = spotA.photos["body"]!.publicId;
    expect((await viewer(body, guardianA)).status).toBe(200);
    expect((await viewer(body, guardianB)).status).toBe(403);
    expect((await viewer(body, staff)).status).toBe(200);
  });

  it("(b) hide: the team can hide the body extra; a guardian of either colony gets 403 (hiding is team-only)", async () => {
    const body = spotA.photos["body"]!.publicId;
    expect((await hide(body, guardianA)).status).toBe(403);
    expect((await hide(body, guardianB)).status).toBe(403);
    expect((await hide(body, staff)).status).toBe(201);
  });
});
