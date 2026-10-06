/**
 * SYC-195: one internet address can register only so many brand-new phones
 * an hour. Phones that are already registered are never affected.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, deviceCredentialsTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import app from "../app";
import { NEW_DEVICES_PER_ADDRESS_PER_HOUR, allowNewDevice } from "./newDeviceLimit";

const PREFIX = "vitest-newdev-";
const SECRET = "vitest-secret-newdevice-0123456789";

async function cleanup() {
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

// app.ts trusts 4 proxy hops, so X-Forwarded-For sets the visitor's address.
function asPhone(deviceId: string, address: string) {
  return request(app)
    .get(`/api/notifications/${deviceId}`)
    .set("X-Device-Secret", SECRET)
    .set("X-Forwarded-For", address);
}

async function isBound(deviceId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(deviceCredentialsTable)
    .where(eq(deviceCredentialsTable.deviceId, deviceId));
  return rows.length > 0;
}

describe("new phones per address (SYC-195)", () => {
  it("lets one address register the allowance, then refuses the next new phone", async () => {
    const address = "203.0.113.10";
    for (let i = 0; i < NEW_DEVICES_PER_ADDRESS_PER_HOUR; i++) {
      const res = await asPhone(`${PREFIX}a-${i}`, address);
      expect(res.status).toBe(200);
    }

    const refused = await asPhone(`${PREFIX}a-over`, address);
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/too many new phones/i);
    const retryAfter = Number(refused.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    // Not bound, so the same phone works later without any repair.
    expect(await isBound(`${PREFIX}a-over`)).toBe(false);

    // A phone that's already registered is never affected.
    expect((await asPhone(`${PREFIX}a-0`, address)).status).toBe(200);

    // Nor is a new phone on a different connection.
    expect((await asPhone(`${PREFIX}b-0`, "203.0.113.11")).status).toBe(200);
  });

  it("a wrong secret for a registered phone is still a 403, not a new registration", async () => {
    const address = "203.0.113.20";
    expect((await asPhone(`${PREFIX}c-0`, address)).status).toBe(200);
    const wrong = await request(app)
      .get(`/api/notifications/${PREFIX}c-0`)
      .set("X-Device-Secret", "vitest-secret-wrong-000000000000")
      .set("X-Forwarded-For", address);
    expect(wrong.status).toBe(403);
  });
});

describe("allowNewDevice", () => {
  it("counts per address and resets after an hour", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < NEW_DEVICES_PER_ADDRESS_PER_HOUR; i++) {
      expect(allowNewDevice("198.51.100.1", t0)).toBe(true);
    }
    expect(allowNewDevice("198.51.100.1", t0)).toBe(false);
    expect(allowNewDevice("198.51.100.2", t0)).toBe(true);
    expect(allowNewDevice("198.51.100.1", t0 + 60 * 60 * 1000)).toBe(true);
  });
});
