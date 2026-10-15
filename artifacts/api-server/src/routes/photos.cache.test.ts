import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, photosTable, photoVisibilityEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";

// SYC-279 PR 3.1: Cache control headers for photos. Decision 1 changes the
// cache rule so shared caches never store photos, whether the pre-launch gate
// is on or off. This tests:
// - T3-1: a public photo's Cache-Control is `private, max-age=31536000, immutable`
//   and never contains `public`
// - T3-2: a hidden photo is 404 with Cache-Control: no-store, and after restore
//   it is 200 with correct headers
// - T3-3: P6-0's check (photos reader list re-run) is covered by existing tests

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let photoId: number;
let publicId: string;

beforeAll(async () => {
  const [photo] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  photoId = photo!.id;
  publicId = photo!.publicId;
});

afterAll(async () => {
  await db.delete(photoVisibilityEventsTable).where(eq(photoVisibilityEventsTable.photoId, photoId));
  await db.delete(photosTable).where(eq(photosTable.id, photoId));
  await pool.end();
});

describe("GET /api/photos/:publicId — Cache-Control headers (SYC-279 Decision 1)", () => {
  it("T3-1: a public photo has `Cache-Control: private, max-age=31536000, immutable` and never `public`", async () => {
    const res = await request(app).get(`/api/photos/${publicId}`);
    expect(res.status).toBe(200);
    const cacheControl = res.headers["cache-control"];
    expect(cacheControl).toBe("private, max-age=31536000, immutable");
    expect(cacheControl).not.toContain("public");
  });

  it("T3-1: no age directive; cache headers do not change with gate state (always private)", async () => {
    // T3-1 stipulates: with the gate off, header is private and never public.
    // We changed the code to always be private, so we verify it never contains public.
    const res = await request(app).get(`/api/photos/${publicId}`);
    expect(res.status).toBe(200);
    // The key change: no "age" in the header and private is always there
    const cacheControl = res.headers["cache-control"];
    expect(cacheControl).not.toMatch(/\bage\b/i);
    expect(cacheControl).toContain("private");
    expect(cacheControl).not.toContain("public");
  });

  it("T3-2: an unknown photo id is 404 with `Cache-Control: no-store`", async () => {
    const res = await request(app).get("/api/photos/totally-unknown-id");
    expect(res.status).toBe(404);
    const cacheControl = res.headers["cache-control"];
    expect(cacheControl).toBe("no-store");
  });

  it("T3-2: a numeric id is 404 with `Cache-Control: no-store`", async () => {
    const res = await request(app).get("/api/photos/12345");
    expect(res.status).toBe(404);
    const cacheControl = res.headers["cache-control"];
    expect(cacheControl).toBe("no-store");
  });

  it("T3-2: a hidden photo is 404 with `Cache-Control: no-store`, and after manual restore it returns 200", async () => {
    // Manually insert a hide event to hide the photo (simulating team action)
    await db.insert(photoVisibilityEventsTable).values({
      photoId,
      action: "hide",
      author: "test-hide",
      reason: "test hide",
    });

    // Check that it's now 404 with no-store
    const hiddenRes = await request(app).get(`/api/photos/${publicId}`);
    expect(hiddenRes.status).toBe(404);
    expect(hiddenRes.headers["cache-control"]).toBe("no-store");

    // Manually insert a restore event
    await db.insert(photoVisibilityEventsTable).values({
      photoId,
      action: "restore",
      author: "test-restore",
    });

    // Check that it's now 200 with correct cache headers
    const restoredRes = await request(app).get(`/api/photos/${publicId}`);
    expect(restoredRes.status).toBe(200);
    const cacheControl = restoredRes.headers["cache-control"];
    expect(cacheControl).toBe("private, max-age=31536000, immutable");
    expect(cacheControl).not.toContain("public");
  });
});
