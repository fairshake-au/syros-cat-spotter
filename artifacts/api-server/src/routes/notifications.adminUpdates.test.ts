import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, catsTable, catUpdatesTable, observationsTable } from "@workspace/db";
import { and, eq, inArray, like } from "drizzle-orm";

vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

import app from "../app";

// SYC-113: every /api route sits behind a pre-launch pass today. This admin
// route predates that gate and is checked by its own Bearer secret, which
// the pre-launch middleware must let through regardless — tested already
// elsewhere; here we only care about OWNER_SECRET's own gate and the
// observation it now writes alongside the care update (data-spine.md PR 2,
// C13).
const NAME_PREFIX = "VitestAdminUpdateCat";
const OWNER_SECRET = "vitest-admin-updates-owner-secret";

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
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, catIds));
  }
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
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
