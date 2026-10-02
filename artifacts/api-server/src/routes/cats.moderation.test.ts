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

const baseBody = {
  deviceId: DEVICE,
  lat: 37.44,
  lng: 24.9,
  ownerName: "Vitest Owner",
  homeDescription: "Test home",
};

describe("POST /api/cats name moderation", () => {
  it("rejects an offensive cat name with 400 and code OFFENSIVE_NAME", async () => {
    const res = await request(app)
      .post("/api/cats")
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ ...baseBody, name: "malakas the cat" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NAME");
  });

  it("rejects a disguised (leetspeak) offensive cat name", async () => {
    const res = await request(app)
      .post("/api/cats")
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ ...baseBody, name: "Sh1t ball" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NAME");
  });

  it("accepts a clean cat name", async () => {
    const res = await request(app)
      .post("/api/cats")
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ ...baseBody, name: `Vitest Clean Cat ${Date.now()}` });
    expect(res.status).toBe(201);
  });
});

describe("PATCH /api/cats/:catId rename moderation", () => {
  async function registerCat() {
    const res = await request(app)
      .post("/api/cats")
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ ...baseBody, name: `Vitest Rename Cat ${Date.now()}` });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  it("rejects an offensive rename with 400 and code OFFENSIVE_NAME", async () => {
    const catId = await registerCat();
    const res = await request(app)
      .patch(`/api/cats/${catId}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: DEVICE, name: "putain cat" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NAME");
  });

  it("rejects a disguised offensive rename", async () => {
    const catId = await registerCat();
    const res = await request(app)
      .patch(`/api/cats/${catId}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: DEVICE, name: "m4laka jr" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NAME");
  });

  it("accepts a clean rename", async () => {
    const catId = await registerCat();
    const res = await request(app)
      .patch(`/api/cats/${catId}`)
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ deviceId: DEVICE, name: `Vitest Renamed ${Date.now()}` });
    expect(res.status).toBe(200);
  });
});
