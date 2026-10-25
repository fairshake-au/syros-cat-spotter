/**
 * SYC-532: a run of failed look-alike checks on POST /api/sightings queues
 * one "failing" email for the team, and nothing for the spotter changes.
 * Works far out at sea, like sightings.recheck.test.ts.
 */
import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, mailOutboxTable, photosTable, sightingsTable, sightingMatchesTable, profilesTable } from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { blurPosition } from "../lib/blur";
import { OUTAGE_FAILURES } from "../lib/matcherHealth";

const { matchCatPhoto } = vi.hoisted(() => ({ matchCatPhoto: vi.fn() }));
vi.mock("../lib/matching", () => ({ matchCatPhoto }));
vi.mock("../lib/mail/outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/mail/outbox")>()),
  kickRow: vi.fn(),
}));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";

const SECRET = "vitest-matcheralert-secret-0123456789ab";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let n = 0;
function send() {
  const at = blurPosition(37.2, 25.9 + ++n * 0.06);
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", SECRET)
    .send({
      deviceId: `vitest-matcheralert-${n}`,
      lat: at.lat,
      lng: at.lng,
      photoBase64: TINY_JPEG_B64,
      capturedAt: new Date(Date.now() - 300_000 + n * 1000).toISOString(),
    });
}
const alerts = () => db.select().from(mailOutboxTable).where(eq(mailOutboxTable.purpose, "matcher_alert"));

async function cleanup() {
  await db.delete(mailOutboxTable).where(eq(mailOutboxTable.purpose, "matcher_alert"));
  const rows = await db
    .select({ id: sightingsTable.id, photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, "vitest-matcheralert-%"));
  if (rows.length) await db.delete(sightingMatchesTable).where(inArray(sightingMatchesTable.sightingId, rows.map((r) => r.id)));
  await deleteTestSightings(like(sightingsTable.deviceId, "vitest-matcheralert-%"));
  if (rows.length) await db.delete(photosTable).where(inArray(photosTable.id, rows.map((r) => r.photoId)));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, "vitest-matcheralert-%"));
}

beforeAll(cleanup);
beforeEach(async () => {
  await cleanup();
  process.env["MATCHER_ALERT_TO"] = "samuel@example.org";
  matchCatPhoto.mockReset();
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("failed checks reach the team", () => {
  it("the fifth failure queues one email; the spotter still gets the plain 'failed' answer", async () => {
    matchCatPhoto.mockRejectedValue(new Error("Connection error."));
    for (let i = 1; i < OUTAGE_FAILURES; i++) {
      const res = await send();
      expect(res.body).toMatchObject({ matchCheck: "failed", canRecheck: true });
      expect(await alerts()).toHaveLength(0);
    }
    const fifth = await send();
    expect(fifth.status).toBe(201);
    expect(fifth.body).toMatchObject({ matchCheck: "failed", candidates: [] });
    expect(await alerts()).toHaveLength(1);
    await send();
    expect(await alerts()).toHaveLength(1);
  });

  it("checks that work send nothing", async () => {
    matchCatPhoto.mockResolvedValue({ isCatPhoto: true, matches: [] });
    for (let i = 0; i < OUTAGE_FAILURES + 1; i++) await send();
    expect(await alerts()).toHaveLength(0);
  });
});
