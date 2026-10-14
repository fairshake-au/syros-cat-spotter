import { deleteTestSightings } from "../test/sightings";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  db,
  markLeft,
  observationsTable,
  photosTable,
  pool,
  sightingsTable,
} from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import { signInThroughHandoff, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { loadCatRecords, writeObservation } from "../lib/observations";
import { resolveCat, resolveSterilised } from "../lib/resolve";
import type { LikelyCat } from "../lib/likelyReview";

// SYC-53 plan, PR 0.2, test T23 (part); roles spec §15.3 test 23: "The one
// list of team roles is used by the resolver, the review list and the
// correction routes." A management member's statement must count as the
// team's in all three. Nobody can sign in as management until PR 0.3, so
// the management rows here are written directly as `roleAtTime:
// "management"`, which writeObservation now accepts.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-mgmt-${RUN}-`;
const SUSAN = `vitest-mgmt-susan-${RUN}@example.com`;
const KEY = "vitest-mgmt-key-0123456789abcdef-0123456789ab";
const SPOTTER = `${PREFIX}spotter-device`;
const MANAGER = `${PREFIX}manager-account`;
const handoffKey = makeKey();

let cookie: string;
let n = 0;

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
}

async function photo(): Promise<number> {
  n += 1;
  const [p] = await db
    .insert(photosTable)
    .values({
      publicId: `${PREFIX}photo-${n}`,
      data: Buffer.from(`fake ${n}`).toString("base64"),
      mime: "image/jpeg",
    })
    .returning({ id: photosTable.id });
  return p!.id;
}

async function newCat(): Promise<number> {
  n += 1;
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}cat-${n}`,
      description: "",
      primaryPhotoId: await photo(),
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: SPOTTER,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

/** A spotter's photo-backed clipped-ear answer on a resolved sighting. */
async function spotterClip(catId: number, minutesAgo: number) {
  const photoId = await photo();
  const when = new Date(Date.now() - minutesAgo * 60_000);
  const [s] = await db
    .insert(sightingsTable)
    .values({
      catId,
      deviceId: SPOTTER,
      photoId,
      lat: 37.4451,
      lng: 24.9421,
      status: "resolved",
      createdAt: when,
    })
    .returning({ id: sightingsTable.id });
  return writeObservation(db, {
    catId,
    kind: "ear_tip",
    value: { clipped: true, side: "left" },
    deviceId: SPOTTER,
    roleAtTime: "public",
    observedAt: when,
    photoId,
    sightingId: s!.id,
  });
}

/** A management member's own photo-backed clipped-ear statement. */
async function managementClip(catId: number, minutesAgo: number) {
  return writeObservation(db, {
    catId,
    kind: "ear_tip",
    value: { clipped: true, side: "left", reason: "Saw it close up" },
    accountId: MANAGER,
    roleAtTime: "management",
    observedAt: new Date(Date.now() - minutesAgo * 60_000),
    photoId: await photo(),
  });
}

const rowsFor = (catId: number) =>
  db
    .select()
    .from(observationsTable)
    .where(eq(observationsTable.catId, catId))
    .orderBy(observationsTable.id);

async function snapshot(catId: number) {
  const r = (await loadCatRecords([catId])).get(catId)!;
  return resolveCat(r.observations, r.evidenceOfLife, new Date());
}

const likelyIds = async () => {
  const res = await request(app)
    .get("/api/team/likely")
    .set("Cookie", cookie)
    .set("Accept", "application/json");
  expect(res.status).toBe(200);
  return (res.body.cats as LikelyCat[]).map((c) => c.catId);
};

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await cleanup();
  const susan = await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest", roles: ["staff"] });
  cookie = await signInThroughHandoff(app, handoffKey, susan.id);
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  await cleanup();
  await markLeft(SUSAN, "cli:vitest");
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

describe("T23 (part): a management member's statement is the team's", () => {
  it("in the resolver: a management 'not sterilised' is Confirmed and beats an older staff 'sterilised'", async () => {
    const catId = await newCat();
    await writeObservation(db, {
      catId,
      kind: "sterilised",
      value: { sterilised: true, reason: "Old card" },
      accountId: "staff-account",
      roleAtTime: "staff",
      observedAt: new Date(Date.now() - 120 * 60_000),
    });
    const manager = await writeObservation(db, {
      catId,
      kind: "sterilised",
      value: { sterilised: false, reason: "Vet's record says otherwise" },
      accountId: MANAGER,
      roleAtTime: "management",
      observedAt: new Date(Date.now() - 60 * 60_000),
    });
    const s = await snapshot(catId);
    expect(s.sterilised.value).toBe(false);
    expect(s.sterilised.confidence).toBe("confirmed");
    const r = (await loadCatRecords([catId])).get(catId)!;
    expect(resolveSterilised(r.observations).supportingObservationIds).toEqual([manager.id]);
  });

  it("in the resolver: a management 'not a clip' knocks a spotter's older clip back to Not known yet", async () => {
    const catId = await newCat();
    const clip = await spotterClip(catId, 120);
    await writeObservation(db, {
      catId,
      kind: "ear_tip",
      value: { clipped: false, reason: "Looked again" },
      accountId: MANAGER,
      roleAtTime: "management",
      observedAt: new Date(Date.now() - 60 * 60_000),
      supersedesId: clip.id,
      supersedeReason: "Not a clip",
    });
    expect((await snapshot(catId)).sterilised.confidence).toBe("unknown");
  });

  it("in the review list: a cat whose newest clipped answer is management's is not on Probably sterilised", async () => {
    const control = await newCat();
    await spotterClip(control, 120);
    const catId = await newCat();
    await spotterClip(catId, 120);
    await managementClip(catId, 60);
    expect((await snapshot(catId)).sterilised.confidence).toBe("likely");
    const ids = await likelyIds();
    expect(ids).toContain(control);
    expect(ids).not.toContain(catId);
  });

  it("in the correction routes: Looks right on management's own answer writes nothing", async () => {
    const catId = await newCat();
    await spotterClip(catId, 120);
    const own = await managementClip(catId, 60);
    const before = (await rowsFor(catId)).length;
    const res = await request(app)
      .post(`/api/team/likely/${own.id}/looks-right`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .type("form")
      .send({});
    expect(res.headers["location"]).toBe("/api/team/likely?done=already");
    expect((await rowsFor(catId)).length).toBe(before);
  });
});
