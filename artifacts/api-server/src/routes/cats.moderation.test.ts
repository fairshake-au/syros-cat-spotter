import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, catsTable, deviceCredentialsTable } from "@workspace/db";
import { like } from "drizzle-orm";

import app from "../app";

const DEVICE = "vitest-registercat-modn-device";
// SYC-107: these routes require the device's secret. Every device id in this
// file binds this secret on its first request, as the app does.
const DEVICE_SECRET = "vitest-registercat-modn-secret-aaaa";

async function cleanup() {
  await db
    .delete(catsTable)
    .where(like(catsTable.discovererDeviceId, `${DEVICE}%`));
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("PATCH /api/cats/:catId rename moderation", () => {
  async function insertCat(name: string) {
    const [cat] = await db
      .insert(catsTable)
      .values({
        name,
        description: "",
        primaryPhotoId: 0,
        lat: 37.44,
        lng: 24.9,
        discovererDeviceId: DEVICE,
        ownerDeviceId: DEVICE,
        ownerName: "Vitest Owner",
        homeDescription: "Test home",
      })
      .returning();
    return cat!.id;
  }

  it("rejects an offensive rename with 400 and code OFFENSIVE_NAME", async () => {
    const catId = await insertCat(`Vitest Rename Cat ${Date.now()}`);
    const res = await request(app)
      .patch(`/api/cats/${catId}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: DEVICE, name: "putain cat" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NAME");
  });

  it("rejects a disguised offensive rename", async () => {
    const catId = await insertCat(`Vitest Rename Cat ${Date.now()}`);
    const res = await request(app)
      .patch(`/api/cats/${catId}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: DEVICE, name: "m4laka jr" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NAME");
  });

  it("accepts a clean rename", async () => {
    const catId = await insertCat(`Vitest Rename Cat ${Date.now()}`);
    const res = await request(app)
      .patch(`/api/cats/${catId}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: DEVICE, name: `Vitest Renamed ${Date.now()}` });
    expect(res.status).toBe(200);
  });
});
