/**
 * SYC-795 (launch-measures-report-design.md §4.4): the phone reports its own
 * whole-trip wait for look-alikes, once, into sighting_matches.phone_wait_ms.
 * Checked like every device-owned route (404, 403, then the secret), and
 * answered 204 whether or not a row changed, so the route says nothing about
 * what is stored.
 *
 * Works far out at sea, like sightings.waitTime.test.ts. No assertion reads
 * the wall clock.
 */
import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  photosTable,
  sightingsTable,
  sightingMatchesTable,
  profilesTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { type LatLng } from "@workspace/geo";
import { blurPosition } from "../lib/blur";

const { matchCatPhoto } = vi.hoisted(() => ({ matchCatPhoto: vi.fn() }));
vi.mock("../lib/matching", () => ({ matchCatPhoto }));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";

const DEVICE = "vitest-phonewait-device";
const OTHER = "vitest-phonewait-other";
const SECRET = "vitest-phonewait-secret-0123456789abcd";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let spots = 0;
/** Open sea south-east of Syros, about 5 km apart per test. */
function spot(): LatLng {
  return blurPosition(37.15, 25.1 + ++spots * 0.06);
}

let tick = 0;
const nextCapturedAt = () => new Date(Date.now() - 300_000 + ++tick * 1000).toISOString();

async function send(device: string): Promise<number> {
  const at = spot();
  const res = await request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", SECRET)
    .send({
      deviceId: device,
      lat: at.lat,
      lng: at.lng,
      photoBase64: TINY_JPEG_B64,
      capturedAt: nextCapturedAt(),
    });
  expect(res.status, `send refused: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body.sightingId as number;
}

function postWait(sightingId: number, body: object, secret = SECRET) {
  return request(app)
    .post(`/api/sightings/${sightingId}/wait`)
    .set("X-Device-Secret", secret)
    .send(body);
}

async function phoneWait(sightingId: number): Promise<number | null | undefined> {
  const [row] = await db
    .select({ phoneWaitMs: sightingMatchesTable.phoneWaitMs })
    .from(sightingMatchesTable)
    .where(eq(sightingMatchesTable.sightingId, sightingId));
  return row?.phoneWaitMs;
}

async function cleanup() {
  const rows = await db
    .select({ id: sightingsTable.id, photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, "vitest-phonewait-%"));
  if (rows.length > 0) {
    await db
      .delete(sightingMatchesTable)
      .where(inArray(sightingMatchesTable.sightingId, rows.map((r) => r.id)));
  }
  await deleteTestSightings(like(sightingsTable.deviceId, "vitest-phonewait-%"));
  if (rows.length > 0) {
    await db.delete(photosTable).where(inArray(photosTable.id, rows.map((r) => r.photoId)));
  }
  await db.delete(profilesTable).where(like(profilesTable.deviceId, "vitest-phonewait-%"));
}

beforeAll(cleanup);
beforeEach(() => {
  matchCatPhoto.mockReset();
  matchCatPhoto.mockImplementation(async () => ({ isCatPhoto: true, matches: [] }));
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("POST /sightings/:id/wait (SYC-795 §4.4)", () => {
  it("writes the phone's wait once; a second post keeps the first", async () => {
    const id = await send(DEVICE);
    expect(await phoneWait(id)).toBeNull();

    const first = await postWait(id, { deviceId: DEVICE, waitMs: 4200 });
    expect(first.status, JSON.stringify(first.body)).toBe(204);
    expect(await phoneWait(id)).toBe(4200);

    const second = await postWait(id, { deviceId: DEVICE, waitMs: 9000 });
    expect(second.status).toBe(204);
    expect(await phoneWait(id)).toBe(4200);
  });

  it("accepts the bounds 0 and 600000", async () => {
    const a = await send(DEVICE);
    expect((await postWait(a, { deviceId: DEVICE, waitMs: 0 })).status).toBe(204);
    expect(await phoneWait(a)).toBe(0);
    const b = await send(DEVICE);
    expect((await postWait(b, { deviceId: DEVICE, waitMs: 600000 })).status).toBe(204);
    expect(await phoneWait(b)).toBe(600000);
  });

  it("refuses a sighting that doesn't exist (404)", async () => {
    expect((await postWait(2_000_000_000, { deviceId: DEVICE, waitMs: 100 })).status).toBe(404);
  });

  it("refuses another phone's sighting (403) and writes nothing", async () => {
    const id = await send(DEVICE);
    const res = await postWait(id, { deviceId: OTHER, waitMs: 100 });
    expect(res.status).toBe(403);
    expect(await phoneWait(id)).toBeNull();
  });

  it("refuses the right device id with the wrong secret and writes nothing", async () => {
    const id = await send(DEVICE);
    const res = await postWait(id, { deviceId: DEVICE, waitMs: 100 }, "vitest-phonewait-wrong-secret-0123456789");
    expect(res.status).toBe(403);
    expect(await phoneWait(id)).toBeNull();
  });

  it.each([
    ["-1", -1],
    ["600001", 600001],
    ["1.5", 1.5],
    ['"100"', "100"],
  ])("refuses a waitMs of %s (400)", async (_label, waitMs) => {
    const id = await send(DEVICE);
    const res = await postWait(id, { deviceId: DEVICE, waitMs });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await phoneWait(id)).toBeNull();
  });

  it("with no match record answers 204 and writes nothing", async () => {
    const id = await send(DEVICE);
    await db.delete(sightingMatchesTable).where(eq(sightingMatchesTable.sightingId, id));
    const res = await postWait(id, { deviceId: DEVICE, waitMs: 100 });
    expect(res.status).toBe(204);
    expect(await phoneWait(id)).toBeUndefined();
  });

  it("after a failed check answers 204 and writes nothing", async () => {
    matchCatPhoto.mockRejectedValueOnce(new Error("Connection error."));
    const id = await send(DEVICE);
    const [row] = await db
      .select({ matcherFailed: sightingMatchesTable.matcherFailed })
      .from(sightingMatchesTable)
      .where(eq(sightingMatchesTable.sightingId, id));
    expect(row?.matcherFailed).toBe(true);
    const res = await postWait(id, { deviceId: DEVICE, waitMs: 100 });
    expect(res.status).toBe(204);
    expect(await phoneWait(id)).toBeNull();
  });
});
