import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  deviceCredentialsTable,
  sightingMatchesTable,
  sightingsTable,
} from "@workspace/db";
import { deleteTestSightings } from "../test/sightings";
import { eq, like } from "drizzle-orm";

// SYC-107: registering, claiming and renaming a cat must prove the caller
// holds the device's secret, the same way profiles, notifications, push
// tokens and sightings already do. Before this, all three trusted a device
// id sent in the request body, so anyone who learned a spotter's device id
// could register cats under it, claim cats as them, or rename their cats.
//
// It's also Slice 0 step 1 of the SYC-3 "keep my spots safe" plan: after a
// spotter moves to a new phone, the old phone's secret is replaced, and
// every route acting as that spotter must refuse it. That only works if the
// secret check runs before any ownership decision, so these tests also pin
// that a wrong secret gets 403 from the secret check, not a 409/"not owner".

vi.mock("../lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notifications")>();
  return { ...actual, notifyCatSpotters: vi.fn() };
});

import { notifyCatSpotters } from "../lib/notifications";
import app from "../app";

const notifyMock = vi.mocked(notifyCatSpotters);

const PREFIX = "vitest-cats-auth-";
const NAME_PREFIX = "VitestCatsAuth";
const SECRET_OWNER = "vitest-cats-auth-secret-owner-aaaa";
const SECRET_OTHER = "vitest-cats-auth-secret-other-bbbb";

const device = (suffix: string) => `${PREFIX}${suffix}`;
const catName = (suffix: string) => `${NAME_PREFIX}${suffix}`;

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});
beforeEach(() => notifyMock.mockClear());

/** Bind `secret` to `deviceId`, as the app does on its first request. */
async function bind(deviceId: string, secret: string) {
  const res = await request(app)
    .get(`/api/profiles/${deviceId}/username`)
    .set("X-Device-Secret", secret);
  expect(res.status).toBe(200);
}

async function insertCat(
  nameSuffix: string,
  overrides: Partial<typeof catsTable.$inferInsert> = {},
) {
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: catName(nameSuffix),
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: device("discoverer"),
      ...overrides,
    })
    .returning();
  return cat!;
}

/** SYC-130: the claim body, with a pin by the cat (37.44, 24.9). */
const claimBody = (deviceId: string, homeNote = "") => ({
  deviceId,
  livesOnSyros: true,
  livesInMyHome: true,
  homePin: { lat: 37.44, lng: 24.9 },
  homeNote,
});

/** SYC-130 §3 rule 2: a resolved sighting of the cat, from this phone,
 * confirming the app's suggestion, so the phone may claim it. */
async function met(catId: number, deviceId: string) {
  const [s] = await db
    .insert(sightingsTable)
    .values({ catId, deviceId, photoId: 0, lat: 37.44, lng: 24.9, status: "resolved" })
    .returning();
  await db
    .insert(sightingMatchesTable)
    .values({ sightingId: s!.id, choice: "suggested", chosenCatId: catId, chosenAt: new Date(), suggestedRank: 1 });
}

async function reload(catId: number) {
  const [row] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
  return row!;
}

describe("POST /api/cats/:catId/claim device auth (SYC-107)", () => {
  it("refuses a claim with no secret and leaves the cat unclaimed", async () => {
    const cat = await insertCat("ClaimNone");
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .send(claimBody(device("claim-a"), "Mine now"));
    expect(res.status).toBe(401);
    expect((await reload(cat.id)).ownerDeviceId).toBeNull();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("refuses a claim made as someone else and leaves the cat unclaimed", async () => {
    const victim = device("claim-b");
    await bind(victim, SECRET_OWNER);
    const cat = await insertCat("ClaimWrong");
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .set("X-Device-Secret", SECRET_OTHER)
      .send(claimBody(victim, "Hijacked"));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Device secret does not match" });
    const after = await reload(cat.id);
    expect(after.ownerDeviceId).toBeNull();
    expect(after.homeDescription).toBeNull();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("checks the secret before ownership: a wrong secret for the real owner is 403, not the idempotent 200", async () => {
    const owner = device("claim-c");
    await bind(owner, SECRET_OWNER);
    const cat = await insertCat("ClaimOwned", {
      ownerDeviceId: owner,
      homeDescription: "Original",
    });
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .set("X-Device-Secret", SECRET_OTHER)
      .send(claimBody(owner, ""));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Device secret does not match" });
  });

  it("claims the cat when the right secret is sent", async () => {
    const owner = device("claim-d");
    await bind(owner, SECRET_OWNER);
    const cat = await insertCat("ClaimOk");
    await met(cat.id, owner);
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .set("X-Device-Secret", SECRET_OWNER)
      .send(claimBody(owner, "Blue door"));
    expect(res.status).toBe(200);
    expect(res.body.hasHome).toBe(true);
    expect((await reload(cat.id)).ownerDeviceId).toBe(owner);
  });
});

describe("PATCH /api/cats/:catId device auth (SYC-107)", () => {
  it("refuses a rename with no secret and leaves the name alone", async () => {
    const owner = device("patch-a");
    const cat = await insertCat("PatchNone", { ownerDeviceId: owner });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .send({ deviceId: owner, name: catName("PatchNoneHijack") });
    expect(res.status).toBe(401);
    expect((await reload(cat.id)).name).toBe(catName("PatchNone"));
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("refuses a rename by someone who only knows the owner's device id", async () => {
    const owner = device("patch-b");
    await bind(owner, SECRET_OWNER);
    const cat = await insertCat("PatchWrong", {
      ownerDeviceId: owner,
      homeDescription: "Original",
    });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", SECRET_OTHER)
      .send({
        deviceId: owner,
        name: catName("PatchWrongHijack"),
        homeDescription: "Changed",
      });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Device secret does not match" });
    const after = await reload(cat.id);
    expect(after.name).toBe(catName("PatchWrong"));
    expect(after.homeDescription).toBe("Original");
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("renames the cat when the owner sends the right secret", async () => {
    const owner = device("patch-c");
    await bind(owner, SECRET_OWNER);
    const cat = await insertCat("PatchOk", { ownerDeviceId: owner });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", SECRET_OWNER)
      .send({ deviceId: owner, name: catName("PatchOkRenamed") });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(catName("PatchOkRenamed"));
  });

  it("still refuses a non-owner who proves their own device", async () => {
    const owner = device("patch-d");
    const stranger = device("patch-d-stranger");
    await bind(stranger, SECRET_OTHER);
    const cat = await insertCat("PatchStranger", { ownerDeviceId: owner });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", SECRET_OTHER)
      .send({ deviceId: stranger, name: catName("PatchStrangerHijack") });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Only the cat's owner can update it", code: "NOT_OWNER" });
    expect((await reload(cat.id)).name).toBe(catName("PatchStranger"));
  });
});

// Review of #41: the secret must be checked before anything is said about the
// cat (whether it exists, who owns it, whether its name is acceptable). SYC-3's
// restore relies on this: an old phone must get the secret refusal, never
// "already claimed" or "not the owner". Moving any check later turns these red.
describe("the secret is checked before anything about the cat (SYC-107)", () => {
  const MISSING_CAT = 999999999;

  it("claim: a wrong secret on a cat someone else owns is 403 mismatch, not 409", async () => {
    const caller = device("order-a");
    await bind(caller, SECRET_OWNER);
    const cat = await insertCat("OrderClaimed", { ownerDeviceId: device("order-a-third") });
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .set("X-Device-Secret", SECRET_OTHER)
      .send(claimBody(caller, "Mine"));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Device secret does not match" });
  });

  it("claim: no secret on a cat that doesn't exist is 401, not 404", async () => {
    const res = await request(app)
      .post(`/api/cats/${MISSING_CAT}/claim`)
      .send(claimBody(device("order-b"), "Mine"));
    expect(res.status).toBe(401);
  });

  it("rename: no secret on a cat that doesn't exist is 401, not 404", async () => {
    const res = await request(app)
      .patch(`/api/cats/${MISSING_CAT}`)
      .send({ deviceId: device("order-c"), name: catName("OrderMissing") });
    expect(res.status).toBe(401);
  });

  it("rename: no secret from a stranger on someone else's cat is 401, not the owner check", async () => {
    const cat = await insertCat("OrderStranger", { ownerDeviceId: device("order-d-owner") });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .send({ deviceId: device("order-d-stranger"), name: catName("OrderStrangerHijack") });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Device secret required" });
  });

  it("claim: no secret with eligibility failure is 401, not the eligibility check", async () => {
    const cat = await insertCat("OrderElig");
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .send(claimBody(device("order-e"), "Mine"));
    expect(res.status).toBe(401);
  });
});
