import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  catUpdatesTable,
  catSubscriptionsTable,
  notificationsTable,
  pushTokensTable,
  observationsTable,
} from "@workspace/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { ObservationRefused } from "../lib/observations";

vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

// Wraps the real writeObservation so a single test can force it to throw
// (mockImplementationOnce, below) while every other test in this file still
// gets the real validation and insert.
vi.mock("../lib/observations", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/observations")>(
      "../lib/observations",
    );
  return { ...actual, writeObservation: vi.fn(actual.writeObservation) };
});

import app from "../app";
import { sendPushNotification } from "../lib/push";
import { writeObservation } from "../lib/observations";

// SYC-113: every /api route sits behind a pre-launch pass today. This admin
// route predates that gate and is checked by its own Bearer secret, which
// the pre-launch middleware must let through regardless — tested already
// elsewhere; here we only care about OWNER_SECRET's own gate and the
// observation it now writes alongside the care update (data-spine.md PR 2,
// C13).
const NAME_PREFIX = "VitestAdminUpdateCat";
const OWNER_SECRET = "vitest-admin-updates-owner-secret";
const SUBSCRIBER_DEVICE = "vitest-admin-updates-subscriber";

async function observationsFor(catId: number, kind: string) {
  return db
    .select()
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, kind)));
}

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id })
    .from(catsTable)
    .where(like(catsTable.name, `${NAME_PREFIX}%`));
  const catIds = cats.map((c) => c.id);
  if (catIds.length > 0) {
    const updates = await db
      .select({ id: catUpdatesTable.id })
      .from(catUpdatesTable)
      .where(inArray(catUpdatesTable.catId, catIds));
    const updateIds = updates.map((u) => u.id);
    if (updateIds.length > 0) {
      await db
        .delete(notificationsTable)
        .where(inArray(notificationsTable.catUpdateId, updateIds));
    }
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, catIds));
    await db
      .delete(catSubscriptionsTable)
      .where(inArray(catSubscriptionsTable.catId, catIds));
  }
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await db.delete(pushTokensTable).where(eq(pushTokensTable.deviceId, SUBSCRIBER_DEVICE));
}

async function insertCat(nameSuffix: string) {
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${nameSuffix}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: "vitest-admin-updates-discoverer",
    })
    .returning();
  return cat!;
}

beforeAll(async () => {
  process.env["OWNER_SECRET"] = OWNER_SECRET;
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  delete process.env["OWNER_SECRET"];
  await pool.end();
});
beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/cats/:catId/updates (admin, OWNER_SECRET)", () => {
  it("desexed also writes a sterilised: true observation, authored system:admin-route", async () => {
    const cat = await insertCat("Desexed");
    const res = await request(app)
      .post(`/api/cats/${cat.id}/updates`)
      .set("Authorization", `Bearer ${OWNER_SECRET}`)
      .send({ updateType: "desexed", message: "Done at the clinic" });

    expect(res.status).toBe(201);

    const obs = await observationsFor(cat.id, "sterilised");
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      accountId: "system:admin-route",
      deviceId: null,
      roleAtTime: "staff",
      value: { sterilised: true },
    });
    // Same observedAt as the cat_updates row it's recognised by (PR 3's
    // backfill match key).
    expect(obs[0]!.observedAt.toISOString()).toBe(res.body.createdAt);
  });

  it("adopted also writes a life_status: homed observation, authored system:admin-route", async () => {
    const cat = await insertCat("Adopted");
    const res = await request(app)
      .post(`/api/cats/${cat.id}/updates`)
      .set("Authorization", `Bearer ${OWNER_SECRET}`)
      .send({ updateType: "adopted", message: "Adopted by a family" });

    expect(res.status).toBe(201);

    const obs = await observationsFor(cat.id, "life_status");
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      accountId: "system:admin-route",
      roleAtTime: "staff",
      value: { status: "homed" },
    });
  });

  it("writes no cat_updates row, no notification and sends no push when writeObservation throws (review of PR #66, SYC-52/SYC-40)", async () => {
    // Before this fix, createUpdateAndFanOut only routed the cat_updates
    // insert through `tx` — the notifications insert and push send ran on
    // the plain pool and committed immediately, ahead of writeObservation
    // and the outer transaction. A subscriber with a push token proves
    // neither fires when the write this update is supposed to accompany
    // never lands.
    const cat = await insertCat("ObsThrows");
    await db
      .insert(catSubscriptionsTable)
      .values({ deviceId: SUBSCRIBER_DEVICE, catId: cat.id });
    await db
      .insert(pushTokensTable)
      .values({ deviceId: SUBSCRIBER_DEVICE, token: "ExponentPushToken[forced-failure]" })
      .onConflictDoUpdate({
        target: pushTokensTable.deviceId,
        set: { token: "ExponentPushToken[forced-failure]" },
      });

    vi.mocked(writeObservation).mockImplementationOnce(() => {
      throw new ObservationRefused("TEST_FORCED_FAILURE", "forced for this test");
    });

    const res = await request(app)
      .post(`/api/cats/${cat.id}/updates`)
      .set("Authorization", `Bearer ${OWNER_SECRET}`)
      .send({ updateType: "desexed", message: "Done at the clinic" });

    expect(res.status).toBe(500);

    // The transaction rolled back: no cat_updates row at all.
    const updates = await db
      .select()
      .from(catUpdatesTable)
      .where(eq(catUpdatesTable.catId, cat.id));
    expect(updates).toHaveLength(0);

    // No notification row — fanOutNotifications is never reached because
    // the transaction it would run after never committed.
    const notifications = await db
      .select()
      .from(notificationsTable)
      .innerJoin(
        catUpdatesTable,
        eq(notificationsTable.catUpdateId, catUpdatesTable.id),
      )
      .where(eq(catUpdatesTable.catId, cat.id));
    expect(notifications).toHaveLength(0);

    // No push attempted.
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("a general update writes no observation", async () => {
    const cat = await insertCat("General");
    const res = await request(app)
      .post(`/api/cats/${cat.id}/updates`)
      .set("Authorization", `Bearer ${OWNER_SECRET}`)
      .send({ updateType: "general", message: "Just an update" });

    expect(res.status).toBe(201);
    expect(await observationsFor(cat.id, "sterilised")).toHaveLength(0);
    expect(await observationsFor(cat.id, "life_status")).toHaveLength(0);
  });

  it("writes no observation when the secret is wrong (401)", async () => {
    const cat = await insertCat("WrongSecret");
    const res = await request(app)
      .post(`/api/cats/${cat.id}/updates`)
      .set("Authorization", "Bearer not-the-secret")
      .send({ updateType: "desexed", message: "Nope" });

    expect(res.status).toBe(401);
    expect(await observationsFor(cat.id, "sterilised")).toHaveLength(0);
  });

  it("writes no observation when OWNER_SECRET is unset (503)", async () => {
    const cat = await insertCat("Unset");
    delete process.env["OWNER_SECRET"];
    const res = await request(app)
      .post(`/api/cats/${cat.id}/updates`)
      .set("Authorization", `Bearer ${OWNER_SECRET}`)
      .send({ updateType: "desexed", message: "Nope" });
    process.env["OWNER_SECRET"] = OWNER_SECRET;

    expect(res.status).toBe(503);
    expect(await observationsFor(cat.id, "sterilised")).toHaveLength(0);
  });
});
