import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, catsTable, deviceCredentialsTable } from "@workspace/db";
import { like } from "drizzle-orm";

import app from "../app";

const DEVICE_PREFIX = "vitest-register-owned-";
const NAME_PREFIX = "VitestOwnedCat";
// SYC-107: these routes require the device's secret. Every device id in this
// file binds this secret on its first request, as the app does.
const DEVICE_SECRET = "vitest-register-owned-secret-aaaa";

async function cleanup() {
  await db
    .delete(catsTable)
    .where(like(catsTable.discovererDeviceId, `${DEVICE_PREFIX}%`));
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${DEVICE_PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

const validBody = {
  deviceId: `${DEVICE_PREFIX}resident`,
  name: `${NAME_PREFIX}Happy`,
  ownerName: "Maria",
  homeDescription: "Blue door near the port",
  lat: 37.44,
  lng: 24.9,
};

describe("POST /api/cats", () => {
  it("registers a brand-new owned cat with the resident as discoverer", async () => {
    const res = await request(app)
      .post("/api/cats")
      .set("X-Device-Secret", DEVICE_SECRET)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: validBody.name,
        ownerName: validBody.ownerName,
        homeDescription: validBody.homeDescription,
        sightingsCount: 0,
        discovererSpotterCode: expect.any(String),
        discovererNickname: null,
        discovererUsername: null,
      }),
    );
    expect(res.body.discovererSpotterCode).not.toBe(validBody.deviceId);
  });

  it("returns null (not a minted token) for the primaryPhotoId: 0 sentinel", async () => {
    // hosting-and-photo-storage.md §6.2 item 1 / SYC-98 "mind the sentinel":
    // zero is not a real photos row, so photoUrl() must not look one up or
    // mint a link for it.
    const registration = await request(app)
      .post("/api/cats")
      .set("X-Device-Secret", DEVICE_SECRET)
      .send({ ...validBody, name: `${NAME_PREFIX}NoPhoto` });

    expect(registration.status).toBe(201);
    expect(registration.body.photoUrl).toBeNull();
  });

  it.each(["name", "ownerName"] as const)(
    "returns 400 when %s is missing",
    async (field) => {
      const body: Partial<typeof validBody> = { ...validBody };
      delete body[field];

      const res = await request(app)
        .post("/api/cats")
        .set("X-Device-Secret", DEVICE_SECRET)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid request");
    },
  );
});