import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, profilesTable, deviceCredentialsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const OWNER = "vitest-profauth-owner";
const ATTACKER_SECRET = "attacker-secret-0123456789abcdef";
const OWNER_SECRET = "owner-secret-0123456789abcdefgh";

async function cleanup() {
  const ids = [OWNER];
  await db.delete(profilesTable).where(inArray(profilesTable.deviceId, ids));
  await db
    .delete(deviceCredentialsTable)
    .where(inArray(deviceCredentialsTable.deviceId, ids));
}

beforeAll(async () => {
  await cleanup();
  // Trust-on-first-use: this binds OWNER_SECRET to the owner's device id.
  await request(app)
    .get(`/api/profiles/${OWNER}`)
    .set("X-Device-Secret", OWNER_SECRET)
    .expect(200);
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("GET /api/profiles/:deviceId auth", () => {
  it("returns the profile to the device holding the bound secret", async () => {
    const res = await request(app)
      .get(`/api/profiles/${OWNER}`)
      .set("X-Device-Secret", OWNER_SECRET)
      .expect(200);
    expect(res.body.deviceId).toBe(OWNER);
    // The fields that make this payload worth protecting.
    expect(Array.isArray(res.body.spottedCatIds)).toBe(true);
    expect(typeof res.body.currentStreakDays).toBe("number");
  });

  // The whole point of the change: a device id is not a secret. It travels in
  // request paths, so knowing one must not be enough to read the profile.
  it("rejects a caller who knows the device id but sends no secret", async () => {
    const res = await request(app).get(`/api/profiles/${OWNER}`).expect(401);
    expect(res.body.spottedCatIds).toBeUndefined();
    expect(res.body.currentStreakDays).toBeUndefined();
    expect(res.body.points).toBeUndefined();
  });

  it("rejects a caller presenting the wrong secret", async () => {
    const res = await request(app)
      .get(`/api/profiles/${OWNER}`)
      .set("X-Device-Secret", ATTACKER_SECRET)
      .expect(403);
    expect(res.body.spottedCatIds).toBeUndefined();
  });

  it("rejects a too-short secret rather than treating it as absent", async () => {
    await request(app)
      .get(`/api/profiles/${OWNER}`)
      .set("X-Device-Secret", "short")
      .expect(401);
  });
});

describe("PATCH /api/profiles/:deviceId auth", () => {
  it("lets the owner set a nickname", async () => {
    const res = await request(app)
      .patch(`/api/profiles/${OWNER}`)
      .set("X-Device-Secret", OWNER_SECRET)
      .send({ nickname: "Owner" })
      .expect(200);
    expect(res.body.nickname).toBe("Owner");
  });

  it("refuses an unauthenticated write", async () => {
    await request(app)
      .patch(`/api/profiles/${OWNER}`)
      .send({ nickname: "Hijacked" })
      .expect(401);

    // ...and the refusal actually prevented the write.
    const after = await request(app)
      .get(`/api/profiles/${OWNER}`)
      .set("X-Device-Secret", OWNER_SECRET)
      .expect(200);
    expect(after.body.nickname).toBe("Owner");
  });

  it("refuses a write presenting the wrong secret", async () => {
    await request(app)
      .patch(`/api/profiles/${OWNER}`)
      .set("X-Device-Secret", ATTACKER_SECRET)
      .send({ nickname: "Hijacked" })
      .expect(403);

    const after = await request(app)
      .get(`/api/profiles/${OWNER}`)
      .set("X-Device-Secret", OWNER_SECRET)
      .expect(200);
    expect(after.body.nickname).toBe("Owner");
  });
});
