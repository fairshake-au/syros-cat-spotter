import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, photosTable, photoVisibilityEventsTable } from "@workspace/db";
import app from "../app";

// SYC-279 PR 3.1 (plan Decision 1): shared caches never store photos.
// - T3-1: with the pre-launch gate off (the test default), a public photo is
//   `private, max-age=31536000, immutable` and never `public`.
// - T3-2: a hidden, unknown or numeric id is 404 with `no-store`, and a
//   restored photo is 200 again at once.
// T3-3 (no hidden photo reaches a public reader) is photoVisibility.test.ts
// and publicPayload.p6.test.ts, unchanged.
//
// photo_visibility_events is add-only (a trigger refuses update and delete),
// so this file leaves its rows; the throwaway test database goes at the end.

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

async function newPhoto() {
  const [photo] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return photo!;
}

async function setVisibility(photoId: number, action: "hide" | "restore") {
  await db
    .insert(photoVisibilityEventsTable)
    .values({ photoId, action, author: "report:photos-cache-test", personId: null });
}

let photo: Awaited<ReturnType<typeof newPhoto>>;

beforeAll(async () => {
  delete process.env["PRELAUNCH_GATE"];
  photo = await newPhoto();
});

afterAll(async () => {
  await pool.end();
});

describe("GET /api/photos/:publicId: Cache-Control (SYC-279, Decision 1)", () => {
  it("T3-1: a public photo is `private, max-age=31536000, immutable`, never `public`", async () => {
    const res = await request(app).get(`/api/photos/${photo.publicId}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(res.headers["cache-control"]).not.toContain("public");
  });

  it("T3-2: an unknown photo id is 404 with `no-store`", async () => {
    const res = await request(app).get("/api/photos/totally-unknown-id");
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("T3-2: a numeric id is 404 with `no-store`", async () => {
    const res = await request(app).get("/api/photos/12345");
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("T3-2: a hidden photo is 404 with `no-store`; restored, it is 200 and private at once", async () => {
    const p = await newPhoto();
    await setVisibility(p.id, "hide");
    const hidden = await request(app).get(`/api/photos/${p.publicId}`);
    expect(hidden.status).toBe(404);
    expect(hidden.headers["cache-control"]).toBe("no-store");

    await setVisibility(p.id, "restore");
    const back = await request(app).get(`/api/photos/${p.publicId}`);
    expect(back.status).toBe(200);
    expect(back.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
  });
});
