import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  photosTable,
  sightingsTable,
  deviceCredentialsTable,
} from "@workspace/db";
import { eq, like } from "drizzle-orm";

// SYC-92: POST /api/sightings must require verifyDeviceSecret, matching the
// resolve route. Before this, anyone could post a sighting under any device
// id; combined with PR #9's dedupe-hit response (which returns an existing
// sighting's id, location and matched cats for a repeat device id +
// capturedAt), an unauthenticated upload route was the one place a device id
// was taken on trust.
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const DEVICE = "vitest-sightings-auth-device";
const SECRET_A = "vitest-sightings-auth-secret-aaaa";
const SECRET_B = "vitest-sightings-auth-secret-bbbb";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

async function cleanup() {
  const rows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  await db.delete(sightingsTable).where(like(sightingsTable.deviceId, `${DEVICE}%`));
  for (const r of rows) {
    await db.delete(photosTable).where(eq(photosTable.id, r.photoId));
  }
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

function submit(deviceId: string, opts: { secret?: string; capturedAt?: string } = {}) {
  const req = request(app).post("/api/sightings");
  if (opts.secret) req.set("X-Device-Secret", opts.secret);
  return req.send({
    deviceId,
    lat: 37.44,
    lng: 24.9,
    photoBase64: TINY_JPEG_B64,
    ...(opts.capturedAt ? { capturedAt: opts.capturedAt } : {}),
  });
}

describe("POST /api/sightings device auth (SYC-92)", () => {
  it("rejects an upload with no X-Device-Secret header at all", async () => {
    const device = `${DEVICE}-a`;
    const res = await submit(device);
    expect(res.status).toBe(401);

    const rows = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, device));
    expect(rows).toHaveLength(0);
  });

  it("rejects a secret that's too short", async () => {
    const device = `${DEVICE}-b`;
    const res = await submit(device, { secret: "short" });
    expect(res.status).toBe(401);
  });

  it("binds the secret on first upload (TOFU) and allows the same device to upload again", async () => {
    const device = `${DEVICE}-c`;
    const first = await submit(device, { secret: SECRET_A });
    expect(first.status).toBe(201);

    const second = await submit(device, {
      secret: SECRET_A,
      capturedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(second.status).toBe(201);
  });

  it("rejects a different secret for an already-bound device id (BOLA)", async () => {
    const device = `${DEVICE}-d`;
    const owner = await submit(device, { secret: SECRET_A });
    expect(owner.status).toBe(201);

    const attacker = await submit(device, {
      secret: SECRET_B,
      capturedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(attacker.status).toBe(403);

    // Only the owner's original sighting exists — the attacker's attempt
    // under the same device id never got as far as writing a row.
    const rows = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, device));
    expect(rows).toHaveLength(1);
  });

  it("also gates the dedupe-hit response — the ticket's stated minimum", async () => {
    const device = `${DEVICE}-e`;
    const capturedAt = new Date(Date.now() - 60_000).toISOString();

    const first = await submit(device, { secret: SECRET_A, capturedAt });
    expect(first.status).toBe(201);

    // A repeat of the same device id + capturedAt without the secret must
    // not return the existing sighting (id, location, matched cats).
    const repeatNoAuth = await submit(device, { capturedAt });
    expect(repeatNoAuth.status).toBe(401);
    expect(repeatNoAuth.body).not.toHaveProperty("sightingId");
  });
});
