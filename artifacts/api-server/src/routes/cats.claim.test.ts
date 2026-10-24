import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  pushTokensTable,
  sightingsTable,
  deviceCredentialsTable,
  observationsTable,
  catSubscriptionsTable,
} from "@workspace/db";
import { and, eq, like } from "drizzle-orm";
import { writeObservation } from "../lib/observations";

async function observationsFor(catId: number, kind: string) {
  return db
    .select()
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, kind)));
}

vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notifications")>();
  return {
    ...actual,
    notifyCatFollowers: vi.fn(actual.notifyCatFollowers),
  };
});

import { sendPushNotification } from "../lib/push";
import { notifyCatFollowers } from "../lib/notifications";
import app from "../app";

const sendPushNotificationMock = vi.mocked(sendPushNotification);
const notifyCatFollowersMock = vi.mocked(notifyCatFollowers);

// All fixtures share these prefixes so cleanup can never touch real data.
const PREFIX = "vitest-claim-";
const NAME_PREFIX = "VitestClaimCat";

// SYC-107: these routes require the device's secret. Every device id in this
// file binds this secret on its first request, as the app does.
const DEVICE_SECRET = "vitest-claim-device-secret-aaaa";

const device = (suffix: string) => `${PREFIX}${suffix}`;
const catName = (suffix: string) => `${NAME_PREFIX}${suffix}`;

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${PREFIX}%`));
  await db
    .delete(catSubscriptionsTable)
    .where(like(catSubscriptionsTable.deviceId, `${PREFIX}%`));
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

beforeEach(() => {
  notifyCatFollowersMock.mockClear();
  sendPushNotificationMock.mockClear();
});

async function insertCat(nameSuffix: string, overrides: Partial<typeof catsTable.$inferInsert> = {}) {
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

async function insertResolvedSighting(catId: number, deviceSuffix: string) {
  const deviceId = device(deviceSuffix);
  await db.insert(sightingsTable).values({
    catId,
    deviceId,
    photoId: 0,
    lat: 37.44,
    lng: 24.9,
    status: "resolved",
  });
  await db
    .insert(pushTokensTable)
    .values({ deviceId, token: deviceId })
    .onConflictDoNothing();
  // SYC-624: the claim and edit pushes go to followers, so a spotter here follows.
  await db
    .insert(catSubscriptionsTable)
    .values({ deviceId, catId })
    .onConflictDoNothing();
}

/** SYC-130: the claim body, with the pin by the cat (37.44, 24.9). */
const claimBody = (deviceId: string, homeNote = "") => ({
  deviceId,
  livesOnSyros: true,
  livesInMyHome: true,
  homePin: { lat: 37.44, lng: 24.9 },
  homeNote,
});

/** Wait for the fire-and-forget notification fan-out to finish. */
async function waitForFanOut(): Promise<string[]> {
  await vi.waitFor(() => {
    expect(sendPushNotificationMock).toHaveBeenCalled();
  });
  return sendPushNotificationMock.mock.calls.map(([token]) => token);
}

describe("POST /api/cats/:catId/claim", () => {
  it("lets a resident claim an unclaimed cat", async () => {
    const cat = await insertCat("Free");
    // SYC-130 §3 rule 2: only a phone that has met the cat can claim it.
    await insertResolvedSighting(cat.id, "owner1");
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send(claimBody(device("owner1"), "Blue door near the port"));
    expect(res.status).toBe(200);
    // Claiming never records who the owner is — only that the cat has a home.
    expect(res.body.ownerName).toBeNull();
    expect(res.body.hasHome).toBe(true);
    expect(res.body.homeDescription).toBe("Blue door near the port");
    expect(res.body.homePin).toEqual({ lat: 37.44, lng: 24.9 });
    expect(notifyCatFollowersMock).toHaveBeenCalledWith(
      cat.id,
      device("owner1"),
      expect.objectContaining({
        data: expect.objectContaining({ type: "cat_claimed", catId: cat.id }),
      }),
    );

    // data-spine.md PR 2: a claim writes life_status: homed, from the
    // claiming device, owner_of_this_cat, exactly once.
    const obs = await observationsFor(cat.id, "life_status");
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      deviceId: device("owner1"),
      accountId: null,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      value: { status: "homed" },
    });
  });

  it("is idempotent for a re-claim by the same device (no duplicate notification, no duplicate observation)", async () => {
    const cat = await insertCat("Idem", {
      ownerDeviceId: device("owner2"),
      ownerName: "Nikos",
      homeDescription: "White house",
    });
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send(claimBody(device("owner2"), "Different text"));
    expect(res.status).toBe(200);
    // Existing ownership details are preserved; the re-claim is a no-op.
    expect(res.body.ownerName).toBe("Nikos");
    expect(res.body.homeDescription).toBe("White house");
    expect(notifyCatFollowersMock).not.toHaveBeenCalled();
    expect(await observationsFor(cat.id, "life_status")).toHaveLength(0);
  });

  it("returns 409 when another device already claimed the cat, and writes no observation", async () => {
    const cat = await insertCat("Taken", {
      ownerDeviceId: device("owner3"),
      ownerName: "Eleni",
      homeDescription: "",
    });
    // The owner's claim, as the claim route writes it (the public then
    // reads "has a home": critic M1 makes the code follow that, not the link).
    await writeObservation(db, {
      catId: cat.id,
      kind: "life_status",
      value: { status: "homed" },
      deviceId: device("owner3"),
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: new Date(),
    });
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send(claimBody(device("intruder"), ""));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_HOMED");
    expect(notifyCatFollowersMock).not.toHaveBeenCalled();
    expect(await observationsFor(cat.id, "life_status")).toHaveLength(1);
  });

  it("writes no observation when the device secret check refuses the request", async () => {
    const cat = await insertCat("SecretRefused");
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .set("X-Device-Secret", "wrong-secret-but-16-chars-long!")
      .send(claimBody(device("owner1"), ""));
    expect([401, 403]).toContain(res.status);
    expect(await observationsFor(cat.id, "life_status")).toHaveLength(0);
  });

  it("lets only one of two concurrent claims succeed", async () => {
    const cat = await insertCat("Race");
    await insertResolvedSighting(cat.id, "race1");
    await insertResolvedSighting(cat.id, "race2");
    const claim = (suffix: string) =>
      request(app)
        .post(`/api/cats/${cat.id}/claim`)
        .set("X-Device-Secret", DEVICE_SECRET)
        .send(claimBody(device(suffix), ""));
    const [r1, r2] = await Promise.all([claim("race1"), claim("race2")]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await observationsFor(cat.id, "life_status")).toHaveLength(1);
  });

  it("returns 404 for a missing or non-numeric cat id", async () => {
    for (const id of ["999999999", "not-a-number"]) {
      const res = await request(app)
        .post(`/api/cats/${id}/claim`)
        .set("X-Device-Secret", DEVICE_SECRET)
        .send(claimBody(device("x"), ""));
      expect(res.status).toBe(404);
    }
  });

  it("notifies every spotter of the cat except the claiming device", async () => {
    const cat = await insertCat("FanOut");
    await insertResolvedSighting(cat.id, "spotterA");
    await insertResolvedSighting(cat.id, "spotterB");
    await insertResolvedSighting(cat.id, "actor"); // the actor also spotted it

    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send(claimBody(device("actor"), "Home"));
    expect(res.status).toBe(200);

    const deviceIds = await waitForFanOut();
    expect([...deviceIds].sort()).toEqual([device("spotterA"), device("spotterB")]);
    expect(deviceIds).not.toContain(device("actor"));
  });
});

describe("PATCH /api/cats/:catId", () => {
  it("lets the owner rename the cat and update home details", async () => {
    const cat = await insertCat("Renameable", {
      ownerDeviceId: device("owner4"),
      ownerName: "Sofia",
      homeDescription: "Old home",
    });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({
        deviceId: device("owner4"),
        name: catName("RenamedNow"),
        homeDescription: "New home by the bakery",
      });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(catName("RenamedNow"));
    expect(res.body.homeDescription).toBe("New home by the bakery");

    // §5, §10.3: a rename writes a name observation (never destroying the
    // earlier name — it's an append, not an edit of the one existing row).
    const obs = await observationsFor(cat.id, "name");
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      deviceId: device("owner4"),
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      value: { name: catName("RenamedNow") },
    });
  });

  it("returns 403 when a non-owner tries to update, and writes no observation", async () => {
    const cat = await insertCat("Guarded", {
      ownerDeviceId: device("owner5"),
      ownerName: "Kostas",
      homeDescription: "",
    });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: device("stranger"), name: catName("Hijack") });
    expect(res.status).toBe(403);
    expect(notifyCatFollowersMock).not.toHaveBeenCalled();

    // Name unchanged.
    const detail = await request(app).get(`/api/cats/${cat.id}`);
    expect(detail.body.cat.name).toBe(catName("Guarded"));
    expect(await observationsFor(cat.id, "name")).toHaveLength(0);
  });

  it("writes no observation when a home-description-only update has no name change", async () => {
    const cat = await insertCat("NoRenameObs", {
      ownerDeviceId: device("owner9"),
      ownerName: "Stavros",
      homeDescription: "Old",
    });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: device("owner9"), homeDescription: "New" });
    expect(res.status).toBe(200);
    expect(await observationsFor(cat.id, "name")).toHaveLength(0);
  });

  it("returns 403 for an unclaimed cat (no owner yet)", async () => {
    const cat = await insertCat("Unowned");
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: device("anyone"), name: catName("Nope") });
    expect(res.status).toBe(403);
  });

  it("notifies spotters (excluding the owner) on a meaningful rename", async () => {
    const cat = await insertCat("NotifyRename", {
      ownerDeviceId: device("owner6"),
      ownerName: "Ana",
      homeDescription: "",
    });
    await insertResolvedSighting(cat.id, "watcher1");
    await insertResolvedSighting(cat.id, "owner6"); // owner also spotted it

    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: device("owner6"), name: catName("NotifyRenamed") });
    expect(res.status).toBe(200);

    expect(notifyCatFollowersMock).toHaveBeenCalledWith(
      cat.id,
      device("owner6"),
      expect.objectContaining({
        data: expect.objectContaining({ type: "cat_updated", catId: cat.id }),
      }),
    );
    const deviceIds = await waitForFanOut();
    expect(deviceIds).toEqual([device("watcher1")]);
  });

  it("notifies spotters on a home-description change", async () => {
    const cat = await insertCat("NotifyHome", {
      ownerDeviceId: device("owner7"),
      ownerName: "Petros",
      homeDescription: "Old description",
    });
    await insertResolvedSighting(cat.id, "watcher2");

    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: device("owner7"), homeDescription: "Fresh description" });
    expect(res.status).toBe(200);
    expect(notifyCatFollowersMock).toHaveBeenCalledWith(
      cat.id,
      device("owner7"),
      expect.anything(),
    );
    await waitForFanOut();
  });

  it("does not notify when the body contains no changes", async () => {
    const cat = await insertCat("NoChange", {
      ownerDeviceId: device("owner8"),
      ownerName: "Dimitra",
      homeDescription: "",
    });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: device("owner8") });
    expect(res.status).toBe(200);
    expect(notifyCatFollowersMock).not.toHaveBeenCalled();
  });
});
