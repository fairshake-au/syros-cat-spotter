import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray, like } from "drizzle-orm";
import {
  catsTable,
  catUpdatesTable,
  db,
  deviceCredentialsTable,
  notificationsTable,
  photosTable,
  pool,
  sightingsTable,
} from "@workspace/db";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async (_photo: string, candidates: { catId: number }[]) => ({
    isCatPhoto: true,
    matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.9, reasoning: "test" })),
  })),
}));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";

// SYC-43 part 2 plan, PR 6: for a cat with NO hidden photos, every public
// reader PR 6 touched sends exactly the bytes it sent before PR 6. The
// snapshot file next to this test was written by running this file against
// `main` at 8c36f63, before any PR 6 code existed, and is never regenerated
// by PR 6. Readers: the catalogue list, the cat's page, the NAME_TAKEN reply,
// the match candidates, the resolve reply, the notifications list and the
// "Anything to add?" card. (P3-2's own snapshot covers the cat's page too.)
// Regenerated once, on purpose, by SYC-130 (claiming a cat): `"homePin":null`
// on every public cat (the pin is owner-only) and `"canClaim":false` on the
// cat's page (no proven phone asked). No other byte changed.
// Regenerated again, on purpose, by SYC-2 PR 2.1: `"coat":[],"markings":[]`
// on every public cat (an undescribed cat). No other byte changed.
//
// Only values the database or the clock hand out (serial ids, the upload's
// random public id, today's date) are swapped for placeholders; every other
// byte, including key order, is compared as sent.

const PREFIX = "vitest-p6snap-";
const DEVICE = `${PREFIX}device`;
const SECRET = "vitest-p6snap-secret-0123456789abcdef";
const ORIGIN = { lat: 34.6123, lng: 21.1189 };
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const NAME = `${PREFIX}Φλόκα`;
let catId: number;

async function cleanup() {
  const cats = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  if (cats.length > 0) {
    const ids = cats.map((c) => c.id);
    const updates = await db
      .select({ id: catUpdatesTable.id })
      .from(catUpdatesTable)
      .where(inArray(catUpdatesTable.catId, ids));
    if (updates.length > 0) {
      await db.delete(notificationsTable).where(inArray(notificationsTable.catUpdateId, updates.map((u) => u.id)));
    }
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, ids));
  }
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(async () => {
  await cleanup();
  const photos = await db
    .insert(photosTable)
    .values(
      ["main", "s1", "own"].map((p) => ({
        publicId: `${PREFIX}${p}`,
        data: TINY_JPEG_B64,
        mime: "image/jpeg",
      })),
    )
    .returning({ id: photosTable.id });
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: NAME,
      description: "Waits by the bakery",
      primaryPhotoId: photos[0]!.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      discovererDeviceId: `${PREFIX}discoverer`,
      createdAt: new Date("2026-09-01T09:00:00Z"),
    })
    .returning({ id: catsTable.id });
  catId = cat!.id;
  await db.insert(sightingsTable).values([
    {
      catId,
      deviceId: `${PREFIX}spotter`,
      photoId: photos[1]!.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      status: "resolved",
      createdAt: new Date("2026-09-10T08:30:00Z"),
    },
    {
      // The caller's own, recent: on the "Anything to add?" card.
      catId,
      deviceId: DEVICE,
      photoId: photos[2]!.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      status: "resolved",
      // An hour ago, but never before today's UTC midnight: lastSeenAt is a UTC
      // day, and the snapshot swaps today's date for <today> (failed 00:00–01:00 UTC).
      createdAt: new Date(Math.max(Date.now() - 3_600_000, new Date().setUTCHours(0, 0, 1, 0))),
    },
  ]);
  const [update] = await db
    .insert(catUpdatesTable)
    .values({ catId, updateType: "general", message: "Fed today", createdAt: new Date("2026-09-12T10:00:00Z") })
    .returning();
  await db
    .insert(notificationsTable)
    .values({ deviceId: DEVICE, catUpdateId: update!.id, createdAt: new Date("2026-09-12T10:00:00Z") });
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

/**
 * Swap what the database and the clock hand out, by key, and keep every other
 * byte. Express sends JSON.stringify's output, so parse-and-stringify is the
 * identity (checked first), and key order survives.
 */
function placeholders(text: string): string {
  expect(JSON.stringify(JSON.parse(text))).toBe(text);
  const today = new Date().toISOString().slice(0, 10);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "catId" || (k === "id" && x === catId && "name" in (v as object))) out[k] = x === catId ? "<cat>" : x;
      else if (["id", "catUpdateId", "sightingId"].includes(k) && typeof x === "number") out[k] = "<n>";
      else if (k === "takenAt") out[k] = "<recent>";
      else if (typeof x === "string" && x.startsWith(today)) out[k] = "<today>";
      else out[k] = walk(x);
    }
    return out;
  };
  return JSON.stringify(walk(JSON.parse(text)));
}

describe("PR 6: public payloads for a cat with no hidden photos are unchanged", () => {
  it("sends exactly the bytes it sent before PR 6", async () => {
    const sections: string[] = [];

    const list = await request(app).get(`/api/cats?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&pageSize=200`);
    expect(list.status).toBe(200);
    placeholders(list.text);
    const entry = (JSON.parse(list.text).cats as { id: number }[]).find((c) => c.id === catId);
    sections.push(`list: ${placeholders(JSON.stringify(entry))}`);

    const page = await request(app).get(`/api/cats/${catId}`);
    sections.push(`detail: ${placeholders(page.text)}`);

    // SYC-130 removed POST /cats (D7); an owner's rename to a taken name is
    // the same NAME_TAKEN reply (nameTakenBody), so the bytes don't change.
    const [own] = await db
      .insert(catsTable)
      .values({
        name: `${PREFIX}renamer`,
        description: "",
        primaryPhotoId: 0,
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        discovererDeviceId: DEVICE,
        ownerDeviceId: DEVICE,
      })
      .returning({ id: catsTable.id });
    const taken = await request(app)
      .patch(`/api/cats/${own!.id}`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, name: NAME });
    expect(taken.status).toBe(409);
    sections.push(`name_taken: ${placeholders(taken.text)}`);

    const notes = await request(app).get(`/api/notifications/${DEVICE}`).set("X-Device-Secret", SECRET);
    expect(notes.status).toBe(200);
    sections.push(`notifications: ${placeholders(notes.text)}`);

    const card = await request(app)
      .get(`/api/profiles/${DEVICE}/cats/${catId}/open-sightings`)
      .set("X-Device-Secret", SECRET);
    expect(card.status).toBe(200);
    sections.push(`open_sightings: ${placeholders(card.text)}`);

    const sighting = await request(app)
      .post("/api/sightings")
      .set("X-Device-Secret", SECRET)
      .send({
        deviceId: DEVICE,
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        photoBase64: TINY_JPEG_B64,
        capturedAt: new Date(Date.now() - 7_200_000).toISOString(),
      });
    expect(sighting.status).toBe(201);
    sections.push(`candidates: ${placeholders(sighting.text)}`);

    const resolved = await request(app)
      .post(`/api/sightings/${sighting.body.sightingId}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, catId });
    expect(resolved.status).toBe(200);
    // The resolve reply's cat (the rest is this device's points and badges,
    // which depend on whatever else is in the database).
    sections.push(`resolve: ${placeholders(JSON.stringify(resolved.body.cat))}`);

    await expect(sections.join("\n") + "\n").toMatchFileSnapshot("./__snapshots__/publicPayload.p6.txt");
  });
});
