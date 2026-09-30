import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, deviceCredentialsTable, profilesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// SYC-136: the client now mints device secrets as 32 cryptographically
// random bytes, base64url-encoded (RFC 4648 §5) — e.g.
// crypto.getRandomValues/expo-crypto output run through a base64url
// encoder, unpadded, ~43 characters for 32 bytes. This locks in that
// deviceAuth.ts (MIN_SECRET_LENGTH=16, MAX_SECRET_LENGTH=256, no character
// restriction — it's hashed and compared as an opaque string) actually
// accepts that shape end to end, not just secrets shaped like the old
// Math.random()-based `sec-<base36>-<base36>` format.

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

// A realistic 32-byte base64url secret, matching DeviceContext.tsx's
// makeDeviceSecret() output shape: unpadded base64url, 43 chars, drawn from
// the full base64url alphabet (upper, lower, digit, '-', '_').
const NEW_FORMAT_SECRET = "aZ9-_QeK3mN0pXyB7cVdG5hLtR2sW8fD1jU4oI6nE0k";
const OTHER_NEW_FORMAT_SECRET = "Q1w2E3r4T5y6U7i8O9p0A-B_cDeFgHiJkLmNoPqRsTu";
const DEVICE_ID = "vitest-syc136-new-secret-format";

expect(NEW_FORMAT_SECRET).toHaveLength(43);
expect(NEW_FORMAT_SECRET).toMatch(/^[A-Za-z0-9_-]+$/);

async function cleanup() {
  await db
    .delete(profilesTable)
    .where(inArray(profilesTable.deviceId, [DEVICE_ID]));
  await db
    .delete(deviceCredentialsTable)
    .where(inArray(deviceCredentialsTable.deviceId, [DEVICE_ID]));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("deviceAuth accepts the new base64url secret format (SYC-136)", () => {
  it("binds a 32-byte base64url secret on first use and accepts it on later requests", async () => {
    const first = await request(app)
      .get(`/api/profiles/${DEVICE_ID}`)
      .set("X-Device-Secret", NEW_FORMAT_SECRET)
      .expect(200);
    expect(first.body.deviceId).toBe(DEVICE_ID);

    const again = await request(app)
      .get(`/api/profiles/${DEVICE_ID}`)
      .set("X-Device-Secret", NEW_FORMAT_SECRET)
      .expect(200);
    expect(again.body.deviceId).toBe(DEVICE_ID);
  });

  it("rejects a different base64url-shaped secret for the now-bound device id", async () => {
    await request(app)
      .get(`/api/profiles/${DEVICE_ID}`)
      .set("X-Device-Secret", OTHER_NEW_FORMAT_SECRET)
      .expect(403);
  });
});
