import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, profilesTable, deviceCredentialsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";
import router from "./profiles";
import {
  _resetBadgeMomentsDeviceLimitForTests,
  BADGE_MOMENTS_DEVICE_LIMIT,
  badgeMomentsIpGuard,
  checkBadgeMomentsDeviceLimit,
} from "../middlewares/rateLimit";

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } };

// SYC-706: the three badge routes run the loose IP guard first, then count
// against the verified device inside the handler (after requireDeviceAuth).
const ROUTES: [string, string][] = [
  ["get", "/profiles/:deviceId/moments"],
  ["post", "/profiles/:deviceId/moments/:id/celebrated"],
  ["post", "/profiles/:deviceId/badges/seen"],
];

const A = "vitest-badgelimit-a";
const B = "vitest-badgelimit-b";
const SECRET_A = "badgelimit-secret-a-0123456789abcdef";
const SECRET_B = "badgelimit-secret-b-0123456789abcdef";

async function cleanup() {
  await db.delete(profilesTable).where(inArray(profilesTable.deviceId, [A, B]));
  await db.delete(deviceCredentialsTable).where(inArray(deviceCredentialsTable.deviceId, [A, B]));
  await _resetBadgeMomentsDeviceLimitForTests();
}

beforeAll(async () => {
  await cleanup();
  await request(app).get(`/api/profiles/${A}`).set("X-Device-Secret", SECRET_A).expect(200);
  await request(app).get(`/api/profiles/${B}`).set("X-Device-Secret", SECRET_B).expect(200);
});
afterEach(_resetBadgeMomentsDeviceLimitForTests);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("badge routes rate limit", () => {
  it.each(ROUTES)("%s %s runs the IP guard first", (method, path) => {
    const layer = (router as unknown as { stack: Layer[] }).stack.find(
      (l) => l.route?.path === path && l.route.methods[method],
    );
    expect(layer?.route).toBeDefined();
    const handles = layer!.route!.stack.map((s) => s.handle);
    expect(handles[0]).toBe(badgeMomentsIpGuard);
    expect(handles.length).toBeGreaterThan(1);
  });

  it("limits each verified device on its own, not the address", async () => {
    for (let i = 0; i < BADGE_MOMENTS_DEVICE_LIMIT; i++) {
      expect((await checkBadgeMomentsDeviceLimit(A)).allowed).toBe(true);
    }
    // A has spent its budget: refused with Retry-After.
    const refused = await request(app).get(`/api/profiles/${A}/moments`).set("X-Device-Secret", SECRET_A);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);

    // B, same test address, is untouched.
    await request(app).get(`/api/profiles/${B}/moments`).set("X-Device-Secret", SECRET_B).expect(200);
  });

  it("a wrong secret is refused by auth and spends no device budget", async () => {
    await request(app).get(`/api/profiles/${A}/moments`).set("X-Device-Secret", SECRET_B).expect(403);
    // The full budget is still there: 120 allowed, the 121st refused.
    for (let i = 0; i < BADGE_MOMENTS_DEVICE_LIMIT; i++) {
      expect((await checkBadgeMomentsDeviceLimit(A)).allowed).toBe(true);
    }
    expect((await checkBadgeMomentsDeviceLimit(A)).allowed).toBe(false);
  });
});
